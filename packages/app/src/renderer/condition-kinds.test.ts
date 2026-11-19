// The kinds of a condition and their values (SR-215 AK3), which the condition prompt and "Filter list" share.
import type { ElementFacetsOutput } from "@reqseq/core";
import { describe, expect, it, vi } from "vitest";
import type { CommandListing } from "../shared/protocol.js";
import type { Call } from "./call.js";
import type { ConditionKind, KindHits, KindSource } from "./condition-kinds.js";
import { CONDITION_KINDS, conditionSchema, textMark, valueHits } from "./condition-kinds.js";

type Facet = ElementFacetsOutput["properties"][number];

const FACETS: ElementFacetsOutput = {
  answer: "The selection has 5 elements.",
  total: 5,
  types: [],
  statuses: [
    { key: "draft", count: 3 },
    { key: "approved", count: 2 },
  ],
  properties: [
    {
      key: "topic",
      name: "Topic",
      kind: "text",
      count: 3,
      missing: 2,
      distinct: 2,
      values: [
        { value: "Finden", count: 2 },
        { value: "Wind", count: 1 },
      ],
    },
    {
      key: "acceptance-criteria",
      name: "Acceptance criteria",
      kind: "text",
      count: 5,
      missing: 0,
      distinct: 5,
    },
    { key: "priority", name: "Priority", kind: "number", count: 0, missing: 5, distinct: 0, values: [] },
  ],
  incomplete: false,
};

const METAMODEL = {
  types: [{ key: "need", name: "Need" }],
  statuses: [{ key: "draft", name: "Draft" }],
  relations: [{ key: "refines", name: "refines" }],
  properties: [
    { key: "packages", name: "Packages", kind: "relation" },
    { key: "topic", name: "Topic", kind: "text" },
  ],
};

const SCHEMA = {
  oneOf: [
    { properties: { type: { type: "array" } } },
    { properties: { verification: { type: "array", items: { enum: ["passed", "failed"] } } } },
    { properties: { validation: { enum: ["open"] } } },
  ],
};

/** A source whose commands answer with `answers`, an Error as a refusal. */
const source = (answers: Record<string, unknown>, schema: unknown = SCHEMA): KindSource => {
  const call = vi.fn((name: string) => {
    const output = answers[name];
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, code: "x.failed", message: output.message }
        : { ok: true, output },
    );
  }) as unknown as Call;
  return { call, facets: () => call("element.facets", {}), schema };
};

const kind = (key: string): ConditionKind => {
  const found = CONDITION_KINDS.find((candidate) => candidate.key === key);
  if (found === undefined) {
    throw new Error(`no kind ${key}`);
  }
  return found;
};

const hitsOf = (key: string, answers: Record<string, unknown>, schema?: unknown): Promise<KindHits> => {
  const { hits } = kind(key);
  if (hits === undefined) {
    throw new Error(`kind ${key} has no values`);
  }
  return hits(source(answers, schema));
};

const ok = { "metamodel.get": METAMODEL, "element.facets": FACETS };

