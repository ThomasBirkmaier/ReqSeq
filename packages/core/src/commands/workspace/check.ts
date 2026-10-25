// workspace.check (SR-019; aggregates SR-008, SR-015, SR-016, SR-040, SR-072, SR-085, SR-086,
// SR-088, SR-089 and SR-090): every finding of the whole workspace against the metamodel, as
// `problems`, and `ok`, from which the CLI takes its exit code (ADR-0009). Each finding comes from
// the whole-workspace state of its block, which is kept until the element store or the metamodel is
// reset, so a second check of an unchanged workspace reads no file again.
//
// - `ok` is false when the workspace has a finding of severity `warning` or `error`: SR-019 AK2
//   ends the check with exit code 1 for findings of SR-015, SR-016, SR-085, SR-086 and SR-090,
//   which are warnings ("Hinweis" blocks nothing, so they stay warnings in every access, SR-080).
//   Info, such as a repository that is not on this machine (SR-006), keeps `ok` true (AK1).
// - `severity` is the lowest severity shown. It only filters `problems`; `ok` is about all findings,
//   so the exit code never depends on it (the spec has no such option).
// - Findings are appended one by one: spreading a state into `push` passes every problem as an
//   argument and overflows the stack at some 100,000 problems (N-036: 50,000 elements).
// - While the metamodel is not valid (SR-011 AK3), every state that checks against it is empty
//   (#208; assumption of spec question #220, option 1): its errors are reported, together with the
//   file findings (SR-008) and duplicate IDs (SR-088), which need no metamodel. Otherwise one typo
//   would report every property of every element as unknown. `ok` stays false: the metamodel, or
//   the layout for a missing metamodel folder, has an `error`. States carried over a store change
//   (#184) stay empty too (`carryProblems` option `skip`); a reset of the metamodel drops them.
// - `changedFiles` and `changedSince` restrict the check to a merge request (SR-092, stage 2). Until
//   then they are refused, so a pipeline never takes a full check for a restricted one.
// - Outdated relations and references (SR-025), after the states of `FINDING_STATES`: the current
//   versions are checked first (images the watcher does not report, ADR-0008), so the state is built
//   on the versions of now; their state keeps findings, and their problems get the dates of both
//   versions per call (`datedProblems`), since a new commit changes them without a file change.
//   Outdated evidence (SR-025 AK4) has its records from stage 4 on (#127 option 1).
// - Folders a running watcher cannot watch (`workspace.not-watched`) are left to `workspace.status`:
//   they are about the running process, not about the files.
// - `durationMs` is left out: it differs between calls, and the same call gives the same output in
//   every access (SR-080 AK2).
import type { CommandInput, CommandOutput, Problem } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import { metamodelState } from "../../metamodel/index.js";
import {
  currentVersions,
  duplicateIdProblemsState,
  elementStoreState,
  missingTargetProblemsState,
  relationTypeProblemsState,
  requiredProblemsState,
  supersededTargetProblemsState,
  unknownProblemsState,
  valueKindProblemsState,
} from "../../model/index.js";
import { datedProblems, outdatedEvidenceProblemsState, outdatedRelationsState } from "../../hints/index.js";
import { derivationCycleProblemsState } from "../../trace/index.js";
import { supersededValidityProblemsState } from "../../variants/index.js";
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
  supersededTargetProblemsState, // SR-072
  supersededValidityProblemsState, // SR-040
  valueKindProblemsState, // SR-085
  relationTypeProblemsState, // SR-086
  duplicateIdProblemsState, // SR-088
  missingTargetProblemsState, // SR-089
  derivationCycleProblemsState, // SR-090
  outdatedEvidenceProblemsState, // SR-025 AK4
] as const;

const refuseRestriction = (input: CommandInput<"workspace.check">): void => {
  const given = (["changedFiles", "changedSince"] as const).filter((key) => input[key] !== undefined);
  if (given.length > 0) {
    throw new CommandError(
      "input.invalid",
      `workspace.check cannot be restricted to changed files yet (SR-092): leave out ${given.join(" and ")}`,
      { command: "workspace.check", fields: given },
    );
  }
};

export default defineCommand({
  name: "workspace.check",
  run: async (ctx, input): Promise<CommandOutput<"workspace.check">> => {
    refuseRestriction(input);
    const layout = await ctx.workspace.get(workspaceLayoutState);
    const metamodel = await ctx.workspace.get(metamodelState);
    const store = await ctx.workspace.get(elementStoreState);
    const findings: Problem[] = [...layout.problems, ...metamodel.problems, ...store.problems];
    if (metamodel.valid) {
      await currentVersions(ctx.workspace);
    }
    for (const state of FINDING_STATES) {
      for (const problem of await ctx.workspace.get(state)) {
        findings.push(problem);
      }
    }
    const lowest = RANK[input.severity];
    const outdated = await ctx.workspace.get(outdatedRelationsState);
    // The dates are asked of Git only when the warnings are shown; for `ok` the problems suffice.
    const shown =
      RANK.warning < lowest ? outdated.map((f) => f.problem) : await datedProblems(ctx.workspace, outdated);
    for (const problem of shown) {
      findings.push(problem);
    }
    return {
      ok: !findings.some((p) => RANK[p.severity] >= RANK.warning),
      problems: findings.filter((p) => RANK[p.severity] >= lowest),
      checkedElements: store.elements.length,
    };
  },
});
