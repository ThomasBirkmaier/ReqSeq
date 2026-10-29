// The keys of the traceability matrix (SR-125): which relation keys make columns, on a metamodel
// object that a metamodel file cannot describe (a relation kind whose key a property of another
// kind has, which makes the file invalid). The matrix itself: commands/trace/matrix.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { expect, it, onTestFinished } from "vitest";
import { metamodelState } from "../metamodel/index.js";
import { Workspace } from "../runtime/workspace.js";
import { matrixKeys } from "./matrix.js";

it("[SR-125/AK2] leaves out a relation kind whose key a property of another kind has", async () => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-125/matrix" });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  const metamodel = await workspace.get(metamodelState);
  const keys = (kinds?: readonly string[]): string[] => matrixKeys(metamodel, kinds).map((k) => k.key);
  expect(keys()).toEqual(["refines", "derives-from", "based-on", "supersedes", "replaces", "excludes"]);
  const shadowed = {
    ...metamodel,
    properties: [...metamodel.properties, { key: "replaces", name: "Replaces", kind: "text" as const }],
  };
  const without = matrixKeys(shadowed, undefined).map((k) => k.key);
  expect(without).toEqual(["refines", "derives-from", "based-on", "supersedes", "excludes"]);
  expect(matrixKeys(shadowed, ["replaces", "derives-from"]).map((k) => k.key)).toEqual(["derives-from"]);
  // The property wins over the relation kind of the same key, as everywhere (ADR-0004).
  const property = {
    ...metamodel,
    properties: [...metamodel.properties, { key: "excludes", name: "Excluded", kind: "relation" as const }],
  };
  expect(matrixKeys(property, ["excludes"]).map((k) => [k.key, k.property, k.name, k.inverseName])).toEqual([
    ["excludes", true, "Excluded", "Excluded"],
  ]);
});
