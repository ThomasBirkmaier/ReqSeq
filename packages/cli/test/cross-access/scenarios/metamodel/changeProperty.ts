// Cross-access scenarios of metamodel.changeProperty, in addition to the default one (cross-access.test.ts).
// On the default fixture, SR-004/one-repository with the standard model in one file and one system
// requirement.
import { expect } from "vitest";
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
]);
