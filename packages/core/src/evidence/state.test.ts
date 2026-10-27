// The evidence states (ADR-0012 "Block and state"): the folders read through the readers by extension,
// and the records as an array, the seam tests and consumers inject records through (#127 option 1).
// Enabler tests of the evidence block (#535); the SR tests come with the readers (SR-028, SR-093).
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import { loadWorkspaceLayout } from "../workspace/index.js";
import { evidenceIndexState } from "./by-element.js";
import type { EvidenceFile } from "./folders.js";
import type { EvidenceRecord, SkippedTestCase } from "./record.js";
import type { EvidenceReader } from "./state.js";
import { EVIDENCE_READERS, evidenceReadState, evidenceRecordsState, readEvidence } from "./state.js";

const SR = "e8df96ea-a168-4d90-8d65-6328cee88fb3";

/** fixtures/enabler-535/evidence: one requirement, one Markdown record and one enriched JUnit file. */
const open = async (): Promise<{ root: string; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "enabler-535/evidence" });
  const workspace = new Workspace(fixture.root);
  onTestFinished(async () => {
    await workspace.close();
    await fixture.cleanup();
  });
  return { root: fixture.root, workspace };
};

const recordOf = (file: EvidenceFile, date: string): EvidenceRecord => ({
  element: SR,
  version: "n1:2eb0feee31fc1d89",
  kind: "verification",
  method: "test",
  item: "build-512",
  result: "passed",
  date,
  source: file.ext === "md" ? "markdown" : "junit",
  repository: file.repository,
  file: file.file,
  line: 1,
});

describe("evidence states", () => {
  it("readEvidence reads no file without a reader", async () => {
    const { root } = await open();
    expect(await readEvidence(await loadWorkspaceLayout(root), [])).toEqual({
      records: [],
      skipped: [],
      problems: [],
      incomplete: false,
    });
  });

  it("evidenceRecordsState holds the records the readers of EVIDENCE_READERS give", async () => {
    // The Markdown reader (SR-028) and the JUnit reader (SR-093).
    expect(EVIDENCE_READERS.map((r) => r.extension)).toEqual(["md", "xml"]);
    const { workspace } = await open();
    expect((await workspace.get(evidenceRecordsState)).map((r) => [r.source, r.file])).toEqual([
      ["markdown", "evidence/2026-10-20-SR-e88fb3-inspection.md"],
      ["junit", "evidence/ci/results.xml"],
    ]);
  });

  it("evidenceRecordsState gives each file to the reader of its extension", async () => {
    const { root } = await open();
    const seen: string[] = [];
    const skipped: SkippedTestCase = {
      name: "test_shows_gusts[SR-e88fb3]",
      className: "tests.test_wind",
      elements: [SR],
      repository: "system",
      file: "evidence/ci/results.xml",
      line: 12,
    };
    const markdown: EvidenceReader = {
      extension: "md",
      read: (file, bytes) => {
        seen.push(`md ${file.file} ${String(new TextDecoder().decode(bytes).startsWith("---\n"))}`);
        return { records: [recordOf(file, "2026-10-20T14:00:00Z")] };
      },
    };
    const junit: EvidenceReader = {
      extension: "xml",
      read: (file, bytes) => {
        seen.push(`xml ${file.file} ${String(new TextDecoder().decode(bytes).startsWith("<?xml"))}`);
        return Promise.resolve({
          records: [recordOf(file, "2026-10-21T09:00:00Z")],
          skipped: [skipped],
          problems: [
            {
              code: "evidence.not-enriched",
              severity: "warning",
              message: "x",
              repository: "system",
              file: file.file,
            },
          ],
        });
      },
    };
    const read = await readEvidence(await loadWorkspaceLayout(root), [junit, markdown]);
    expect(seen).toEqual([
      "md evidence/2026-10-20-SR-e88fb3-inspection.md true",
      "xml evidence/ci/results.xml true",
    ]);
    expect(read.records.map((r) => [r.source, r.file])).toEqual([
      ["markdown", "evidence/2026-10-20-SR-e88fb3-inspection.md"],
      ["junit", "evidence/ci/results.xml"],
    ]);
    expect(read.skipped).toEqual([skipped]);
    expect(read.problems.map((p) => p.code)).toEqual(["evidence.not-enriched"]);
    expect(read.incomplete).toBe(false);
    // Without a reader for an extension its files are not read.
    seen.length = 0;
    expect((await readEvidence(await loadWorkspaceLayout(root), [markdown])).records).toHaveLength(1);
    expect(seen).toEqual(["md evidence/2026-10-20-SR-e88fb3-inspection.md true"]);
  });

  it("readEvidence reports an evidence file that cannot be read and reads the others", async () => {
    const { root } = await open();
    const readFile = fs.readFile.bind(fs);
    const spy = vi
      .spyOn(fs, "readFile")
      .mockImplementation(((file: string, options: never) =>
        file.endsWith(".xml")
          ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
          : readFile(file, options)) as typeof fs.readFile);
    onTestFinished(() => {
      spy.mockRestore();
    });
    const any = (extension: "md" | "xml"): EvidenceReader => ({
      extension,
      read: (file) => ({ records: [recordOf(file, "2026-10-20T14:00:00Z")] }),
    });
    const read = await readEvidence(await loadWorkspaceLayout(root), [any("md"), any("xml")]);
    expect(read.records.map((r) => r.file)).toEqual(["evidence/2026-10-20-SR-e88fb3-inspection.md"]);
    expect(read.problems).toEqual([
      {
        code: "file.unreadable",
        severity: "error",
        repository: "system",
        file: "evidence/ci/results.xml",
        message: "Cannot read evidence file: EACCES",
      },
    ]);
  });

  it("evidenceIndexState indexes the injected records and the skipped test cases of the read state", async () => {
    const { workspace } = await open();
    const read = workspace.get(evidenceReadState);
    const skipped: SkippedTestCase = {
      name: "test_gusts",
      elements: [SR],
      repository: "system",
      file: "evidence/ci/results.xml",
      line: 12,
    };
    await workspace.replace(
      evidenceReadState,
      read,
      Promise.resolve({ ...(await read), skipped: [skipped] }),
    );
    const records = workspace.get(evidenceRecordsState);
    const record: EvidenceRecord = {
      element: SR,
      version: "n1:0",
      kind: "validation",
      result: "passed",
      date: "2026-01-01T00:00:00Z",
    };
    await workspace.replace(evidenceRecordsState, records, Promise.resolve([record]));
    const index = await workspace.get(evidenceIndexState);
    expect(index.byElement.get(SR)).toEqual([record]);
    expect(index.testCasesOf(SR)).toEqual([
      { name: "test_gusts", elements: [SR], executed: false, executions: [] },
    ]);
  });
});
