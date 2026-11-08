// The context menu of a list outside its rows (SR-198): on the heading and the other lines of a list, a
// search or the elements of a package page. Its entries are the list actions (`list-actions.ts`), which act
// on the shown list as from the command prompt. Display only: the view marks the place, the actions do the
// work.
import type { MenuEntry, MenuHit } from "./context-menu.js";

/** The mark of a grouped list, set by the list on its place `list` (SR-149). */
export const GROUPED = "data-grouped";

/** The list pressed is grouped: its menu offers "Ungroup list" in place of "Group list" (SR-198 AK1). */
const grouped = (hit: MenuHit): boolean =>
  hit.target.closest('[data-menu="list"]')?.hasAttribute(GROUPED) === true;

/**
 * The entries of a list (SR-198 AK1), in this order. Each is shown only where the prompt offers it: a
 * search is not sorted, a package page has no groups, "Ungroup list" only on a grouped list and "Clear all
 * list filters" only on a filtered one.
 */
export const LIST_MENU: readonly MenuEntry[] = [
  { id: "filter-type" },
  { id: "filter-status" },
  { id: "filter-text" },
  { id: "sort" },
  { id: "group", when: (hit) => !grouped(hit) },
  { id: "ungroup" },
  { id: "clear-filters" },
];
