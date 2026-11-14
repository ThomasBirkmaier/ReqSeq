// A save with older criteria (#1418, SR-031 AK11, SR-204) in the performance suite (ADR-0011) on the
// generated workspace of N-036 (50,000 elements, 200,000 relations) with the records of
// `withEvidenceRecords`, every acceptance criterion keyed, and Markdown verification records that
// name criteria by number: one for every tenth system requirement, at its version of the first
// commit. The first 1,000 of them got a new text in a second commit, so their records are of an
// older version and the status resolves their numbers through Git (`olderCriteriaState`).
//
// A server workspace is warmed as the app keeps it (the verification status with the subtrees of
// the top requirements walked). Each run saves another requirement whose records name numbers of
// its current version (`element.update` of its first criterion), which makes those records older
// ones, then shows the saved requirement and the top requirement above it (`element.get`): the
// status is carried over the save, computing again only the saved requirement and its ancestors
// (`withOlder` in `verification.ts`). For comparison, the same reads after the status was reset,
// as before #1418. No SR names a time for it: recorded, untagged.
//
// `workspace.check` with outdated criteria named (#1420, SR-205 AK2): the first `NAMED` requirements
// whose records became older get a record of their current version for every other criterion, so
// criterion 1 alone has records of older versions only and each `evidence.outdated` names it with
// number, key and text (`criteria`). Recorded: the time, the size of the output and the share of the
// `criteria` fields in it.
import type { GeneratedElement, GeneratedWorkspace, LargeFixtureWorkspace } from "@reqseq/testkit";
import {
  generateLargeWorkspace,
  recordValue,
  withEvidenceRecords,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import fs from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { olderCriteriaState, verificationState } from "../../src/evidence/index.js";
import { CommandError, type CommandOutput } from "../../src/catalog.js";
import { NO_OLDER_CRITERIA } from "../../src/evidence/criteria.js";
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { standardModel, versionOf } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;
/** Every this many system requirements get a record by number. */
const NUMBERED_EVERY = 10;
/** Of those, the first this many got a new text in a second commit: their records are older ones. */
const OLDER = 1000;
/** Saves; the first `WARM_UP` are not counted (JIT). */
const RUNS = 12;
const WARM_UP = 2;
/** Top requirements whose subtrees the warm status has walked. */
const TOPS = 200;
const BASIS = "SR-031 AK11, SR-204, N-036 (#1418; recorded, untagged)";
/** Requirements whose `evidence.outdated` names an outdated criterion (#1420). */
const NAMED = 500;

/** A passed Markdown verification record of `element` at `version` that names criterion 1. */
const numberedRecord = (element: GeneratedElement): string =>
  "---\nreqseq-record: 1\nkind: verification\n" +
  `element: ${element.id}\nversion: ${element.version}\nmethod: inspection\nitem: review-1418\n` +
  "result: passed\ndate: 2026-10-30T10:00:00Z\ncriteria: [1]\n---\n";

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.floor(sorted.length / 2)]);
};

