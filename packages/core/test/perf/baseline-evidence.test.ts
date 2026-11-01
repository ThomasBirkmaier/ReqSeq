// Performance suite (ADR-0011): `baseline.get` with `withEvidence` (SR-094) on the generated
// workspace of N-036 (50,000 elements, 200,000 relations) with the variant rules pass of the testkit
// (100 variants, 5,000 exclusions and 5,000 replacements) and the records of `withEvidenceRecords`
// with 10 older runs (`history`: every automated test case in each). The baseline lists all 50,000
// elements at their current versions and is dated 2026-08-24T12:00:00Z, after the third of the
// history runs: the 7 later history runs and the 3 CI runs are dated after it, so `later` is filled.
// One page of 5,000 entries (the largest, catalog). Each core requirement on the page gets a row for
// the core and every variant whose view holds it (about 101 rows, SR-094 AK4); an automated one
// names about 10 later records in its core row (one per run after the baseline that ran it at the
// baseline version and did not skip it, more when other test cases name it too), so `later` grows by
// one record per such run and has no bound of its own.
//
// "Cold" is the first use after a start (as in evidence.test.ts): a new `Workspace` on the same files
// with the model loaded through the model cache and its evidence files read, so the cold call holds
// `verificationState` (the incoming relation index and the view rule index) and the page. No SR names
// a time for `baseline.get`: the rows record, untagged, with SR-082 AK4's 500 ms as a threshold for
// comparison only (as the evidence rows of #693).
import type { GeneratedEvidence, LargeFixtureWorkspace } from "@reqseq/testkit";
import {
  generateLargeWorkspace,
  measure,
  recordValue,
  withEvidenceRecords,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { baselineText } from "../../src/baselines/index.js";
import type { CommandOutput } from "../../src/catalog.js";
import { evidenceIndexState } from "../../src/evidence/index.js";
import { RACY_MS } from "../../src/model/model-cache.js";
import { currentVersionOf, currentVersions, elementStoreState, warmModel } from "../../src/model/index.js";
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { standardModel, versionOf } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
const HISTORY = 10;
const DATE = "2026-08-24T12:00:00Z";
const LIMIT = 5000;
const COMPARE_MS = 500;
const BASIS = "SR-094, N-036 (untagged; SR-082 AK4's 500 ms as a threshold for comparison only)";

type Output = CommandOutput<"baseline.get">;

describe("baseline.get withEvidence with 50,000 elements, 100 variants and their records (SR-094, N-036)", () => {
  let evidence: GeneratedEvidence;
  let fixture: LargeFixtureWorkspace | undefined;
  let cacheFolder = "";
  let current: Workspace | undefined;

  /** Closes the open workspace and opens a new one with the model loaded and the evidence files read. */
  const reopen = async (): Promise<Workspace> => {
    await current?.close();
    current = new Workspace(String(fixture?.workspaceRoot), { cacheFolder });
    await warmModel(current);
    await current.get(evidenceIndexState);
    return current;
  };

  const get = async (workspace: Workspace): Promise<Output> =>
    (await invoke(
      "baseline.get",
      { baseline: "All", withEvidence: true, limit: LIMIT },
      { workspace },
    )) as Output;

  beforeAll(async () => {
    const version = versionOf(await standardModel());
    const generated = generateLargeWorkspace({
      version,
      elements: ELEMENTS,
      relations: RELATIONS,
      variantRules: {},
    });
    evidence = withEvidenceRecords(generated, { history: HISTORY });
    fixture = await writeLargeWorkspace(evidence.workspace);
    cacheFolder = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-baseline-evidence-cache-"));
    getCommandRuntime();
    const workspace = await reopen();
    const store = await workspace.get(elementStoreState);
    const versions = await currentVersions(workspace);
    const elements = store.elements
      .map((e) => ({ id: e.id, version: String(currentVersionOf(versions, e)) }))
      .sort((x, y) => (x.id < y.id ? -1 : 1));
    const folder = path.join(fixture.workspaceRoot, "baselines");
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, "all.yaml"),
      baselineText({
        "reqseq-baseline": 1,
        name: "All",
        date: DATE,
        repositories: [{ name: store.elements[0]?.repository ?? "", commit: "a".repeat(40) }],
        elements,
      }),
    );
    // Files settled, so the model cache of the next start takes every one (`RACY_MS`).
    await new Promise((resolve) => setTimeout(resolve, 2 * RACY_MS));
  }, 900_000);

  afterAll(async () => {
    await current?.close();
    await fixture?.cleanup();
    await fs.rm(cacheFolder, { recursive: true, force: true });
  });

  it("records the evidence of a page of 5,000 entries, cold and again, with the call without evidence for comparison", async () => {
    const without = (workspace: Workspace): Promise<unknown> =>
      invoke("baseline.get", { baseline: "All", limit: LIMIT }, { workspace });
    const compared = { basis: "SR-051 (the call without evidence, for comparison)" };
    const first = await reopen();
    await measure(
      "baseline.get, 5,000 entries of 50,000, without evidence: first call after the start (current versions built)",
      () => without(first),
      compared,
    );
    const workspace = await reopen();
    const { result } = await measure(
      "baseline.get withEvidence, 5,000 entries of 50,000, 100 variants: first call after the start (current versions and status state built)",
      () => get(workspace),
      // No threshold: the first call is dominated by the current versions, which the call without
      // evidence above builds too (about 4.6 s in the container).
      { basis: BASIS },
    );
    await measure(
      "baseline.get, 5,000 entries of 50,000, without evidence: again",
      () => without(workspace),
      compared,
    );
    await measure(
      "baseline.get withEvidence, 5,000 entries of 50,000, 100 variants: again (states kept)",
      () => get(workspace),
      { basis: BASIS, thresholdMs: COMPARE_MS },
    );
    const rows = result.elements.flatMap((e) => e.verification ?? []);
    const later = rows.reduce((n, r) => n + (r.later?.length ?? 0), 0);
    const largest = rows.reduce((n, r) => Math.max(n, r.later?.length ?? 0), 0);
    const validationLater = result.elements.reduce((n, e) => n + (e.validationLater?.length ?? 0), 0);
    const bytes = Buffer.byteLength(JSON.stringify(result));
    await recordValue(
      `baseline.get withEvidence page: ${String(rows.length)} rows, ${String(later)} later records (at most ${String(largest)} in a row), ${String(validationLater)} later validation records, ${(bytes / 1e6).toFixed(1)} MB of JSON`,
      0,
      { basis: "SR-094 AK2, AK4 (size of the page, no time)" },
    );
    expect(result.elements).toHaveLength(LIMIT);
    expect(rows.length).toBeGreaterThan(LIMIT);
    expect(later).toBeGreaterThan(0);
  });
});
