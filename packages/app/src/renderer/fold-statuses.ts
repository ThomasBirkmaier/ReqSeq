// Elements in chosen statuses stand at the end of a list, in a section that is collapsed at first (SR-201).
// Which statuses fold is display state of the app, chosen by the user with "Fold status in lists": kept
// in the app's own local storage for this user on this computer, the same for every workspace, never in a
// file of a workspace and not through a catalog command (AK4; SR-080 AK1: "außer reiner Darstellung der
// App", as `recent.ts`). Without a choice, every status the metamodel flags invalid folds (AK1). The list
// asks core twice, with the selection without these statuses and with only them (`foldedSelections`), so
// the order and the paging stay core's (N-036).
import { createContext, useContext } from "react";
import type { ElementSelection, FilterCondition, FilterSortKeyWithDefaults } from "@reqseq/core";
import type { RecentStorage } from "./recent.js";

/** The statuses chosen to fold, by key; undefined: none chosen, the invalid ones fold. */
export type FoldChoice = readonly string[] | undefined;

/** The storage key: one choice for every workspace (AK4). */
export const FOLD_KEY = "reqseq.fold-statuses.v1";

/** The condition the folded elements meet; undefined when nothing folds (every status chosen away). */
export const foldCondition = (choice: FoldChoice): FilterCondition | undefined => {
  if (choice === undefined) {
    return { invalid: true };
  }
  return choice.length === 0 ? undefined : { status: [...choice] as [string, ...string[]] };
};

/** What the lists of the window fold (`foldCondition` of the user's choice), read by `ListView`. */
export const FoldStatuses = createContext<FilterCondition | undefined>(undefined);

export const useFoldCondition = (): FilterCondition | undefined => useContext(FoldStatuses);

/** A tree (SR-075) keeps every element at its place in the hierarchy: nothing folds there. */
export const folds = (sort: readonly FilterSortKeyWithDefaults[] | undefined): boolean =>
  sort?.[0]?.by !== "hierarchy";

/** `selection` with `condition` added to what must hold. */
const narrowed = (selection: ElementSelection | undefined, condition: FilterCondition): ElementSelection => {
  const where = selection?.where;
  return { ...selection, where: where === undefined ? condition : { all: [where, condition] } };
};

/** The selection of the rows in place and that of the folded section at the end. */
export const foldedSelections = (
  selection: ElementSelection | undefined,
  condition: FilterCondition,
): { readonly shown: ElementSelection; readonly folded: ElementSelection } => ({
  shown: narrowed(selection, { not: condition }),
  folded: narrowed(selection, condition),
});

const isKeys = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((key) => typeof key === "string");

/** The stored choice; none for broken content or a storage that throws. */
export const loadFoldChoice = (storage: () => RecentStorage): FoldChoice => {
  try {
    const stored = storage().getItem(FOLD_KEY);
    if (stored === null) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(stored);
    return isKeys(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/** Stores the choice, or (undefined) drops it. A storage that fails is ignored: the choice holds until the app quits. */
export const saveFoldChoice = (
  storage: () => RecentStorage & Pick<Storage, "removeItem">,
  choice: FoldChoice,
): void => {
  try {
    if (choice === undefined) {
      storage().removeItem(FOLD_KEY);
    } else {
      storage().setItem(FOLD_KEY, JSON.stringify(choice));
    }
  } catch {
    // Not kept for the next start.
  }
};

/** A status of the metamodel, as `metamodel.get` gives it. */
export interface FoldStatus {
  readonly key: string;
  readonly name: string;
  readonly invalid?: boolean;
}

/** The keys that fold now: the chosen ones, else the invalid statuses of the metamodel. */
export const foldedKeys = (choice: FoldChoice, statuses: readonly FoldStatus[]): readonly string[] =>
  choice ?? statuses.filter((status) => status.invalid === true).map((status) => status.key);

/** The choice after `key` was chosen or chosen away (AK2), in metamodel order, from what folds now. */
export const toggledChoice = (
  choice: FoldChoice,
  statuses: readonly FoldStatus[],
  key: string,
): readonly string[] => {
  const now = foldedKeys(choice, statuses);
  const next = now.includes(key) ? now.filter((known) => known !== key) : [...now, key];
  const order = statuses.map((status) => status.key);
  const at = (known: string): number => {
    const index = order.indexOf(known);
    return index === -1 ? order.length : index;
  };
  return [...next].sort((a, b) => at(a) - at(b));
};
