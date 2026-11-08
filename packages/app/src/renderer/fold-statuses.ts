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

/**
 * What the user chose, as a change of the default: statuses that fold although the metamodel does not flag
 * them invalid (`fold`), and invalid ones that stay in place (`unfold`), by key. Kept as a change, so a
 * workspace with other invalid statuses folds its own, and keys of other workspaces stay as they were;
 * undefined: no choice, the invalid statuses fold.
 */
export type FoldChoice = { readonly fold: readonly string[]; readonly unfold: readonly string[] } | undefined;

/** The storage key: one choice for every workspace (AK4). */
export const FOLD_KEY = "reqseq.fold-statuses.v1";

/** A status of the metamodel, as `metamodel.get` gives it. */
export interface FoldStatus {
  readonly key: string;
  readonly name: string;
  readonly invalid?: boolean;
}

/** The keys of the statuses of this metamodel that fold now, in metamodel order. */
export const foldedKeys = (choice: FoldChoice, statuses: readonly FoldStatus[]): readonly string[] =>
  statuses
    .filter((status) =>
      status.invalid === true
        ? !(choice?.unfold.includes(status.key) ?? false)
        : (choice?.fold.includes(status.key) ?? false),
    )
    .map((status) => status.key);

/** The condition the folded elements meet; undefined when no status of this metamodel folds. */
export const foldCondition = (
  choice: FoldChoice,
  statuses: readonly FoldStatus[],
): FilterCondition | undefined => {
  const [first, ...rest] = foldedKeys(choice, statuses);
  return first === undefined ? undefined : { status: [first, ...rest] };
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

const isChoice = (value: unknown): value is NonNullable<FoldChoice> =>
  typeof value === "object" &&
  value !== null &&
  isKeys((value as Record<string, unknown>)["fold"]) &&
  isKeys((value as Record<string, unknown>)["unfold"]);

/** The stored choice; none for broken content or a storage that throws. */
export const loadFoldChoice = (storage: () => RecentStorage): FoldChoice => {
  try {
    const parsed: unknown = JSON.parse(storage().getItem(FOLD_KEY) ?? "null");
    return isChoice(parsed) ? { fold: parsed.fold, unfold: parsed.unfold } : undefined;
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

/**
 * The choice after the status `key` was chosen or chosen away (AK2): it folds, or its elements go back in
 * place; no change of the default is no choice.
 */
export const toggledChoice = (
  choice: FoldChoice,
  statuses: readonly FoldStatus[],
  key: string,
): FoldChoice => {
  const fold = choice?.fold ?? [];
  const unfold = choice?.unfold ?? [];
  const invalid = statuses.some((status) => status.key === key && status.invalid === true);
  const folded = foldedKeys(choice, statuses).includes(key);
  const without = (keys: readonly string[]): readonly string[] => keys.filter((known) => known !== key);
  const next = {
    fold: folded || invalid ? without(fold) : [...fold, key],
    unfold: folded && invalid ? [...without(unfold), key] : without(unfold),
  };
  return next.fold.length === 0 && next.unfold.length === 0 ? undefined : next;
};
