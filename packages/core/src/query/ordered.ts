// The order of a selection (SR-070 AK3, SR-075): the elements of `resolveSelection` sorted by the
// `sort` of the input; without `sort`, by the first stored sort of: the saved filter the selection
// names, the perspective given beside it (SR-213 AK5), the saved filter of the perspective. The one
// place that decides it, so `element.list` and `trace.matrix` give the same order for the same
// selection and sort (SR-125 AK1); `orderedGroups` gives the same order inside each group (SR-149 AK3).
import type { CommandName } from "../catalog.js";
import { inPerspective } from "./perspectives.js";
import { inSavedFilter, savedSort } from "./saved.js";
import type { Selected } from "./selection.js";
import type { ElementRecord } from "../model/index.js";
import type { SortedElements } from "./sort.js";
import { sortElements, sortGroups } from "./sort.js";

/**
 * `selected.elements` in the order of `sort` for `command`, with the derivation tree when `sort`
 * starts with `hierarchy` (`sortElements`). Without `sort` (undefined), the first stored sort, also
 * an empty one: of the saved filter of the selection (SR-070 AK3: the same elements in the same
 * order), of the perspective (SR-213 AK5), of the perspective's saved filter; with none, the
 * workspace order. An explicit `sort`, also an empty one, wins over all of them.
 */
export const orderedSelection = (
  selected: Selected,
  command: CommandName,
  sort: SortKeys | undefined,
): SortedElements =>
  withSort(selected, sort, (keys) => sortElements({ ...selected, command }, selected.elements, keys));

/**
 * The groups of `selected` (`groupsOf` gives the groups of an element, of `count`), each in the
 * order `orderedSelection` gives for the same `sort`, with its own tree under `hierarchy` (`sortGroups`).
 */
export const orderedGroups = (
  selected: Selected,
  command: CommandName,
  sort: SortKeys | undefined,
  groupsOf: (element: ElementRecord) => readonly number[],
  count: number,
): SortedElements[] =>
  withSort(selected, sort, (keys) =>
    sortGroups({ ...selected, command }, selected.elements, keys, groupsOf, count),
  );

type SortKeys = Parameters<typeof sortElements>[2];

/**
 * Runs `run` with `sort`. Without it (undefined), with the first stored sort (see the file comment),
 * also an empty one, whose errors then name its file; with none, the workspace order. The sort of the
 * selection's filter ranks as the input's, above the perspective's (assumption, question #1627).
 */
const withSort = <T>(selected: Selected, sort: SortKeys | undefined, run: (keys: SortKeys) => T): T => {
  if (sort !== undefined) {
    return run(sort);
  }
  const { filter, stored } = selected;
  if (filter?.data.sort !== undefined) {
    return inSavedFilter(filter, () => run(savedSort(filter)));
  }
  if (stored === undefined) {
    return run([]);
  }
  const { perspective, filter: its } = stored;
  const own = perspective.data.sort;
  if (own !== undefined) {
    return inPerspective(perspective, () => run(own.map((key) => ({ ...key, order: key.order ?? "asc" }))));
  }
  return its?.data.sort === undefined
    ? run([])
    : inPerspective(perspective, () => inSavedFilter(its, () => run(savedSort(its))));
};
