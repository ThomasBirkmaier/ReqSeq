// Cross-access scenarios of metamodel.addStatus, in addition to the default one (cross-access.test.ts).
// On the default fixture, SR-004/one-repository with the standard model in one file (no type has a
// status list) and one system requirement.
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";

scenariosOf("metamodel.addStatus", [
  {
    name: "adds a new status to a type without a list and writes the same bytes and output through every access (SR-240 AK1, SR-236)",
    tag: "[SR-240/AK-s2fx]",
    input: { type: "need", name: "In review", invalid: false },
    expect: "output",
    check: (results) => {
      for (const { changed } of Object.values(results)) {
        expect(changed).toEqual(["metamodel/standard-model.yaml"]);
      }
    },
  },
  {
    name: "a status the type has already is refused the same way through every access (SR-236)",
    tag: "[SR-236/AK-rtcn]",
    input: { type: "need", status: "draft" },
    expect: "error",
  },
]);
