// The selection of a command (SR-101, `common.schema.json#/$defs/selection`): which elements a
// function works on, the same for every function that takes one and on every access (D-029).
//
// - Every part given must hold (SR-101 AK2: "nur Elemente, die beide Bedingungen erfüllen"):
//   - `ids`: exactly the elements named (AK3), each resolved with `resolveListRef` (any case, ThomasBirkmaier/ReqSeq-archive#309;
//     `ref.unknown`, `ref.ambiguous`); an element named twice is selected once.
//   - `inRepository` (#2024): explicit IDs too, each a UUID with the repository of its file (D-058), so
//     one copy of a UUID that files in several repositories share (SR-088) is named without `ref.ambiguous`
//     (`resolveInRepository`): every element with that UUID in that repository, also two copies there; an
//     item that names none is `ref.unknown`, as an `ids` item. The app opens the elements a number of a
//     write command's output counts with it (SR-223 AK5).
//   - `where`: the condition (condition.ts, SR-069).
//   - `package`: the elements assigned to the package (SR-112 AK1), as the condition `package`.
//   - `view`: the elements the view of the core or a variant holds (`viewRuleOf`: the validity,
//     SR-040, less what the variant excludes or replaces, SR-041, SR-042, SR-043). It is also the
//     view of `verification` without `variant` (SR-047).
//   Without any part, every element of the workspace.
//   - `filter`: a saved filter by name (SR-070, saved.ts), read from its file on every call: its
//     `where` and its `view` hold as `where` and `view` do. Its `verification` conditions without
//     `variant` use its own view, else the view of the selection; the selection's `where` uses the
//     view of the selection, else the filter's. `sort` gives its sort for `element.list` (SR-070
//     AK3: the same elements, in the same order, on every access). An error in a hand-written filter
//     file names the filter and its file.
// - A perspective (SR-213 AK5, perspectives.ts), given by `element.list` beside the selection: its
//   `where` and its saved filter hold in addition to every part of the selection. Its filter is read
//   as `filter` is: its `where` and its `view` hold, its `where` in its own view, else the selection's.
//   The perspective stores no view; its `where` uses the view of the selection (its own, else that
//   of its saved filter, as for the selection's `where`), else its filter's, else the core. Its errors name the perspective and its file (and the filter, for the filter's).
// - `baseline`: the elements the baseline file lists, as they are now (`Baseline.selects`,
//   baselines/read.ts), for every command that takes a selection (SR-101, #1353). "As they are now"
//   is SR-061 AK2 for the export and, for every other command, the answer to
//   ThomasBirkmaier/ReqSeq-archive#530 Q4 (reading 1: one meaning of the selection for
//   every function); the versions at the baseline are what baseline.get shows (SR-051). It is found by name, then by
//   file name (`findBaseline`): none is `input.invalid`, a name two files share too, a text that
//   names only a faulty file `file.faulty`. baseline.create refuses it before it gets here.
// - `output` (SR-224 AK5, #1873): the elements of the field of a read command's output
//   marked `x-elements: "answer"` over all pages (`CommandDefinition.outputElements`), run through
//   `readOutputElements` of the command's context as `invoke` runs a command (runtime/invoke.ts,
//   `outputElementsReader`). An element is matched by repository and UUID, and by its file when it names one
//   (a record: only that copy of a UUID found twice, SR-088); one the store does not hold
//   is not selected; the inner output's `incomplete` holds, which baseline.get sets for such an entry
//   (assumption of #1932). baseline.create refuses it. With `output.count` (SR-224 AK4, #1915) the elements
//   one number of that output counts (runtime/output-count.ts); a number counted in a view (a verification
//   degree) gives the view of the selection when it names none, and another `view` is `input.invalid`.
// - Order: the order of the store, by repository as the workspace file lists them, then by file
//   path (code units), whatever order `ids` names them in; `sortElements` (sort.ts, SR-075) sorts.
// - `incomplete` (SR-006 AK2): the workspace file lists a repository that is not on this machine,
//   whose elements may belong to the selection too, or a condition met a target in a repository the
//   workspace file does not list (relation.ts). A baselines folder in a repository that is not on
//   this machine holds no baseline here: `baseline` then names none (`input.invalid`, saying so).
// Cost: the conditions are compiled once per call, then one pass over the store (N-036). Compile per
// run (ThomasBirkmaier/ReqSeq-archive#336): a compiled condition holds the states of the store it was compiled against and keeps
// its `notes` (condition.ts, `CompiledCondition`), so a caller that runs a selection again (a bulk
// update, ThomasBirkmaier/ReqSeq-archive#83) calls `resolveSelection` again and never keeps a compiled one; a saved filter is
// compiled from its file on each call.
import type { Baseline } from "../baselines/index.js";
import { findBaseline, workspaceBaselines } from "../baselines/index.js";
import type { CommandContext, CommandName } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { ElementSelection } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import { elementStoreState, resolveInRepository, resolveListRef, shortIdState } from "../model/index.js";
import type { View } from "../variants/index.js";
import { resolveView, viewRuleOf } from "../variants/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { CompiledCondition } from "./condition.js";
import { compileWhere } from "./condition.js";
import type { Predicate, QueryContext, QueryNotes } from "./context.js";
import { invalidAt } from "./context.js";
import type { SavedPerspective } from "./perspectives.js";
import { inPerspective, inPerspectiveAsync } from "./perspectives.js";
import type { SavedFilter } from "./saved.js";
import { inSavedFilter, inSavedFilterAsync, savedFilterFor } from "./saved.js";

