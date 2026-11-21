// Cross-access scenarios of baseline.changes (SR-241), in addition to the default one (cross-access.test.ts),
// on fixtures/SR-061/export: „Release 1“ without stored selection, the faulty `broken.yaml`, two open hints.
import fs from "node:fs/promises";
import path from "node:path";
import type { BaselineChangesOutput } from "@reqseq/core";
import { expect } from "vitest";
import type { Result } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";
import { EXPORT } from "../../fixtures.js";

const ID = "61061061-0000-4000-8000-0000000000";

/** The core output of a scenario. */
const coreOutput = (results: Readonly<Record<string, Result>>): BaselineChangesOutput =>
  (results["core"]?.outcome as { output: BaselineChangesOutput }).output;

/** A baseline of SR-0000b1 over the package Display, at a commit of `system` that is not there. */
const baseline = (name: string, date: string): string =>
  `reqseq-baseline: 1\nname: ${name}\ndate: ${date}\nselection:\n  ids: [${ID}b1]\n` +
  `repositories:\n  - { name: system, commit: 61aa061aa061aa061aa061aa061aa061aa061aa0 }\n` +
  `elements:\n  - { id: ${ID}b1, version: n1:697a2ad17ed49170 }\n`;

const TWO = {
  ...EXPORT,
  files: {
    "system/baselines/r1.yaml": baseline("R1", "2026-11-02T10:00:00Z"),
    "system/baselines/r2.yaml": baseline("R2", "2026-11-09T10:00:00Z"),
  },
};

scenariosOf("baseline.changes", [
  {
    name: "the newest baseline by date and time with the numbers of baseline.get (SR-241 AK1)",
    fixture: TWO,
    root: "system",
    input: {},
    tag: "[SR-241/AK-p7s5]",
    expect: "output",
    check: (results) => {
      expect(coreOutput(results).baseline?.name).toBe("R2");
    },
  },
  {
    name: "the open hints and their number per kind as hint.list (SR-241 AK2)",
    fixture: EXPORT,
    root: "system",
    input: { limit: 1 },
    tag: "[SR-241/AK-rnfc]",
    expect: "output",
    check: (results) => {
      expect(coreOutput(results).hintKinds.map((k) => k.code)).toEqual([
        "element.unknown-property",
        "relation.outdated",
      ]);
    },
  },
  {
    name: "Confirm hints, Show Git command to compare baseline and Prepare baseline as the next steps (SR-241 AK3)",
    fixture: EXPORT,
    root: "system",
    input: {},
    tag: "[SR-241/AK-z038]",
    expect: "output",
    check: (results) => {
      expect(coreOutput(results).next.map((s) => s.command)).toEqual([
        "hint.confirm",
        "baseline.compare",
        "baseline.prepare",
      ]);
    },
  },
  {
    name: "a workspace without a baseline (SR-241 AK4)",
    fixture: EXPORT,
    root: "system",
    input: {},
    tag: "[SR-241/AK-xjjt]",
    expect: "output",
    prepare: async (copy) => {
      await fs.rm(path.join(copy.root, "baselines"), { recursive: true, force: true });
    },
    check: (results) => {
      expect(coreOutput(results).answer).toBe("The workspace has no baseline; 2 open hints.");
    },
  },
  {
    name: "nothing changed since the baseline (SR-241 AK5)",
    fixture: TWO,
    root: "system",
    input: { baseline: "R1" },
    tag: "[SR-241/AK-r3xg]",
    expect: "output",
    check: (results) => {
      expect(coreOutput(results).answer).toMatch(/^Nothing changed since baseline R1 of 2026-11-02;/);
    },
  },
  {
    name: "incomplete without a repository, and no added or removed without a stored selection (SR-241 AK6)",
    fixture: EXPORT,
    root: "system",
    input: {},
    tag: "[SR-241/AK-h6wy]",
    expect: "output",
    prepare: async (copy) => {
      await fs.rm(path.join(copy.top, "sensor"), { recursive: true, force: true });
    },
    check: (results) => {
      const out = coreOutput(results);
      expect([out.incomplete, out.baseline?.selectionKnown, out.baseline?.counts.added]).toEqual([
        true,
        false,
        undefined,
      ]);
    },
  },
  {
    name: "an unknown baseline is refused as baseline.get refuses it (SR-241 AK7)",
    fixture: EXPORT,
    root: "system",
    input: { baseline: "nope" },
    tag: "[SR-241/AK-jfjs]",
    expect: "error",
  },
  {
    name: "the newest readable baseline, and the faulty file as baseline.list names it (SR-241 AK7)",
    fixture: {
      ...TWO,
      files: {
        ...TWO.files,
        "system/baselines/r9.yaml":
          "reqseq-baseline: 1\nname: R9\ndate: 2026-11-19T10:00:00Z\nrepositories: []\nelements: none\n",
      },
    },
    root: "system",
    input: {},
    tag: "[SR-241/AK-jfjs]",
    expect: "output",
    check: (results) => {
      const out = coreOutput(results);
      expect([out.baseline?.name, out.problems?.some((p) => p.file === "baselines/r9.yaml")]).toEqual([
        "R2",
        true,
      ]);
    },
  },
]);
