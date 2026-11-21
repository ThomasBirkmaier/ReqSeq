// baseline.changes (SR-241, D-082): what changed since a baseline and which hints are open, with the next
// steps. It composes the outputs of existing commands and computes no number itself:
//
// - The baseline: the given one as baseline.get finds it (an unknown or ambiguous one is refused by
//   baseline.get, AK7), else the newest valid one by the rule of SR-103 AK4 (`newestBaselines`, one group
//   for every file), which skips a file that is no valid baseline (AK7). baseline.get is called with its
//   name, or its file name when another valid baseline has the same name (as the app's offers name it).
// - Its numbers are `counts` of baseline.get (AK1, AK5), without `added` and `removed` when the file stores
//   no selection (AK6); its problems and those of baseline.list (faulty files, AK7) are `problems`.
// - The hints are hint.list without a filter (AK2), the page of `limit` from `offset`.
// - The next steps (AK3, AK4): Confirm hints with the hints open, when a confirmable kind (D-042) has a
//   hint over all pages; Show Git command to compare baseline with the baseline and the element open, when an element is
//   marked changed; Prepare baseline. `invoke` leaves out a step whose write command it refuses while the
//   workspace is read-only (SR-226 AK6).
// - `countedElements` gives the elements of `baseline.counts.*` by baseline.get's (SR-224 AK4).
import path from "node:path";
import type { CommandContext, CommandInput, CommandOutput } from "../../catalog.js";
import { CommandError, commandErrorOrThrow, defineCommand } from "../../catalog.js";
import { foldName, newestBaselines } from "../../baselines/index.js";
import type { BaselineSince, NextStep } from "../../generated/types.js";
import { CONFIRMABLE_CODES } from "../../hints/index.js";
import { namesField } from "../../model/index.js";
import { counted, incompleteNote, listed, problemsNote, sentence } from "../answer.js";
import hintList from "../hint/list.js";
import baselineGet, { countedOfBaseline } from "./get.js";
import baselineList from "./list.js";

const command = "baseline.changes";

/**
 * `run` of a command that composes others: a refusal of one of them (an unknown baseline, a selection it
 * cannot resolve) is the composing command's, with the same code, message and details (SR-241 AK7).
 */
export const ranAs = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    const refused = commandErrorOrThrow(error);
    throw new CommandError(
      refused.code,
      refused.message,
      { ...refused.details, command: name },
      { cause: refused },
    );
  }
};

/**
 * How baseline.get is to find the baseline of `given` (see the file comment): the given text, the name of
 * the newest baseline or its file name, or undefined without a baseline. With the problems of baseline.list.
 */
export const baselineRef = async (
  ctx: CommandContext,
  given: string | undefined,
): Promise<{ readonly ref: string | undefined; readonly list: CommandOutput<"baseline.list"> }> => {
  const list = await baselineList.run(ctx, {});
  if (given !== undefined) {
    return { ref: given, list };
  }
  const newest = (await newestBaselines(ctx.workspace, () => "all")).get("all");
  if (newest === undefined) {
    return { ref: undefined, list };
  }
  const shared = list.baselines.filter((b) => foldName(b.name) === foldName(newest.name)).length > 1;
  return { ref: shared ? path.posix.basename(newest.file) : newest.name, list };
};

/** The input of baseline.get for `ref`: only the numbers are taken, so the page is one element. */
export const getInput = (ref: string): CommandInput<"baseline.get"> => ({
  baseline: ref,
  withEvidence: false,
  limit: 1,
  offset: 0,
});

/** The baseline of a baseline.get output with its numbers, `added` and `removed` only with a stored selection (AK6). */
export const baselineSince = (output: CommandOutput<"baseline.get">): BaselineSince => {
  const { added, removed, ...counts } = output.counts;
  return {
    name: output.name,
    file: output.file,
    repository: output.repository,
    date: output.date,
    ...(output.view === undefined ? {} : { view: output.view }),
    selectionKnown: output.selectionKnown,
    counts: output.selectionKnown ? { ...counts, added, removed } : counts,
  };
};

