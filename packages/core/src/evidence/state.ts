// The evidence records of a workspace (ADR-0012 "Block and state", SR-028). Two states:
//
// - `evidenceReadState`: the evidence folders walked (`evidenceFiles`) and every file given to the
//   reader of its extension: `{ records, skipped, problems, incomplete }`.
// - `evidenceRecordsState`: its records alone, an array. This is the seam through which tests and
//   consumers get records without files (decision on #127, option 1): `workspace.replace` it with
//   the records a test needs. Skipped test cases are given by replacing `evidenceReadState` (do that
//   first: replacing it gives `evidenceRecordsState` the records of the new read).
//
// `evidence.record` puts the record it wrote into a built read (`withRecord`) and registers it for
// the new value (`registerInsertion`), so the states built on the read carry it over instead of
// being built again (#278: the index, `evidenceIndexWith`, and the status, `verificationState`).
//
// The readers are registered in `EVIDENCE_READERS`, one per extension: the Markdown reader of SR-028
// (#40, `markdown.ts`) and the JUnit reader of SR-093 (#105, `junit.ts`).
import fs from "node:fs/promises";
import type { Problem } from "../catalog.js";
import type { StateChange } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { EvidenceExtension, EvidenceFile } from "./folders.js";
import { evidenceFiles } from "./folders.js";
import { JUNIT_READER } from "./junit.js";
import { MARKDOWN_READER } from "./markdown.js";
import type { EvidenceRecord, SkippedTestCase } from "./record.js";

/** What a reader found in one file. */
export interface EvidenceFileRead {
  readonly records: readonly EvidenceRecord[];
  /** JUnit test cases marked `<skipped>` that name elements. */
  readonly skipped?: readonly SkippedTestCase[];
  /** Findings in the file (`evidence.invalid-record`, `evidence.not-enriched`, ...). */
  readonly problems?: readonly Problem[];
}

/**
 * A reader of one kind of evidence file. It gets the file and its bytes and never reads or writes
 * anything else; a file that is no record of its kind (a Markdown file without `logreq-record`, XML
 * without a JUnit root) gives nothing.
 */
export interface EvidenceReader {
  readonly extension: EvidenceExtension;
  readonly read: (file: EvidenceFile, bytes: Uint8Array) => EvidenceFileRead | Promise<EvidenceFileRead>;
}

/** The readers of the product, one per extension (see the file comment). */
export const EVIDENCE_READERS: readonly EvidenceReader[] = [
  MARKDOWN_READER, // SR-028
  JUNIT_READER, // SR-093
];

/** Everything read from the evidence folders of a workspace. */
export interface EvidenceRead {
  /** By file in the order of `evidenceFiles`, then as each reader gives them. */
  readonly records: readonly EvidenceRecord[];
  readonly skipped: readonly SkippedTestCase[];
  /** The problems of the walk, then those of the files in file order. */
  readonly problems: readonly Problem[];
  /** An evidence location lies in a repository that is not on this machine. */
  readonly incomplete: boolean;
}

/** Files read at a time. */
const PARALLEL_READS = 16;

/** The bytes of one file, or `file.unreadable` when it cannot be read. */
const bytesOf = async (file: EvidenceFile): Promise<Uint8Array | Problem> => {
  try {
    return await fs.readFile(file.absolute);
  } catch (error) {
    return {
      code: "file.unreadable",
      severity: "error",
      repository: file.repository,
      file: file.file,
      message: `Cannot read evidence file: ${String((error as NodeJS.ErrnoException).code)}`,
    };
  }
};

/**
 * The records of the evidence folders of `layout`: each file of `evidenceFiles` given to the reader
 * of its extension in `readers` (default `EVIDENCE_READERS`); a file without a reader is not read.
 * The bytes are read `PARALLEL_READS` files at a time, and the readers are called one file after the
 * other in the order of `evidenceFiles`, so the result and the calls are the same on every run.
 */
export const readEvidence = async (
  layout: WorkspaceLayout,
  readers: readonly EvidenceReader[] = EVIDENCE_READERS,
): Promise<EvidenceRead> => {
  const listed = await evidenceFiles(layout);
  const byExtension = new Map(readers.map((r) => [r.extension, r]));
  const jobs = listed.files.flatMap((file) => {
    const reader = byExtension.get(file.ext);
    return reader === undefined ? [] : [{ file, reader }];
  });
  const reads: EvidenceFileRead[] = [];
  for (let start = 0; start < jobs.length; start += PARALLEL_READS) {
    const batch = jobs.slice(start, start + PARALLEL_READS);
    const loaded = await Promise.all(batch.map(async (job) => ({ ...job, bytes: await bytesOf(job.file) })));
    for (const { file, reader, bytes } of loaded) {
      reads.push(
        bytes instanceof Uint8Array ? await reader.read(file, bytes) : { records: [], problems: [bytes] },
      );
    }
  }
  return {
    records: reads.flatMap((r) => r.records),
    skipped: reads.flatMap((r) => r.skipped ?? []),
    problems: [...listed.problems, ...reads.flatMap((r) => r.problems ?? [])],
    incomplete: listed.incomplete,
  };
};

/** The evidence folders of the workspace, read (see the file comment). Reset with the workspace layout. */
export const evidenceReadState = defineWorkspaceState(
  "evidence-read",
  async (workspace): Promise<EvidenceRead> => readEvidence(await workspace.get(workspaceLayoutState)),
  { dependsOn: [workspaceLayoutState] },
);

/** The record each read value got from `evidence.record`, by the value (see the file comment). */
const insertions = new WeakMap<Promise<EvidenceRead>, EvidenceRecord>();

/**
 * Registers `record` as the one record by which the read `value` differs from the read it replaces
 * (`withRecord`); call it before `workspace.replace(evidenceReadState, from, value)`.
 */
export const registerInsertion = (value: Promise<EvidenceRead>, record: EvidenceRecord): void => {
  insertions.set(value, record);
};

/**
 * The record inserted by `change` when it is a replace of `evidenceReadState` with a registered
 * value (`registerInsertion`), else undefined: then what changed is not known.
 */
export const insertionOf = (change: StateChange): EvidenceRecord | undefined =>
  change.key === evidenceReadState ? insertions.get(change.to as Promise<EvidenceRead>) : undefined;

/**
 * The evidence records of the workspace (SR-028): the records of `evidenceReadState`. The seam
 * through which the check of SR-025 AK4 and the stage 4 consumers get their records (see the file
 * comment). Carried over every replace of the read: it is the new read's records.
 */
export const evidenceRecordsState = defineWorkspaceState(
  "evidence-records",
  async (workspace): Promise<readonly EvidenceRecord[]> => (await workspace.get(evidenceReadState)).records,
  {
    dependsOn: [evidenceReadState],
    // Only a replace of the read reaches it: a replace of the layout resets the read first.
    carry: (_value, change) => (change.to as Promise<EvidenceRead>).then((read) => read.records),
  },
);
