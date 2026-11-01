import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GeneratedEvidence, GeneratedWorkspace, VersionSubject } from "./index.js";
import {
  EVIDENCE_FOLDER,
  generateLargeWorkspace,
  pytestJunit,
  shortIdOf,
  withEvidenceRecords,
} from "./index.js";

/** Stands in for core's version (the testkit cannot import core); core's perf tests use the real one. */
const fakeVersion = (subject: VersionSubject): string =>
  `n1:${createHash("sha256").update(JSON.stringify(subject)).digest("hex").slice(0, 16)}`;

const small = (seed = 7): GeneratedWorkspace =>
  generateLargeWorkspace({ version: fakeVersion, seed, elements: 2000, relations: 6000 });

const evidenceFiles = (evidence: GeneratedEvidence, folder: string): [string, string][] =>
  [...evidence.workspace.files].filter(([file]) => file.startsWith(`system/${EVIDENCE_FOLDER}/${folder}`));

/** The frontmatter of a Markdown record as key and value. */
const frontmatter = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split("\n")
      .slice(1, -2)
      .map((line) => [line.slice(0, line.indexOf(": ")), line.slice(line.indexOf(": ") + 2)]),
  );

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

describe("withEvidenceRecords", () => {
  it("gives the same files for the same seed, and leaves every element file as it was", () => {
    const generated = small();
    const a = withEvidenceRecords(generated);
    const b = withEvidenceRecords(generated, { seed: generated.seed });
    expect(b.workspace.digest).toBe(a.workspace.digest);
    expect(withEvidenceRecords(generated, { seed: 8 }).workspace.digest).not.toBe(a.workspace.digest);
    expect(a.workspace.digest).not.toBe(generated.digest);
    for (const [file, content] of generated.files) {
      if (file !== "system/reqseq-workspace.yaml") {
        expect(a.workspace.files.get(file)).toBe(content);
      }
    }
    expect(a.workspace.files.get("system/reqseq-workspace.yaml")).toBe(
      `${String(generated.files.get("system/reqseq-workspace.yaml"))}evidence:\n  - { repository: system, path: evidence }\n`,
    );
    expect([...a.workspace.files.keys()]).toEqual([...a.workspace.files.keys()].sort());
  });

  it("gives the top 2 % of the system requirements no record, most others JUnit or Markdown records", () => {
    const generated = small();
    const evidence = withEvidenceRecords(generated);
    const requirements = generated.elements.filter((e) => e.type === "system-requirement");
    expect(evidence.parents).toEqual(
      requirements.slice(0, Math.floor(requirements.length * 0.02)).map((e) => e.id),
    );
    const recorded = new Set([...evidence.automated, ...evidence.manual]);
    expect(evidence.parents.some((id) => recorded.has(id))).toBe(false);
    expect(evidence.automated.length / requirements.length).toBeGreaterThan(0.6);
    expect(evidence.manual.length / requirements.length).toBeGreaterThan(0.05);
    expect(evidence.counts.testCases).toBe(evidence.automated.length);
  });

  it("writes enriched JUnit files of three CI runs whose counts match the test cases", () => {
    const evidence = withEvidenceRecords(small(), { testCasesPerFile: 100 });
    const junit = evidenceFiles(evidence, "ci/");
    expect(junit.length).toBe(evidence.counts.junitFiles);
    expect(new Set(junit.map(([file]) => file.split("/")[3]))).toEqual(new Set(["run-1", "run-2", "run-3"]));
    const all = junit.map(([, text]) => text).join("");
    expect(Buffer.byteLength(all)).toBe(evidence.counts.junitBytes);
    const executions = count(all, /<testcase /g);
    const skipped = count(all, /<skipped\/>/g);
    expect(skipped).toBe(evidence.counts.skipped);
    expect(skipped / executions).toBeGreaterThan(0.02);
    expect(count(all, /<failure /g) / executions).toBeGreaterThan(0.02);
    // One record per element a test case names, per execution that is not skipped.
    const named = [...all.matchAll(/<testcase [^]*?<\/testcase>/g)].map((m) => m[0]);
    const records = named
      .filter((t) => !t.includes("<skipped/>"))
      .reduce((sum, t) => sum + count(t, /reqseq:element/g), 0);
    expect(records).toBe(evidence.counts.junitRecords);
    expect(named.every((t) => count(t, /reqseq:element/g) === count(t, /reqseq:version/g))).toBe(true);
    const multi = named.filter((t) => count(t, /reqseq:element/g) > 1);
    expect(multi.length / executions).toBeGreaterThan(0.05);
    expect(Math.max(...named.map((t) => count(t, /reqseq:element/g)))).toBeLessThanOrEqual(5);
    // The newest run holds every test case; older runs fewer.
    const run3 = count(
      junit
        .filter(([f]) => f.includes("/run-3/"))
        .map(([, t]) => t)
        .join(""),
      /<testcase /g,
    );
    expect(run3).toBe(evidence.counts.testCases);
    expect(executions).toBeGreaterThan(evidence.counts.testCases);
    expect(executions).toBeLessThanOrEqual(3 * evidence.counts.testCases);
    expect(all).toContain('<property name="reqseq:item" value="build-3"/>');
  });

  it("writes one large file per history run with every test case, older than the CI runs", () => {
    const evidence = withEvidenceRecords(small(), { runs: 1, history: 2 });
    const history = evidenceFiles(evidence, "archive/");
    expect(history.map(([file]) => file)).toEqual([
      "system/evidence/archive/run-01.xml",
      "system/evidence/archive/run-02.xml",
    ]);
    for (const [n, [, text]] of history.entries()) {
      expect(count(text, /<testcase /g)).toBe(evidence.counts.testCases);
      expect(text).toContain('timestamp="2026-08-');
      expect(text).toContain(`<property name="reqseq:item" value="history-${String(n + 1)}"/>`);
    }
    expect(evidence.counts.junitFiles).toBe(evidenceFiles(evidence, "ci/").length + 2);
  });

  it("writes no JUnit file for a part of the suite that did not run in an older CI run", () => {
    const evidence = withEvidenceRecords(small(), { testCasesPerFile: 1 });
    const executions = count(
      evidenceFiles(evidence, "ci/")
        .map(([, text]) => text)
        .join(""),
      /<testcase /g,
    );
    expect(evidence.counts.junitFiles).toBe(executions);
    expect(evidence.counts.junitFiles).toBeLessThan(3 * evidence.counts.testCases);
  });

  it("writes Markdown verification and validation records in the format of evidence.record", () => {
    const generated = small();
    const evidence = withEvidenceRecords(generated);
    const byId = new Map(generated.elements.map((e) => [e.id, e]));
    const manual = evidenceFiles(evidence, "manual/");
    expect(manual).toHaveLength(evidence.counts.markdownVerification);
    expect(manual.map(([, t]) => String(frontmatter(t)["element"])).sort()).toEqual(
      [...evidence.manual].sort(),
    );
    const [file, text] = manual[0] ?? ["", ""];
    const fields = frontmatter(text);
    const element = byId.get(String(fields["element"]));
    expect(Object.keys(fields)).toEqual([
      "reqseq-record",
      "kind",
      "element",
      "version",
      "method",
      "item",
      "result",
      "date",
    ]);
    expect(fields["kind"]).toBe("verification");
    expect(element?.type).toBe("system-requirement");
    expect(file).toContain(
      `-${element === undefined ? "" : shortIdOf(element)}-${String(fields["method"])}.md`,
    );
    const validation = evidenceFiles(evidence, "validation/");
    expect(validation).toHaveLength(evidence.counts.markdownValidation);
    expect(validation.length).toBeGreaterThan(evidence.validated.length);
    const validated = validation.map(([, t]) => frontmatter(t));
    expect(new Set(validated.map((f) => f["kind"]))).toEqual(new Set(["validation"]));
    expect(new Set(validated.map((f) => f["result"]))).toEqual(new Set(["passed", "failed"]));
    // Some records are of the current version, some of an older one.
    const current = validated.filter((f) => byId.get(String(f["element"]))?.version === f["version"]);
    expect(current.length).toBeGreaterThan(0);
    expect(current.length).toBeLessThan(validated.length);
    expect(new Set(evidence.validated.map((id) => byId.get(id)?.type))).toEqual(
      new Set(["need", "system-requirement"]),
    );
    expect(validated.every((f) => /^n1:[0-9a-f]{16}$/.test(String(f["version"])))).toBe(true);
    expect(validated.every((f) => /^\d{4}-\d\d-\d\dT\d\d:00:00Z$/.test(String(f["date"])))).toBe(true);
  });

  it("gives an element one older version up to the run after which it changed, the current one later", () => {
    const generated = small();
    const evidence = withEvidenceRecords(generated, { runs: 3, history: 2 });
    const current = new Map(generated.elements.map((e) => [e.id, e.version]));
    // The executions of each element in time order (archive, then the CI runs): stored versions.
    const runsInOrder = [...evidence.workspace.files]
      .filter(([file]) => /\/(archive|ci)\//.test(file))
      .sort(([a], [b]) => Number(a.includes("/ci/")) - Number(b.includes("/ci/")) || (a < b ? -1 : 1));
    const stored = new Map<string, string[]>();
    for (const [, text] of runsInOrder) {
      for (const [testCase] of text.matchAll(/<testcase [^]*?<\/testcase>/g)) {
        const ids = [...testCase.matchAll(/reqseq:element" value="([^"]+)"/g)].map((m) => m[1] ?? "");
        const versions = [...testCase.matchAll(/reqseq:version" value="([^"]+)"/g)].map((m) => m[1] ?? "");
        ids.forEach((id, n) => stored.set(id, [...(stored.get(id) ?? []), versions[n] ?? ""]));
      }
    }
    let changed = 0;
    for (const [id, versions] of stored) {
      const older = versions.filter((v) => v !== current.get(id));
      // Older versions come first and are all the same one.
      expect(versions.slice(0, older.length)).toEqual(older);
      expect(new Set(older).size).toBeLessThanOrEqual(1);
      changed += Number(older.length > 0);
    }
    expect(changed / stored.size).toBeGreaterThan(0.05);
    expect(changed / stored.size).toBeLessThan(0.3);
    const variants = new Set(generated.elements.filter((e) => e.type === "variant").map((e) => e.id));
    const named = [
      ...runsInOrder
        .map(([, t]) => t)
        .join("")
        .matchAll(/reqseq:variant" value="([^"]+)"/g),
    ];
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((m) => variants.has(m[1] ?? ""))).toBe(true);
  });

  it("keeps at most 1,000 record files per folder, and the same files on every machine", () => {
    const evidence = withEvidenceRecords(small(36));
    const folders = new Map<string, number>();
    for (const file of evidence.workspace.files.keys()) {
      const folder = path.posix.dirname(file);
      folders.set(folder, (folders.get(folder) ?? 0) + 1);
    }
    expect(Math.max(...folders.values())).toBeLessThanOrEqual(1000);
    // Pinned: a change of the generator shifts every perf baseline, so it shows here.
    expect(evidence.workspace.digest).toBe(
      "68955cb2177ed6de4b13fd8bc6cd09aad64b41aa4e78cb90553ce06f74edbfce",
    );
  });

  it("refuses runs or a file size that are no whole number from 1", () => {
    const generated = small();
    expect(() => withEvidenceRecords(generated, { runs: 0 })).toThrow("whole numbers from 1");
    expect(() => withEvidenceRecords(generated, { testCasesPerFile: 1.5 })).toThrow("whole numbers from 1");
  });
});

describe("pytestJunit", () => {
  it("writes a one-line pytest file of at least the given size, naming requirements by short ID", () => {
    const generated = small();
    const { content, testCases } = pytestJunit(generated, 50_000);
    expect(content.length).toBeGreaterThanOrEqual(50_000);
    expect(content.split("\n")).toHaveLength(2);
    expect(count(content, /<testcase /g)).toBe(testCases);
    expect(content).not.toContain("reqseq:");
    const refs = [...content.matchAll(/\[(SR-[0-9a-f]{6})\]/g)].map((m) => m[1]);
    expect(refs).toHaveLength(testCases);
    const tails = generated.elements.map((e) => e.id.slice(-6));
    expect(refs.every((ref) => tails.filter((t) => t === ref?.slice(3)).length === 1)).toBe(true);
  });

  it("refuses a workspace without a system requirement whose short ID is unique", () => {
    const generated = small();
    const [first] = generated.elements.filter((e) => e.type === "system-requirement");
    if (first === undefined) {
      throw new Error("no system requirement");
    }
    // Two copies of one requirement share its short ID.
    const twins = { ...generated, elements: [first, first] };
    expect(() => pytestJunit(twins, 1000)).toThrow("no system requirement with a unique short ID");
  });
});
