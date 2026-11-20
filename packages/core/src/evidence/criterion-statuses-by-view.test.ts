// `criterionStatusesByView` (SR-031): the status of each acceptance criterion of a requirement in each view it applies
// in, from its own records, as the rows of `evidence.list`'s `display` give it.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { currentVersionsOf, elementStoreState, formsOfEntry } from "../model/index.js";
import { Workspace } from "../runtime/workspace.js";
import { criterionStatusesByView, workspaceStatus } from "./verification.js";

const id = (n: number): string => `31313131-0000-4000-8000-3131310000e${String(n)}`;

describe("criterionStatusesByView", () => {
  it("gives each criterion's status per view, and nothing for an element without criteria or that is no requirement", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-031/criteria" });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const store = await workspace.get(elementStoreState);
    const of = (n: number) => {
      const record = store.elements.find((r) => r.id === id(n));
      if (record === undefined) {
        throw new Error(`no element ${id(n)}`);
      }
      return record;
    };
    const records = [of(1), of(4), of(5)];
    const status = await workspaceStatus(workspace, records);
    const versions = await currentVersionsOf(workspace, records);
    const current = (n: number) => formsOfEntry(versions.get(of(n)));
    expect(criterionStatusesByView(status, of(1), current(1))).toEqual([
      { view: "core", statuses: ["verified", "verified", "open"] },
    ]);
    expect(criterionStatusesByView(status, of(4), current(4))).toEqual([
      { view: "core", statuses: ["verified", "failed"] },
    ]);
    expect(criterionStatusesByView(status, of(5), current(5))).toBeUndefined();
    expect(criterionStatusesByView(status, { ...of(1), type: "need" }, current(1))).toBeUndefined();
  });
});
