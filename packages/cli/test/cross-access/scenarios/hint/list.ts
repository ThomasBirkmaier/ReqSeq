// Cross-access scenarios of hint.list, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { HINTS, IN_CRITERIA, SINCE_BASELINE } from "../../fixtures.js";

/** SR-A (SR-0000b1, validity [VAR-0000c1]) replaces the core requirement SR-K (SR-0000a1), whose content changed (SR-045). */
const CORE_CHANGED: FixtureOptions = {
  fixture: "SR-045/core-changed",
  git: true,
  files: {
    "requirements/SR-0000000000a1.md": `---\nid: 45045045-0000-4000-8000-0000000000a1\ntype: system-requirement\nstatus: draft\ntitle: Response time at most 10 ms\nrequirement-type: functional\nacceptance-criteria:\n  - Given a request, when it is sent, then the answer comes within 12 ms.\n---\n\nThe station answers within 12 ms.\n`,
  },
};

scenariosOf("hint.list", [
  {
    name: "the outdated reference in an acceptance criterion, with its hint ID and line (SR-127 AK3)",
    fixture: IN_CRITERIA,
    input: { kind: ["relation.outdated"] },
    expect: "output",
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
    tag: "[SR-045/AK1]",
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
    tag: "[SR-103/AK1]",
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
