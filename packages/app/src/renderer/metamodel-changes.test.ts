import { describe, expect, it } from "vitest";
import { NO_CHANGE, NO_MARKS, changeOf, marksOf } from "./metamodel-changes.js";
import { FIXTURE_METAMODEL } from "./metamodel-test-data.js";

/** The file a metamodel command names as written. */
const written = { files: [{ repository: "system", path: "metamodel/standard-model.yaml" }] };

describe("changeOf", () => {
  it("[SR-130/AK-wb12] takes the definitions a metamodel command added or changed from its output, none after a removal", () => {
    const of = (command: string, output: object) => changeOf(command, { ...output, ...written });
    expect(of("metamodel.addType", { type: { key: "t" } })).toEqual({ ...NO_CHANGE, types: ["t"] });
    expect(of("metamodel.changeType", { type: { key: "t" } })).toEqual({ ...NO_CHANGE, types: ["t"] });
    expect(of("metamodel.addProperty", { type: "t", property: { key: "p" } })).toEqual({
      ...NO_CHANGE,
      properties: [{ key: "p", type: "t" }],
    });
    expect(of("metamodel.changeProperty", { property: { key: "p" } })).toEqual({
      ...NO_CHANGE,
      properties: [{ key: "p" }],
    });
    for (const command of ["metamodel.addRelationKind", "metamodel.changeRelationKind"]) {
      expect(of(command, { relationKind: { key: "k" } })).toEqual({ ...NO_CHANGE, kinds: ["k"] });
    }
    expect(of("metamodel.addStatus", { type: "t", status: { key: "s" }, alsoTypes: ["u"] })).toEqual({
      ...NO_CHANGE,
      statuses: [{ key: "s", types: ["t", "u"] }],
    });
    // The status that lost the initial mark changed too.
    expect(of("metamodel.changeStatus", { status: { key: "s" }, previousInitial: "d" })).toEqual({
      ...NO_CHANGE,
      statuses: [{ key: "s" }, { key: "d" }],
    });
    expect(of("metamodel.changeStatus", { status: { key: "s" } })?.statuses).toEqual([{ key: "s" }]);
    for (const command of [
      "metamodel.removeType",
      "metamodel.removeProperty",
      "metamodel.removeRelationKind",
      "metamodel.removeStatus",
    ]) {
      expect(of(command, {})).toBe(NO_CHANGE);
    }
    // Another command keeps the marks.
    expect(changeOf("element.setStatus", {})).toBeUndefined();
  });

  it("[SR-130/AK-wb12] keeps the marks after a metamodel command whose output names no written file", () => {
    expect(changeOf("metamodel.changeType", { type: { key: "t" }, files: [] })).toBeUndefined();
    expect(changeOf("metamodel.removeStatus", { files: [] })).toBeUndefined();
  });
});

describe("marksOf", () => {
  it("[SR-130/AK-wb12] marks a definition in the types of its scope and the types that extend one of them", () => {
    expect(marksOf(NO_CHANGE, FIXTURE_METAMODEL)).toBe(NO_MARKS);
    expect(NO_MARKS.type("item")).toBe(false);
    const marks = marksOf(
      {
        types: ["decision"],
        properties: [{ key: "rationale", type: "requirement" }, { key: "title" }],
        statuses: [{ key: "draft", types: ["requirement"] }],
        kinds: ["replaces"],
      },
      FIXTURE_METAMODEL,
    );
    expect(marks.type("decision")).toBe(true);
    expect(marks.type("item")).toBe(false);
    expect(marks.property("software-requirement", "rationale")).toBe(true);
    expect(marks.property("item", "rationale")).toBe(false);
    expect(marks.property("package", "title")).toBe(true);
    expect(marks.status("software-requirement", "draft")).toBe(true);
    expect(marks.status("item", "draft")).toBe(false);
    // A type the output does not have counts by its own key only.
    expect(marks.status("gone", "draft")).toBe(false);
    expect(marks.kind("replaces")).toBe(true);
    expect(marks.kind("derives-from")).toBe(false);
  });
});
