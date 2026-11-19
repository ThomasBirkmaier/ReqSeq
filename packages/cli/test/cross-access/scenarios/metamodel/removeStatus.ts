// Cross-access scenarios of metamodel.removeStatus, in addition to the default one (cross-access.test.ts).
// On the default fixture, SR-004/one-repository with the standard model in one file (no type has a
// status list) and one system requirement in status draft.
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";

scenariosOf("metamodel.removeStatus", [
  {
    name: "writes the list of the other statuses on a type without one, with the same bytes and output through every access (SR-236 AK12)",
    tag: "[SR-236/AK-rtcn]",
    input: { type: "need", status: "obsolete" },
    expect: "output",
    check: (results) => {
      for (const { changed } of Object.values(results)) {
        expect(changed).toEqual(["metamodel/standard-model.yaml"]);
      }
    },
  },
  {
    name: "a status an element of the type has is refused with the same use through every access (SR-236 AK12)",
    tag: "[SR-236/AK-rtcn]",
    input: { type: "system-requirement", status: "draft" },
    expect: "error",
  },
]);
