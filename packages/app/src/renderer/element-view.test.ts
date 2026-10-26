import type { DataExportElement, DataExportRelation } from "@logreq/core";
import { describe, expect, it } from "vitest";
import { outdatedReferences, propertyBoxes, propertyLines, relationGroups } from "./element-view.js";

const relation = (extra: Partial<DataExportRelation>): DataExportRelation => ({
  kind: "derives-from",
  direction: "out",
  id: "u",
  accessible: true,
  targetState: "available",
  ...extra,
});

describe("propertyLines", () => {
  it("gives one line per item, a title for an object, and nothing for an empty value", () => {
    expect(propertyLines("quality")).toEqual(["quality"]);
    expect(propertyLines(["a", "b"])).toEqual(["a", "b"]);
    expect(propertyLines(3)).toEqual(["3"]);
    expect(propertyLines(false)).toEqual(["false"]);
    expect(propertyLines([{ id: "x", title: "Stufe 3" }, { id: "y", title: "" }, [], "  ", ""])).toEqual([
      "Stufe 3",
      '{"id":"y","title":""}',
    ]);
    expect(propertyLines({ a: 1 })).toEqual(['{"a":1}']);
    expect(propertyLines({})).toEqual([]);
    expect(propertyLines(null)).toEqual([]);
    expect(propertyLines(undefined)).toEqual([]);
  });
});

describe("propertyBoxes", () => {
  it("leaves out empty properties and those that appear as relations", () => {
    const element = {
      properties: { topic: "Wind", empty: "", list: [], packages: [{ id: "p", title: "Stufe 3" }], n: 2 },
      relations: [relation({ kind: "packages", property: true }), relation({ kind: "topic" })],
    } as unknown as DataExportElement;
    expect(propertyBoxes(element)).toEqual([
      { key: "topic", lines: ["Wind"] },
      { key: "n", lines: ["2"] },
    ]);
  });
});

describe("relationGroups", () => {
  it("groups by kind and direction in the order of first appearance", () => {
    const groups = relationGroups([
      relation({ id: "1" }),
      relation({ id: "2", direction: "in" }),
      relation({ id: "3" }),
      relation({ id: "4", kind: "references" }),
    ]);
    expect(groups.map((group) => [group.heading, group.relations.map((r) => r.id)])).toEqual([
      ["derives-from", ["1", "3"]],
      ["← derives-from", ["2"]],
      ["references", ["4"]],
    ]);
    expect(relationGroups([])).toEqual([]);
  });
});

describe("outdatedReferences", () => {
  const TARGET = "6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2";
  const hint = (extra: object) => ({
    code: "relation.outdated",
    severity: "warning",
    message: "points to an older version",
    targetId: TARGET,
    storedVersion: "n1:aa",
    hintId: `relation.outdated/spec/f.md/src/@text/${TARGET}?version=n1:aa&n=1`,
    ...extra,
  });
  const of = (problems: object[] | undefined) =>
    outdatedReferences({ problems } as unknown as DataExportElement);

  it("keeps the outdated inline references by target, stored version and repository, with their message", () => {
    expect(
      of([
        hint({}),
        hint({
          hintId: `relation.outdated/spec/f.md/src/@text/${TARGET}?version=n1:aa&repository=other%20repo&n=1`,
          message: "other",
        }),
      ]),
    ).toEqual(
      new Map([
        [`${TARGET} n1:aa `, "points to an older version"],
        [`${TARGET} n1:aa other%20repo`, "other"],
      ]),
    );
  });

  it("the first message of a reference wins", () => {
    expect(
      of([
        hint({}),
        hint({
          message: "second",
          hintId: `relation.outdated/spec/f.md/src/@text/${TARGET}?version=n1:aa&n=2`,
        }),
      ]),
    ).toEqual(new Map([[`${TARGET} n1:aa `, "points to an older version"]]));
  });

  it("leaves out other hints, relation hints, hints without target or version, and elements without hints", () => {
    expect(
      of([
        hint({ code: "relation.missing" }),
        hint({ hintId: `relation.outdated/spec/f.md/src/derives-from/${TARGET}?version=n1:aa` }),
        hint({ hintId: undefined }),
        hint({ targetId: undefined }),
        hint({ storedVersion: undefined }),
      ]).size,
    ).toBe(0);
    expect(of(undefined).size).toBe(0);
  });
});
