// E4 (#583), review of #561 (N4): peak memory, not only time, when the evidence folders hold many
// large JUnit files. The JUnit model holds about 17 times the file, and `readEvidence` reads 16 files
// at a time and gives them to the readers one after the other (`evidence/state.ts`). The generated
// workspace of N-036 (50,000 elements, 200,000 relations) with the records of `withEvidenceRecords`
// and an archive of 16 older CI runs, each one JUnit file with every automated test case; the archive
// sorts first, so its 16 files are read in one batch. No SR names a memory limit: the time and what
// the read adds to the heap and to the resident memory are recorded (ADR-0011); a peak near the
// default heap of Node (about 2.2 GB) is a finding for the concurrency of `xml` reads. Its own file,
// so the Vitest process measures nothing else, and the generated tree is dropped before the read.
import type { EvidenceCounts } from "@reqseq/testkit";
import {
  generateLargeWorkspace,
  measurePeakMemory,
  memoryIncrease,
  recordValue,
  withEvidenceRecords,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evidenceReadState } from "../../src/evidence/index.js";
import { warmModel } from "../../src/model/index.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { standardModel, versionOf } from "./core-version.js";

/** Older CI runs in the archive, one large JUnit file each. */
const HISTORY = 16;

describe("peak memory of reading many large JUnit files (N-036, E4 #583)", () => {
  // Only what the test needs after the setup, so the generated tree can be collected.
  let counts: EvidenceCounts;
  let largest = 0;
  let cleanup: (() => Promise<void>) | undefined;
  let workspace: Workspace | undefined;

  beforeAll(async () => {
    const version = versionOf(await standardModel());
    const evidence = withEvidenceRecords(generateLargeWorkspace({ version }), { history: HISTORY });
    counts = evidence.counts;
    largest = Math.max(
      ...[...evidence.workspace.files]
        .filter(([file]) => file.includes("/evidence/archive/"))
        .map(([, text]) => Buffer.byteLength(text)),
    );
    // Only the members the test needs: the fixture object holds the generated tree.
    const { cleanup: remove, workspaceRoot } = await writeLargeWorkspace(evidence.workspace);
    cleanup = remove;
    workspace = new Workspace(workspaceRoot);
    await warmModel(workspace);
  }, 600_000);

  const opened = (): Workspace => {
    if (workspace === undefined) {
      throw new Error("no workspace");
    }
    return workspace;
  };

  afterAll(async () => {
    await workspace?.close();
    await cleanup?.();
  });

  it("records time, peak heap and peak resident memory of reading every evidence file", async () => {
    const peak = await measurePeakMemory(() => opened().get(evidenceReadState));
    const name = `evidence: read ${String(counts.junitFiles)} JUnit files of ${(counts.junitBytes / 1e6).toFixed(0)} MB (${String(HISTORY)} of about ${(largest / 1e6).toFixed(0)} MB each, read first) and ${String(counts.markdownVerification + counts.markdownValidation)} Markdown records`;
    const basis =
      "review of #561 N4, ADR-0012 (readEvidence: 16 files at a time; recorded, no limit in the spec)";
    await recordValue(name, peak.ms, { basis });
    await recordValue(
      `evidence: read many large JUnit files (${String(peak.result.records.length)} records): ${memoryIncrease(peak)}`,
      0,
      { basis },
    );
    expect(peak.result.problems).toEqual([]);
    expect(peak.result.records).toHaveLength(
      counts.junitRecords + counts.markdownVerification + counts.markdownValidation,
    );
  });
});
