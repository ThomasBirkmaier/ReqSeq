import type { DataExportElement, DataExportRelation } from "@logreq/core";
import { describe, expect, it } from "vitest";
import { propertyBoxes, propertyLines, relationGroups } from "./element-view.js";

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
