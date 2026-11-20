// Cross-access scenarios of baseline.prepare (SR-242), in addition to the default one (cross-access.test.ts),
// on fixtures/SR-061/export: two warnings, „Release 1“ without stored selection, the variant Coast (c1).
import fs from "node:fs/promises";
import path from "node:path";
import type { BaselinePrepareOutput } from "@reqseq/core";
import { expect } from "vitest";
import type { Result } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";
import { EXPORT } from "../../fixtures.js";

const ID = "61061061-0000-4000-8000-0000000000";

/** The core output of a scenario. */
const coreOutput = (results: Readonly<Record<string, Result>>): BaselinePrepareOutput =>
  (results["core"]?.outcome as { output: BaselinePrepareOutput }).output;

scenariosOf("baseline.prepare", [
  {
    name: "the errors and warnings of the check and the degree in the answer, the problems of the whole workspace (SR-242 AK1)",
    fixture: EXPORT,
    root: "system",
    input: { selection: { ids: [`${ID}b1`] } },
    tag: "[SR-242/AK-cq4q]",
    expect: "output",
    check: (results) => {
      const out = coreOutput(results);
      expect([out.answer.startsWith("The check found 0 errors and 2 warnings;"), out.wholeWorkspace]).toEqual(
        [true, true],
      );
    },
  },
  {
    name: "the numbers of evidence.degree and evidence.withoutPassedTest for the selection's view (SR-242 AK2)",
    fixture: EXPORT,
    root: "system",
    input: { selection: { view: `${ID}c1` } },
    tag: "[SR-242/AK-fncy]",
    expect: "output",
    check: (results) => {
      expect(coreOutput(results).view).toBe(`${ID}c1`);
    },
  },
  {
    name: "the newest baseline with its problems apart from the check's (SR-242 AK3)",
    fixture: EXPORT,
    root: "system",
    input: {},
    tag: "[SR-242/AK-hss7]",
    expect: "output",
    check: (results) => {
      const out = coreOutput(results);
      expect([out.baseline?.name, out.baseline?.problems?.[0]?.code]).toEqual([
        "Release 1",
        "baseline.repository-commit-differs",
      ]);
    },
  },
  {
    name: "Create baseline with the selection and Show changes since baseline as next steps (SR-242 AK4)",
    fixture: EXPORT,
    root: "system",
    input: { selection: { filter: "Functional" } },
    tag: "[SR-242/AK-rqjf]",
    expect: "output",
    check: (results) => {
      expect(coreOutput(results).next).toEqual([
        { command: "baseline.create", input: { selection: { filter: "Functional" } }, open: ["name"] },
        { command: "baseline.changes", input: {}, open: [] },
      ]);
    },
  },
  {
    name: "no Create baseline while the workspace is read-only (SR-226 AK6, SR-242 AK4)",
    fixture: {
      ...EXPORT,
      files: {
        "system/metamodel/broken.yaml": "reqseq-metamodel: 1\nstatuses:\n  - key: draft\n    name: [Draft\n",
      },
    },
    root: "system",
    input: {},
    tag: "[SR-226/AK-t0mt]",
    expect: "output",
    check: (results) => {
      expect(coreOutput(results).next.map((s) => s.command)).toEqual(["baseline.changes"]);
    },
  },
  {
    name: "incomplete when a repository is not here (SR-242 AK5)",
    fixture: EXPORT,
    root: "system",
    input: {},
    tag: "[SR-242/AK-tsww]",
    expect: "output",
    prepare: async (copy) => {
      await fs.rm(path.join(copy.top, "sensor"), { recursive: true, force: true });
    },
    check: (results) => {
      expect(coreOutput(results).incomplete).toBe(true);
    },
  },
]);
