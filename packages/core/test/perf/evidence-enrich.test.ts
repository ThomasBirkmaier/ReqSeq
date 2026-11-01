// E4 (#583), SR-029 (#41, PR #584): `evidence.enrichJunit` of one 50 MB JUnit file as pytest writes
// it, every test case naming a system requirement by its short ID, in the generated workspace of
// N-036 (50,000 elements, 200,000 relations), through the catalog as the CLI calls it. The model of
// the file is most of the memory (about 17 times the file); `packages/core/docs/evidence-records.md`
// states the practical ceiling on the default heap. No SR names a time or memory limit: recorded
// (ADR-0011): the time and what the call adds to the heap and to the resident memory. Its own file,
// so the Vitest process measures nothing else, and the generated tree is dropped before the call.
// A second run (SR-029 AK5, #627) enriches 50,000 test cases named in the form `sr_<id>_ak1` through
// the name pattern `{prefix}_{id}_ak{ak}`, plus two names of about 200 KB built against the matcher.
import {
  generateLargeWorkspace,
  measurePeakMemory,
  memoryIncrease,
  pytestJunit,
  recordValue,
  shortIdOf,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import type { GeneratedElement } from "@reqseq/testkit";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CommandOutput } from "../../src/catalog.js";
import { warmModel } from "../../src/model/index.js";
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { standardModel, versionOf } from "./core-version.js";

/** The size of the JUnit file (stage 4 plan, E4: "enrich of one 50 MB JUnit file"). */
const BYTES = 50_000_000;

/** Test cases of the name pattern run (N-036). */
const PATTERN_CASES = 50_000;

/**
 * A JUnit file of `PATTERN_CASES` test cases, each naming one system requirement with a unique short ID
 * as `tests::sr_<id>_ak1_check_<n>`, and two names built against the matcher: hex runs longer than 32
 * digits, and near matches whose `{ak}` has no digit.
 */
const patternJunit = (elements: readonly GeneratedElement[]): string => {
  const tails = new Map<string, number>();
  for (const element of elements) {
    tails.set(element.id.slice(-6), (tails.get(element.id.slice(-6)) ?? 0) + 1);
  }
  const named = elements.filter((e) => e.type === "system-requirement" && tails.get(e.id.slice(-6)) === 1);
  const cases: string[] = [];
  for (let n = 0; n < PATTERN_CASES; n += 1) {
    const element = named[n % named.length];
    const [prefix = "", id = ""] = element === undefined ? [] : shortIdOf(element).split("-");
    cases.push(
      `<testcase classname="tests" name="tests::${prefix.toLowerCase()}_${id}_ak1_check_${String(n)}"/>`,
    );
  }
  for (const name of [`_sr_${"f".repeat(40)}`.repeat(5_000), "sr_123456_ak_".repeat(15_000)]) {
    cases.push(`<testcase classname="tests" name="${name}"/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><testsuites><testsuite name="nextest">${cases.join("")}</testsuite></testsuites>\n`;
};

describe("SR-029: enrich of one 50 MB JUnit file with 50,000 elements (N-036, E4 #583)", () => {
  // Only what the test needs after the setup, so the generated tree and the file text can be collected.
  let cleanup: (() => Promise<void>) | undefined;
  let file = "";
  let output = "";
  let patternFile = "";
  let workspace: Workspace | undefined;
  let testCases = 0;

  beforeAll(async () => {
    const version = versionOf(await standardModel());
    const generated = generateLargeWorkspace({ version });
    // Only the members the test needs: the fixture object holds the generated tree. The workspace
    // folder is `system` in the tree root, the JUnit files go next to it.
    const { cleanup: remove, workspaceRoot } = await writeLargeWorkspace(generated);
    cleanup = remove;
    const ci = path.join(path.dirname(workspaceRoot), "ci");
    file = path.join(ci, "results.xml");
    output = path.join(ci, "enriched.xml");
    const junit = pytestJunit(generated, BYTES);
    testCases = junit.testCases;
    await fs.mkdir(ci);
    await fs.writeFile(file, junit.content);
    patternFile = path.join(ci, "nextest.xml");
    await fs.writeFile(patternFile, patternJunit(generated.elements));
    getCommandRuntime();
    workspace = new Workspace(workspaceRoot);
    await warmModel(workspace);
  }, 600_000);

  const opened = (): Workspace => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    return workspace;
  };

  afterAll(async () => {
    await workspace?.close();
    await cleanup?.();
  });

  it("records time, peak heap and peak resident memory of enriching it", async () => {
    const peak = await measurePeakMemory(
      async () =>
        (await invoke(
          "evidence.enrichJunit",
          { file, output, item: "build-e4", date: "2026-10-28T10:00:00Z" },
          { workspace: opened() },
        )) as CommandOutput<"evidence.enrichJunit">,
    );
    const { size } = await fs.stat(output);
    const basis =
      "SR-029, stage 4 plan E4 (evidence.enrichJunit through the catalog; recorded, no limit in the spec)";
    await recordValue(
      `SR-029: enrich of one ${String(Math.round(BYTES / 1e6))} MB JUnit file (${String(testCases)} test cases, ${(size / 1e6).toFixed(0)} MB written)`,
      peak.ms,
      { basis },
    );
    await recordValue(
      `SR-029: enrich of one ${String(Math.round(BYTES / 1e6))} MB JUnit file: ${memoryIncrease(peak)}`,
      0,
      { basis },
    );
    expect(peak.result.unknown).toEqual([]);
    expect(peak.result.problems).toEqual([]);
    expect(peak.result.testCases).toBe(testCases);
  });

  it("records time and memory of enriching 50,000 test cases through a name pattern (SR-029 AK5)", async () => {
    const peak = await measurePeakMemory(
      async () =>
        (await invoke(
          "evidence.enrichJunit",
          {
            file: patternFile,
            item: "build-627",
            date: "2026-11-01T10:00:00Z",
            namePattern: "{prefix}_{id}_ak{ak}",
          },
          { workspace: opened() },
        )) as CommandOutput<"evidence.enrichJunit">,
    );
    const basis =
      "SR-029 AK5, #627 (evidence.enrichJunit with a name pattern; recorded, no limit in the spec)";
    await recordValue(
      `SR-029: enrich of ${String(PATTERN_CASES)} test cases through the name pattern {prefix}_{id}_ak{ak}`,
      peak.ms,
      { basis },
    );
    await recordValue(`SR-029: enrich through a name pattern: ${memoryIncrease(peak)}`, 0, { basis });
    expect(peak.result.unknown).toEqual([]);
    expect(peak.result.problems).toEqual([]);
    expect([peak.result.testCases, peak.result.withoutReference]).toEqual([PATTERN_CASES, 2]);
  });
});
