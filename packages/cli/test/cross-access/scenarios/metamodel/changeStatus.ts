// Cross-access scenarios of metamodel.changeStatus, in addition to the default one (cross-access.test.ts).
// On the default fixture, SR-004/one-repository with the standard model in one file and one system
// requirement in status draft.
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";

scenariosOf("metamodel.changeStatus", [
  {
    name: "moves the initial mark and writes the same bytes and output through every access, the element keeping its status (SR-240 AK2, SR-236)",
    tag: "[SR-240/AK-kk0y]",
    input: { status: "approved", initial: true },
    expect: "output",
    check: (results) => {
      for (const { changed } of Object.values(results)) {
        expect(changed).toEqual(["metamodel/standard-model.yaml"]);
      }
    },
  },
  {
    name: "a name another status has is refused the same way through every access (SR-236)",
    tag: "[SR-236/AK-rtcn]",
    input: { status: "approved", name: "Draft" },
    expect: "error",
  },
]);
