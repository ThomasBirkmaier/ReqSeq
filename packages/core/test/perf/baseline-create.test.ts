// Performance suite (ADR-0011): `baseline.create` (SR-050) of the whole generated workspace of N-036
// (50,000 elements, Git repositories, store warmed). ADR-0018 bounds it by 3 s; SR-050 names no time,
// so the bound is recorded (`thresholdMs`), not asserted.
import fs from "node:fs";
import path from "node:path";
import type { LargeFixtureWorkspace } from "@reqseq/testkit";
import { generateLargeWorkspace, measure, writeLargeWorkspace } from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanBaseline } from "../../src/baselines/scan.js";
import type { CommandOutput } from "../../src/catalog.js";
import { elementStoreState } from "../../src/model/index.js";
import { getCommandRuntime, invoke } from "../../src/runtime/invoke.js";
import { warmWorkspace } from "../../src/runtime/warm.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { standardModel, versionOf } from "./core-version.js";

const ELEMENTS = 50_000;
const RELATIONS = 200_000;

describe("baseline.create with 50,000 elements (SR-050, N-036, ADR-0018)", () => {
  let fixture: LargeFixtureWorkspace | undefined;
  let workspace: Workspace | undefined;

  beforeAll(async () => {
    const version = versionOf(await standardModel());
    const tree = generateLargeWorkspace({ version, elements: ELEMENTS, relations: RELATIONS });
    fixture = await writeLargeWorkspace(tree, { git: true });
    workspace = new Workspace(fixture.workspaceRoot);
    getCommandRuntime();
    await warmWorkspace(workspace);
    expect((await workspace.get(elementStoreState)).elements).toHaveLength(ELEMENTS);
  }, 600_000);

  afterAll(async () => {
    await workspace?.close();
    await fixture?.cleanup();
  });

  it("writes a baseline of the whole workspace", async () => {
    const opened = workspace;
    if (opened === undefined || fixture === undefined) {
      throw new Error("no workspace");
    }
    const { result } = await measure(
      "baseline.create: 50,000 elements",
      async () =>
        (await invoke(
          "baseline.create",
          { name: "Everything", selection: {} },
          { workspace: opened },
        )) as CommandOutput<"baseline.create">,
      { basis: "N-036, ADR-0018 (no SR threshold)", thresholdMs: 3000 },
    );
    expect(result.baseline.elements).toBe(ELEMENTS);
    const text = fs.readFileSync(
      path.join(fixture.workspaceRoot, ...result.baseline.file.split("/")),
      "utf8",
    );
    expect(scanBaseline(text)?.elements).toHaveLength(ELEMENTS);
  });
});
