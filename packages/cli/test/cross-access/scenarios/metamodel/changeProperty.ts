// Cross-access scenarios of metamodel.changeProperty, in addition to the default one (cross-access.test.ts).
// On the default fixture, SR-004/one-repository with the standard model in one file and one system
// requirement.
import { expect } from "vitest";
import { UNREADABLE_ELEMENT } from "../../fixtures.js";
import { scenariosOf } from "../../scenario.js";

scenariosOf("metamodel.changeProperty", [
  {
    name: "changes a property's name and adds a fixed value in place, the same bytes and output through every access (SR-236 AK12)",
    tag: "[SR-236/AK-rtcn]",
    input: { property: "priority", name: "Urgency", addChoices: [{ name: "Urgent" }] },
    expect: "output",
    check: (results) => {
      for (const { changed } of Object.values(results)) {
        expect(changed).toEqual(["metamodel/standard-model.yaml"]);
      }
    },
  },
  {
    name: "a new kind of a property an element holds is refused with the same use through every access (SR-236 AK12)",
    tag: "[SR-236/AK-rtcn]",
    input: { property: "title", kind: "number" },
    expect: "error",
  },
  {
    name: "refuses a new value kind while an element file cannot be read, through every access (SR-008 AK3)",
    tag: "[SR-008/AK-kdrw]",
    fixture: UNREADABLE_ELEMENT,
    input: { property: "remark", kind: "number" },
    expect: "error",
    check: (results) => {
      for (const [access, { changed }] of Object.entries(results)) {
        expect(changed, access).toEqual([]);
      }
    },
  },
]);
