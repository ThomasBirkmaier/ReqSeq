// The HTML export in the performance suite (ADR-0011, SR-231, N-036): the generated workspace of 50,000 elements
// and 200,000 relations exported into an empty folder, then again over that export. Each run is recorded with its
// time, its memory and the bytes of the folder. No AK names a time for the export, so the rows are for comparison.
import fs from "node:fs/promises";
import path from "node:path";
import type { LargeFixtureWorkspace } from "@reqseq/testkit";
import {
  generateLargeWorkspace,
  measurePeakMemory,
  memoryIncrease,
  perfSize,
  recordValue,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InvokedOutput } from "../../src/catalog.js";
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { standardModel, versionOf } from "./core-version.js";

// The size of the run (#2037): N-036's 50,000 elements and 200,000 relations unless REQSEQ_PERF_ELEMENTS is set.
const { elements: ELEMENTS, relations: RELATIONS } = perfSize();
const BASIS = "SR-231, N-036: HTML export of 50,000 elements (recorded, no limit in the spec)";
/** A first export writes 50,000 pages; the suite's 600 s per test must not stop it. */
const EXPORT_TIMEOUT_MS = 1_800_000;

/** The bytes of every file below `folder`. */
const bytesOf = async (folder: string): Promise<number> => {
  let total = 0;
  for (const entry of await fs.readdir(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      total += (await fs.stat(path.join(entry.parentPath, entry.name))).size;
    }
  }
  return total;
};

describe("HTML export of 50,000 elements (SR-231, N-036)", () => {
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;

  beforeAll(async () => {
    const tree = generateLargeWorkspace({
      version: versionOf(await standardModel()),
      elements: ELEMENTS,
      relations: RELATIONS,
    });
    fixture = await writeLargeWorkspace(tree);
    workspace = new Workspace(fixture.workspaceRoot);
    getCommandRuntime();
  });

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  /** Exports into `site` once and records time, memory and bytes as `name`. */
  const exported = async (name: string): Promise<void> => {
    const opened = workspace;
    if (opened === undefined || fixture === undefined) {
      throw new Error("no workspace");
    }
    const peak = await measurePeakMemory(
      async () =>
        (await invoke(
          "html.export",
          { output: "site" },
          { workspace: opened },
        )) as InvokedOutput<"html.export">,
    );
    const bytes = await bytesOf(path.join(fixture.workspaceRoot, "site"));
    await recordValue(name, peak.ms, { basis: BASIS });
    await recordValue(`${name}: ${memoryIncrease(peak)}`, 0, { basis: BASIS });
    await recordValue(`${name}: ${String(Math.round(bytes / 1e6))} MB written`, 0, { basis: BASIS });
    expect(peak.result.pages).toBeGreaterThan(ELEMENTS / 2);
  };

  // One step per test, in order: the second exports over what the first wrote.
  it(
    "exports into an empty folder",
    async () => {
      await exported(`html.export: first export of ${String(ELEMENTS)} elements`);
    },
    EXPORT_TIMEOUT_MS,
  );

  it(
    "exports again over the earlier export",
    async () => {
      await exported(`html.export: export of ${String(ELEMENTS)} elements over the earlier one`);
    },
    EXPORT_TIMEOUT_MS,
  );
});
