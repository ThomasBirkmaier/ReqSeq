// Cross-access scenarios of hint.list, in addition to the default one (cross-access.test.ts).
import type { CommandOutput } from "@reqseq/core";
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { coreOutput, HINTS, IN_CRITERIA, OBSOLETE_SOURCE, SINCE_BASELINE } from "../../fixtures.js";

/** SR-A (SR-0000b1, validity [VAR-0000c1]) replaces the core requirement SR-K (SR-0000a1), whose content changed (SR-045). */
const CORE_CHANGED: FixtureOptions = {
  fixture: "SR-045/core-changed",
  git: true,
  files: {
    "requirements/SR-0000000000a1.md": `---\nid: 45045045-0000-4000-8000-0000000000a1\ntype: system-requirement\nstatus: draft\ntitle: Response time at most 10 ms\nrequirement-type: functional\nacceptance-criteria:\n  - Given a request, when it is sent, then the answer comes within 12 ms.\n---\n\nThe station answers within 12 ms.\n`,
  },
};

/** An outdated verification record of SR-0000b1 (valid in VAR-0000c1) for that variant. */
const OUTDATED_RECORD =
  "---\nreqseq-record: 1\nkind: verification\nelement: 26a0b000-0000-4000-8000-0000000000b1\n" +
  "version: n1:0000000000000000\nmethod: test\nvariant: 26a0b000-0000-4000-8000-0000000000c1\n" +
  "item: build-41\nresult: passed\ndate: 2026-11-02T12:00:00Z\n---\n";

/** HINTS with that record, the outdated evidence of SR-0000b2 in the core, and a repository not on this machine. */
const COUNTED: FixtureOptions = {
  ...HINTS,
  files: {
    "reqseq-workspace.yaml":
      "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
      '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
      '  - { name: away, url: "git@git.example.com:ws/away.git", path: ../away }\n' +
      "metamodel: { repository: system, path: metamodel }\n" +
      "evidence:\n  - { repository: system, path: evidence }\n",
    "evidence/b1-coast.md": OUTDATED_RECORD,
    "evidence/b2.md": OUTDATED_RECORD.replace("0000b1", "0000b2").replace(
      "variant: 26a0b000-0000-4000-8000-0000000000c1\n",
      "",
    ),
  },
};

/** The output of core in `results`. */
const hintsOf = (results: Parameters<typeof coreOutput>[0]): CommandOutput<"hint.list"> =>
  coreOutput(results) as CommandOutput<"hint.list">;

scenariosOf("hint.list", [
  {
    tag: "[SR-026/AK-mdtk]",
    name: "counts per kind over every page, titles of element and target, the view of outdated evidence, incomplete",
    fixture: COUNTED,
    input: { limit: 1, offset: 6 },
    expect: "output",
    check: (results) => {
      const output = hintsOf(results);
      expect(output.incomplete).toBe(true);
      expect(output.hints).toHaveLength(1);
      expect(output.kinds.reduce((sum, kind) => sum + kind.count, 0)).toBe(output.total);
      expect(output.kinds).toContainEqual({ code: "evidence.outdated", count: 2 });
      expect(output.hints[0]).toMatchObject({
        code: "evidence.outdated",
        elementTitle: "Show wind speed",
        view: "26a0b000-0000-4000-8000-0000000000c1",
      });
    },
  },
  {
    tag: "[SR-026/AK-mdtk]",
    name: "no matching hint counts 0, also for the kind the filter names",
    fixture: HINTS,
    input: { kind: ["variant.nested"] },
    expect: "output",
    check: (results) => {
      expect(hintsOf(results)).toMatchObject({ kinds: [{ code: "variant.nested", count: 0 }], total: 0 });
    },
  },
  {
    name: "the outdated reference in an acceptance criterion, with its hint ID and line (SR-127 AK3)",
    fixture: IN_CRITERIA,
    input: { kind: ["relation.outdated"] },
    expect: "output",
  },
  {
    tag: "[SR-025/AK-n45t]",
    name: "no outdated reference of an obsolete source",
    fixture: OBSOLETE_SOURCE,
    input: { kind: ["relation.outdated"] },
    expect: "output",
    check: (results) => {
      const output = (results["core"]?.outcome as { output: { hints: { elementShortId: string }[] } }).output;
      const sources = output.hints.map((h) => h.elementShortId);
      expect(sources).toContain("SR-0000b1");
      expect(sources).not.toContain("SR-0000b8");
    },
  },
  {
    name: "every open hint with kind, element, target and reason, dates from Git (SR-026 AK1)",
    fixture: HINTS,
    input: {},
    expect: "output",
  },
  {
    name: "filtered by kind, type, package and variant (SR-026 AK2)",
    fixture: HINTS,
    input: {
      kind: ["element.unknown-property"],
      type: ["system-requirement"],
      package: "PKG-0000d1",
      variant: "VAR-0000c2",
    },
    expect: "output",
  },
  {
    name: "hints of one element (SR-026 AK3)",
    fixture: HINTS,
    input: { ref: "SR-0000b1" },
    expect: "output",
  },
  {
    name: "one page of hints, total counts all (#146)",
    fixture: HINTS,
    input: { offset: 5, limit: 2 },
    expect: "output",
  },
  {
    name: "hints of one element in the order of the check, by the single-element path (#145)",
    fixture: HINTS,
    input: { ref: "SAF-0000b4" },
    expect: "output",
    check: (results) => {
      const output = (results["core"]?.outcome as { output: { hints: { code: string }[] } }).output;
      expect(output.hints.map((h) => h.code)).toEqual(["element.unknown-property", "trace.no-parent"]);
    },
  },
  { name: "no package", fixture: HINTS, input: { package: "VAR-0000c1" }, expect: "error" },
  {
    tag: "[SR-045/AK-yryh]",
    name: "a changed core requirement is one hint at its replacement, listed for the variant",
    fixture: CORE_CHANGED,
    input: { variant: "VAR-0000c1", kind: ["variant.core-changed", "relation.outdated"] },
    expect: "output",
    check: (results) => {
      const output = (
        results["core"]?.outcome as { output: { hints: { code: string; elementShortId: string }[] } }
      ).output;
      expect(output.hints.map((h) => [h.code, h.elementShortId])).toEqual([
        ["variant.core-changed", "SR-0000b1"],
        ["relation.outdated", "SR-0000b2"],
      ]);
    },
  },
  {
    tag: "[SR-103/AK-grj7]",
    name: "a core requirement changed since the variant's newest baseline is a hint at the variant",
    fixture: SINCE_BASELINE,
    input: { variant: "VAR-0000c1" },
    expect: "output",
    check: (results) => {
      const output = (
        results["core"]?.outcome as { output: { hints: { code: string; elementShortId: string }[] } }
      ).output;
      // The fixture's requirements have no parent (SR-022 AK6), which this scenario does not test.
      const hints = output.hints.filter((h) => h.code !== "trace.no-parent");
      expect(hints.map((h) => [h.code, h.elementShortId])).toEqual([
        ["variant.core-changed-since-baseline", "VAR-0000c1"],
      ]);
    },
  },
]);
