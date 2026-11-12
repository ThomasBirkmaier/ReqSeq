// Cross-access scenarios of perspective.list, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { PERSPECTIVES } from "../../fixtures.js";

scenariosOf("perspective.list", [
  {
    name: "hand-written perspectives, and a faulty file with file and reason (SR-213 AK2, AK8)",
    fixture: PERSPECTIVES,
    input: {},
    expect: "output",
  },
]);
