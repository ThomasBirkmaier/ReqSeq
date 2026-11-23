// Cross-access scenarios of metamodel.changeType, in addition to the default one (cross-access.test.ts).
// On the default fixture, SR-004/one-repository with the standard model in one file and one system
// requirement.
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";

scenariosOf("metamodel.changeType", [
  {
    name: "changes a type's name and description in place and writes the same bytes and output through every access (SR-236)",
    tag: "[SR-236/AK-rtcn]",
    input: { type: "decision", name: "Design decision", description: "Why: the reason" },
    expect: "output",
    check: (results) => {
      for (const { changed } of Object.values(results)) {
        expect(changed).toEqual(["metamodel/standard-model.yaml"]);
      }
    },
  },
  {
    name: "a new prefix of a type an element has is refused with the same use through every access (SR-236)",
    tag: "[SR-236/AK-rtcn]",
    input: { type: "system-requirement", prefix: "REQ" },
    expect: "error",
  },
]);