/** A perspective given beside a selection, with the saved filter it names, read for this call. */
export interface StoredSelection {
  readonly perspective: SavedPerspective;
  readonly filter?: SavedFilter;
}

/** The elements of a selection, and the states they were selected from (for building the output). */
export interface Selected {
  /** In store order, each once. */
  readonly elements: readonly ElementRecord[];
  /** SR-006 AK2 (see the file comment). */
  readonly incomplete: boolean;
  readonly layout: Pick<WorkspaceLayout, "repositories">;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
  /** The saved filter of `filter`, for its `sort`. */
  readonly filter?: SavedFilter;
  /** The perspective given beside the selection and its saved filter, for their `sort`. */
  readonly stored?: StoredSelection;
  /** The views the elements were selected through: the selection's own and the saved filter's, each if given. */
  readonly views: readonly View[];
}

/**
 * The baseline `text` names for the command (see the file comment). A baselines folder in a repository
 * that is not on this machine holds no baseline here, so `text` names none and the message says why.
 */
const baselineFor = async (
  context: Pick<QueryContext, "workspace" | "command">,
  text: string,
): Promise<Baseline> => {
  const baselines = await workspaceBaselines(context.workspace);
  const found = findBaseline(baselines, text);
  switch (found.kind) {
    case "found":
      return found.baseline;
    case "faulty":
      throw new CommandError(
        "file.faulty",
        `The baseline ${JSON.stringify(text)} is in a faulty file (${found.file}); workspace check names its problems`,
        { files: [found.file] },
      );
    case "ambiguous":
      throw invalidAt(
        context,
        "selection.baseline",
        `${String(found.files.length)} baseline files are named ${JSON.stringify(text)} (${found.files.join(", ")}); give its file name`,
      );
    case "none": {
      // The folder in a repository that is not here: its baselines are not seen (SR-006 AK2).
      const where = baselines.incomplete
        ? `; the baselines folder is in repository ${baselines.location.repository}, which is not on this machine`
        : "";
      throw invalidAt(
        context,
        "selection.baseline",
        `no baseline is named ${JSON.stringify(text)} and no baseline file has that name${where}`,
      );
    }
  }
};

/** The view of a saved filter, when it has one. */
const savedViewOf = (
  context: Pick<QueryContext, "metamodel" | "store" | "shortIds">,
  saved: SavedFilter,
  command: CommandName,
): View | undefined => {
  const { view } = saved.data;
  return view === undefined
    ? undefined
    : inSavedFilter(saved, () => resolveView(context, view, command, "view", true));
};

