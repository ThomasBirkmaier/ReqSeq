// workspace.check with more findings than fit as arguments of one call (N-036: 50,000 elements can
// give hundreds of thousands of findings, e.g. after one typo in the metamodel). The superseded-
// validity state is replaced by a cheap stub with 250,000 problems; spreading them into `push`
// would overflow the stack.
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput, Problem } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const { MANY } = vi.hoisted(() => ({ MANY: 250_000 }));

vi.mock("../../variants/index.js", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const { defineWorkspaceState } = await import("../../runtime/workspace.js");
  const problems: readonly Problem[] = Array.from({ length: MANY }, (_, i) => ({
    code: "variant.superseded-in-validity",
    severity: "warning",
    message: `finding ${String(i)}`,
  }));
  return {
    ...original,
    supersededValidityProblemsState: defineWorkspaceState("many-findings", () => Promise.resolve(problems)),
  };
});

describe("workspace.check with many findings", () => {
  it("[SR-019/AK2] reports more than 200,000 findings without overflowing the stack", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-072/supersede" });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const out = (await invoke(
      "workspace.check",
      { failOn: "warning" },
      { workspace },
    )) as CommandOutput<"workspace.check">;
    expect(out.ok).toBe(false);
    expect(out.problems).toHaveLength(MANY);
    expect(out.problems.at(-1)?.message).toBe(`finding ${String(MANY - 1)}`);
  });
});
