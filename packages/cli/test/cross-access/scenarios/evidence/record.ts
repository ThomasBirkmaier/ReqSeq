// Cross-access scenarios of evidence.record, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { EVIDENCE, VARIANT_EVIDENCE } from "../../fixtures.js";

// The date is given: without it the time of the call would differ between the accesses.
scenariosOf("evidence.record", [
  {
    name: "a manual inspection record of a requirement in the evidence folder (SR-030 AK1, AK2)",
    fixture: EVIDENCE,
    input: {
      ref: "SR-e88fb3",
      kind: "verification",
      result: "passed",
      method: "inspection",
      item: "unit 7",
      date: "2026-10-27T10:00:00Z",
      evidence: "photos/unit-7.jpg",
    },
    expect: "output",
  },
  {
    name: "an unknown element gives the same error",
    fixture: EVIDENCE,
    input: { ref: "SR-ffffff", kind: "validation", result: "passed", date: "2026-10-27T10:00:00Z" },
    expect: "error",
  },
  {
    name: "a record for a variant that excludes the requirement is refused (SR-047 AK4)",
    fixture: VARIANT_EVIDENCE,
    input: {
      ref: "SR-0000a2",
      kind: "verification",
      method: "test",
      item: "build-47",
      result: "passed",
      variant: "VAR-0000c1",
    },
    tag: "[SR-047/AK4]",
    expect: "error",
  },
  {
    name: "a record for a variant that replaces the requirement is refused (SR-047 AK4)",
    fixture: VARIANT_EVIDENCE,
    input: {
      ref: "SR-0000a1",
      kind: "verification",
      method: "test",
      item: "build-47",
      result: "passed",
      variant: "VAR-0000c1",
    },
    tag: "[SR-047/AK4]",
    expect: "error",
  },
  {
    name: "a validation record with a variant is refused (SR-038 AK4)",
    fixture: VARIANT_EVIDENCE,
    input: {
      ref: "SR-0000a3",
      kind: "validation",
      result: "passed",
      variant: "VAR-0000c1",
      date: "2026-10-27T10:00:00Z",
    },
    tag: "[SR-038/AK4]",
    expect: "error",
  },
]);
