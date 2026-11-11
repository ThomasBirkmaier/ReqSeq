// Cross-access scenarios of evidence.status, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import type { Scenario } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";
import { CRITERIA, EMERGENT, EVIDENCE, FILTER, VARIANT_EVIDENCE, VARIANT_INVALID } from "../../fixtures.js";

/** Parents verified indirectly through Markdown records of their children, missing children (SR-034). */
/** The criterion of SR-0000e3 with records of an older version only, as outputs name it (SR-205 AK2). */
const FROST = { criterion: 3, key: "kfro", text: "Given frost, then a mark shows." };
const INDIRECT: FixtureOptions = { fixture: "SR-034/indirect", git: true };

/** A repository marked variant-independent next to an unmarked one, with records with and without variant (SR-173). */
const INDEPENDENT: FixtureOptions = { fixture: "SR-173/independent", git: true };

/** One JUnit test case for two variants and the core, in a repository with and one without the mark of SR-173 (SR-093 AK5). */
const VIEWS: FixtureOptions = { fixture: "SR-093/views", git: true };

/** Needs, requirements and a use case with validation and verification records (SR-038). */
const VALIDATION: FixtureOptions = { fixture: "SR-038/validation", git: true };

/** Needs with inconclusive validation records: current, decided by a newer one, older version, without reason (SR-172). */
const INCONCLUSIVE: FixtureOptions = { fixture: "SR-172/inconclusive", git: true };

/** The `verification` of each element of the core access's output. */
const verificationOf = (results: Parameters<NonNullable<Scenario["check"]>>[0]): unknown[] =>
  (
    results["core"]?.outcome as { output: { elements: readonly Record<string, unknown>[] } }
  ).output.elements.map((e) => e["verification"]);

