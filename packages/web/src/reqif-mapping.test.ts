import { describe, expect, it } from "vitest";
import type { Metamodel } from "./meaning.js";
import type { Choice, Mapping } from "./reqif-mapping.js";
import {
  OMIT,
  attributeId,
  attributeOptions,
  choiceOf,
  emptyMapping,
  groupsOf,
  guess,
  mappedProperty,
  mappedType,
  relationOptions,
  typeOptions,
  valueId,
  valueOf,
  valueOptions,
  withChoices,
} from "./reqif-mapping.js";

const mm = {
  types: [
    {
      key: "base",
      name: "Base",
      prefix: "B",
      abstract: true,
      ancestors: [],
      properties: [],
      required: [],
      statuses: [],
    },
    {
      key: "req",
      name: "System Requirement",
      prefix: "R",
      abstract: false,
      ancestors: [],
      properties: ["name", "kind", "rationale", "links", "origin"],
      required: [],
      statuses: [],
    },
  ],
  properties: [
    { key: "name", name: "Name", kind: "text", meaning: "title" },
    { key: "kind", name: "Requirement Type", kind: "choice", choices: [{ key: "func", name: "Functional" }] },
    { key: "rationale", name: "Rationale", kind: "text" },
    { key: "links", name: "Links", kind: "relation" },
    { key: "origin", name: "Origin", kind: "text", meaning: "source" },
  ],
  relations: [{ key: "refines", name: "Refines" }],
  statuses: [],
} as unknown as Metamodel;

const map = (entries: readonly (readonly [string, Choice])[]): Map<string, Choice> => new Map(entries);
const none = { types: map([]), attributes: map([]), relations: map([]), values: map([]) };

describe("the choices of a select", () => {
  it("stand for a key, leaving out, or no choice", () => {
    expect(choiceOf(valueOf("req"))).toEqual({ to: "req" });
    expect(choiceOf(OMIT)).toEqual({ omit: true });
    expect(choiceOf("")).toBeUndefined();
  });

  it("offer the concrete types, the relation kinds and the choices of a property", () => {
    expect(typeOptions(mm)).toEqual([{ key: "req", name: "System requirement" }]);
    expect(relationOptions(mm)).toEqual([{ key: "refines", name: "Refines" }]);
    expect(valueOptions(mm, "kind")).toEqual([{ key: "func", name: "Functional" }]);
    expect(valueOptions(mm, "nothing")).toEqual([]);
  });

  it("offer title, text and the properties the import does not write itself", () => {
    expect(attributeOptions(mm, "req").map((o) => o.key)).toEqual(["title", "text", "kind", "rationale"]);
  });

  it("guess the option of the same name or key, ignoring case", () => {
    const options = attributeOptions(mm, "req");
    expect(guess(options, " requirement type ")?.key).toBe("kind");
    expect(guess(options, "RATIONALE")?.key).toBe("rationale");
    expect(guess(options, "Weight")).toBeUndefined();
  });
});

describe("groupsOf", () => {
  it("puts attributes under their type and values under their attribute", () => {
    expect(
      groupsOf([
        { kind: "type", source: "Item" },
        { kind: "attribute", source: "Name", sourceType: "Item" },
        { kind: "relation", source: "trace" },
        { kind: "attribute", source: "Label", sourceType: "Memo" },
        { kind: "value", source: "Low", sourceType: "Item", attribute: "Level" },
        { kind: "value", source: "High", sourceType: "Item", attribute: "Level" },
        { kind: "attribute", source: "Loose" },
        { kind: "value", source: "Odd" },
      ]),
    ).toEqual({
      types: [
        { source: "Item", unmapped: true, attributes: ["Name"] },
        { source: "Memo", unmapped: false, attributes: ["Label"] },
        { source: "", unmapped: false, attributes: ["Loose"] },
      ],
      relations: ["trace"],
      values: [
        { sourceType: "Item", attribute: "Level", values: ["Low", "High"] },
        { sourceType: "", attribute: "", values: ["Odd"] },
      ],
    });
  });
});

describe("withChoices", () => {
  it("writes an entry per choice and none for the attributes of a type left out", () => {
    const mapping = withChoices(emptyMapping("old"), "Tool", {
      types: map([
        ["Item", { to: "req" }],
        ["Skip", { omit: true }],
      ]),
      attributes: map([
        [attributeId("Item", "Name"), { to: "title" }],
        [attributeId("Item", "Note"), { omit: true }],
        [attributeId("Skip", "Label"), { to: "text" }],
        [attributeId("", "Loose"), { to: "text" }],
      ]),
      relations: map([
        ["trace", { to: "refines" }],
        ["skip", { omit: true }],
      ]),
      values: map([]),
    });
    expect(mapping).toEqual({
      "reqseq-reqif-mapping": 1,
      source: { name: "Tool" },
      types: [
        { source: "Item", type: "req" },
        { source: "Skip", omit: true },
      ],
      attributes: [
        { "source-type": "Item", source: "Name", property: "title" },
        { "source-type": "Item", source: "Note", omit: true },
        { source: "Loose", property: "text" },
      ],
      relations: [
        { source: "trace", kind: "refines" },
        { source: "skip", omit: true },
      ],
    });
    expect(mappedType(mapping, "Item")).toBe("req");
    expect(mappedType(mapping, "Skip")).toBeUndefined();
    expect(mappedProperty(mapping, "Item", "Name")).toBe("title");
    expect(mappedProperty(mapping, "", "Loose")).toBe("text");
    expect(mappedProperty(mapping, "Item", "Loose")).toBeUndefined();
  });

  it("keeps the entries without a choice, replaces those with one and adds the values", () => {
    const before: Mapping = {
      "reqseq-reqif-mapping": 1,
      source: { name: "Tool", "tool-id": "T" },
      types: [{ source: "Item", type: "req" }],
      attributes: [
        {
          "source-type": "Item",
          source: "Level",
          property: "kind",
          values: { Mid: "func" },
          "omit-values": ["Old"],
        },
        { "source-type": "Item", source: "Name", property: "title" },
        { source: "Gone", omit: true },
      ],
    };
    const after = withChoices(before, "Tool", {
      ...none,
      types: map([["Item", { to: "req" }]]),
      attributes: map([[attributeId("Item", "Name"), { to: "rationale" }]]),
      values: map([
        [valueId("Item", "Level", "Low"), { to: "func" }],
        [valueId("Item", "Level", "Mid"), { omit: true }],
        [valueId("Item", "Level", "Old"), { to: "func" }],
        [valueId("Item", "Gone", "X"), { omit: true }],
      ]),
    });
    expect(after).toEqual({
      "reqseq-reqif-mapping": 1,
      source: { name: "Tool", "tool-id": "T" },
      types: [{ source: "Item", type: "req" }],
      attributes: [
        {
          "source-type": "Item",
          source: "Level",
          property: "kind",
          values: { Low: "func", Old: "func" },
          "omit-values": ["Mid"],
        },
        { "source-type": "Item", source: "Name", property: "rationale" },
        { source: "Gone", omit: true },
      ],
    });
  });

  it("writes only the source when nothing is chosen", () => {
    expect(withChoices(emptyMapping("Tool"), "Tool", none)).toEqual(emptyMapping("Tool"));
  });
});
