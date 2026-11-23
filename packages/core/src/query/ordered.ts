// The order of a selection (SR-070 AK3, SR-075): the elements of `resolveSelection` sorted by the
// `sort` of the input; without `sort`, by the first stored sort of: the saved filter the selection
// names, the perspective given beside it (SR-213 AK5), the saved filter of the perspective. The one
// place that decides it, so `element.list` and `trace.matrix` give the same order for the same
// selection and sort (SR-125 AK1); `orderedGroups` gives the same order inside each group (SR-149 AK3).
// The keys that read more than the files (`SortValues`) are read first (`sortValuesFor`), then the sort
// runs: `verification` (SR-075) in the view of the selection, `views[0]` as the rows take it
// (`rowsVerification`, SR-137), the core without one, through the provider the filter on the
// verification status uses (`evidenceStatusState`), so its state is built once and kept (SR-082 AK4);
// `versionDate` (SR-075) for the whole selection (`versionTimesOf`, version-times.ts), from the
// walks of the version dates that the workspace keeps per HEAD (SR-082 AK4), with the warnings of the
// order in `SortValues.problems`. `element.list` reads them itself and passes them on, to show the warnings.
import type { CommandName, Problem } from "../catalog.js";
import type { Workspace } from "../runtime/workspace.js";
import type { View } from "../variants/index.js";
import { evidenceStatusState } from "./evidence.js";
import { versionTimesOf } from "./version-times.js";
import { inPerspective } from "./perspectives.js";
import { inSavedFilter, savedSort } from "./saved.js";
import type { Selected } from "./selection.js";
import type { ElementRecord } from "../model/index.js";
import type { SortedElements, SortValues } from "./sort.js";
import { checkSortKeys, sortElements, sortGroups } from "./sort.js";

/**
 * `selected.elements` in the order of `sort` for `command`, with the derivation tree when `sort`
 * starts with `hierarchy` (`sortElements`). Without `sort` (undefined), the first stored sort, also
 * an empty one: of the saved filter of the selection (SR-070 AK3: the same elements in the same
 * order), of the perspective (SR-213 AK5), of the perspective's saved filter; with none, the
 * workspace order. An explicit `sort`, also an empty one, wins over all of them. `values` are those of
 * `sortValuesFor` for the same `selected` and `sort`, read here when not given.
 */
export const orderedSelection = async (
  workspace: Workspace,
  selected: Selected,
  command: CommandName,
  sort: SortKeys | undefined,
  given?: SortValues,
): Promise<SortedElements> => {
  const values = given ?? (await sortValuesFor(workspace, selected, sort));
  return withSort(selected, sort, (keys, storedSort) =>
    sortElements({ ...selected, command, storedSort, values }, selected.elements, keys),
  );
};

const CORE: View = Object.freeze({ kind: "core" });

/**
 * What the sort of `orderedSelection` for the same `selected` and `sort` reads beyond the files (see the
 * file comment): an entry only for a key it holds, so a sort without one reads nothing more.
 */
export const sortValuesFor = async (
  workspace: Workspace,
  selected: Selected,
  sort: SortKeys | undefined,
): Promise<SortValues> => {
  const keys = withSort(selected, sort, (given) => given);
  const by = new Set(keys.map((key) => key.by));
  return {
    ...(by.has("verification") ? await verificationOf(workspace, selected) : {}),
    ...(by.has("versionDate") ? await versionDateOf(workspace, selected) : {}),
  };
};

const verificationOf = async (workspace: Workspace, selected: Selected): Promise<SortValues> => {
  const statuses = await workspace.get(evidenceStatusState);
  await statuses.ready?.();
  const view = selected.views[0] ?? CORE;
  return { verification: (element) => statuses.verification(element, view) };
};

const versionDateOf = async (workspace: Workspace, selected: Selected): Promise<SortValues> => {
  const { versionTimes, problems } = await versionTimesOf(workspace, selected.elements);
  return { versionDate: versionTimes, problems };
};

/** The warnings of the order in `values` (`sort.incomplete`), for the output of a command. */
export const sortProblems = (values: SortValues): readonly Problem[] => values.problems ?? [];

/** Checks the sort `orderedSelection` would use for the same input, without sorting (`checkSortKeys`). */
export const checkedSort = (selected: Selected, command: CommandName, sort: SortKeys | undefined): void => {
  withSort(selected, sort, (keys, storedSort) => {
    checkSortKeys({ ...selected, command, storedSort }, keys);
  });
};

/**
 * The groups of `selected` (`groupsOf` gives the groups of an element, of `count`), each in the
 * order `orderedSelection` gives for the same `sort`, with its own tree under `hierarchy` (`sortGroups`);
 * `values` are those of `sortValuesFor` for the same `selected` and `sort`.
 */
export const orderedGroups = (
  selected: Selected,
  command: CommandName,
  sort: SortKeys | undefined,
  groupsOf: (element: ElementRecord) => readonly number[],
  count: number,
  values: SortValues,
): SortedElements[] =>
  withSort(selected, sort, (keys, storedSort) =>
    sortGroups({ ...selected, command, storedSort, values }, selected.elements, keys, groupsOf, count),
  );

type SortKeys = Parameters<typeof sortElements>[2];

/**
 * Runs `run` with `sort`. Without it (undefined), with the first stored sort (see the file comment),
 * also an empty one, whose errors then name its file; with none, the workspace order. The sort of the
 * selection's filter counts as the input's sort, above the perspective's (SR-213 AK5).
 * `run` learns whether the keys come from a stored sort (`SortContext.storedSort`).
 */
const withSort = <T>(
  selected: Selected,
  sort: SortKeys | undefined,
  run: (keys: SortKeys, storedSort: boolean) => T,
): T => {
  if (sort !== undefined) {
    return run(sort, false);
  }
  const { filter, stored } = selected;
  const selectionSort = filter?.data.sort;
  if (filter !== undefined && selectionSort !== undefined) {
    return inSavedFilter(filter, () => run(savedSort(selectionSort), true));
  }
  if (stored === undefined) {
    return run([], false);
  }
  const { perspective, filter: its } = stored;
  const own = perspective.data.sort;
  if (own !== undefined) {
    return inPerspective(perspective, () => run(savedSort(own), true));
  }
  const itsSort = its?.data.sort;
  return its === undefined || itsSort === undefined
    ? run([], false)
    : inPerspective(perspective, () => inSavedFilter(its, () => run(savedSort(itsSort), true)));
};
