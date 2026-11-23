// Cross-access scenarios of metamodel.addRelationKind, in addition to the default one
// (cross-access.test.ts). On the default fixture, SR-004/one-repository with the standard model in
// one file.
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";

scenariosOf("metamodel.addRelationKind", [
  {
    name: "adds a relation kind with every field through every access (SR-239 AK1)",
    tag: "[SR-239/AK-rvxg]",
    input: {
      name: "Conflicts with",
      inverseName: "Conflicts with",
      description: "The two cannot both hold",
      sourceTypes: ["system-requirement"],
      targetTypes: ["system-requirement"],
      limits: [{ "target-type": "system-requirement", max: 5 }],
    },
    expect: "output",
    check: (results) => {
      for (const { changed, files } of Object.values(results)) {
        expect(changed).toEqual(["metamodel/standard-model.yaml"]);
        expect(files["metamodel/standard-model.yaml"]).toContain(
          "  - key: conflicts-with\n    name: Conflicts with\n    description: The two cannot both hold\n",
        );
      }
    },
  },
  {
    name: "a name another relation kind has is refused through every access (SR-236)",
    tag: "[SR-236/AK-rtcn]",
    input: { name: "Refines", key: "details" },
    expect: "error",
  },
]);
