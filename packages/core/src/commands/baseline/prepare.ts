// baseline.prepare (SR-242, D-082): before a baseline, what the check of the workspace found, the
// verification degree of a selection, the requirements without a passed test and the changes since the
// newest baseline, with Create baseline as the next step. It composes the outputs of existing commands and
// computes no number itself:
//
// - `problems`: workspace.check with its default input, always for the whole workspace; `wholeWorkspace`
//   says so when a selection was given (AK1).
// - `degree`, `view`, `names`: evidence.degree for the selection; `withoutPassedTest`: `total` of
//   evidence.withoutPassedTest for that view (AK2).
// - `baseline`: the newest baseline as baseline.changes takes it (SR-241 AK1, AK7), with the problems of
//   baseline.get apart from the check's, without the warnings of SR-254 (AK3, `gotProblems`); `baselineFiles`:
//   those of baseline.list (faulty files).
// - The next steps (AK4): Create baseline with the selection given and only `name` open, left out for a
//   selection baseline.create refuses (`refusedSelection`: a baseline, a command output, a saved filter with
//   another view, assumption of #2045); nothing else of whether it can be created is checked (SR-242). Show
//   changes since baseline when there is a baseline. `invoke` leaves out a step whose write command it
//   refuses while the workspace is read-only (SR-226).
// - `countedElements` gives the elements of each number by the command that counted it (SR-224 AK4).
import type { CommandContext, CommandInput, CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { degreePercent } from "../../evidence/degree-text.js";
import type { BaselineSince, ElementSelection, NextStep } from "../../generated/types.js";
import { namesField } from "../../model/index.js";
import { resolveSelection } from "../../query/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";
import { counted, incompleteNote, sentence, viewNamed } from "../answer.js";
import evidenceDegree, { countedOfDegree } from "../evidence/degree.js";
import withoutPassedTest, { listedWithoutPassedTest } from "../evidence/withoutPassedTest.js";
import workspaceCheck from "../workspace/check.js";
import { baselineRef, baselineSince, getInput, gotProblems, ranAs, viewNames } from "./changes.js";
import { refusedSelection } from "./create.js";
import { countedOfBaseline } from "./get.js";
import baselineGet from "./get.js";

const command = "baseline.prepare";

/**
 * The input of evidence.withoutPassedTest for `view`: only its total is taken, so the page is one element. The
 * core is its default and is not given, because a named view needs the validity meaning (resolveView).
 */
const withoutInput = (view: string): CommandInput<"evidence.withoutPassedTest"> => ({
  ...(view === "core" ? {} : { view }),
  limit: 1,
  offset: 0,
});

/**
 * Whether baseline.create refuses `selection` (`refusedSelection`): by its kind, and for a saved filter with
 * a view also by the views it resolves to, which only then are resolved.
 */
const refused = async (ctx: CommandContext, selection: ElementSelection): Promise<boolean> =>
  refusedSelection(selection) !== undefined ||
  (selection.filter !== undefined &&
    selection.view !== undefined &&
    refusedSelection(selection, await resolveSelection(ctx, selection, command)) !== undefined);

/** The number of problems of `severity` the check found. */
const ofSeverity = (problems: CommandOutput<typeof command>["problems"], severity: string): number =>
  problems.filter((p) => p.severity === severity).length;

/** Whether the output is incomplete (SR-242 AK5): a repository is not here, or a composed output says so. */
const incompleteOf = async (
  ctx: CommandContext,
  outputs: readonly ({ readonly incomplete?: boolean } | undefined)[],
): Promise<boolean> =>
  (await ctx.workspace.get(workspaceLayoutState)).repositories.some((r) => !r.available) ||
  outputs.some((output) => output?.incomplete === true);

/** The newest baseline with the problems baseline.get gives for it, kept apart from the check's (AK3). */
const baselineOf = (got: CommandOutput<"baseline.get">): BaselineSince => {
  const problems = gotProblems(got);
  return { ...baselineSince(got), ...(problems === undefined ? {} : { problems }) };
};

/** The output of baseline.prepare (see the file comment). */
const prepared = async (
  ctx: CommandContext,
  input: CommandInput<typeof command>,
): Promise<CommandOutput<typeof command>> => {
  const selection = input.selection ?? {};
  const check = await workspaceCheck.run(ctx, { severity: "info", failOn: "error" });
  const degree = await evidenceDegree.run(ctx, { selection });
  const without = await withoutPassedTest.run(ctx, withoutInput(degree.view));
  const { ref, list } = await baselineRef(ctx, undefined);
  const got = ref === undefined ? undefined : await baselineGet.run(ctx, getInput(ref));
  const next: NextStep[] = [
    ...((await refused(ctx, selection))
      ? []
      : [{ command: "baseline.create", input: { selection }, open: ["name"] }]),
    ...(got === undefined ? [] : [{ command: "baseline.changes", input: {}, open: [] }]),
  ];
  const incomplete = await incompleteOf(ctx, [degree, without, got, list]);
  const named = [...(degree.names ?? []), ...(got === undefined ? [] : viewNames(got))];
  return {
    problems: check.problems,
    ...(input.selection === undefined ? {} : { wholeWorkspace: true }),
    degree: degree.degree,
    view: degree.view,
    withoutPassedTest: without.total,
    ...(got === undefined ? {} : { baseline: baselineOf(got) }),
    ...(list.problems === undefined ? {} : { baselineFiles: { problems: list.problems } }),
    next,
    ...(incomplete ? { incomplete: true } : {}),
    ...namesField(named.filter((name, i) => named.findIndex((other) => other.id === name.id) === i)),
  };
};

export default defineCommand({
  name: command,
  answer: (output) => {
    const { degree } = output;
    const check = `The check found ${counted(ofSeverity(output.problems, "error"), "error")} and ${counted(ofSeverity(output.problems, "warning"), "warning")}`;
    const verified = degree.counts.verified + degree.counts.indirect;
    const view = viewNamed(output.view, output.names);
    return sentence(
      check,
      // The share is left out when no valid requirement is counted (SR-037).
      degree.share === undefined
        ? `the selection has no valid requirement in view ${view}`
        : `${String(verified)} of ${counted(degree.total, "requirement")} in view ${view} verified or indirectly verified (${degreePercent(degree.share)})`,
      incompleteNote(output.incomplete),
    );
  },
  run: (ctx, input) => ranAs(command, () => prepared(ctx, input)),
  countedElements: (ctx, input, count) =>
    ranAs(command, async () => {
      const selection = input.selection ?? {};
      if (count.field.startsWith("degree.")) {
        return countedOfDegree(ctx, { selection }, count);
      }
      if (count.field === "withoutPassedTest") {
        const { view } = await evidenceDegree.run(ctx, { selection });
        return listedWithoutPassedTest(ctx, withoutInput(view));
      }
      const { ref } = await baselineRef(ctx, undefined);
      return ref === undefined
        ? { elements: [], incomplete: false }
        : countedOfBaseline(ctx, getInput(ref), {
            field: count.field.slice("baseline.".length),
            key: count.key,
          });
    }),
});