/** The states that differ from the baseline, as baseline.get's answer names them: `2 changed`. */
export const differences = (counts: BaselineSince["counts"]): string[] =>
  (
    [
      [counts.changed, "changed"],
      [counts.superseded, "superseded"],
      [counts.removed ?? 0, "removed"],
      [counts.added ?? 0, "added"],
      [counts.missing, "missing"],
      [counts.inaccessible, "inaccessible"],
    ] as const
  )
    .filter(([count]) => count > 0)
    .map(([count, state]) => `${String(count)} ${state}`);

/** The note of an answer on a baseline without stored selection (SR-051 AK2). */
export const selectionNote = "it stores no selection, so nothing is counted as added or removed";

/** The variant of the baseline's view as baseline.get names it, so a reader names the view by short ID and title. */
export const viewNames = (output: CommandOutput<"baseline.get">): CommandOutput<"baseline.get">["names"] =>
  output.names.filter((name) => name.id === output.view);

/** How baseline.compare and the other steps name the baseline: by the text baseline.get found it with. */
const nextSteps = (
  ref: string | undefined,
  baseline: BaselineSince | undefined,
  hints: CommandOutput<"hint.list">,
): NextStep[] => {
  const confirmable = hints.kinds.some(
    (kind) => kind.count > 0 && (CONFIRMABLE_CODES as readonly string[]).includes(kind.code),
  );
  return [
    ...(confirmable ? [{ command: "hint.confirm", input: {}, open: ["hintIds"] }] : []),
    ...(ref !== undefined && baseline !== undefined && baseline.counts.changed > 0
      ? [{ command: "baseline.compare", input: { baseline: ref }, open: ["ref"] }]
      : []),
    { command: "baseline.prepare", input: {}, open: [] },
  ];
};

/** The output of baseline.changes (see the file comment). */
const changesOf = async (
  ctx: CommandContext,
  input: CommandInput<typeof command>,
): Promise<CommandOutput<typeof command>> => {
  const { ref, list } = await baselineRef(ctx, input.baseline);
  const got = ref === undefined ? undefined : await baselineGet.run(ctx, getInput(ref));
  const hints = await hintList.run(ctx, { limit: input.limit, offset: input.offset });
  const baseline = got === undefined ? undefined : baselineSince(got);
  const problems = [...(got?.problems ?? []), ...(list.problems ?? [])];
  const incomplete = got?.incomplete === true || list.incomplete === true || hints.incomplete;
  return {
    ...(baseline === undefined ? {} : { baseline }),
    hints: hints.hints,
    hintKinds: hints.kinds,
    hintTotal: hints.total,
    ...(problems.length === 0 ? {} : { problems }),
    next: nextSteps(ref, baseline, hints),
    ...(incomplete ? { incomplete: true } : {}),
    ...namesField(got === undefined ? [] : viewNames(got)),
  };
};

export default defineCommand({
  name: command,
  answer: (output) => {
    const hints = output.hintTotal === 0 ? "no open hint" : counted(output.hintTotal, "open hint");
    const { baseline } = output;
    if (baseline === undefined) {
      return sentence(
        "The workspace has no baseline",
        hints,
        problemsNote(output.problems),
        incompleteNote(output.incomplete),
      );
    }
    const differ = differences(baseline.counts);
    const since = `baseline ${baseline.name} of ${baseline.date.slice(0, 10)}`;
    return sentence(
      differ.length === 0 ? `Nothing changed since ${since}` : `Since ${since}, ${listed(differ)}`,
      baseline.selectionKnown ? "" : selectionNote,
      hints,
      problemsNote(output.problems),
      incompleteNote(output.incomplete),
    );
  },
  run: (ctx, input) => ranAs(command, () => changesOf(ctx, input)),
  countedElements: (ctx, input, count) =>
    ranAs(command, async () => {
      const { ref } = await baselineRef(ctx, input.baseline);
      return ref === undefined
        ? { elements: [], incomplete: false }
        : countedOfBaseline(ctx, getInput(ref), {
            field: count.field.slice("baseline.".length),
            key: count.key,
          });
    }),
});