describe("a save that makes records by number older, with 50,000 elements (#1418, N-036)", () => {
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;
  let numbered: readonly GeneratedElement[] = [];
  let tops: readonly string[] = [];

  const ws = (): Workspace => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    return workspace;
  };
  const get = async (id: string): Promise<CommandOutput<"element.get">> =>
    (await invoke("element.get", { ref: id }, { workspace: ws() })) as CommandOutput<"element.get">;

  beforeAll(async () => {
    const version = versionOf(await standardModel());
    const evidence = withEvidenceRecords(
      generateLargeWorkspace({ version, elements: ELEMENTS, relations: RELATIONS }),
    );
    const generated = evidence.workspace;
    const parents = new Set(evidence.parents);
    numbered = generated.elements
      .filter((e) => e.type === "system-requirement" && !parents.has(e.id))
      .filter((_, n) => n % NUMBERED_EVERY === 0);
    tops = evidence.parents.slice(0, TOPS);
    // The generator keys every acceptance criterion (`k001` and on), the form the tool writes (ADR-0004).
    const files = new Map(generated.files);
    numbered.forEach((element, n) => {
      files.set(
        `${generated.main}/evidence/numbered/${String(Math.floor(n / 1000)).padStart(3, "0")}/${element.id}.md`,
        numberedRecord(element),
      );
    });
    const tree: GeneratedWorkspace = { ...generated, files };
    fixture = await writeLargeWorkspace(tree, { git: true });
    // The second commit: the first OLDER of them get a new text, so their records are older ones.
    const changed = new Set<string>();
    for (const element of numbered.slice(0, OLDER)) {
      const folder = generated.repositories.find((r) => r.name === element.repository)?.folder ?? "";
      const file = fixture.path(`${folder}/${element.file}`);
      await fs.writeFile(file, `${await fs.readFile(file, "utf8")}\nChanged after the review.\n`);
      changed.add(folder);
    }
    for (const folder of changed) {
      await fixture.commit(folder, "Change texts after the review");
    }
    getCommandRuntime();
    workspace = new Workspace(fixture.workspaceRoot);
    // Warm as the app keeps it: the status with the subtrees of the top requirements walked.
    expect(await ws().get(olderCriteriaState)).not.toBe(NO_OLDER_CRITERIA);
    for (const top of tops) {
      await get(top);
    }
  }, 1_800_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  it("records the save of a requirement whose records name numbers: the status carried, and built afresh for comparison", async () => {
    const saved = numbered.slice(OLDER, OLDER + RUNS);
    const carried: number[] = [];
    for (const [n, element] of saved.entries()) {
      const shown = await get(element.id);
      const [first] = (shown.element.properties["acceptance-criteria"] ?? []) as { text: string }[];
      const started = performance.now();
      await invoke(
        "element.update",
        {
          ref: element.id,
          setItems: { "acceptance-criteria": { "1": `${String(first?.text)} Saved ${String(n)}.` } },
          expectedFileSha256: shown.fileSha256,
        },
        { workspace: ws() },
      );
      await get(element.id);
      await get(tops[n % tops.length] ?? "");
      if (n >= WARM_UP) {
        carried.push(performance.now() - started);
      }
    }
    await recordValue(
      `save of a requirement whose records name numbers (now older), then element.get of it and of a top requirement: status carried (median of ${String(RUNS - WARM_UP)})`,
      median(carried),
      { basis: BASIS },
    );
    // For comparison: the same reads on a status built afresh, as every such save did before #1418.
    const fresh: number[] = [];
    for (const [n, element] of saved.slice(WARM_UP).entries()) {
      await ws().reset(verificationState);
      const started = performance.now();
      await get(element.id);
      await get(tops[(n + WARM_UP) % tops.length] ?? "");
      fresh.push(performance.now() - started);
    }
    await recordValue(
      `the same element.get calls on a status built afresh, for comparison (median of ${String(RUNS - WARM_UP)})`,
      median(fresh),
      { basis: BASIS },
    );
    expect(carried).toHaveLength(RUNS - WARM_UP);
  });

  it("records workspace.check whose outdated evidence names the criteria with number, key and text (#1420)", async () => {
    for (const element of numbered.slice(0, NAMED)) {
      const shown = await get(element.id);
      const count = ((shown.element.properties["acceptance-criteria"] ?? []) as unknown[]).length;
      if (count < 2) {
        continue;
      }
      // A requirement outside the core view takes no record there (SR-040); it is skipped.
      await invoke(
        "evidence.record",
        {
          ref: element.id,
          kind: "verification",
          method: "inspection",
          item: "review-1420",
          result: "passed",
          date: "2026-11-01T10:00:00Z",
          criteria: Array.from({ length: count - 1 }, (_, i) => i + 2),
        },
        { workspace: ws() },
      ).catch((error: unknown) => {
        if (!(error instanceof CommandError) || error.code !== "input.invalid") {
          throw error;
        }
      });
    }
    const started = performance.now();
    const out = (await invoke(
      "workspace.check",
      {},
      { workspace: ws() },
    )) as CommandOutput<"workspace.check">;
    const ms = performance.now() - started;
    const named = out.problems.filter((p) => p.code === "evidence.outdated" && p.criteria !== undefined);
    const bytes = JSON.stringify(out).length;
    const criteriaBytes = named.reduce((sum, p) => sum + JSON.stringify(p.criteria).length, 0);
    await recordValue("workspace.check with outdated evidence that names its criteria (#1420)", ms, {
      basis: "SR-205 AK2, SR-025 AK4, N-036 (recorded, untagged)",
    });
    await recordValue(
      `workspace.check output: ${(bytes / 1e6).toFixed(1)} MB of JSON, ${String(named.length)} evidence.outdated with criteria, ${(criteriaBytes / 1e3).toFixed(0)} kB of them in criteria`,
      0,
      { basis: "SR-205 AK2 (output size; recorded)" },
    );
    expect(named.length).toBeGreaterThan(0);
  }, 1_800_000);
});
