// Cross-access scenarios of evidence.coverage, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { DEGREE, EVIDENCE } from "../../fixtures.js";

/** A level of evidence.coverage, as far as the SR-112 scenario reads it. */
interface CoverageLevel {
  readonly type: string;
  readonly total: number;
  readonly withEvidence?: number;
}

/** Needs, requirements and a subtype in two repositories, an obsolete child, a saved filter (SR-036). */
const COVERAGE: FixtureOptions = { fixture: "SR-036/levels", git: ["system", "sensor"] };

scenariosOf("evidence.coverage", [
  {
    name: "the whole workspace in two repositories, with an obsolete child (SR-036)",
    fixture: COVERAGE,
    root: "system",
    input: {},
    expect: "output",
  },
  {
    name: "a saved filter in the core view (SR-036)",
    fixture: COVERAGE,
    root: "system",
    input: { selection: { filter: "Requirements", view: "core" } },
    expect: "output",
  },
  {
    name: "a package page counts 8 of 10 requirements with evidence, not its need",
    fixture: DEGREE,
    input: { selection: { package: "PKG-00d003" } },
    tag: "[SR-112/AK-s1rj]",
    expect: "output",
    check: (results) => {
      const { levels } = (results["core"]?.outcome as { output: { levels: readonly CoverageLevel[] } })
        .output;
      expect(levels.map(({ type, total, withEvidence }) => [type, total, withEvidence])).toEqual([
        ["need", 1, undefined],
        ["system-requirement", 10, 8],
      ]);
    },
  },
  {
    name: "an unknown package gives the same error (ThomasBirkmaier/ReqSeq-archive#535 fixture)",
    fixture: EVIDENCE,
    input: { selection: { package: "PKG-ffffff" } },
    expect: "error",
  },
  {
    name: "a workspace with an evidence location (ThomasBirkmaier/ReqSeq-archive#535)",
    fixture: EVIDENCE,
    input: { selection: { ids: ["SR-e88fb3"] } },
    expect: "output",
  },
]);
