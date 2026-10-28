import type { DataExportElement, DataExportRelation, ElementFacetsOutput } from "@logreq/core";
import { describe, expect, it, vi } from "vitest";
import { exactTypeStep, propertyStep, statusStep } from "./list-filters.js";
import type { ListableValue, Pointer } from "./value-list.js";
import {
  NO_POINTER,
  listableValues,
  pointedValue,
  valueKeyOf,
  valueSignature,
  valuesPrompt,
} from "./value-list.js";

/** The facets of one element (`element.facets` with its ID), as core gives them. */
const facets: ElementFacetsOutput = {
  total: 1,
  types: [{ key: "system-requirement", name: "System Requirement", count: 1 }],
  statuses: [{ key: "approved", count: 1 }],
  properties: [
    { key: "title", name: "Title", kind: "text", count: 1, missing: 0, distinct: 1 },
    { key: "rationale", name: "Rationale", kind: "text", count: 1, missing: 0, distinct: 1 },
    {
      key: "requirement-type",
      name: "Requirement Type",
      kind: "choice",
      count: 1,
      missing: 0,
      distinct: 1,
      values: [{ value: "functional", count: 1, name: "Functional" }],
    },
    {
      key: "acceptance-criteria",
      name: "Acceptance Criteria",
      kind: "text",
      count: 1,
      missing: 0,
      distinct: 3,
    },
    { key: "validity", name: "Validity", kind: "relation", count: 0, missing: 1, distinct: 0, values: [] },
    {
      key: "packages",
      name: "Package",
      kind: "relation",
      count: 1,
      missing: 0,
      distinct: 1,
      values: [{ value: "PKG-089f89", count: 1, title: "Stufe 3: Oberfläche", identifier: "Stufe-3" }],
    },
    {
      key: "verification-method",
      name: "Verification Method",
      kind: "choice",
      count: 1,
      missing: 0,
      distinct: 1,
      values: [{ value: "test", count: 1, name: "Test" }],
    },
    {
      key: "emergent",
      name: "Emergent",
      kind: "choice",
      count: 1,
      missing: 0,
      distinct: 1,
      values: [{ value: "no", count: 1, name: "no" }],
    },
    {
      key: "labels",
      name: "Labels",
      kind: "text",
      count: 1,
      missing: 0,
      distinct: 2,
      values: [
        { value: "Timing", count: 1 },
        { value: "Safety", count: 1 },
      ],
    },
    {
      key: "topic",
      name: "Topic",
      kind: "text",
      count: 1,
      missing: 0,
      distinct: 1,
      values: [{ value: "Bearbeiten und Finden", count: 1 }],
    },
  ],
  incomplete: false,
};

/** The boxes of the element as it shows them: topic before the packages; `verification-method` and `emergent` without a box keep core's order. */
const BOXES = [
  "title",
  "rationale",
  "topic",
  "requirement-type",
  "acceptance-criteria",
  "packages",
  "labels",
];

const relation = (extra: Partial<DataExportRelation> = {}): DataExportRelation => ({
  kind: "packages",
  property: true,
  direction: "out",
  id: "uuid-p",
  repository: "spec",
  shortId: "PKG-089f89",
  accessible: true,
  targetState: "available",
  ...extra,
});

/** The relation without one of its optional fields. */
const without = (whole: DataExportRelation, key: "property" | "repository"): DataExportRelation => {
  const { [key]: _gone, ...rest } = whole;
  return rest;
};

const values = listableValues(facets, BOXES);
const named = (name: string): ListableValue => {
  const found = values.find((value) => value.name === name);
  if (found === undefined) {
    throw new Error(`no value ${name}`);
  }
  return found;
};
const box = (key: string, extra: Omit<Extract<Pointer, { kind: "box" }>, "kind" | "key"> = {}): Pointer => ({
  kind: "box",
  key,
  ...extra,
});

describe("the values of an element that open a list (SR-132)", () => {
  it("[SR-132/AK2] are the status, the type, then each value of a choice, a relation and a few-valued text property, in the order of the boxes", () => {
    expect(values.map((value) => value.name)).toEqual([
      "status: approved",
      "type: system-requirement",
      "topic: Bearbeiten und Finden",
      "requirement-type: functional",
      "packages: Stufe-3 Stufe 3: Oberfläche",
      "labels: Timing",
      "labels: Safety",
      "verification-method: test",
      "emergent: no",
    ]);
    // The display name of a choice and of a type is the hint, when it is not the key.
    expect(values.map((value) => value.hint)).toEqual([
      undefined,
      "System Requirement",
      undefined,
      "Functional",
      undefined,
      undefined,
      undefined,
      "Test",
      undefined,
    ]);
  });

  it('[SR-132/AK2] each value opens the step that "Filter list by property", "by status" or the overview builds for it', () => {
    expect(named("status: approved").step).toEqual(statusStep("approved"));
    expect(named("type: system-requirement").step).toEqual(exactTypeStep("system-requirement"));
    expect(named("topic: Bearbeiten und Finden").step).toEqual(
      propertyStep("topic", "Bearbeiten und Finden", "Bearbeiten und Finden"),
    );
    expect(named("requirement-type: functional").step).toEqual(
      propertyStep("requirement-type", "functional", "functional"),
    );
    expect(named("labels: Safety").step).toEqual(propertyStep("labels", "Safety", "Safety"));
  });

  it("[SR-132/AK3] a relation target opens the step of its short ID, labelled with its title", () => {
    expect(named("packages: Stufe-3 Stufe 3: Oberfläche").step).toEqual(
      propertyStep("packages", "Stufe 3: Oberfläche", "PKG-089f89"),
    );
  });

  it("[SR-132/AK4] rationale, acceptance criteria and title give no value, nor does a property without values", () => {
    expect(values.map((value) => value.key)).not.toContain("rationale");
    expect(values.map((value) => value.key)).not.toContain("acceptance-criteria");
    expect(values.map((value) => value.key)).not.toContain("title");
    expect(values.map((value) => value.key)).not.toContain("validity");
  });
});

