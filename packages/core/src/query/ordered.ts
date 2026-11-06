// The order of a selection (SR-070 AK3, SR-075): the elements of `resolveSelection` sorted by the
// `sort` of the input; without `sort`, by the sort of the saved filter the selection names. The one
// place that decides it, so `element.list` and `trace.matrix` give the same order for the same
// selection and sort (SR-125 AK1); `orderedGroups` gives the same order inside each group (SR-149 AK3).
import type { CommandName } from "../catalog.js";
import { inSavedFilter, savedSort } from "./saved.js";
import type { Selected } from "./selection.js";
import type { ElementRecord } from "../model/index.js";
import type { SortedElements } from "./sort.js";
import { sortElements, sortGroups } from "./sort.js";

/**
 * `selected.elements` in the order of `sort` for `command`, with the derivation tree when `sort`
 * starts with `hierarchy` (`sortElements`). Without `sort` (undefined), a saved filter's own sort
 * holds (SR-070 AK3: the same elements in the same order); an explicit `sort`, also an empty one,
 * wins over it.
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

/** Runs `run` with `sort`, or without it with the saved filter's sort, whose errors then name the filter. */
const withSort = <T>(selected: Selected, sort: SortKeys | undefined, run: (keys: SortKeys) => T): T => {
  const { filter } = selected;
  return sort === undefined && filter !== undefined
    ? inSavedFilter(filter, () => run(savedSort(filter)))
    : run(sort ?? []);
};