describe("the kinds of a condition (SR-215 AK3)", () => {
  it("are offered in this order; a text search has no values", () => {
    expect(CONDITION_KINDS.map((each) => each.name)).toEqual([
      "Type",
      "Status",
      "Property",
      "Verification status",
      "Validation status",
      "Validity",
      "Relation",
      "Text search",
    ]);
    expect(kind("text").hits).toBeUndefined();
    expect(textMark("wind")).toEqual({ label: "text: wind", condition: { text: "wind" } });
  });

  it("types by name with the key, labelled as the list filter step", async () => {
    expect(await hitsOf("type", ok)).toEqual([
      { name: "Need", key: "need", mark: { label: "type: need", condition: { type: ["need"] } } },
    ]);
  });

  it("statuses of the facets by their name in the metamodel", async () => {
    expect(await hitsOf("status", ok)).toEqual([
      { name: "Draft", key: "draft", mark: { label: "status: draft", condition: { status: ["draft"] } } },
      { name: "approved", mark: { label: "status: approved", condition: { status: ["approved"] } } },
    ]);
  });

  it("[SR-124/AK-hxcz] properties with values only, each with its values next; no status among them", async () => {
    const hits = await hitsOf("property", ok);
    expect(hits).toEqual([
      {
        name: "Topic",
        key: "topic",
        values: [
          {
            name: "Finden",
            mark: { label: "topic: Finden", condition: { property: "topic", op: "eq", value: "Finden" } },
          },
          {
            name: "Wind",
            mark: { label: "topic: Wind", condition: { property: "topic", op: "eq", value: "Wind" } },
          },
          {
            name: "(no value)",
            mark: { label: "topic: (no value)", condition: { property: "topic", op: "missing" } },
          },
        ],
      },
    ]);
  });

  it("the enums of the schema as verification and validation statuses; none without a schema", async () => {
    expect(await hitsOf("verification", ok)).toEqual([
      { name: "passed", mark: { label: "verification: passed", condition: { verification: ["passed"] } } },
      { name: "failed", mark: { label: "verification: failed", condition: { verification: ["failed"] } } },
    ]);
    expect(await hitsOf("validation", ok)).toEqual([
      { name: "open", mark: { label: "validation: open", condition: { validation: ["open"] } } },
    ]);
    expect(await hitsOf("verification", ok, null)).toEqual([]);
  });

  it("the views as validity, and the relation ends and kinds with and without", async () => {
    expect(await hitsOf("validFor", ok)).toEqual([
      { name: "Core", key: "core", mark: { label: "validity: Core", condition: { validFor: "core" } } },
    ]);
    const relations = await hitsOf("relation", ok);
    expect("failed" in relations ? [] : relations.map((hit) => hit.name)).toEqual([
      "without child",
      "with child",
      "without parent",
      "with parent",
      "without evidence",
      "with evidence",
      "without refines",
      "with refines",
      "without Packages",
      "with Packages",
    ]);
  });

  it("says why when core refuses", async () => {
    const failing = { "metamodel.get": new Error("no metamodel"), "element.facets": new Error("no facets") };
    for (const key of ["type", "status", "property", "validFor", "relation"]) {
      expect(await hitsOf(key, failing)).toHaveProperty("failed");
    }
    expect(
      await hitsOf("status", { "metamodel.get": new Error("no metamodel"), "element.facets": FACETS }),
    ).toEqual({
      failed: "no metamodel",
    });
  });
});

describe("the values of a property", () => {
  it("name a choice by its display name with the key, and a relation target by short ID and title", () => {
    const choice: Facet = {
      key: "requirement-type",
      name: "Requirement type",
      kind: "choice",
      count: 1,
      missing: 0,
      distinct: 1,
      values: [{ value: "functional", count: 1, name: "Functional" }],
    };
    expect(valueHits(choice).map(({ name, key }) => [name, key])).toEqual([["Functional", "functional"]]);
    const relation: Facet = {
      key: "packages",
      name: "Packages",
      kind: "relation",
      count: 2,
      missing: 0,
      distinct: 2,
      values: [
        { value: "PKG-0000d1", count: 1, title: "Sensors", identifier: "P-1" },
        { value: "PKG-0000d2", count: 1 },
      ],
    };
    expect(valueHits(relation).map(({ name, mark }) => [name, mark.label])).toEqual([
      ["PKG-0000d1 (P-1) Sensors", "packages: Sensors"],
      ["PKG-0000d2", "packages: PKG-0000d2"],
    ]);
  });
});

describe("the condition's schema in the catalog", () => {
  it("is that of the first argument built as a condition", () => {
    const listing = (name: string, complete: string, properties: unknown): CommandListing =>
      ({
        name,
        arguments: [{ field: "where", complete }],
        input: { properties },
      }) as unknown as CommandListing;
    expect(
      conditionSchema([
        listing("element.get", "element", {}),
        listing("filter.save", "condition", { where: SCHEMA }),
      ]),
    ).toBe(SCHEMA);
    expect(conditionSchema([listing("filter.save", "condition", undefined)])).toBeUndefined();
    expect(conditionSchema([])).toBeUndefined();
  });
});
