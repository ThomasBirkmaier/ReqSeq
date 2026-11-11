// Cross-access scenarios of workspace.check, in addition to the default one (cross-access.test.ts).
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FixtureOptions } from "@reqseq/testkit";
import { defaultFixturesDir } from "@reqseq/testkit";
import { expect } from "vitest";
import type { Result } from "../../scenario.js";
import { scenariosOf, templateSetup } from "../../scenario.js";
import {
  EVIDENCE,
  IDENTIFIERS,
  MISSING_TARGETS,
  ORPHANED_CHAIN,
  VARIANT_EVIDENCE,
  replaceOnce,
} from "../../fixtures.js";

/** One finding of each kind (SR-019), then a second commit that changes one requirement (SR-092). */
const SECOND_COMMIT: FixtureOptions = { fixture: "SR-019/findings", git: true };
templateSetup(SECOND_COMMIT, async (ws) => {
  const file = ws.path("requirements/SR-b00000000004.md");
  await fs.appendFile(file, "Changed in a second commit.\n");
  await ws.commit();
});

/** Statuses per type (#306): a status outside the type, one on a type without statuses, a missing one. */
const STATUSES: FixtureOptions = { fixture: "enabler-306/statuses-per-type", git: true };
/** STATUSES with a glossary term type whose only status is invalid, and a term without status (SR-017 AK3). */
const RETIRABLE: FixtureOptions = {
  ...STATUSES,
  files: {
    "metamodel/model.yaml": replaceOnce(
      replaceOnce(
        readFileSync(
          path.join(defaultFixturesDir, "enabler-306/statuses-per-type/metamodel/model.yaml"),
          "utf8",
        ),
        "properties:\n  - key: title",
        "  - { key: glossary-term, name: Glossary Term, prefix: GT, properties: [title], statuses: [retired] }\n\nproperties:\n  - key: title",
      ),
      "  - { key: superseded, name: Superseded, invalid: true }\n",
      "  - { key: superseded, name: Superseded, invalid: true }\n  - { key: retired, name: Retired, invalid: true }\n",
    ),
    "elements/GT-000000fff001.md":
      "---\nid: 6f6f6f6f-6666-4666-8666-000000fff001\ntype: glossary-term\ntitle: Baseline\n---\n",
  },
};

/** The status findings of one access's output, as code, severity, short ID and file. */
const statusFindings = (result: Result | undefined): (string | undefined)[][] =>
  (
    result?.outcome as {
      output: { problems: { code: string; severity: string; elementShortId?: string; file?: string }[] };
    }
  ).output.problems
    .filter((p) =>
      ["element.status-not-allowed", "element.missing-status", "metamodel.optional-status"].includes(p.code),
    )
    .map((p) => [p.code, p.severity, p.elementShortId, p.file]);

