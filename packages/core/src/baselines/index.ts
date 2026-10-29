// The `baselines` block (D-039, architecture README §5). Stage 4 has the read-only reader of baseline
// files (SR-032 AK2, spec question #530) and the fast reader of the file format of ADR-0018; creating
// and comparing baselines comes with stage 5. Core blocks and commands import it relatively; it never
// imports `commands`. Block doc: docs/baselines.md.
export {
  BASELINE_FILE_EXTENSION,
  MAX_VIOLATIONS,
  baselineFilesState,
  baselinesContaining,
  findBaseline,
  readBaselines,
  workspaceBaselines,
} from "./read.js";
export type { Baseline, BaselineFiles, Baselines, FoundBaseline } from "./read.js";
export { baselineHeader, scanBaseline } from "./scan.js";
export type { BaselineHeader } from "./scan.js";