describe("what the key and the command do at the cursor (SR-132)", () => {
  const relations = [relation()];

  it("[SR-132/AK1] the line with the caret in the topic box opens its list", () => {
    expect(pointedValue(values, box("topic", { line: "Bearbeiten und Finden" }), relations)).toEqual({
      kind: "open",
      value: named("topic: Bearbeiten und Finden"),
    });
  });

  it("[SR-132/AK2] the line with the caret in a list property opens that value; the box as a whole asks among its values", () => {
    expect(pointedValue(values, box("labels", { line: "Safety" }), relations)).toEqual({
      kind: "open",
      value: named("labels: Safety"),
    });
    expect(pointedValue(values, box("labels"), relations)).toEqual({
      kind: "ask",
      values: [named("labels: Timing"), named("labels: Safety")],
    });
  });

  it("[SR-132/AK2] a box with one value opens it; a line that is no stored value (input not saved) asks among the values of the box", () => {
    expect(pointedValue(values, box("requirement-type"), relations)).toEqual({
      kind: "open",
      value: named("requirement-type: functional"),
    });
    expect(pointedValue(values, box("topic", { line: "Typed" }), relations)).toEqual({
      kind: "ask",
      values: [named("topic: Bearbeiten und Finden")],
    });
  });

  it("[SR-132/AK3] the focused target of a relation box opens the list of its short ID", () => {
    const pointer = box("packages", { target: { id: "uuid-p", repository: "spec" } });
    expect(pointedValue(values, pointer, relations)).toEqual({
      kind: "open",
      value: named("packages: Stufe-3 Stufe 3: Oberfläche"),
    });
  });

  it("[SR-132/AK3] a target that the element does not name as that property asks among the values of the box", () => {
    const pointer = box("packages", { target: { id: "uuid-p", repository: "spec" } });
    const ask = { kind: "ask", values: [named("packages: Stufe-3 Stufe 3: Oberfläche")] };
    expect(pointedValue(values, pointer, [without(relation(), "property")])).toEqual(ask);
    expect(pointedValue(values, pointer, [relation({ direction: "in" })])).toEqual(ask);
    expect(pointedValue(values, pointer, [relation({ kind: "validity" })])).toEqual(ask);
    expect(pointedValue(values, pointer, [relation({ id: "other" })])).toEqual(ask);
    expect(pointedValue(values, pointer, [relation({ repository: "vault" })])).toEqual(ask);
    // A relation without a repository is matched by the empty name, as the links carry it.
    const unnamed = box("packages", { target: { id: "uuid-p", repository: "" } });
    expect(pointedValue(values, unnamed, [without(relation(), "repository")])).toEqual({
      kind: "open",
      value: named("packages: Stufe-3 Stufe 3: Oberfläche"),
    });
  });

  it("[SR-132/AK4] on a free-text box or on no box it asks among all the values, never the free text", () => {
    expect(pointedValue(values, box("rationale", { line: "Weil" }), relations)).toEqual({
      kind: "ask",
      values,
    });
    expect(pointedValue(values, box("acceptance-criteria"), relations)).toEqual({ kind: "ask", values });
    expect(pointedValue(values, NO_POINTER, relations)).toEqual({ kind: "ask", values });
  });

  it("gives nothing when the element has no value to list", () => {
    expect(pointedValue([], box("topic"), relations)).toEqual({ kind: "none" });
  });
});

describe("the prompt and the signature (SR-132)", () => {
  it('asks "Elements with" among the values, with their hints; taking one opens it', () => {
    const open = vi.fn();
    const prompt = valuesPrompt([named("status: approved"), named("requirement-type: functional")], open);
    expect(prompt.label).toBe("Elements with");
    expect(prompt.items.map((item) => [item.id, item.name, item.hint])).toEqual([
      ["status\napproved", "status: approved", undefined],
      ["requirement-type\nfunctional", "requirement-type: functional", "Functional"],
    ]);
    prompt.items[1]?.run();
    expect(open).toHaveBeenCalledWith(named("requirement-type: functional"));
  });

  it("changes with the type, the status and the properties, not with the text", () => {
    const element = {
      id: "uuid-1",
      repository: "spec",
      type: "system-requirement",
      status: "draft",
      properties: { topic: "Wind" },
      text: "One",
    } as unknown as DataExportElement;
    const same = valueSignature({ ...element, text: "Two" } as DataExportElement);
    expect(valueSignature(element)).toBe(same);
    expect(valueSignature({ ...element, status: "approved" })).not.toBe(same);
    expect(valueSignature({ ...element, properties: { topic: "Gust" } })).not.toBe(same);
    const { status: _status, ...without } = element;
    expect(valueSignature(without)).not.toBe(same);
  });
});

describe("valueKeyOf", () => {
  it("is the value signature of the shown element, none while none is shown", () => {
    const element = {
      id: "u",
      repository: "spec",
      type: "need",
      properties: {},
    } as unknown as DataExportElement;
    expect(valueKeyOf(element)).toBe(valueSignature(element));
    expect(valueKeyOf(undefined)).toBeUndefined();
  });
});
