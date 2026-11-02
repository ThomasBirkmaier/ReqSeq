// Cross-access scenarios of filter.list, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { SAVED } from "../../fixtures.js";

scenariosOf("filter.list", [
  {
    name: "hand-written filters with their definitions, and a faulty file (SR-070 AK2)",
    fixture: SAVED,
    input: {},
    expect: "output",
  },
]);
