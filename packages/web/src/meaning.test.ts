import { describe, expect, it } from "vitest";
import type { Metamodel } from "./meaning.js";
import {
  kindProps,
  listProps,
  namesOf,
  noteProps,
  propOfType,
  reqWords,
  settledWords,
  statusRole,
  typePlural,
  typesWith,
} from "./meaning.js";

const type = (
  key: string,
  name: string,
  extra: Partial<Metamodel["types"][number]> = {},
): Metamodel["types"][number] => ({
  key,
  name,
  prefix: key.toUpperCase(),
  abstract: false,
  ancestors: [],
  properties: [],
  required: [],
  statuses: [],
  ...extra,
});

/** A metamodel with other keys than the standard model, as the UI must read any workspace. */
const mm: Metamodel = {
  types: [
    type("cap", "Capability", {
      meaning: "requirement",
      properties: ["crit", "why", "checks", "level"],
      required: ["level"],
    }),
    type("con", "Constraint", { meaning: "requirement" }),
    type("base", "Base requirement", { meaning: "requirement", abstract: true }),
    type("goal", "Mission goal", { meaning: "need" }),
    type("box", "Library", { meaning: "package" }),
    type("ana", "Hazard Analysis"),
    type("st", "Status"),
    type("reqs", "Requirements"),
  ],
  properties: [
    { key: "crit", name: "Checks", kind: "text", many: true, meaning: "acceptance-criteria", content: true },
    { key: "why", name: "Rationale", kind: "text", markdown: true, content: true },
    { key: "checks", name: "Validation Criteria", kind: "text", many: true, content: true },
    { key: "level", name: "Level", kind: "choice", choices: [{ key: "high", name: "High" }], content: true },
  ],
  relations: [],
  statuses: [
    { key: "proposed", name: "Proposed", initial: true },
    { key: "agreed", name: "Agreed" },
    { key: "shipped", name: "Shipped" },
    { key: "gone", name: "Withdrawn", invalid: true },
  ],
};

describe("the metamodel by meaning", () => {
  it("finds types and properties by meaning, never by key", () => {
    expect(typesWith(mm, "requirement")).toEqual(["cap", "con"]);
    expect(propOfType(mm, "cap", "acceptance-criteria")).toBe("crit");
    expect(propOfType(mm, "con", "acceptance-criteria")).toBeUndefined();
    expect(kindProps(mm, "cap")).toEqual(["level"]);
    expect(noteProps(mm, "cap")).toEqual(["why"]);
    expect(listProps(mm, "cap")).toEqual(["checks"]);
  });

  it("words the workspace's own names", () => {
    expect(reqWords(mm)).toBe("capabilities and constraints");
    expect(namesOf(mm, ["cap", "con", "goal"], "requirements")).toBe("requirements");
    expect(typePlural(mm, "box")).toBe("Libraries");
    expect(typePlural(mm, "goal")).toBe("Mission goals");
    expect(typePlural(mm, "ana")).toBe("Hazard analyses");
    expect(typePlural(mm, "st")).toBe("Statuses");
    expect(typePlural(mm, "reqs")).toBe("Requirements");
    expect(settledWords(mm)).toBe("Agreed or shipped");
  });

  it("colours a status by its role", () => {
    expect(statusRole(mm, "proposed")).toBe("initial");
    expect(statusRole(mm, "shipped")).toBe("settled");
    expect(statusRole(mm, "gone")).toBe("invalid");
    expect(statusRole(mm, "unknown")).toBe("");
  });
});