/** The `where` of a saved filter compiled in `view` (its own, else the selection's), errors naming the filter. */
const compileSaved = (
  context: QueryContext,
  saved: SavedFilter,
  view: View | undefined,
): Promise<CompiledCondition> =>
  inSavedFilterAsync(saved, () => compileWhere({ ...context, view }, saved.data.where, "where"));

/**
 * The view of the saved filter of `stored` and the compiled `where` of that filter and of the
 * perspective, each in its view (see the file comment); errors name the perspective.
 */
const storedParts = async (
  context: QueryContext,
  stored: StoredSelection,
): Promise<{ readonly view: View | undefined; readonly compiled: readonly CompiledCondition[] }> => {
  const { perspective, filter } = stored;
  const filterView =
    filter === undefined
      ? undefined
      : inPerspective(perspective, () => savedViewOf(context, filter, context.command));
  // The view of the selection: its own, else that of its saved filter (`context.view`).
  const { view } = context;
  const compiled = await inPerspectiveAsync(perspective, async () => [
    ...(filter === undefined ? [] : [await compileSaved(context, filter, filterView ?? view)]),
    await compileWhere({ ...context, view: view ?? filterView }, perspective.data.where, "where"),
  ]);
  return { view: filterView, compiled };
};

/**
 * The compiled `where` of the selection's saved filter (in its view, else the selection's) and of
 * `stored`, in this order, the view of the filter of `stored`, and the fields of `Selected` for their sort.
 */
const savedParts = async (
  context: QueryContext,
  view: View | undefined,
  saved: SavedFilter | undefined,
  savedView: View | undefined,
  stored: StoredSelection | undefined,
): Promise<{
  readonly compiled: readonly CompiledCondition[];
  readonly storedView: View | undefined;
  readonly fields: Pick<Selected, "filter" | "stored">;
}> => {
  const own = saved === undefined ? [] : [await compileSaved(context, saved, savedView ?? view)];
  const fromStored = stored === undefined ? undefined : await storedParts(context, stored);
  return {
    compiled: [...own, ...(fromStored?.compiled ?? [])],
    storedView: fromStored?.view,
    fields: {
      ...(saved === undefined ? {} : { filter: saved }),
      ...(stored === undefined ? {} : { stored }),
    },
  };
};

/** What a selection reads of the command's context: its workspace, and `readOutputElements` for `output`. */
export type SelectionContext = Pick<CommandContext, "workspace" | "readOutputElements">;

/** The key an element of an output is matched by: repository and UUID, and the file when it names one. */
const keyOf = (element: {
  readonly id: string;
  readonly repository: string;
  readonly file?: string;
}): string =>
  `${element.repository}\u0000${element.id}${element.file === undefined ? "" : `\u0000${element.file}`}`;

/**
 * The part `output` of `selection` (see the file comment): its test of an element, if given, its `incomplete`
 * and the view its number was counted in.
 */
const outputPart = async (
  caller: SelectionContext,
  selection: ElementSelection,
): Promise<{ readonly tests: readonly Predicate[]; readonly incomplete: boolean; readonly view?: View }> => {
  if (selection.output === undefined) {
    return { tests: [], incomplete: false };
  }
  const { elements, incomplete, view } = await caller.readOutputElements(
    selection.output.command,
    selection.output.input,
    selection.output.count,
  );
  const keys = new Set(elements.map(keyOf));
  return {
    tests: [
      (element) =>
        keys.has(keyOf(element)) || keys.has(keyOf({ id: element.id, repository: element.repository })),
    ],
    incomplete,
    ...(view === undefined ? {} : { view }),
  };
};

/** Whether two views are the same: the core, or the same variant. */
const sameView = (a: View, b: View): boolean =>
  a.kind === "core"
    ? b.kind === "core"
    : b.kind === "variant" && a.variant.id === b.variant.id && a.variant.repository === b.variant.repository;

