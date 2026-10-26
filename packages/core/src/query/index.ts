// The `query` block (architecture README section 5): the filter conditions (SR-069), the selection
// of a command (SR-101) and the evidence provider the filter asks (stage 4 fills it). Core blocks and
// commands import it relatively; it is not part of the package's public API.
export { compileWhere } from "./condition.js";
export type { CompiledCondition } from "./condition.js";
export type { CompileContext, Predicate, QueryContext, QueryNotes } from "./context.js";
export { evidenceStatusState } from "./evidence.js";
export type { EvidenceStatuses } from "./evidence.js";
export { resolveSelection } from "./selection.js";
export type { Selected } from "./selection.js";
