// The workspace states whose problems make up the check of the element files (SR-019), by name.
// Each is computed from one element store and kept until that store is reset (ADR-0008).
import type { Problem } from "../catalog.js";
import type { WorkspaceState } from "../runtime/workspace.js";
import { duplicateIdProblemsState } from "./duplicates.js";
import { missingTargetProblemsState } from "./missing-targets.js";
import { relationTypeProblemsState } from "./relation-types.js";
import { requiredProblemsState } from "./required.js";
import { supersededTargetProblemsState } from "./superseded.js";
import { unknownProblemsState } from "./unknown.js";
import { valueKindProblemsState } from "./values.js";

/** Every problem state of the element check, with a name for messages and tests. */
export const CHECK_PROBLEM_STATES: readonly (readonly [
  string,
  WorkspaceState<Promise<readonly Problem[]>>,
])[] = [
  ["duplicate IDs", duplicateIdProblemsState],
  ["required properties", requiredProblemsState],
  ["unknown properties", unknownProblemsState],
  ["value kinds", valueKindProblemsState],
  ["relation types", relationTypeProblemsState],
  ["superseded targets", supersededTargetProblemsState],
  ["missing targets", missingTargetProblemsState],
];
