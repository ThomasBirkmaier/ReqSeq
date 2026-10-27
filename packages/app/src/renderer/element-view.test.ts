import type { DataExportElement, DataExportRelation } from "@logreq/core";
import { describe, expect, it } from "vitest";
import {
  outdatedReferences,
  propertyBoxes,
  propertyLines,
  propertyModel,
  relationGroups,
  relationLabel,
} from "./element-view.js";

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

describe("relationLabel", () => {
  it("is the identifier, else the short ID, else the UUID, then the title when there is one", () => {
    expect(relationLabel(relation({ identifier: "N-1", shortId: "N-000001", title: "Need" }))).toBe(
      "N-1 Need",
    );
    expect(relationLabel(relation({ shortId: "N-000001", title: "Need" }))).toBe("N-000001 Need");
    expect(relationLabel(relation({ shortId: "N-000001" }))).toBe("N-000001");
    expect(relationLabel(relation({ id: "uuid-9" }))).toBe("uuid-9");
  });
});

describe("propertyModel", () => {
  const property = (key: string, extra: object = {}) => ({ key, name: key, kind: "text", ...extra });

  it("[SR-127/AK5] gives, per type, kind, list and markdown of each property of the type, as the metamodel says", () => {
    const model = propertyModel({
      properties: [
        property("title", { meaning: "title" }),
        property("acceptance-criteria", { markdown: true, many: true }),
        property("rationale", { markdown: true }),
        property("topic", { markdown: false }),
        property("effort", { kind: "number" }),
        property("note"),
      ],
      types: [
        { key: "requirement", properties: ["title", "acceptance-criteria", "topic", "effort", "gone"] },
        { key: "system-requirement", properties: ["title", "acceptance-criteria", "rationale", "note"] },
        { key: "glossary-term", properties: [] },
      ],
    } as unknown as Parameters<typeof propertyModel>[0]);
    expect(model).toEqual(
      new Map([
        [
          "requirement",
          new Map([
            ["title", { kind: "text", many: false, markdown: false }],
            ["acceptance-criteria", { kind: "text", many: true, markdown: true }],
            ["topic", { kind: "text", many: false, markdown: false }],
            ["effort", { kind: "number", many: false, markdown: false }],
          ]),
        ],
        [
          "system-requirement",
          new Map([
            ["title", { kind: "text", many: false, markdown: false }],
            ["acceptance-criteria", { kind: "text", many: true, markdown: true }],
            ["rationale", { kind: "text", many: false, markdown: true }],
            ["note", { kind: "text", many: false, markdown: false }],
          ]),
        ],
        ["glossary-term", new Map()],
      ]),
    );
  });
});

describe("outdatedReferences in a property (SR-127)", () => {
  const TARGET = "6adc4fbb-fe6a-4dfa-b9b6-8ccf0e589cf2";
  const hint = (place: string, message: string) => ({
    code: "relation.outdated",
    severity: "warning",
    message,
    targetId: TARGET,
    storedVersion: "n1:aa",
    hintId: `relation.outdated/spec/f.md/src/${place}/${TARGET}?version=n1:aa&n=1`,
  });
  const element = {
    problems: [
      hint("@text", "in the text"),
      hint("@text:acceptance-criteria", "in the criteria"),
      hint("@text:rationale", "in the rationale"),
    ],
  } as unknown as DataExportElement;

  it("[SR-127/AK3] keeps the hints of the text and of each property apart", () => {
    const key = `${TARGET} n1:aa `;
    expect(outdatedReferences(element)).toEqual(new Map([[key, "in the text"]]));
    expect(outdatedReferences(element, "acceptance-criteria")).toEqual(new Map([[key, "in the criteria"]]));
    expect(outdatedReferences(element, "rationale")).toEqual(new Map([[key, "in the rationale"]]));
    expect(outdatedReferences(element, "topic").size).toBe(0);
  });
});
