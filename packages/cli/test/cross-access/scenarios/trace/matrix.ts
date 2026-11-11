// Cross-access scenarios of trace.matrix, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { CRITERIA, MATRIX_EVIDENCE, STATUS } from "../../fixtures.js";

/**
 * Needs, a decision, packages and system requirements with current, outdated and missing relations
 * (SR-125), and a minimum: a system requirement derives from at least one need (SR-153).
 */
const MATRIX: FixtureOptions = { fixture: "SR-125/matrix", git: true };

/** The matrix with evidence of SR-126 and a failed run of SR-126b01's test case at the instant of its passed one. */
const TIED: FixtureOptions = {
  ...MATRIX_EVIDENCE,
  files: {
    ...MATRIX_EVIDENCE.files,
    "evidence/ci/run-3.xml":
      '<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="station" tests="1" failures="1">\n' +
      '    <testcase classname="tests.test_wind" name="test_speed[SR-126b01]" time="0.010">\n      <properties>\n' +
      '        <property name="reqseq:element" value="5c0e1d2a-0126-4126-8126-000000126b01"/>\n' +
      '        <property name="reqseq:version" value="n1:4b6860725d822fd9"/>\n' +
      '        <property name="reqseq:item" value="build-603"/>\n' +
      '        <property name="reqseq:date" value="2026-10-22T09:00:00Z"/>\n      </properties>\n' +
      '      <failure message="too slow">AssertionError: too slow</failure>\n    </testcase>\n  </testsuite>\n</testsuites>\n',
  },
};
const MX = "5e125a7d-2b4f-4c61-9d08-";

scenariosOf("trace.matrix", [
  {
    tag: "[SR-125/AK6]",
    name: "a package gives the same rows, columns and cells",
    fixture: MATRIX,
    input: { selection: { package: "PKG-000001" } },
    expect: "output",
  },
  {
    tag: "[SR-125/AK6]",
    name: "a saved filter with its own sort",
    fixture: MATRIX,
    input: { selection: { filter: "Stage SRs" } },
    expect: "output",
  },
  {
    tag: "[SR-125/AK6]",
    name: "a list of IDs, the sort of the app's list",
    fixture: MATRIX,
    input: {
      selection: { ids: [`${MX}0b0000000005`, `${MX}0b0000000001`, `${MX}0a0000000001`] },
      sort: [
        { by: "type", order: "asc" },
        { by: "identifier", order: "asc" },
      ],
    },
    expect: "output",
  },
  {
    tag: "[SR-125/AK6]",
    name: "the derivation tree, one page, with the properties named",
    fixture: MATRIX,
    input: {
      selection: { package: "PKG-000001" },
      sort: [{ by: "hierarchy" }],
      kinds: ["packages", "derives-from"],
      limit: 2,
      offset: 1,
    },
    expect: "output",
  },
  {
    tag: "[SR-153/AK3]",
    name: "one page of gaps, with the head of a column with a minimum and of the columns without",
    fixture: MATRIX,
    input: { selection: { package: "PKG-000001" }, limit: 3, offset: 2 },
    expect: "output",
  },
  {
    tag: "[SR-153/AK3]",
    name: "rows of a type without a minimum and the column of a minimum no row has",
    fixture: MATRIX,
    input: { selection: { ids: [`${MX}0b0000000003`, `${MX}0a0000000001`] } },
    expect: "output",
  },
  {
    name: "relations and gaps seen through the core view (SR-125 AK2, SR-153 AK1)",
    fixture: MATRIX,
    input: { selection: { package: "PKG-000001", view: "core" } },
    expect: "output",
  },
  {
    name: "the matrix of a selection with evidence (SR-126)",
    fixture: MATRIX_EVIDENCE,
    input: { selection: { where: { type: ["system-requirement"] } } },
    expect: "output",
  },
  {
    name: "the status column counts the acceptance criteria the records name (SR-031 AK5, SR-126)",
    fixture: CRITERIA,
    input: { selection: { where: { type: ["system-requirement"] } } },
    expect: "output",
  },
  {
    tag: "[SR-126/AK1]",
    name: "of several equally new runs of a test case the cell shows the failed one (SR-126 AK1)",
    fixture: TIED,
    input: { selection: { ids: ["5c0e1d2a-0126-4126-8126-000000126b01"] } },
    expect: "output",
    check: (results) => {
      const { rows } = (
        results["core"]?.outcome as {
          output: { rows: { testCases?: { last?: { item: string; result: string }; mark?: string }[] }[] };
        }
      ).output;
      const [test] = rows[0]?.testCases ?? [];
      expect([test?.last?.item, test?.last?.result, test?.mark]).toEqual(["build-603", "failed", "failed"]);
    },
  },
  {
    name: "one page of the matrix of a selection with evidence (SR-126)",
    fixture: MATRIX_EVIDENCE,
    input: { selection: { where: { type: ["system-requirement"] } }, limit: 3, offset: 2 },
    expect: "output",
  },
  {
    name: "the matrix in a variant view names its variant (SR-126, ThomasBirkmaier/ReqSeq-archive#588)",
    fixture: STATUS,
    input: { selection: { view: "5e031a7d-2b4f-4c61-9d08-0c0000000001" } },
    expect: "output",
  },
  {
    name: "a key that is no relation kind",
    fixture: MATRIX,
    input: { selection: { package: "PKG-000001" }, kinds: ["nope"] },
    expect: "error",
  },
  {
    name: "an unknown saved filter",
    fixture: MATRIX,
    input: { selection: { filter: "no such filter" } },
    expect: "error",
  },
]);