/**
 * The view of a selection: its own, else the one the number of its `output` was counted in; `input.invalid`
 * when both are given and differ (see the file comment).
 */
const viewOfSelection = (
  own: View | undefined,
  counted: View | undefined,
  command: CommandName,
): View | undefined => {
  if (own !== undefined && counted !== undefined && !sameView(own, counted)) {
    throw new CommandError(
      "input.invalid",
      "selection.view: the number of selection.output is counted in another view; leave the view out or name that one",
      { command, fields: ["selection.view"] },
    );
  }
  return own ?? counted;
};

/** The elements of the store that `ids` and `inRepository` both name, where given, in store order (see the file comment). */
const namedIn = (
  store: ElementStore,
  shortIds: ShortIds,
  selection: Pick<ElementSelection, "ids" | "inRepository">,
): readonly ElementRecord[] => {
  const named = [
    ...(selection.ids === undefined
      ? []
      : [new Set(selection.ids.map((ref) => resolveListRef(store, shortIds, ref)))]),
    ...(selection.inRepository === undefined
      ? []
      : [new Set(selection.inRepository.flatMap((item) => resolveInRepository(store, shortIds, item)))]),
  ];
  return named.length === 0 ? store.elements : store.elements.filter((e) => named.every((set) => set.has(e)));
};

/**
 * The elements `selection` selects in the workspace of `caller` for `command`, with the perspective
 * `stored` when given (see the file comment). Errors name the fields of the input under `selection`.
 */
export const resolveSelection = async (
  caller: SelectionContext,
  selection: ElementSelection,
  command: CommandName,
  stored?: StoredSelection,
): Promise<Selected> => {
  const { workspace } = caller;
  const fromOutput = await outputPart(caller, selection);
  const layout = await workspace.get(workspaceLayoutState);
  const metamodel = await workspace.get(metamodelState);
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const base = { workspace, command, layout, metamodel, store, shortIds };
  const baseline = selection.baseline === undefined ? undefined : await baselineFor(base, selection.baseline);
  const saved: SavedFilter | undefined =
    selection.filter === undefined ? undefined : await savedFilterFor(layout, selection.filter, command);
  const savedView = saved === undefined ? undefined : savedViewOf(base, saved, command);
  const view = viewOfSelection(
    selection.view === undefined
      ? undefined
      : resolveView(base, selection.view, command, "selection.view", true),
    fromOutput.view,
    command,
  );
  const context: QueryContext = { ...base, view: view ?? savedView };
  const tests: Predicate[] = [];
  const notes: QueryNotes[] = [];
  const fromSaved = await savedParts(context, view, saved, savedView, stored);
  for (const compiled of fromSaved.compiled) {
    tests.push(compiled.predicate);
    notes.push(compiled.notes);
  }
  if (baseline !== undefined) {
    tests.push((element) => baseline.selects(element, store.byId));
  }
  tests.push(...fromOutput.tests);
  if (selection.package !== undefined) {
    const compiled = await compileWhere(context, { package: selection.package }, "selection");
    tests.push(compiled.predicate);
  }
  if (selection.where !== undefined) {
    const compiled = await compileWhere(context, selection.where, "selection.where");
    tests.push(compiled.predicate);
    notes.push(compiled.notes);
  }
  const views = [view, savedView, fromSaved.storedView].filter((shown): shown is View => shown !== undefined);
  for (const shown of views) {
    tests.push(viewRuleOf({ workspace, store, metamodel }, shown).includes);
  }
  const elements = namedIn(store, shortIds, selection).filter((e) => tests.every((test) => test(e)));
  return {
    elements,
    incomplete:
      layout.repositories.some((r) => !r.available) ||
      notes.some((n) => n.incomplete) ||
      fromOutput.incomplete,
    layout,
    metamodel,
    store,
    shortIds,
    ...fromSaved.fields,
    views,
  };
};
