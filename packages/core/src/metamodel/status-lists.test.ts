// The status lists of types as the status commands read them (SR-240); the commands themselves are
// tested in commands/metamodel/*Status.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import { metamodelState } from "./state.js";
import { statusKeysOf, statusListHolders, typeDefinition } from "./status-lists.js";

describe("status lists of types", () => {
  it("knows no statuses, list or definition of a type the metamodel does not have", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const metamodel = await workspace.get(metamodelState);
    expect([statusKeysOf(metamodel, "nope"), statusListHolders(metamodel, "nope")]).toEqual([[], []]);
    expect(typeDefinition(metamodel, "nope")).toBeUndefined();
    expect(statusKeysOf(metamodel, "need")).toEqual(["draft", "approved", "obsolete"]);
  });
});
