// Cross-access scenarios of metamodel.addProperty, in addition to the default one (cross-access.test.ts).
// On the default fixture, SR-004/one-repository with the standard model in one file and one system
// requirement.
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";

scenariosOf("metamodel.addProperty", [
  {
    name: "gives a type a new choice property and writes the same bytes and output through every access (SR-236)",
    tag: "[SR-236/AK-rtcn]",
    input: {
      type: "decision",
      required: true,
      name: "Risk level",
      kind: "choice",
      choices: [{ name: "Low" }, { name: "High" }],
    },
    expect: "output",
    check: (results) => {
      for (const { changed } of Object.values(results)) {
        expect(changed).toEqual(["metamodel/standard-model.yaml"]);
      }
    },
  },
  {
    name: "a property the type has already is refused the same way through every access (SR-236)",
    tag: "[SR-236/AK-rtcn]",
    input: { type: "system-requirement", property: "title", required: false },
    expect: "error",
  },
]);
