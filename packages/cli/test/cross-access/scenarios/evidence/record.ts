// Cross-access scenarios of evidence.record, in addition to the default one (cross-access.test.ts).
import { scenariosOf } from "../../scenario.js";
import { CRITERIA, EVIDENCE, VARIANT_EVIDENCE } from "../../fixtures.js";

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
    // Criteria by number or key; the file holds their keys, the output names number, key and text.
    name: "a record names acceptance criteria by number or key and has their keys in its file (SR-030 AK4)",
    fixture: CRITERIA,
    input: {
      ref: "SR-0000e3",
      kind: "verification",
      result: "passed",
      method: "analysis",
      item: "build-47",
      date: "2026-10-27T10:00:00Z",
      criteria: ["kfro", 1],
    },
    tag: "[SR-030/AK4]",
    expect: "output",
  },
  {
    name: "a criterion without key is refused (SR-030 AK4)",
    fixture: CRITERIA,
    input: {
      ref: "SR-0000e1",
      kind: "verification",
      result: "passed",
      method: "analysis",
      item: "build-47",
      date: "2026-10-27T10:00:00Z",
      criteria: [1],
    },
    tag: "[SR-030/AK4]",
    expect: "error",
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
    name: "a record without variant of a requirement the core does not hold is refused (SR-047 AK5)",
    fixture: VARIANT_EVIDENCE,
    input: { ref: "SR-0000b1", kind: "verification", method: "test", item: "build-47", result: "passed" },
    tag: "[SR-047/AK5]",
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
  {
    name: "an inconclusive validation without a reason is refused (SR-172 AK1)",
    fixture: EVIDENCE,
    input: { ref: "SR-e88fb3", kind: "validation", result: "inconclusive", date: "2026-10-27T10:00:00Z" },
    tag: "[SR-172/AK1]",
    expect: "error",
  },
  {
    name: "an inconclusive validation is written with its reason (SR-172 AK1)",
    fixture: EVIDENCE,
    input: {
      ref: "SR-e88fb3",
      kind: "validation",
      result: "inconclusive",
      reason: "The field test needs frost; none so far.",
      date: "2026-10-27T10:00:00Z",
    },
    tag: "[SR-172/AK1]",
    expect: "output",
  },
]);