scenariosOf("workspace.check", [
  {
    name: "a record for a variant that replaces its requirement counts in no view and is a finding (SR-047 AK5)",
    fixture: VARIANT_EVIDENCE,
    input: {},
    tag: "[SR-047/AK5]",
    expect: "output",
    check: (results) => {
      const output = (
        results["core"]?.outcome as {
          output: { problems: { code: string; file?: string; targetId?: string }[] };
        }
      ).output;
      expect(
        output.problems
          .filter((p) => p.code === "evidence.counts-in-no-view")
          .map((p) => [p.file, p.targetId]),
      ).toEqual([["evidence/k1-a.md", "43043043-0000-4000-8000-0000000000a1"]]);
    },
  },
  {
    name: "a validation record of a use case, neither need nor requirement, is a finding (SR-038 AK5)",
    fixture: { fixture: "SR-038/validation", git: true },
    input: {},
    tag: "[SR-038/AK5]",
    expect: "output",
    check: (results) => {
      const output = (
        results["core"]?.outcome as {
          output: { problems: { code: string; targetId?: string; message?: string }[] };
        }
      ).output;
      expect(
        output.problems
          .filter((p) => p.code === "evidence.kind-mismatch")
          .map((p) => [p.targetId, p.message?.startsWith("The validation record") === true]),
      ).toEqual([
        // N1: its verification record (#628); U1: its validation record (AK5).
        ["38383838-3838-4838-8838-00000000a001", false],
        ["38383838-3838-4838-8838-00000000e001", true],
      ]);
    },
  },
  {
    name: "a repository whose own metamodel counts another property to the version (#666)",
    fixture: { fixture: "SR-004/own-metamodel", git: ["system", "fuel"] },
    root: "system",
    input: {},
    expect: "output",
    check: (results) => {
      const output = (
        results["core"]?.outcome as { output: { problems: { code: string; severity: string }[] } }
      ).output;
      expect(
        output.problems.filter((p) => p.code === "workspace.metamodel-mismatch").map((p) => p.severity),
      ).toEqual(["warning"]);
    },
  },
  {
    name: "a requirement without a parent is a hint with its ID",
    fixture: ORPHANED_CHAIN,
    input: {},
    tag: "[SR-022/AK6]",
    expect: "output",
    check: (results) => {
      const output = (
        results["core"]?.outcome as {
          output: { problems: { code: string; severity: string; elementId?: string }[] };
        }
      ).output;
      expect(
        output.problems.filter((p) => p.code === "trace.no-parent").map((p) => [p.severity, p.elementId]),
      ).toEqual([["warning", "5c0e1d2a-0022-4022-8022-00000000b004"]]);
    },
  },
  {
    name: "relations above a maximum and below a minimum of the metamodel, with count and limit",
    fixture: { fixture: "SR-152/limits" },
    input: {},
    tag: "[SR-152/AK1]",
    expect: "output",
    check: (results) => {
      const { problems } = (results["core"]?.outcome as { output: { problems: Record<string, unknown>[] } })
        .output;
      // AK1 the maximum, AK2 the minimum (no line without the key), AK4 none for based-on.
      expect(
        problems
          .filter((p) => p["key"] !== undefined)
          .map((p) => [
            p["code"],
            p["elementShortId"],
            p["key"],
            p["targetType"],
            p["count"],
            p["limit"],
            p["line"],
          ]),
      ).toEqual([
        ["relation.too-many", "SR-c00001", "derives-from", "use-case", 2, 1, 6],
        ["relation.too-few", "SR-c00002", "derives-from", "need", 0, 1, undefined],
        ["relation.too-few", "SR-c00003", "derives-from", "need", 0, 1, 6],
      ]);
    },
  },
  {
    name: "a list property with more entries than its max-items, with count and limit",
    fixture: { fixture: "SR-171/max-items" },
    input: {},
    tag: "[SR-171/AK1]",
    expect: "output",
    check: (results) => {
      const { problems } = (results["core"]?.outcome as { output: { problems: Record<string, unknown>[] } })
        .output;
      // SR-c00002 holds the most allowed and seven keywords, which have no max-items (AK2).
      expect(
        problems
          .filter((p) => p["key"] !== undefined)
          .map((p) => [p["code"], p["elementShortId"], p["key"], p["count"], p["limit"], p["line"]]),
      ).toEqual([["element.too-many-items", "SR-c00001", "acceptance-criteria", 4, 3, 6]]);
    },
  },
  {
    name: "a workspace with an evidence location (ThomasBirkmaier/ReqSeq-archive#535)",
    fixture: EVIDENCE,
    input: {},
    expect: "output",
  },
  {
    name: "duplicate identifiers within a type, also in another case, a warning at each element naming the other file (ThomasBirkmaier/ReqSeq-archive#305)",
    tag: "[SR-088/AK4]",
    fixture: {
      ...IDENTIFIERS,
      files: {
        "requirements/SR-0000000b0038.md":
          "---\nid: 30500000-0000-4000-8000-0000000b0038\ntype: system-requirement\nstatus: draft\ntitle: Twin\nspec-id: sr-036\n---\n",
      },
    },
    input: {},
    expect: "output",
    check: (results) => {
      const output = (
        results["core"]?.outcome as {
          output: { problems: { code: string; severity: string; file?: string; message: string }[] };
        }
      ).output;
      expect(
        output.problems
          .filter((p) => p.code === "element.duplicate-identifier")
          .map((p) => [p.severity, p.file, /is also on System Requirement (\S+)/.exec(p.message)?.[1]]),
      ).toEqual([
        ["warning", "requirements/SR-0000000b0036.md", "requirements/SR-0000000b0038.md"],
        ["warning", "requirements/SR-0000000b0038.md", "requirements/SR-0000000b0036.md"],
      ]);
    },
  },
  {
    name: "a status the type does not have is a warning with element and status, the file stays",
    tag: "[SR-017/AK2]",
    fixture: STATUSES,
    input: {},
    expect: "output",
    check: (results) => {
      expect(
        statusFindings(results["core"]).filter(([code]) => code === "element.status-not-allowed"),
      ).toEqual([
        ["element.status-not-allowed", "warning", "D-ddd002", "elements/D-000000ddd002.md"],
        ["element.status-not-allowed", "warning", "SR-bbb002", "elements/SR-000000bbb002.md"],
        ["element.status-not-allowed", "warning", "T-eee002", "elements/T-000000eee002.md"],
      ]);
    },
  },
  {
    name: "an element without status is a warning, except of a type with only invalid statuses, which gets one info",
    tag: "[SR-017/AK3]",
    fixture: RETIRABLE,
    input: {},
    expect: "output",
    check: (results) => {
      expect(
        statusFindings(results["core"]).filter(([code]) => code !== "element.status-not-allowed"),
      ).toEqual([
        ["metamodel.optional-status", "info", undefined, "metamodel/model.yaml"],
        ["element.missing-status", "warning", "SR-bbb003", "elements/SR-000000bbb003.md"],
      ]);
    },
  },
  {
    name: "reqseq: links whose target is no UUID, with the element they name (#176)",
    fixture: {
      fixture: "SR-004/one-repository",
      git: true,
      files: {
        "requirements/SR-0000000b0176.md":
          "---\nid: 17600000-0000-4000-8000-0000000b0176\ntype: system-requirement\nstatus: draft\ntitle: Linking\n---\n\nSee [wind](reqseq:SR-e88fb3) and [gone](reqseq:SR-999999).\n",
      },
    },
    input: {},
    expect: "output",
  },
  {
    name: "a reqseq: reference outside a Markdown link and outside code, with file and line (#633)",
    tag: "[SR-021/AK3]",
    fixture: {
      fixture: "SR-004/one-repository",
      git: true,
      files: {
        "requirements/SR-0000000b0633.md":
          "---\nid: 63300000-0000-4000-8000-0000000b0633\ntype: system-requirement\nstatus: draft\ntitle: Confirms\n---\n\n- reqseq:SR-e88fb3\n- `reqseq:SR-e88fb3` and [wind](reqseq:SR-e88fb3)\n",
      },
    },
    input: {},
    expect: "output",
  },
  {
    name: "a reference-style reqseq: link, warned once per definition with file and line (#844)",
    fixture: {
      fixture: "SR-004/one-repository",
      git: true,
      files: {
        "requirements/SR-0000000b0844.md":
          "---\nid: 84400000-0000-4000-8000-0000000b0844\ntype: system-requirement\nstatus: draft\ntitle: Confirms\n---\n\nSee [wind][w] and [w].\n\n[w]: reqseq:SR-e88fb3\n\n`[c]: reqseq:SR-e88fb3`\n",
      },
    },
    input: {},
    expect: "output",
  },
  {
    name: "a requirement with a statement but no text, with file and line (#667)",
    fixture: {
      fixture: "SR-004/one-repository",
      git: true,
      files: {
        "requirements/SR-0000000a0667.md":
          "---\nid: 66700000-0000-4000-8000-0000000a0667\ntype: system-requirement\nstatus: draft\ntitle: Rounding\nstatement: The mass is rounded to 0.001 kg.\n---\n",
      },
    },
    input: {},
    expect: "output",
    check: (results) => {
      const { problems } = (results["core"]?.outcome as { output: { problems: Record<string, unknown>[] } })
        .output;
      expect(problems).toContainEqual(
        expect.objectContaining({
          code: "element.statement-without-text",
          file: "requirements/SR-0000000a0667.md",
          line: 6,
        }),
      );
    },
  },
  {
    name: "one finding of each kind",
    fixture: { fixture: "SR-019/findings", git: true },
    input: {},
    expect: "output",
  },
  {
    name: "errors only",
    fixture: { fixture: "SR-019/findings", git: true },
    input: { severity: "error" },
    expect: "output",
  },
  {
    name: "warnings fail with failOn warning, errors only shown (ThomasBirkmaier/ReqSeq-archive#304)",
    fixture: { fixture: "SR-085/value-kinds" },
    root: "system",
    input: { severity: "error", failOn: "warning" },
    expect: "output",
  },
  {
    name: "warnings alone are ok by default (ThomasBirkmaier/ReqSeq-archive#304)",
    fixture: { fixture: "SR-085/value-kinds" },
    root: "system",
    input: {},
    expect: "output",
  },
  {
    name: "info only, a repository missing",
    fixture: MISSING_TARGETS,
    root: "system",
    input: {},
    expect: "output",
  },
  {
    name: "info fails with failOn info (ThomasBirkmaier/ReqSeq-archive#304)",
    fixture: MISSING_TARGETS,
    root: "system",
    input: { failOn: "info", severity: "warning" },
    expect: "output",
  },
  { name: "unknown failOn (ThomasBirkmaier/ReqSeq-archive#304)", input: { failOn: "hint" }, expect: "error" },
  {
    name: "restricted to changed files (SR-092)",
    fixture: { fixture: "SR-019/findings", git: true },
    input: { changedFiles: ["requirements/SR-b00000000002.md", "needs/N-a00000000002.md"] },
    expect: "output",
  },
  {
    name: "restricted to changes since the commit before (SR-092)",
    fixture: SECOND_COMMIT,
    input: { changedSince: "HEAD~1" },
    expect: "output",
  },
  {
    name: "a commit that is not here (SR-092 AK2)",
    input: { changedSince: "0123456789abcdef0123456789abcdef01234567" },
    expect: "error",
  },
]);
