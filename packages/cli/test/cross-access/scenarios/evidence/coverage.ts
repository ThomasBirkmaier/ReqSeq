// Cross-access scenarios of evidence.coverage, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { DEGREE, EVIDENCE } from "../../fixtures.js";

/** A level of evidence.coverage, as far as the package scenario reads it. */
interface CoverageLevel {
  readonly type: string;
  readonly total: number;
  readonly withChildren: number;
  readonly withEvidence?: number;
}

/** A level of evidence.coverage, as far as the SR-036 AK6 scenario reads it. */
interface LevelKeys extends Readonly<Record<string, unknown>> {
  readonly type: string;
  readonly elements: Readonly<Record<string, unknown>>;
}

/** The order of the fields of a requirement level and of its element lists (SR-036 AK6): without before with. */
const LEVEL_ORDER = [
  "type",
  "total",
  "withoutChildren",
  "withoutEvidence",
  "withChildren",
  "withEvidence",
  "elements",
];
const ELEMENTS_ORDER = ["withoutChildren", "withoutEvidence", "withChildren", "withEvidence"];

/** The numbers of a level in the order of SR-036 AK6, then the order of its fields and of its element lists. */
const numbersAndOrder = (level: LevelKeys): unknown[] => [
  [
    level.type,
    level["withoutChildren"],
    level["withoutEvidence"],
    level["withChildren"],
    level["withEvidence"],
  ],
  Object.keys(level),
  Object.keys(level.elements),
];

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
    name: "per level the numbers without children and without evidence, 0 included, come before those with",
    fixture: COVERAGE,
    root: "system",
    input: { selection: { where: { type: ["system-requirement", "software-requirement"] } } },
    tag: "[SR-036/AK-zhys]",
    expect: "output",
    check: (results) => {
      // Every access keeps the order of the catalog, which the comparison of the outputs does not look at.
      for (const [access, result] of Object.entries(results)) {
        const { levels } = (result.outcome as { output: { levels: readonly LevelKeys[] } }).output;
        expect([access, levels.map(numbersAndOrder)]).toEqual([
          access,
          [
            // S1 has a child, S2 none; neither has a record in the files of the fixture.
            [["system-requirement", 1, 2, 1, 0], LEVEL_ORDER, ELEMENTS_ORDER],
            // No software requirement has a child: the number with children is there as 0.
            [["software-requirement", 3, 3, 0, 0], LEVEL_ORDER, ELEMENTS_ORDER],
          ],
        ]);
      }
    },
  },
  {
    name: "a package counts per level how many elements have children and how many requirements have evidence",
    fixture: DEGREE,
    input: { selection: { package: "PKG-00d003" } },
    tag: "[SR-036/AK-wkgr]",
    expect: "output",
    check: (results) => {
      const { levels } = (results["core"]?.outcome as { output: { levels: readonly CoverageLevel[] } })
        .output;
      // Of P3's 10 valid requirements R10 has a child (C3) and 8 have evidence; its need N1 has no child.
      expect(
        levels.map(({ type, total, withChildren, withEvidence }) => [
          type,
          total,
          withChildren,
          withEvidence,
        ]),
      ).toEqual([
        ["need", 1, 0, undefined],
        ["system-requirement", 10, 1, 8],
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
