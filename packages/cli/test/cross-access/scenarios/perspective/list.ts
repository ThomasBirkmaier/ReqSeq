// Cross-access scenarios of perspective.list, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { PERSPECTIVES } from "../../fixtures.js";

scenariosOf("perspective.list", [
  {
    name: "hand-written perspectives, and a faulty file with file and reason (SR-213 AK8)",
    tag: "[SR-213/AK-qp6d]",
    fixture: PERSPECTIVES,
    input: {},
    expect: "output",
  },
  {
    name: "the perspectives committed to the repository, in a fresh copy of it (SR-213 AK2)",
    tag: "[SR-213/AK-dyjq]",
    fixture: PERSPECTIVES,
    input: {},
    expect: "output",
  },
]);
