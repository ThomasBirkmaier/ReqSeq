// compileWhere on a condition the schema does not allow (#336): core validates every input first,
// so this is reached only by a caller that bypasses the validation, and it is a bug, not an input error.
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { FilterCondition } from "../generated/types.js";
import { metamodelState } from "../metamodel/index.js";
import { elementStoreState, shortIdState } from "../model/index.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { compileWhere } from "./condition.js";

describe("compileWhere", () => {
  it("throws a plain error for a condition with no compiler, which the schema refuses before", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-069/filter" });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const context = {
      workspace,
      command: "element.list" as const,
      layout: await workspace.get(workspaceLayoutState),
      metamodel: await workspace.get(metamodelState),
      store: await workspace.get(elementStoreState),
      shortIds: await workspace.get(shortIdState),
      view: undefined,
    };
    const unknown = { owner: "Anna" } as unknown as FilterCondition;
    await expect(compileWhere(context, unknown, "selection.where")).rejects.toThrow(
      new Error('no compiler for the condition {"owner":"Anna"}'),
    );
    // A known condition still compiles.
    const { predicate } = await compileWhere(context, { all: [] }, "selection.where");
    expect(context.store.elements.every(predicate)).toBe(true);
  });
});
