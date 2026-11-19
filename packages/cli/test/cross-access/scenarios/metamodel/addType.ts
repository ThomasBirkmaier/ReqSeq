// Cross-access scenarios of metamodel.addType, in addition to the default one (cross-access.test.ts).
// On the default fixture, SR-004/one-repository with the standard model in one file.
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";

scenariosOf("metamodel.addType", [
  {
    name: "adds a type with every field and writes the same bytes and output through every access (SR-236 AK12)",
    tag: "[SR-236/AK-rtcn]",
    input: { name: "Risk Item", prefix: "RI", extends: "need", abstract: true },
    expect: "output",
    check: (results) => {
      for (const { changed } of Object.values(results)) {
        expect(changed).toEqual(["metamodel/standard-model.yaml"]);
      }
    },
  },
  {
    name: "a key made from the name that does not start with a letter is refused through every access (SR-236 AK12)",
    tag: "[SR-236/AK-rtcn]",
    input: { name: "2nd level", prefix: "SL" },
    expect: "error",
  },
]);
