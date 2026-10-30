// workspace.check (SR-019; aggregates SR-008, SR-015, SR-016, SR-028, SR-040, SR-072, SR-085,
// SR-086, SR-088, SR-089 and SR-090): every finding of the whole workspace against the metamodel, as
// `problems`, and `ok`, from which the CLI takes its exit code (ADR-0009). Each finding comes from
// the whole-workspace state of its block, which is kept until the element store or the metamodel is
// reset, so a second check of an unchanged workspace reads no file again.
//
// - `ok` is false when the workspace has a finding at or above `failOn`, shown or not; the default
//   `error` lets warnings and info pass (#304, product owner decision, 2026-10-26, option 1): a correct
//   workspace keeps hints that cannot be confirmed (the superseded targets of SR-072 AK2), so warnings
//   failing the check meant it never passed. `failOn: warning` gives the exit code 1 that SR-019 AK2
//   and SR-025 AK2 ask for warnings (they get a new version after the spec moves into ReqSeq). The
//   choice is an input of the command, so `ok` is the same on every access (SR-080).
// - `severity` is the lowest severity shown. It only filters `problems`; `ok` is about all findings,
//   so the exit code never depends on it. The findings it leaves out are counted in `hidden`, so that
//   no problem shown never reads as a workspace without findings.
// - Findings are appended one by one: spreading a state into `push` passes every problem as an
//   argument and overflows the stack at some 100,000 problems (N-036: 50,000 elements).
// - While the metamodel is not valid (SR-011 AK3), every state that checks against it is empty
//   (#208; assumption of spec question #220, option 1): its errors are reported, together with the
//   file findings (SR-008) and duplicate IDs (SR-088), which need no metamodel. Otherwise one typo
//   would report every property of every element as unknown. `ok` stays false: the metamodel, or
//   the layout for a missing metamodel folder, has an `error`. States carried over a store change
//   (#184) stay empty too (`carryProblems` option `skip`); a reset of the metamodel drops them.
// - `changedFiles` and `changedSince` restrict the check to a merge request (SR-092, `model/changed.ts`;
//   spec question #291): the findings of the changed elements and their targets, and those whose
//   target is a changed element. The problems of the layout and the metamodel are always kept, and so
//   is an `info` per repository whose changes are not looked at (no such commit, no Git). The
//   states are still built for the whole workspace (they are kept for the next call); the outdated
//   relations are restricted before their dates are asked for, so only the kept ones cost a walk.
//   `ok` and `checkedElements` are about what the restriction keeps.
// - Outdated relations and references (SR-025), after the states of `FINDING_STATES`: the current
//   versions are checked first (images the watcher does not report, ADR-0008), so the state is built
//   on the versions of now; their state keeps findings, and their problems get the dates of both
//   versions per call (`datedProblems`), since a new commit changes them without a file change.
//   Outdated evidence (SR-025 AK4) has its records from stage 4 on (#127 option 1); the problems of
//   reading them and the records of unknown elements are `evidenceProblemsState` (SR-028 AK3).
// - Folders a running watcher cannot watch (`workspace.not-watched`) are left to `workspace.status`:
//   they are about the running process, not about the files.
// - `durationMs` is left out: it differs between calls, and the same call gives the same output in
//   every access (SR-080 AK2).
import type { CommandOutput, Problem } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { evidenceProblemsState } from "../../evidence/index.js";
import { metamodelState } from "../../metamodel/index.js";
import {
  changedFiles,
  currentVersions,
  duplicateIdProblemsState,
  duplicateIdentifierProblemsState,
  elementStoreState,
  missingTargetProblemsState,
  relationTypeProblemsState,
  requiredProblemsState,
  restrictTo,
  statusProblemsState,
  supersededTargetProblemsState,
  unknownProblemsState,
  valueKindProblemsState,
} from "../../model/index.js";
import { datedProblems, outdatedEvidenceProblemsState, outdatedRelationsState } from "../../hints/index.js";
import { derivationCycleProblemsState } from "../../trace/index.js";
import { nestedVariantsState, supersededValidityProblemsState } from "../../variants/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

type Severity = Problem["severity"];

const RANK: Readonly<Record<Severity, number>> = { info: 0, warning: 1, error: 2 };

/**
 * The whole-workspace findings after the files themselves, in the order of their SRs. The one list
 * of them: tests that need every finding state take it from here. The outdated relations of SR-025
 * follow them (`outdatedRelationsState`): their state keeps findings, which get their dates per call.
 */
export const FINDING_STATES = [
  requiredProblemsState, // SR-015
  unknownProblemsState, // SR-016
  statusProblemsState, // #306
  supersededTargetProblemsState, // SR-072
  supersededValidityProblemsState, // SR-040
  nestedVariantsState, // SR-039
  valueKindProblemsState, // SR-085
  relationTypeProblemsState, // SR-086
  duplicateIdProblemsState, // SR-088
  duplicateIdentifierProblemsState, // #305
  missingTargetProblemsState, // SR-089
  derivationCycleProblemsState, // SR-090
  evidenceProblemsState, // SR-028
  outdatedEvidenceProblemsState, // SR-025 AK4
] as const;

type Output = CommandOutput<"workspace.check">;

/**
 * The problems at or above `severity`, and the findings below it counted by severity as `hidden`,
 * only when it leaves out at least one (an error is never left out).
 */
const shownOf = (findings: readonly Problem[], severity: Severity): Pick<Output, "problems" | "hidden"> => {
  const problems: Problem[] = [];
  const left: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const problem of findings) {
    if (RANK[problem.severity] >= RANK[severity]) {
      problems.push(problem);
    } else {
      left[problem.severity] += 1;
    }
  }
  // `severity === "info"` only narrows the type of `below`: at info nothing is left out.
  return left.warning + left.info === 0 || severity === "info"
    ? { problems }
    : { problems, hidden: { below: severity, warning: left.warning, info: left.info } };
};

export default defineCommand({
  name: "workspace.check",
  run: async (ctx, input): Promise<Output> => {
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const metamodel = await ctx.workspace.get(metamodelState);
    const store = await ctx.workspace.get(elementStoreState);
    // Git first: a commit that is not here fails the call before anything is built (SR-092 AK2).
    const changed = await changedFiles(ctx.workspace.root, layout, input, ctx.signal);
    const versions = metamodel.valid ? await currentVersions(ctx.workspace) : undefined;
    const restriction =
      changed === undefined ? undefined : restrictTo(changed, { store, layout, metamodel, versions });
    const keeps = (problem: Problem): boolean => restriction?.keeps(problem) ?? true;
    const findings: Problem[] = [...layout.problems, ...metamodel.problems, ...(changed?.problems ?? [])];
    for (const problem of store.problems) {
      if (keeps(problem)) {
        findings.push(problem);
      }
    }
    for (const state of FINDING_STATES) {
      for (const problem of await ctx.workspace.get(state)) {
        if (keeps(problem)) {
          findings.push(problem);
        }
      }
    }
    const lowest = RANK[input.severity];
    const outdated = (await ctx.workspace.get(outdatedRelationsState)).filter((f) => keeps(f.problem));
    // The dates are asked of Git only when the warnings are shown; for `ok` the problems suffice.
    const shown =
      RANK.warning < lowest ? outdated.map((f) => f.problem) : await datedProblems(ctx.workspace, outdated);
    for (const problem of shown) {
      findings.push(problem);
    }
    return {
      ok: !findings.some((p) => RANK[p.severity] >= RANK[input.failOn]),
      ...shownOf(findings, input.severity),
      checkedElements: restriction?.selected.length ?? store.elements.length,
    };
  },
});
