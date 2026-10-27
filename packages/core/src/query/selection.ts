// The selection of a command (SR-101, `common.schema.json#/$defs/selection`): which elements a
// function works on, the same for every function that takes one (element.list now; search, bulk
// update, coverage, export and baselines later) and on every access (D-029).
//
// - Every part given must hold (SR-101 AK2: "nur Elemente, die beide Bedingungen erfüllen"):
//   - `ids`: exactly the elements named (AK3), each resolved with `resolveRef` (any case, #309;
//     `ref.unknown`, `ref.ambiguous`); an element named twice is selected once.
//   - `where`: the condition (condition.ts, SR-069).
//   - `package`: the elements assigned to the package (SR-048 AK3), as the condition `package`.
//   - `view`: the elements that apply in the core or a variant by their validity (`appliesIn`,
//     SR-040); replacement and exclusion narrow a view in stage 5 (SR-041, SR-042). It is also the
//     view of `verification` without `variant` (SR-047).
//   Without any part, every element of the workspace.
//   - `filter`: a saved filter by name (SR-070, saved.ts), read from its file on every call: its
//     `where` and its `view` hold as `where` and `view` do. Its `verification` conditions without
//     `variant` use its own view, else the view of the selection; the selection's `where` uses the
//     view of the selection, else the filter's. `sort` gives its sort for `element.list` (SR-070
//     AK3: the same elements, in the same order, on every access). An error in a hand-written filter
//     file names the filter and its file.
// - `baseline`: only for a command that opts in (`SelectionOptions.baseline`); so far only
//   data.export (SR-061 AK2; data.store joins with SR-062). The elements the baseline file lists, as
//   they are now (`Baseline.selects`, baselines/read.ts; assumption A1 of #530 Q2/Q4). It is found by
//   name, then by file name (`findBaseline`): none is `input.invalid`, a name two files share too,
//   a text that names only a faulty file `file.faulty`. Every other command refuses it with
//   `input.invalid` naming itself and stage 5, where SR-050, SR-051 and SR-094 decide what a
//   baseline means for it; so no caller takes every element for a narrower selection.
// - Order: the order of the store, by repository as the workspace file lists them, then by file
//   path (code units), whatever order `ids` names them in; `sortElements` (sort.ts, SR-075) sorts.
// - `incomplete` (SR-006 AK2): the workspace file lists a repository that is not on this machine,
//   whose elements may belong to the selection too, or a condition met a target in a repository the
//   workspace file does not list (relation.ts). A baselines folder in a repository that is not on
//   this machine holds no baseline here: `baseline` then names none (`input.invalid`, saying so).
// Cost: the conditions are compiled once per call, then one pass over the store (N-036). Compile per
// run (#336): a compiled condition holds the states of the store it was compiled against and keeps
// its `notes` (condition.ts, `CompiledCondition`), so a caller that runs a selection again (a bulk
// update, #83) calls `resolveSelection` again and never keeps a compiled one; a saved filter is
// compiled from its file on each call.
import type { Baseline } from "../baselines/index.js";
import { findBaseline, workspaceBaselines } from "../baselines/index.js";
import type { CommandName } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { ElementSelection } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import { elementStoreState, resolveRef, shortIdState } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { View } from "../variants/index.js";
import { appliesIn, resolveView, validityOf } from "../variants/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { compileWhere } from "./condition.js";
import type { Predicate, QueryContext, QueryNotes } from "./context.js";
import { invalidAt } from "./context.js";
import type { SavedFilter } from "./saved.js";
import { inSavedFilter, inSavedFilterAsync, savedFilterFor } from "./saved.js";

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
  /** The views the elements were selected through: the selection's own and the saved filter's, each if given. */
  readonly views: readonly View[];
}

/** What a command takes beyond the selection every command takes. */
export interface SelectionOptions {
  /** `baseline` is taken (see the file comment); else it is refused. Default: false. */
  readonly baseline?: boolean;
}

/**
 * The baseline `text` names for `command` (see the file comment). A baselines folder in a repository
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

/** The baseline of `selection.baseline`, when it is given and the command takes it (`options`). */
const baselineOf = async (
  context: Pick<QueryContext, "workspace" | "command">,
  text: string | undefined,
  options: SelectionOptions,
): Promise<Baseline | undefined> => {
  if (text === undefined) {
    return undefined;
  }
  if (options.baseline !== true) {
    throw invalidAt(
      context,
      "selection.baseline",
      `for ${context.command} a selection by baseline comes with stage 5; leave it out`,
    );
  }
  return baselineFor(context, text);
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

/**
 * The elements `selection` selects in `workspace` for `command` (see the file comment). Errors name
 * the fields of the input under `selection`.
 */
export const resolveSelection = async (
  workspace: Workspace,
  selection: ElementSelection,
  command: CommandName,
  options: SelectionOptions = {},
): Promise<Selected> => {
  const layout = await workspace.get(workspaceLayoutState);
  const metamodel = await workspace.get(metamodelState);
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const base = { workspace, command, layout, metamodel, store, shortIds };
  const baseline = await baselineOf(base, selection.baseline, options);
  const saved: SavedFilter | undefined =
    selection.filter === undefined ? undefined : await savedFilterFor(layout, selection.filter, command);
  const savedView = saved === undefined ? undefined : savedViewOf(base, saved, command);
  const view =
    selection.view === undefined
      ? undefined
      : resolveView(base, selection.view, command, "selection.view", true);
  const context: QueryContext = { ...base, view: view ?? savedView };
  const tests: Predicate[] = [];
  const notes: QueryNotes[] = [];
  if (saved !== undefined) {
    const compiled = await inSavedFilterAsync(saved, () =>
      compileWhere({ ...context, view: savedView ?? view }, saved.data.where, "where"),
    );
    tests.push(compiled.predicate);
    notes.push(compiled.notes);
  }
  if (baseline !== undefined) {
    tests.push(baseline.selects);
  }
  if (selection.package !== undefined) {
    const compiled = await compileWhere(context, { package: selection.package }, "selection");
    tests.push(compiled.predicate);
  }
  if (selection.where !== undefined) {
    const compiled = await compileWhere(context, selection.where, "selection.where");
    tests.push(compiled.predicate);
    notes.push(compiled.notes);
  }
  const views = [view, savedView].filter((shown): shown is View => shown !== undefined);
  const validity = validityOf(metamodel);
  for (const shown of views) {
    tests.push((e) => appliesIn(validity, e, shown));
  }
  const named =
    selection.ids === undefined
      ? undefined
      : new Set(selection.ids.map((ref) => resolveRef(store, shortIds, ref)));
  const candidates = named === undefined ? store.elements : store.elements.filter((e) => named.has(e));
  const elements = candidates.filter((e) => tests.every((test) => test(e)));
  return {
    elements,
    incomplete: layout.repositories.some((r) => !r.available) || notes.some((n) => n.incomplete),
    layout,
    metamodel,
    store,
    shortIds,
    ...(saved === undefined ? {} : { filter: saved }),
    views,
  };
};
