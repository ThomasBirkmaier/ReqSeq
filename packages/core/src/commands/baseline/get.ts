// baseline.get (SR-051 AK1–AK3, SR-094): a baseline with its entries and what became of them since
// (baselines/show.ts), with their evidence on request. This file resolves the stored selection of
// the file as it selects now (query/selection.ts, ADR-0018 "selection"), which the baselines block
// cannot import:
//
// - `ids` items by the copy rule of the entries (`copyOf`): a UUID is the copy in the repository
//   of the file, else its only copy; `{ id, repository }` that copy; a short ID or identifier as
//   every command resolves it. `package` and
//   `view` by their UUID or the text written, `filter` by name as it is now, `where` as written.
// - Without stored selection nothing is added or removed (`selectionKnown: false`, AK2, AK3).
// - A stored selection that cannot be resolved now (an element of it in a repository that is not
//   here, a saved filter that is gone) is a `baseline.invalid` warning with the reason, and the
//   answer is given as without stored selection.
// - `withEvidence` (SR-094): the evidence of each entry at its version in the baseline,
//   `baselineEvidence` of the evidence block over the views of `verificationState` (the same as
//   `evidence.status`, SR-080) and the records that count for the baseline (`countsFor`, AK2). The
//   rows: with a variant in the stored selection only that variant's (AK5), else the core and every
//   variant the requirement applies in (AK4, a stored `view: core` included), as `evidence.status`
//   shows them (SR-047 AK3), so none for a variant whose status is invalid now (SR-047 AK6; a
//   baseline over that variant's view keeps its rows, AK5). When the stored
//   selection cannot be resolved, its `view` alone is resolved for this; a view that is gone leaves
//   the verification out, with a warning, and keeps the validation status, which has no view (AK7).
//   While the metamodel is not valid there are no records: every row is `open`. Page only; one
//   index of all records, built once per state of the records (N-036).
// - `countedElements` gives the elements of each number of `counts` (SR-224 AK4, `stateElements`), and
//   `outputElements` those of the rows of every page (AK5).
// - Both read the files on disk: a repository whose HEAD is not the baseline's commit is a
//   `baseline.repository-commit-differs` warning first (`commitDifferences`, #668).
import type { CommandContext, CommandInput, CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { Baseline, ShowRequest } from "../../baselines/index.js";
import {
  baselineElements,
  commitDifferences,
  copyOf,
  countsFor,
  namedBaseline,
  showBaseline,
  stateElements,
} from "../../baselines/index.js";
import type {
  BaselineStoredRef,
  BaselineStoredSelection,
  ElementSelection,
  Problem,
} from "../../generated/types.js";
import type { ViewHolder } from "../../evidence/index.js";
import { baselineEvidence, verificationState } from "../../evidence/index.js";
import type { Metamodel } from "../../metamodel/index.js";
import { metamodelState } from "../../metamodel/index.js";
import type { ElementRecord } from "../../model/index.js";
import { elementStoreState, isUuid, resolveRef, shortIdState } from "../../model/index.js";
import type { Selected, SelectionContext } from "../../query/index.js";
import { resolveSelection } from "../../query/index.js";
import type { Workspace } from "../../runtime/workspace.js";
import type { View } from "../../variants/index.js";
import { resolveView } from "../../variants/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";
import { counted, incompleteNote, listed, problemsNote, sentence } from "../answer.js";

const command = "baseline.get";

/** A stored `package` or `view` as a reference of a selection. */
const refOf = (stored: BaselineStoredRef): string => (typeof stored === "string" ? stored : stored.id);

/** What the stored selection of `baseline` selects now (see the file comment). */
const selectedNow = async (
  ctx: SelectionContext,
  baseline: Baseline,
  stored: BaselineStoredSelection,
): Promise<Pick<Selected, "elements" | "views" | "incomplete" | "store">> => {
  const { ids, package: inPackage, view, ...rest } = stored;
  const selection: ElementSelection = {
    ...rest,
    ...(inPackage === undefined ? {} : { package: refOf(inPackage) }),
    ...(view === undefined ? {} : { view: refOf(view) }),
  };
  const selected = await resolveSelection(ctx, selection, command);
  if (ids === undefined) {
    return selected;
  }
  const { store, shortIds } = selected;
  const named = new Set(
    ids.map((item): ElementRecord => {
      // The copy rule of the entries (`copyOf`); resolveRef names what it does not find.
      const entry = typeof item === "string" ? { id: item.toLowerCase() } : item;
      const copy = isUuid(entry.id) ? copyOf(store.byId, baseline, entry) : undefined;
      return typeof copy === "object"
        ? copy
        : resolveRef(
            store,
            shortIds,
            entry.id,
            typeof item === "string" ? {} : { repository: item.repository },
          );
    }),
  );
  return { ...selected, elements: selected.elements.filter((e) => named.has(e)) };
};

const CORE: View = { kind: "core" };

/**
 * The views of the rows of `holders` for the view `shown` (see the file comment): a variant's view
 * alone, also when its status is invalid; for the core every view but those of invalid variants.
 */
const rowViews = (holders: readonly ViewHolder[], shown: View): readonly ViewHolder[] =>
  shown.kind === "core"
    ? holders.filter(({ invalid }) => !invalid)
    : holders.filter(
        ({ view }) =>
          view.kind === "variant" &&
          view.variant.id === shown.variant.id &&
          view.variant.repository === shown.variant.repository,
      );

/**
 * The view of the evidence when the stored selection could not be resolved: its `view` alone, the
 * core without; undefined with a warning when that cannot be resolved either.
 */
const storedView = async (
  workspace: Workspace,
  metamodel: Metamodel,
  baseline: Baseline,
  problems: Problem[],
): Promise<View | undefined> => {
  const stored = baseline.data.selection?.view;
  if (stored === undefined) {
    return CORE;
  }
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  try {
    return resolveView({ metamodel, store, shortIds }, refOf(stored), command, "selection.view", true);
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    problems.push({
      code: "baseline.invalid",
      severity: "warning",
      repository: baseline.repository,
      file: baseline.file,
      message: `The view of ${baseline.file} cannot be resolved now (${error.message}); the evidence is left out`,
    });
    return undefined;
  }
};

/**
 * `ShowRequest.evidence` for `withEvidence`: rows for the first of `views`, those of the resolved
 * stored selection (none: the core), or, when it was not resolved (undefined), for its `view` alone
 * (`storedView`); no rows when that is gone.
 */
const evidenceOf = async (
  workspace: Workspace,
  metamodel: Metamodel,
  baseline: Baseline,
  views: readonly View[] | undefined,
  problems: Problem[],
): Promise<Pick<ShowRequest, "evidence">> => {
  const shown =
    views === undefined ? await storedView(workspace, metamodel, baseline, problems) : (views[0] ?? CORE);
  const status = await workspace.get(verificationState);
  const rows = shown === undefined ? undefined : rowViews(status.holders, shown);
  return { evidence: baselineEvidence(status, rows, countsFor(baseline.data.date)) };
};

/** The baseline of `input` and what its stored selection selects now, with a warning when it cannot be resolved (see the file comment). */
const baselineOf = async (
  ctx: CommandContext,
  input: Pick<CommandInput<typeof command>, "baseline">,
): Promise<{
  readonly baseline: Baseline;
  readonly problems: Problem[];
  readonly selected: Pick<Selected, "elements" | "views" | "incomplete" | "store"> | undefined;
}> => selectedOf(ctx, await namedBaseline(ctx.workspace, input.baseline, command));

/** `baselineOf` for a baseline already read. */
const selectedOf = async (
  ctx: CommandContext,
  baseline: Baseline,
): Promise<{
  readonly baseline: Baseline;
  readonly problems: Problem[];
  readonly selected: Pick<Selected, "elements" | "views" | "incomplete" | "store"> | undefined;
}> => {
  const problems: Problem[] = [];
  let selected: Pick<Selected, "elements" | "views" | "incomplete" | "store"> | undefined;
  if (baseline.data.selection !== undefined) {
    try {
      selected = await selectedNow(ctx, baseline, baseline.data.selection);
    } catch (error) {
      if (!(error instanceof CommandError)) {
        throw error;
      }
      problems.push({
        code: "baseline.invalid",
        severity: "warning",
        repository: baseline.repository,
        file: baseline.file,
        message: `The stored selection of ${baseline.file} cannot be resolved now (${error.message}); nothing is marked added or removed`,
      });
    }
  }
  return { baseline, problems, selected };
};

/** Whether the output is incomplete (SR-006 AK2): a repository is not here, or the stored selection says so. */
const incompleteOf = async (
  workspace: Workspace,
  selected: Pick<Selected, "incomplete"> | undefined,
): Promise<boolean> =>
  (await workspace.get(workspaceLayoutState)).repositories.some((r) => !r.available) ||
  selected?.incomplete === true;

/** The output of `baseline.get` for the baseline and selection `read`, with the rows of `page`. */
const shownBaseline = async (
  ctx: CommandContext,
  read: Awaited<ReturnType<typeof selectedOf>>,
  page: Pick<CommandInput<typeof command>, "limit" | "offset" | "withEvidence">,
): Promise<CommandOutput<typeof command>> => {
  const { workspace } = ctx;
  const { baseline, problems: unresolved, selected } = read;
  // The files on disk are read, not the baseline's commits (#668): these warnings come first.
  const problems: Problem[] = [
    ...(await commitDifferences(await workspace.get(workspaceLayoutState), baseline)),
    ...unresolved,
  ];
  const metamodel = await workspace.get(metamodelState);
  const [view] = selected?.views ?? [];
  return showBaseline(workspace, {
    baseline,
    metamodel,
    store: selected?.store ?? (await workspace.get(elementStoreState)),
    selected: selected?.elements,
    view: view?.kind === "variant" ? view.variant.id : undefined,
    incomplete: await incompleteOf(workspace, selected),
    problems,
    limit: page.limit,
    offset: page.offset,
    ...(page.withEvidence ? await evidenceOf(workspace, metamodel, baseline, selected?.views, problems) : {}),
  });
};

/**
 * `baseline.get` of `baseline` without rows: its counts as the command gives them, for the start page of the HTML
 * export (SR-233 AK3).
 */
export const baselineCounts = async (
  ctx: CommandContext,
  baseline: Baseline,
): Promise<Pick<CommandOutput<typeof command>, "counts" | "selectionKnown">> => {
  const { counts, selectionKnown } = await shownBaseline(ctx, await selectedOf(ctx, baseline), {
    limit: 0,
    offset: 0,
    withEvidence: false,
  });
  return { counts, selectionKnown };
};

export default defineCommand({
  name: command,
  answer: (output) => {
    const { counts } = output;
    const states = [
      [counts.changed, "changed"],
      [counts.superseded, "superseded"],
      [counts.removed, "removed"],
      [counts.added, "added"],
      [counts.missing, "missing"],
      [counts.inaccessible, "inaccessible"],
    ] as const;
    const differ = states.filter(([count]) => count > 0).map(([count, state]) => `${String(count)} ${state}`);
    return sentence(
      `Baseline ${output.name} has ${counted(output.total, "element")}, ${differ.length === 0 ? "all unchanged since it was created" : `${listed(differ)} since it was created`}`,
      problemsNote(output.problems),
      incompleteNote(output.incomplete),
    );
  },
  run: async (ctx, input): Promise<CommandOutput<typeof command>> =>
    shownBaseline(ctx, await baselineOf(ctx, input), input),
  outputElements: async (ctx, input) => {
    const { baseline, selected } = await baselineOf(ctx, input);
    const { elements, absent } = baselineElements({
      baseline,
      store: selected?.store ?? (await ctx.workspace.get(elementStoreState)),
      selected: selected?.elements,
    });
    // An entry without an element in the workspace is no row of a list: the list says it is incomplete (#1932).
    return { elements, incomplete: absent || (await incompleteOf(ctx.workspace, selected)) };
  },
  // The elements of each state of `counts` (SR-224 AK4): incomplete only for a state that counts an entry
  // without an element in the workspace (`missing`, `inaccessible`).
  countedElements: async (ctx, input, count) => {
    const { baseline, selected } = await baselineOf(ctx, input);
    const state = count.field.slice("counts.".length) as Parameters<typeof stateElements>[2];
    const { elements, absent } = await stateElements(
      ctx.workspace,
      {
        baseline,
        metamodel: await ctx.workspace.get(metamodelState),
        store: selected?.store ?? (await ctx.workspace.get(elementStoreState)),
        selected: selected?.elements,
      },
      state,
    );
    return { elements, incomplete: absent || (await incompleteOf(ctx.workspace, selected)) };
  },
});
