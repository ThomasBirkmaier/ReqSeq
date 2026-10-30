// The `baselines` block (D-039, architecture README §5). Stage 4 has the read-only reader of baseline
// files (SR-032 AK2, spec question #530), the fast reader of the file format of ADR-0018 and the
// text of new baseline files; creating them is SR-050, comparing SR-051. Core blocks and commands
// import it relatively; it never imports `commands`. Block doc: docs/baselines.md.
export { baselineStem, baselineText } from "./text.js";
export { elementNames, involvedCommits, refuseUncommitted } from "./state.js";
export type { ChangedFile, Checked } from "./state.js";
export { writeNewBaseline } from "./write.js";
export {
  BASELINE_FILE_EXTENSION,
  MAX_VIOLATIONS,
  baselineFilesState,
  baselinesContaining,
  findBaseline,
  foldName,
  readBaselines,
  workspaceBaselines,
} from "./read.js";
export type { Baseline, BaselineFiles, Baselines, FoundBaseline } from "./read.js";
export { baselineHeader, scanBaseline } from "./scan.js";
export type { BaselineHeader } from "./scan.js";