scenariosOf("evidence.status", [
  {
    name: "no row for a variant that excludes or replaces the requirement (SR-047 AK3)",
    fixture: VARIANT_EVIDENCE,
    input: { selection: { ids: ["SR-0000a1", "SR-0000a2", "SR-0000b1"] } },
    tag: "[SR-047/AK3]",
    expect: "output",
  },
  {
    name: "no row for a variant with an invalid status (SR-047 AK6)",
    fixture: VARIANT_INVALID,
    input: { selection: { ids: ["SR-0000a3"] } },
    tag: "[SR-047/AK6]",
    expect: "output",
    check: (results) => {
      expect(verificationOf(results)).toEqual([
        [
          { view: "core", status: "open" },
          { view: "43043043-0000-4000-8000-0000000000c1", status: "open" },
          { view: "43043043-0000-4000-8000-0000000000c2", status: "open" },
        ],
      ]);
    },
  },
  {
    name: "records without variant count in every view in a variant-independent repository (SR-173 AK1)",
    fixture: INDEPENDENT,
    input: {},
    tag: "[SR-173/AK1]",
    expect: "output",
  },
  {
    name: "records without variant count only in the core outside a variant-independent repository (SR-173 AK2)",
    fixture: INDEPENDENT,
    input: { selection: { ids: ["SR-0000a4"] } },
    tag: "[SR-173/AK2]",
    expect: "output",
  },
  {
    name: "a JUnit test case for the variants A and B and the core counts in each of them only, its core record of a variant-independent repository in every view (SR-093 AK5)",
    fixture: VIEWS,
    input: {},
    tag: "[SR-093/AK5]",
    expect: "output",
    check: (results) => {
      const { elements } = (
        results["core"]?.outcome as { output: { elements: readonly Record<string, unknown>[] } }
      ).output;
      const views: Readonly<Record<string, string>> = {
        core: "core",
        "09300093-0000-4000-8000-0000000000c1": "linux",
        "09300093-0000-4000-8000-0000000000c2": "macos",
        "09300093-0000-4000-8000-0000000000c3": "windows",
      };
      expect(
        elements.flatMap((e) => {
          const rows = e["verification"] as readonly { view: string; status: string }[] | undefined;
          return rows === undefined
            ? []
            : [[e["shortId"], rows.map((v) => `${String(views[v.view])} ${v.status}`)]];
        }),
      ).toEqual([
        ["SR-0000a1", ["core verified", "linux verified", "macos verified", "windows open"]],
        ["SR-0000b1", ["core verified", "linux verified", "macos verified", "windows verified"]],
      ]);
    },
  },
  {
    name: "the verification status of a workspace with an evidence location (ThomasBirkmaier/ReqSeq-archive#535, SR-031)",
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
    name: "the status per acceptance criterion: open with 2 of 3 criteria verified (SR-031 AK5)",
    fixture: CRITERIA,
    input: {},
    tag: "[SR-031/AK5]",
    expect: "output",
    check: (results) => {
      const { elements } = (
        results["core"]?.outcome as { output: { elements: readonly Record<string, unknown>[] } }
      ).output;
      expect(elements.map((e) => [e["shortId"], e["verification"]])).toEqual([
        [
          "SR-0000e1",
          [
            {
              view: "core",
              status: "open",
              criteria: {
                verified: 2,
                total: 3,
                notVerified: [{ criterion: 3, text: "Given a gust, then the peak shows." }],
              },
            },
          ],
        ],
        ["SR-0000e2", [{ view: "core", status: "verified", criteria: { verified: 2, total: 2 } }]],
        [
          "SR-0000e3",
          [{ view: "core", status: "outdated", criteria: { verified: 2, total: 3, notVerified: [FROST] } }],
        ],
        [
          "SR-0000e4",
          [
            {
              view: "core",
              status: "failed",
              criteria: {
                verified: 1,
                total: 2,
                notVerified: [{ criterion: 2, text: "Given no reading, then a dash shows." }],
              },
            },
          ],
        ],
        ["SR-0000e5", [{ view: "core", status: "verified" }]],
      ]);
    },
  },
  {
    name: "a record that names no criterion counts for every criterion (SR-031 AK6)",
    fixture: CRITERIA,
    input: { selection: { ids: ["SR-0000e2"] } },
    tag: "[SR-031/AK6]",
    expect: "output",
    check: (results) => {
      expect(verificationOf(results)).toEqual([
        [{ view: "core", status: "verified", criteria: { verified: 2, total: 2 } }],
      ]);
    },
  },
  {
    name: "a requirement without criteria takes the newest record for the whole requirement (SR-031 AK7)",
    fixture: CRITERIA,
    input: { selection: { ids: ["SR-0000e5"] } },
    tag: "[SR-031/AK7]",
    expect: "output",
    check: (results) => {
      expect(verificationOf(results)).toEqual([[{ view: "core", status: "verified" }]]);
    },
  },
  {
    name: "a criterion with records of an older version only, the others verified, gives outdated (SR-031 AK8)",
    fixture: CRITERIA,
    input: { selection: { ids: ["SR-0000e3"] } },
    tag: "[SR-031/AK8]",
    expect: "output",
    check: (results) => {
      expect(verificationOf(results)).toEqual([
        [{ view: "core", status: "outdated", criteria: { verified: 2, total: 3, notVerified: [FROST] } }],
      ]);
    },
  },
  {
    name: "indirect verification and missing children (SR-034)",
    fixture: INDIRECT,
    input: {},
    expect: "output",
  },
  {
    name: "validation status apart from the verification status, none for a use case with a validation record (SR-038)",
    fixture: VALIDATION,
    input: {},
    tag: "[SR-038/AK5]",
    expect: "output",
    check: (results) => {
      const { elements } = (
        results["core"]?.outcome as { output: { elements: readonly Record<string, unknown>[] } }
      ).output;
      expect(elements.find((e) => e["shortId"] === "UC-00e001")?.["validation"]).toBeUndefined();
    },
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
