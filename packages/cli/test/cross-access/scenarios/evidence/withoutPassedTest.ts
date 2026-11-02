// Cross-access scenarios of evidence.withoutPassedTest, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { EVIDENCE, FILTER, MATRIX_EVIDENCE } from "../../fixtures.js";

scenariosOf("evidence.withoutPassedTest", [
  {
    name: "requirements without passed test, from JUnit runs with a skipped test case and an inspection (SR-120)",
    fixture: MATRIX_EVIDENCE,
    input: {},
    expect: "output",
  },
  {
    name: "one page in the order by type and identifier (SR-120)",
    fixture: MATRIX_EVIDENCE,
    input: { limit: 2, offset: 1 },
    expect: "output",
  },
  {
    name: "in a variant view, only the records for it count (SR-120, SR-047)",
    fixture: FILTER,
    input: { view: "VAR-0000c1" },
    expect: "output",
  },
  {
    name: "a workspace with an evidence location (#535)",
    fixture: EVIDENCE,
    input: {},
    expect: "output",
  },
  {
    name: "a view that is no variant gives the same error",
    fixture: EVIDENCE,
    input: { view: "SR-e88fb3" },
    expect: "error",
  },
]);
