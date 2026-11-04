// Cross-access scenarios of evidence.status, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { EMERGENT, EVIDENCE, FILTER, VARIANT_EVIDENCE } from "../../fixtures.js";

/** Parents verified indirectly through Markdown records of their children, missing children (SR-034). */
const INDIRECT: FixtureOptions = { fixture: "SR-034/indirect", git: true };

/** Needs, requirements and a use case with validation and verification records (SR-038). */
const VALIDATION: FixtureOptions = { fixture: "SR-038/validation", git: true };

/** Needs with inconclusive validation records: current, decided by a newer one, older version, without reason (SR-172). */
const INCONCLUSIVE: FixtureOptions = { fixture: "SR-172/inconclusive", git: true };

scenariosOf("evidence.status", [
  {
    name: "no row for a variant that excludes or replaces the requirement (SR-047 AK3)",
    fixture: VARIANT_EVIDENCE,
    input: { selection: { ids: ["SR-0000a1", "SR-0000a2", "SR-0000b1"] } },
    tag: "[SR-047/AK3]",
    expect: "output",
  },
  {
    name: "the verification status of a workspace with an evidence location (#535, SR-031)",
    fixture: EVIDENCE,
    input: {},
    expect: "output",
  },
  {
    name: "the verification status per view of requirements valid for variants, one page (SR-031, SR-047)",
    fixture: FILTER,
    input: { selection: { where: { verification: ["open"] }, view: "VAR-0000c1" }, limit: 3, offset: 1 },
    expect: "output",
  },
  {
    name: "indirect verification and missing children (SR-034)",
    fixture: INDIRECT,
    input: {},
    expect: "output",
  },
  {
    name: "validation status apart from the verification status (SR-038)",
    fixture: VALIDATION,
    input: {},
    expect: "output",
  },
  {
    name: "an inconclusive validation with its reason as a status of its own (SR-172 AK2)",
    fixture: INCONCLUSIVE,
    input: {},
    tag: "[SR-172/AK2]",
    expect: "output",
    check: (results) => {
      const { elements } = (
        results["core"]?.outcome as { output: { elements: readonly Record<string, unknown>[] } }
      ).output;
      expect(elements.map((e) => [e["shortId"], e["validation"], e["validationReason"]])).toEqual([
        ["N-00a001", "inconclusive", "The field test needs a winter with frost; none so far."],
        ["N-00a002", "validated", undefined],
        ["N-00a003", "inconclusive", "The frost sensor was replaced; the field test starts again."],
        ["N-00a004", "outdated", undefined],
        ["N-00a005", "open", undefined],
      ]);
    },
  },
  {
    name: "emergent requirements need their own record (SR-035)",
    fixture: EMERGENT,
    input: {},
    expect: "output",
  },
  {
    name: "unknown element in the selection",
    fixture: EVIDENCE,
    input: { selection: { ids: ["SR-ffffff"] } },
    expect: "error",
  },
]);
