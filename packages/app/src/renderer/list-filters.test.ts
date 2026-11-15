import type { ElementFacetsOutput } from "@reqseq/core";
import { describe, expect, it } from "vitest";
import {
  choosableProperties,
  exactTypeStep,
  hasSavedFilter,
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

describe("the properties whose values can be chosen (#993)", () => {
  it("are those with values among the listed elements, in the order of the core, each with its values", () => {
    const chosen = choosableProperties(facets);
    expect(chosen.map(({ facet }) => facet.key)).toEqual(["topic", "requirement-type", "packages"]);
    expect(chosen.map(({ values }) => values.length)).toEqual([2, 1, 2]);
    expect(choosableProperties({ ...facets, properties: [] })).toEqual([]);
  });
});

describe("the steps of a list filter (SR-124)", () => {
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
