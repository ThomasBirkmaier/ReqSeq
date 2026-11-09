// A JUnit test case that names several views (SR-093 AK5) on fixtures/SR-093/views: one test case
// names the variants Linux (c1) and macOS (c2) and the core, for SR-0000a1 of `system` and SR-0000b1
// of `supplier`, which the workspace file marks `variant-independent` (SR-173). Windows (c3) is not
// named. The same on every access in packages/cli/test/cross-access.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const P = "09300093-0000-4000-8000-0000000000";
const LINUX = `${P}c1`;
const MACOS = `${P}c2`;

const open = async (): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-093/views" });
  const workspace = new Workspace(fixture.root);
  onTestFinished(async () => {
    await workspace.close();
    await fixture.cleanup();
  });
  return workspace;
};

/** The verification rows of each requirement by the last two digits of its UUID, view by view (`evidence.status`). */
const statusRows = async (workspace: Workspace): Promise<Record<string, Record<string, string>>> => {
  const out = (await invoke("evidence.status", {}, { workspace })) as CommandOutput<"evidence.status">;
  return Object.fromEntries(
    out.elements.flatMap((e) =>
      e.verification === undefined
        ? []
        : [[e.id.slice(-2), Object.fromEntries(e.verification.map((v) => [v.view.slice(-2), v.status]))]],
    ),
  );
};

const list = async (
  workspace: Workspace,
  ref: string,
  view?: string,
): Promise<CommandOutput<"evidence.list">> =>
  (await invoke(
    "evidence.list",
    { ref, ...(view === undefined ? {} : { view }) },
    { workspace },
  )) as CommandOutput<"evidence.list">;

describe("a JUnit test case for several views (SR-093 AK5)", () => {
  it("[SR-093/AK5] a test case for the variants A and B and the core verifies the requirement in each of them, and in no other variant", async () => {
    const workspace = await open();
    // `re` is the core (`core`.slice(-2)); c3 (Windows) is not named.
    expect((await statusRows(workspace))["a1"]).toEqual({
      re: "verified",
      c1: "verified",
      c2: "verified",
      c3: "open",
    });
    // One record per view, each for its view only.
    const all = await list(workspace, "SR-0000a1");
    expect(all.records.map((r) => r.variant)).toEqual([undefined, LINUX, MACOS]);
    expect((await list(workspace, "SR-0000a1", "VAR-0000c3")).records).toEqual([]);
    // Read without a finding.
    const checked = (await invoke("workspace.check", {}, { workspace })) as CommandOutput<"workspace.check">;
    expect(checked.problems.filter((p) => p.code.startsWith("evidence."))).toEqual([]);
  });

  it("[SR-093/AK5] the record of the core of a variant-independent repository counts in every variant, also one the test case does not name", async () => {
    const workspace = await open();
    expect((await statusRows(workspace))["b1"]).toEqual({
      re: "verified",
      c1: "verified",
      c2: "verified",
      c3: "verified",
    });
    // In Linux both the record of the core and that of Linux hold; the view lists the execution once.
    const linux = await list(workspace, "SR-0000b1", "VAR-0000c1");
    expect(linux.records.map((r) => r.variant)).toEqual([LINUX]);
    expect(linux.testCases.map((t) => t.executions.map((r) => r.variant))).toEqual([[LINUX]]);
    // In Windows the record of the core.
    const windows = await list(workspace, "SR-0000b1", "VAR-0000c3");
    expect(windows.records.map((r) => r.variant)).toEqual([undefined]);
    expect(windows.testCases.map((t) => t.executions.length)).toEqual([1]);
  });
});
