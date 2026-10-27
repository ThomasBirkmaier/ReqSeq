// The order of a selection (SR-070 AK3, SR-075): the elements of `resolveSelection` sorted by the
// `sort` of the input; without `sort`, by the sort of the saved filter the selection names. The one
// place that decides it, so `element.list` and `trace.matrix` give the same order for the same
// selection and sort (SR-125 AK1).
import type { CommandName } from "../catalog.js";
import { inSavedFilter, savedSort } from "./saved.js";
import type { Selected } from "./selection.js";
import type { SortedElements } from "./sort.js";
import { sortElements } from "./sort.js";

/**
 * `selected.elements` in the order of `sort` for `command`, with the derivation tree when `sort`
 * starts with `hierarchy` (`sortElements`). Without `sort` (undefined), a saved filter's own sort
 * holds (SR-070 AK3: the same elements in the same order); an explicit `sort`, also an empty one,
 * wins over it.
 */
export const orderedSelection = (
  selected: Selected,
  command: CommandName,
  sort: Parameters<typeof sortElements>[2] | undefined,
): SortedElements => {
  const { filter } = selected;
  return sort === undefined && filter !== undefined
    ? inSavedFilter(filter, () =>
        sortElements({ ...selected, command }, selected.elements, savedSort(filter)),
      )
    : sortElements({ ...selected, command }, selected.elements, sort ?? []);
};
