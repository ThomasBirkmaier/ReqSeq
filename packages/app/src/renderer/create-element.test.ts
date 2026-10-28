import { describe, expect, it } from "vitest";
import { creatableTypes, createdEcho, propertiesInput } from "./create-element.js";
import { CREATE_METAMODEL } from "./create-test-data.js";

const element = (title: string) => ({
  id: "uuid-9",
  type: "report",
  repository: "spec",
  file: "report/REP-000009.md",
  shortId: "REP-000009",
  title,
  properties: {},
  relations: [],
  text: "",
});

const hint = (key: string) => ({
  code: "element.missing-required" as const,
  severity: "warning" as const,
  message: `Required property ${key} has no value`,
});

describe("creating an element (SR-064)", () => {
  it("[SR-064/AK1] offers the types that can have elements, in metamodel order, each with its required properties but the title", () => {
    const types = creatableTypes(CREATE_METAMODEL);
    // The abstract "item" has no elements.
    expect(types.map((type) => [type.key, type.name])).toEqual([
      ["requirement", "System Requirement"],
      ["software-requirement", "Software Requirement"],
      ["decision", "Decision"],
      ["package", "Package"],
      ["report", "Report"],
      ["note", "Note"],
    ]);
    expect(types.map((type) => type.required.map((property) => property.key))).toEqual([
      [],
      ["component"],
      [],
      [],
      // In the order of `required`, without the title and without "owner", which the metamodel does not define.
      ["severity", "packages", "component"],
      ["related", "scope"],
    ]);
    expect(types.at(-2)?.required[1]).toEqual({
      key: "packages",
      info: {
        name: "Package",
        kind: "relation",
        many: true,
        markdown: false,
        targetTypes: ["package"],
        meaning: "packages",
      },
    });
  });

  it("makes the properties of element.create from the values given, as a box with them saves them", () => {
    const report = creatableTypes(CREATE_METAMODEL).at(-2)?.required ?? [];
    const target = (n: number) => ({
      id: `uuid-${String(n)}`,
      repository: "spec",
      label: `PKG-${String(n)} P`,
    });
    expect(
      propertiesInput(report, [
        { key: "component", value: "sensor" },
        { key: "severity", value: "3" },
        { key: "packages", value: target(1) },
        { key: "component", value: "display" },
        { key: "packages", value: target(2) },
        // A target taken twice is one.
        { key: "packages", value: target(1) },
      ]),
    ).toEqual({
      severity: 3,
      packages: [
        { id: "uuid-1", repository: "spec" },
        { id: "uuid-2", repository: "spec" },
      ],
      component: ["sensor", "display"],
    });
    // A blank text gives nothing, a text that is no number stays text (core says what is wrong), nothing given nothing.
    expect(propertiesInput(report, [{ key: "severity", value: "  " }])).toEqual({});
    expect(propertiesInput(report, [{ key: "severity", value: "high" }])).toEqual({ severity: "high" });
    expect(propertiesInput(report, [])).toEqual({});
  });

  it("[SR-064/AK2] says that the element is created and how many hints core gave", () => {
    expect(createdEcho({ element: element("Wind"), problems: [hint("severity"), hint("component")] })).toBe(
      "Created REP-000009 Wind · 2 hints",
    );
    expect(createdEcho({ element: element(""), problems: [hint("title")] })).toBe(
      "Created REP-000009 · 1 hint",
    );
    expect(createdEcho({ element: { ...element("Wind"), identifier: "R-1" } })).toBe("Created R-1 Wind");
    expect(createdEcho({ element: element("Wind"), problems: [] })).toBe("Created REP-000009 Wind");
  });
});
