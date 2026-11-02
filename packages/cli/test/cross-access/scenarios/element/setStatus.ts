// Cross-access scenarios of element.setStatus, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { scenariosOf } from "../../scenario.js";

/** Statuses per type (#306): glossary terms have no status, requirements require one. */
const STATUSES_PER_TYPE: FixtureOptions = { fixture: "enabler-306/statuses-per-type", git: true };

scenariosOf("element.setStatus", [
  { name: "approve one element", input: { refs: ["SR-e88fb3"], status: "approved" }, expect: "output" },
  {
    name: "a status by its display name, in any case (#309)",
    input: { refs: ["sr-e88fb3"], status: "APPROVED" },
    expect: "output",
  },
  {
    name: "status not in the metamodel",
    input: { refs: ["SR-e88fb3"], status: "released" },
    expect: "error",
  },
  {
    name: "remove a leftover status with status null: CLI via --input (#343)",
    fixture: STATUSES_PER_TYPE,
    input: { refs: ["T-eee002"], status: null },
    expect: "output",
  },
  {
    name: "remove the status of an element whose type requires one (#343)",
    fixture: STATUSES_PER_TYPE,
    input: { refs: ["SR-bbb001"], status: null },
    expect: "error",
  },
]);
