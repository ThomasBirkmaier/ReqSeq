// The `evidence` block (ADR-0012, architecture README §5): evidence records, the evidence folders and
// the index by element and test case. Core blocks and commands import it relatively; it never
// imports `commands`. Block doc: docs/evidence-records.md.
export {
  evidenceIndex,
  evidenceIndexState,
  hasVerificationRecord,
  instantOf,
  newestFirst,
  sortNewestFirst,
} from "./by-element.js";
export type { EvidenceIndex, TestCaseEntry } from "./by-element.js";
export { coverageOf, coverageRules } from "./coverage.js";
export { enrichJunitBytes, enrichJunitFile } from "./enrich.js";
export type { EnrichOptions, EnrichResult, RefResolution, UnknownRef, VersionLookup } from "./enrich.js";
export type { CoverageLevel, CoverageRules } from "./coverage.js";
export { EVIDENCE_FILES, evidenceFiles } from "./folders.js";
export type { EvidenceExtension, EvidenceFile, EvidenceFiles } from "./folders.js";
export { JUNIT_READER, readJunitRecords } from "./junit.js";
export type { JunitLocation } from "./junit.js";
export { MARKDOWN_READER, RECORD_KEY, readMarkdownRecord } from "./markdown.js";
export { evidenceProblemsState, recordElementProblems } from "./match.js";
export type { ElementCopies, RepositoriesAvailable } from "./match.js";
export { testCaseKey, testCaseKeyOf } from "./record.js";
export type { EvidenceRecord, SkippedTestCase, TestCase, TestCaseName } from "./record.js";
export { EVIDENCE_READERS, evidenceReadState, evidenceRecordsState, readEvidence } from "./state.js";
export type { EvidenceFileRead, EvidenceRead, EvidenceReader } from "./state.js";
export { childRulesOf, hasOwnRecordIn, verificationEvaluator } from "./indirect.js";
export type { ChildRules, Shown, VerificationEvaluator, VerificationResult } from "./indirect.js";
export {
  hasValidationRecord,
  holdsIn,
  recordStatusOf,
  statusSource,
  validationStatusOf,
  verificationStatusOf,
} from "./status.js";
export type { RecordStatus, RecordVerificationStatus, StatusSource, VerificationEntries } from "./status.js";
export {
  verificationOf,
  verificationState,
  withEvidenceStatus,
  workspaceStatus,
  workspaceStatusOf,
} from "./verification.js";
export type { VersionReader, WorkspaceStatus } from "./verification.js";
export { listedRecords, recordHoldsIn } from "./views.js";
