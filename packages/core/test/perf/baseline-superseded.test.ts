// Performance suite (ADR-0011): `baseline.get` (SR-051 AK2) on the generated workspace of N-036 (50,000 elements,
// 200,000 relations, Git repositories) whose baseline lists all elements at their current versions and many of them
// with a status that is invalid now (#2514): 10,000 system requirements obsolete already at the baseline's commit and
// 1,000 more set obsolete after it in the work tree. Their status is not part of the version (ADR-0005), so the call
// compares the 11,000 files with the blobs of the baseline's commit and parses the 1,000 that differ
// (`baselines/superseded-since.ts`); the counts say 1,000 superseded.
//
// "First" is the first call in a new `Workspace` with the model loaded and the current versions built (timed apart,
// as baseline-evidence.test.ts does), so the row holds the states and the read at the commit; "again" is the same
// call in that workspace, which keeps the answers read. No SR names a time for `baseline.get`: the rows record,
// untagged, with SR-082 AK4's 500 ms as a threshold for comparison only (as the rows of baseline-evidence.test.ts).
import type { LargeFixtureWorkspace } from "@reqseq/testkit";
import {
  generateLargeWorkspace,
  measure,
  perfSize,
  recordValue,
  scaledCount,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baselineText } from "../../src/baselines/index.js";
import type { CommandOutput } from "../../src/catalog.js";
import { currentVersionOf, currentVersions, elementStoreState, warmModel } from "../../src/model/index.js";
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { standardModel, versionOf } from "./core-version.js";

// The size of the run (#2037): N-036's 50,000 elements and 200,000 relations unless REQSEQ_PERF_ELEMENTS is set.
const { elements: ELEMENTS, relations: RELATIONS } = perfSize();
const BEFORE = scaledCount(10_000);
const AFTER = scaledCount(1000);
const LIMIT = scaledCount(5000);
const COMPARE_MS = 500;
const BASIS = "SR-051 AK2, N-036 (untagged; SR-082 AK4's 500 ms as a threshold for comparison only)";
const OBSOLETE = "status: obsolete";

type Output = CommandOutput<"baseline.get">;

describe("baseline.get with 11,000 of 50,000 entries invalid now (SR-051 AK2, N-036, #2514)", () => {
  let fixture: LargeFixtureWorkspace | undefined;

  /** A new workspace with the model loaded and the current versions built. */
  const opened = async (): Promise<Workspace> => {
    const workspace = new Workspace(String(fixture?.workspaceRoot));
    await warmModel(workspace);
    await currentVersions(workspace);
    return workspace;
  };

  beforeAll(async () => {
    const version = versionOf(await standardModel());
    const generated = generateLargeWorkspace({ version, elements: ELEMENTS, relations: RELATIONS });
    const requirements = generated.elements.filter((e) => e.type === "system-requirement");
    const folderOf = new Map(generated.repositories.map((r) => [r.name, r.folder]));
    /** The file of `element` (relative to its repository) with its status set to obsolete. */
    const obsolete = (element: (typeof requirements)[number]): readonly [string, string] => [
      element.file,
      String(generated.files.get(`${String(folderOf.get(element.repository))}/${element.file}`)).replace(
        /^status: \w+$/m,
        OBSOLETE,
      ),
    ];
    fixture = await writeLargeWorkspace(generated, { git: true });
    getCommandRuntime();
    // Obsolete at the baseline's commit: one commit per repository (`commitFiles`, no `git add`), checked out.
    const before = requirements.slice(0, BEFORE);
    const commits: { name: string; commit: string }[] = [];
    for (const { name, folder } of generated.repositories) {
      const files = Object.fromEntries(before.filter((e) => e.repository === name).map(obsolete));
      const commit = await fixture.commitFiles(files, { repository: folder, message: "obsolete" });
      await fixture.git(["-c", "checkout.workers=0", "reset", "--hard", "--quiet", commit], folder);
      commits.push({ name, commit });
    }
    // Obsolete after it, in the work tree only.
    for (const element of requirements.slice(BEFORE, BEFORE + AFTER)) {
      const [file, text] = obsolete(element);
      await fs.writeFile(path.join(fixture.root, String(folderOf.get(element.repository)), file), text);
    }
    const workspace = await opened();
    const store = await workspace.get(elementStoreState);
    const versions = await currentVersions(workspace);
    const elements = store.elements
      .map((e) => ({ id: e.id, version: String(currentVersionOf(versions, e)) }))
      .sort((x, y) => (x.id < y.id ? -1 : 1));
    await workspace.close();
    const folder = path.join(fixture.workspaceRoot, "baselines");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, "all.yaml"),
      baselineText({
        "reqseq-baseline": 1,
        name: "All",
        date: "2026-11-24T04:00:00Z",
        repositories: commits,
        elements,
      }),
    );
  }, 900_000);

  afterAll(async () => {
    await fixture?.cleanup();
  });

  it("records the first call and the call again, and counts only those superseded since", async () => {
    const workspace = await opened();
    try {
      const get = async (): Promise<Output> =>
        (await invoke("baseline.get", { baseline: "All", limit: LIMIT }, { workspace })) as Output;
      const { result } = await measure(
        "baseline.get, 50,000 entries of which 11,000 invalid now: first call after the start (current versions built)",
        get,
        { basis: BASIS },
      );
      await measure("baseline.get, 50,000 entries of which 11,000 invalid now: again (answers kept)", get, {
        basis: BASIS,
        thresholdMs: COMPARE_MS,
      });
      await recordValue(`baseline.get: ${String(BEFORE + AFTER)} entries read at the baseline commit`, 0, {
        basis: "SR-051 AK2 (size of the read, no time)",
      });
      expect(result.counts).toMatchObject({ superseded: AFTER, unchanged: ELEMENTS - AFTER, changed: 0 });
      expect(result.problems?.filter((p) => p.code.startsWith("git.")) ?? []).toEqual([]);
    } finally {
      await workspace.close();
    }
  });
});
