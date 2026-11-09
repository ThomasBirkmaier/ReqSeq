// E4 (ThomasBirkmaier/ReqSeq-archive#583), review of ThomasBirkmaier/ReqSeq-archive#561 (N4): peak memory, not only time, when the evidence folders hold many
// large JUnit files. The JUnit model holds about 17 times the file, and `readEvidence` reads 16 files
// at a time and gives them to the readers one after the other (`evidence/state.ts`). The generated
// workspace of N-036 (50,000 elements, 200,000 relations) with the records of `withEvidenceRecords`
// and an archive of 16 older CI runs, each one JUnit file with every automated test case; the archive
// sorts first, so its 16 files are read in one batch. No SR names a memory limit: the time and what
// the read adds to the heap and to the resident memory are recorded (ADR-0011); a peak near the
// default heap of Node (about 2.2 GB) is a finding for the concurrency of `xml` reads. Its own file,
// so the Vitest process measures nothing else, and the generated tree is dropped before the read.
// A second workspace has every JUnit test case name the core and one variant (`coreAndVariant`,
// SR-093 AK5), so the reader gives two records per element and execution; its rows add the index and
// a page of `evidence.status` in the view of a variant, where the records of both views are pooled.
import type { EvidenceCounts, EvidenceRecordsOptions } from "@reqseq/testkit";
import {
  generateLargeWorkspace,
  measure,
  measurePeakMemory,
  memoryIncrease,
  recordValue,
  withEvidenceRecords,
  writeLargeWorkspace,
} from "@reqseq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evidenceIndexState, evidenceReadState } from "../../src/evidence/index.js";
import type { Output } from "../../src/commands/list.test-helper.js";
import { invoke } from "../../src/runtime/invoke.js";
import { warmModel } from "../../src/model/index.js";
import { Workspace } from "../../src/runtime/workspace.js";
import { standardModel, versionOf } from "./core-version.js";

/** Older CI runs in the archive, one large JUnit file each. */
const HISTORY = 16;

/** The generated workspace with the records of `options`, written and its model loaded; the test reads its evidence. */
const largeEvidence = (
  options: EvidenceRecordsOptions,
): {
  readonly counts: () => EvidenceCounts;
  readonly largest: () => number;
  readonly variant: () => string;
  readonly opened: () => Workspace;
} => {
  // Only what the test needs after the setup, so the generated tree can be collected.
  let counts: EvidenceCounts | undefined;
  let largest = 0;
  let variant = "";
  let cleanup: (() => Promise<void>) | undefined;
  let workspace: Workspace | undefined;

  beforeAll(async () => {
    const version = versionOf(await standardModel());
    const generated = generateLargeWorkspace({ version });
    variant = generated.elements.find((e) => e.type === "variant")?.id ?? "";
    const evidence = withEvidenceRecords(generated, options);
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

  afterAll(async () => {
    await workspace?.close();
    await cleanup?.();
  });

  return {
    counts: () => {
      if (counts === undefined) {
        throw new Error("no records");
      }
      return counts;
    },
    largest: () => largest,
    variant: () => variant,
    opened: () => {
      if (workspace === undefined) {
        throw new Error("no workspace");
      }
      return workspace;
    },
  };
};

describe("peak memory of reading many large JUnit files (N-036, E4 ThomasBirkmaier/ReqSeq-archive#583)", () => {
  const { counts: countsOf, largest: largestOf, opened } = largeEvidence({ history: HISTORY });

  it("records time, peak heap and peak resident memory of reading every evidence file", async () => {
    const counts = countsOf();
    const largest = largestOf();
    const peak = await measurePeakMemory(() => opened().get(evidenceReadState));
    const name = `evidence: read ${String(counts.junitFiles)} JUnit files of ${(counts.junitBytes / 1e6).toFixed(0)} MB (${String(HISTORY)} of about ${(largest / 1e6).toFixed(0)} MB each, read first) and ${String(counts.markdownVerification + counts.markdownValidation)} Markdown records`;
    const basis =
      "review of ThomasBirkmaier/ReqSeq-archive#561 N4, ADR-0012 (readEvidence: 16 files at a time; recorded, no limit in the spec)";
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

describe("reading many large JUnit files whose test cases each name the core and one variant (SR-093 AK5, N-036)", () => {
  const { counts: countsOf, variant, opened } = largeEvidence({ history: HISTORY, coreAndVariant: true });

  it("records time and memory of the read, the index and a page of evidence.status in the view of a variant", async () => {
    const counts = countsOf();
    const peak = await measurePeakMemory(() => opened().get(evidenceReadState));
    const basis = "SR-093 AK5 (two records per element and execution; recorded, no limit in the spec)";
    await recordValue(
      `evidence, every test case for the core and one variant: read ${String(counts.junitFiles)} JUnit files of ${(counts.junitBytes / 1e6).toFixed(0)} MB (${String(HISTORY)} large, read first) and ${String(counts.markdownVerification + counts.markdownValidation)} Markdown records`,
      peak.ms,
      { basis },
    );
    await recordValue(
      `evidence, every test case for the core and one variant: read (${String(peak.result.records.length)} records): ${memoryIncrease(peak)}`,
      0,
      { basis },
    );
    expect(peak.result.problems).toEqual([]);
    expect(peak.result.records).toHaveLength(
      counts.junitRecords + counts.markdownVerification + counts.markdownValidation,
    );
    const { result: index } = await measure(
      `evidence index, every test case for the core and one variant (${String(peak.result.records.length)} records)`,
      () => opened().get(evidenceIndexState),
      { basis },
    );
    expect(index.byElement.size).toBeGreaterThan(0);
    const workspace = opened();
    const { result: page } = await measure(
      "evidence.status, first page (200) of the system requirements in the view of a variant, every test case for the core and one variant",
      async () =>
        (await invoke(
          "evidence.status",
          { selection: { where: { type: ["system-requirement"] }, view: variant() }, limit: 200 },
          { workspace },
        )) as Output<"evidence.status">,
      { basis },
    );
    expect(page.elements.some((e) => (e.verification ?? []).some((v) => v.status === "verified"))).toBe(true);
  });
});
