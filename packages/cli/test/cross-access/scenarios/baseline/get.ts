// Cross-access scenarios of baseline.get, in addition to the default one (cross-access.test.ts).
import type { BaselineGetOutput } from "@reqseq/core";
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import type { Result } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";
import { EXPORT } from "../../fixtures.js";

/** SR-094: the core output of a baseline.get scenario, its entries by the last two characters of their UUID. */
const baselineEntries = (
  results: Readonly<Record<string, Result>>,
): Readonly<Record<string, BaselineGetOutput["elements"][number]>> =>
  Object.fromEntries(
    (results["core"]?.outcome as { output: BaselineGetOutput }).output.elements.map((e) => [
      e.id.slice(-2),
      e,
    ]),
  );
/** SR-094: the rows of an entry as `view status`, the view by the last two characters of a variant's UUID. */
const baselineRows = (entry: BaselineGetOutput["elements"][number] | undefined): string[] | undefined =>
  entry?.verification?.map((r) => `${r.view === "core" ? "core" : r.view.slice(-2)} ${r.status}`);
const SR094: FixtureOptions = { fixture: "SR-094/baseline", git: true };

scenariosOf("baseline.get", [
  {
    name: "a baseline with the version and its date of each element (SR-051 AK1)",
    fixture: EXPORT,
    root: "system",
    input: { baseline: "release-1" },
    tag: "[SR-051/AK1]",
    expect: "output",
  },
  {
    name: "a warning for a repository at another commit than the baseline names (#668)",
    fixture: EXPORT,
    root: "system",
    input: { baseline: "release-1", withEvidence: true, limit: 1 },
    expect: "output",
    check: (results) => {
      const { problems } = (results["core"]?.outcome as { output: BaselineGetOutput }).output;
      expect([problems?.[0]?.code, problems?.[0]?.repository]).toEqual([
        "baseline.repository-commit-differs",
        "system",
      ]);
      expect(problems?.[0]?.message).toContain("the baseline names 61aa061");
    },
  },
  {
    name: "the evidence status of each requirement at its baseline version (SR-094 AK1)",
    fixture: SR094,
    input: { baseline: "Release 1", withEvidence: true },
    tag: "[SR-094/AK1]",
    expect: "output",
    check: (results) => {
      const e = baselineEntries(results);
      expect(Object.keys(e)).toEqual(["a1", "a2", "b1", "b2", "b3", "b5", "b6", "b7"]);
      expect(baselineRows(e["b1"])).toEqual(["core verified", "c1 verified", "c2 open"]);
    },
  },
  {
    name: "records dated after the baseline do not count and are named (SR-094 AK2)",
    fixture: SR094,
    input: { baseline: "Release 1", withEvidence: true, offset: 2, limit: 2 },
    tag: "[SR-094/AK2]",
    expect: "output",
    check: (results) => {
      const e = baselineEntries(results);
      expect(e["b1"]?.verification?.map((r) => [r.status, r.later?.map((l) => l.date)])).toEqual([
        ["verified", ["2026-11-02T15:00:00Z"]],
        ["verified", ["2026-11-02T16:00:00Z"]],
        ["open", undefined],
      ]);
      expect(e["b2"]?.verification?.[0]?.later?.map((l) => l.date)).toEqual(["2026-11-03T09:00:00Z"]);
    },
  },
  {
    name: "outdated with records of older versions only, else open (SR-094 AK3)",
    fixture: SR094,
    input: { baseline: "Release 1", withEvidence: true, offset: 3, limit: 2 },
    tag: "[SR-094/AK3]",
    expect: "output",
    check: (results) => {
      const e = baselineEntries(results);
      expect(baselineRows(e["b2"])?.[0]).toBe("core outdated");
      expect(baselineRows(e["b3"])?.[0]).toBe("core open");
    },
  },
  {
    name: "without a variant in the selection a row for the core and every variant it applies in (SR-094 AK4)",
    fixture: SR094,
    input: { baseline: "Release 1", withEvidence: true, offset: 3 },
    tag: "[SR-094/AK4]",
    expect: "output",
    check: (results) => {
      const e = baselineEntries(results);
      expect(baselineRows(e["b2"])).toEqual(["core outdated", "c1 open"]);
      expect(baselineRows(e["b3"])).toEqual(["core open", "c1 open"]);
      expect(baselineRows(e["b7"])).toEqual(["c2 verified"]);
    },
  },
  {
    name: "with a variant in the selection only that variant's row (SR-094 AK5)",
    fixture: SR094,
    input: { baseline: "Alpine 1", withEvidence: true },
    tag: "[SR-094/AK5]",
    expect: "output",
    check: (results) => {
      const e = baselineEntries(results);
      expect([baselineRows(e["b1"]), baselineRows(e["b4"])]).toEqual([["c1 verified"], ["c1 verified"]]);
    },
  },
  {
    name: "no indirect verification in a baseline (SR-094 AK6)",
    fixture: SR094,
    input: { baseline: "Release 1", withEvidence: true, offset: 5, limit: 2 },
    tag: "[SR-094/AK6]",
    expect: "output",
    check: (results) => {
      const e = baselineEntries(results);
      expect([baselineRows(e["b5"])?.[0], baselineRows(e["b6"])?.[0]]).toEqual([
        "core open",
        "core verified",
      ]);
    },
  },
  {
    name: "the validation status at the baseline version, without view (SR-094 AK7)",
    fixture: SR094,
    input: { baseline: "Release 1", withEvidence: true, limit: 3 },
    tag: "[SR-094/AK7]",
    expect: "output",
    check: (results) => {
      const e = baselineEntries(results);
      expect([e["a1"]?.validation, e["a1"]?.validationLater?.map((l) => l.date)]).toEqual([
        "validated",
        ["2026-11-02T15:00:00Z"],
      ]);
      expect([e["a2"]?.validation, e["b1"]?.validation]).toEqual(["open", undefined]);
    },
  },
]);
