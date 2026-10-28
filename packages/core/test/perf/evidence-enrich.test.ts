// E4 (#583), SR-029 (#41, PR #584): `evidence.enrichJunit` of one 50 MB JUnit file as pytest writes
// it, every test case naming a system requirement by its short ID, in the generated workspace of
// N-036 (50,000 elements, 200,000 relations), through the catalog as the CLI calls it. The model of
// the file is most of the memory (about 17 times the file); `packages/core/docs/evidence-records.md`
// states the practical ceiling on the default heap. No SR names a time or memory limit: recorded
// (ADR-0011): the time and what the call adds to the heap and to the resident memory. Its own file,
// so the Vitest process measures nothing else, and the generated tree is dropped before the call.
import {
  generateLargeWorkspace,
  measurePeakMemory,
  memoryIncrease,
  pytestJunit,
  recordValue,
  writeLargeWorkspace,
} from "@logreq/testkit";
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

describe("SR-029: enrich of one 50 MB JUnit file with 50,000 elements (N-036, E4 #583)", () => {
  // Only what the test needs after the setup, so the generated tree and the file text can be collected.
  let cleanup: (() => Promise<void>) | undefined;
  let file = "";
  let output = "";
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
});
