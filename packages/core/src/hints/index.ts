// The `hints` block (architecture README section 5): hints that someone settles by confirming them
// (D-042). Stage 2: outdated relations and inline references (SR-025) with their stable hint IDs,
// which `hint.confirm` (SR-027) resolves, and outdated evidence (SR-025 AK4), whose records stage 4
// reads; the list of all open hints (`hint.list`, SR-026) and the hints at one element in its view.
export type { EvidenceVersion } from "./evidence.js";
export { outdatedEvidenceFindings, outdatedEvidenceProblemsState } from "./evidence.js";
export type { ConfirmableCode, HintTarget } from "./hint-id.js";
export {
  CONFIRMABLE_CODES,
  CORE_CHANGED_CODE,
  OUTDATED_CODE,
  TEXT_SEGMENT,
  hintIdOf,
  parseHintId,
} from "./hint-id.js";
export type {
  Candidate as OutdatedCandidate,
  OutdatedContext,
  OutdatedFinding,
  ShownContext,
} from "./outdated.js";
export {
  datedProblems,
  outdatedAmong,
  outdatedFindingsOf,
  outdatedOfShown,
  outdatedRelationsState,
} from "./outdated.js";
export type { ConfirmedHints } from "./confirm.js";
export { confirmHints } from "./confirm.js";
export { elementHints } from "./element.js";
export type { HintFilter } from "./list.js";
export { HINT_STATES, hintsOf, isHint, listHints, resolveHintFilter } from "./list.js";
