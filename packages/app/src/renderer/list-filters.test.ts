import type { ElementFacetsOutput } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import type { Prompt } from "./actions.js";
import type { FilterStep } from "./buffers.js";
import {
  choosableProperties,
  exactTypeStep,
  hasSavedFilter,
  missingStep,
  propertyChoices,
  propertyStep,
  savedStep,
  statusStep,
  textStep,
  typeStep,
} from "./list-filters.js";

const facets: ElementFacetsOutput = {
  total: 5,
  types: [{ key: "system-requirement", name: "System Requirement", count: 5 }],
  statuses: [
    { key: "draft", count: 3 },
    { key: "approved", count: 2 },
  ],
  properties: [
    { key: "title", name: "Title", kind: "text", count: 5, missing: 0, distinct: 5 },
    {
      key: "topic",
      name: "Topic",
      kind: "text",
      count: 3,
      missing: 2,
      distinct: 2,
      values: [
        { value: "Bearbeiten und Finden", count: 2 },
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
    {
      key: "requirement-type",
      name: "Requirement type",
      kind: "choice",
      count: 5,
      missing: 0,
      distinct: 1,
      values: [{ value: "functional", count: 5, name: "Functional" }],
    },
    { key: "priority", name: "Priority", kind: "number", count: 0, missing: 5, distinct: 0, values: [] },
    {
      key: "packages",
      name: "Packages",
      kind: "relation",
      count: 4,
      missing: 1,
      distinct: 2,
      values: [
        { value: "PKG-0000d1", count: 3, title: "Sensors", identifier: "P-1" },
        { value: "PKG-0000d2", count: 1 },
      ],
    },
  ],
  incomplete: false,
};

/** The prompts asked and the steps run while the choices are used. */
const use = (output: ElementFacetsOutput) => {
  const asked: Prompt[] = [];
  const ran: FilterStep[] = [];
  const items = propertyChoices(
    output,
    (step) => ran.push(step),
    (prompt) => asked.push(prompt),
  );
  return { items, asked, ran };
};

describe("the properties whose values can be chosen (#993)", () => {
  it("are those with values among the listed elements, in the order of the core, each with its values", () => {
    const chosen = choosableProperties(facets);
    expect(chosen.map(({ facet }) => facet.key)).toEqual(["topic", "requirement-type", "packages"]);
    expect(chosen.map(({ values }) => values.length)).toEqual([2, 1, 2]);
    expect(choosableProperties({ ...facets, properties: [] })).toEqual([]);
  });
});

describe("the property prompt (SR-124)", () => {
  it("[SR-124/AK-hxcz] offers the status first, then the properties with values, in the order of the core", () => {
    const { items } = use(facets);
    // By display name, as the built-in choices read; the key stays the id.
    expect(items.map((item) => item.name)).toEqual(["Status", "Topic", "Requirement type", "Packages"]);
    expect(items.map((item) => item.id)).toEqual(["status", "topic", "requirement-type", "packages"]);
    expect(items.map((item) => item.hint)).toEqual(["2", "2", "1", "2"]);
  });

  it("[SR-124/AK-mch4] does not offer free text, which has no values, nor a property without a value in the list", () => {
    const ids = use(facets).items.map((item) => item.id);
    expect(ids).not.toContain("acceptance-criteria");
    expect(ids).not.toContain("title");
    expect(ids).not.toContain("priority");
  });

  it("offers the statuses of the list with their counts", () => {
    const { items, asked, ran } = use(facets);
    items[0]?.run();
    expect(asked[0]?.label).toBe("Status");
    expect(asked[0]?.items.map((item) => [item.name, item.hint])).toEqual([
      ["draft", "3"],
      ["approved", "2"],
    ]);
    asked[0]?.items[1]?.run();
    expect(ran).toEqual([statusStep("approved")]);
  });

  it("offers the values with their counts and a choice for no value", () => {
    const { items, asked, ran } = use(facets);
    items[1]?.run();
    expect(asked[0]?.label).toBe("Topic");
    expect(asked[0]?.items.map((item) => [item.name, item.hint])).toEqual([
      ["Bearbeiten und Finden", "2"],
      ["Wind", "1"],
      ["(no value)", "2"],
    ]);
    asked[0]?.items[0]?.run();
    asked[0]?.items[2]?.run();
    expect(ran).toEqual([
      propertyStep("topic", "Bearbeiten und Finden", "Bearbeiten und Finden"),
      missingStep("topic"),
    ]);
    expect(ran[1]).toEqual({
      label: "topic: (no value)",
      selection: { where: { property: "topic", op: "missing" } },
    });
  });

  it("offers no choice for no value when every element has a value; a choice reads by its display name", () => {
    const { items, asked, ran } = use(facets);
    items[2]?.run();
    expect(asked[0]?.items.map((item) => item.name)).toEqual(["Functional"]);
    asked[0]?.items[0]?.run();
    expect(ran).toEqual([propertyStep("requirement-type", "functional", "functional")]);
  });

  it("names a relation target by identifier and title and filters by its short ID", () => {
    const { items, asked, ran } = use(facets);
    items[3]?.run();
    expect(asked[0]?.items.map((item) => item.name)).toEqual([
      "PKG-0000d1 (P-1) Sensors",
      "PKG-0000d2",
      "(no value)",
    ]);
    asked[0]?.items[0]?.run();
    asked[0]?.items[1]?.run();
    expect(ran).toEqual([
      {
        label: "packages: Sensors",
        selection: { where: { property: "packages", op: "eq", value: "PKG-0000d1" } },
      },
      {
        label: "packages: PKG-0000d2",
        selection: { where: { property: "packages", op: "eq", value: "PKG-0000d2" } },
      },
    ]);
  });

  it("[SR-124/AK-hxcz] offers nothing when no property has values", () => {
    expect(use({ ...facets, statuses: [], properties: facets.properties.slice(0, 1) }).items).toEqual([]);
  });

  it("[SR-124/AK-jz48] builds the steps with the labels of the list", () => {
    expect(typeStep("need")).toEqual({ label: "type: need", selection: { where: { type: ["need"] } } });
    expect(statusStep("draft").label).toBe("status: draft");
    expect(savedStep("open")).toEqual({ label: "filter: open", selection: { filter: "open" } });
    expect(textStep("wind")).toEqual({ label: "text: wind", selection: { where: { text: "wind" } } });
    expect(hasSavedFilter([typeStep("need")])).toBe(false);
    expect(hasSavedFilter([typeStep("need"), savedStep("open")])).toBe(true);
  });

  it("[SR-118/AK-p9z9] the step of a type line takes the elements of exactly that type, the type filter its subtypes too", () => {
    expect(exactTypeStep("need")).toEqual({
      label: "type: need",
      selection: { where: { type: ["need"], subtypes: false } },
    });
    expect(typeStep("need").selection).toEqual({ where: { type: ["need"] } });
    // With the name of the type, the heading of the list says it (SR-148); the label stays.
    expect(exactTypeStep("need", "Need")).toEqual({ ...exactTypeStep("need"), heading: "Need" });
  });
});
