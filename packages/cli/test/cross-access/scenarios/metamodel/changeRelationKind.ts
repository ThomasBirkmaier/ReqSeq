// Cross-access scenarios of metamodel.changeRelationKind, in addition to the default one
// (cross-access.test.ts). On the default fixture, SR-004/one-repository with the standard model in
// one file and one system requirement.
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";

scenariosOf("metamodel.changeRelationKind", [
  {
    name: "changes the name, target types and limits of a relation kind in place through every access (SR-239 AK2)",
    tag: "[SR-239/AK-qt0q]",
    input: {
      kind: "based-on",
      name: "Grounded in",
      targetTypes: ["decision", "need"],
      limits: [{ "target-type": "decision", min: 1 }],
    },
    expect: "output",
    check: (results) => {
      for (const { changed } of Object.values(results)) {
        expect(changed).toEqual(["metamodel/standard-model.yaml"]);
      }
    },
  },
  {
    name: "an unknown relation kind is refused through every access (SR-236 AK12)",
    tag: "[SR-236/AK-rtcn]",
    input: { kind: "nope", name: "Nope" },
    expect: "error",
  },
]);
