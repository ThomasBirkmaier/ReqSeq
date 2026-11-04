// Cross-access scenarios of workspace.check, in addition to the default one (cross-access.test.ts).
import fs from "node:fs/promises";
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import { scenariosOf, templateSetup } from "../../scenario.js";
import { EVIDENCE, IDENTIFIERS, MISSING_TARGETS, ORPHANED_CHAIN } from "../../fixtures.js";

/** One finding of each kind (SR-019), then a second commit that changes one requirement (SR-092). */
const SECOND_COMMIT: FixtureOptions = { fixture: "SR-019/findings", git: true };
templateSetup(SECOND_COMMIT, async (ws) => {
  const file = ws.path("requirements/SR-b00000000004.md");
  await fs.appendFile(file, "Changed in a second commit.\n");
  await ws.commit();
});

scenariosOf("workspace.check", [
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
    name: "a workspace with an evidence location (#535)",
    fixture: EVIDENCE,
    input: {},
    expect: "output",
  },
  {
    name: "duplicate identifiers within a type, with the identifier of each element (#305)",
    fixture: {
      ...IDENTIFIERS,
      files: {
        "requirements/SR-0000000b0038.md":
          "---\nid: 30500000-0000-4000-8000-0000000b0038\ntype: system-requirement\nstatus: draft\ntitle: Twin\nspec-id: SR-036\n---\n",
      },
    },
    input: {},
    expect: "output",
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
    name: "warnings fail with failOn warning, errors only shown (#304)",
    fixture: { fixture: "SR-085/value-kinds" },
    root: "system",
    input: { severity: "error", failOn: "warning" },
    expect: "output",
  },
  {
    name: "warnings alone are ok by default (#304)",
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
    name: "info fails with failOn info (#304)",
    fixture: MISSING_TARGETS,
    root: "system",
    input: { failOn: "info", severity: "warning" },
    expect: "output",
  },
  { name: "unknown failOn (#304)", input: { failOn: "hint" }, expect: "error" },
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
