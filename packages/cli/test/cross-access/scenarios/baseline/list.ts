// Cross-access scenarios of baseline.list, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { EXPORT } from "../../fixtures.js";

scenariosOf("baseline.list", [
  {
    name: "the valid baselines and the problems of a faulty file",
    fixture: EXPORT,
    root: "system",
    input: {},
    expect: "output",
  },
]);
