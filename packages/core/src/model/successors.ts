// The successors of a superseded element (SR-072 AK3, D-045): the element view names them, and the
// superseded element has no relation to them. A successor is the source of a relation of a kind
// with the meaning `replacement` (D-059) to an element whose status the metamodel marks invalid
// (D-044, ADR-0004), whichever command or person set that status. The relations are read where
// they are stored, in the successors' files, the way the element view reads its own relations
// (`relationItems`, `hasId`, `isUuid`), so a target without a version or with another key still
// names its successor; its shape is the value-kind check's (SR-085). The AK2 hints
// (`superseded.ts`) read only items that are complete relation targets (`isRelationTarget`).
//
// The relations are collected once per element store (`successionIndexState`), by the repository
// and UUID they point at, so a view does a lookup instead of a walk over the store (N-036; until the
// incoming relation index of ADR-0008 exists).
import type { MetamodelRelationKind } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { relationKindsWithMeaning } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { ElementRecord } from "./elements.js";
import { isUuid } from "./elements.js";
import type { TargetItem } from "./relation-keys.js";
import { hasId, relationItems } from "./relation-keys.js";
import { resolveTarget } from "./relations.js";
import type { ElementStore } from "./store.js";
import { invalidStatuses } from "./superseded.js";

/** One relation from a successor: `item` is an item of the list under `kind.key` in `source`. */
export interface Succession {
  readonly source: ElementRecord;
  readonly kind: MetamodelRelationKind;
  readonly item: TargetItem;
}

/** The relations with the meaning `replacement` of one element store, by the target they name. */
export interface SuccessionIndex {
  /** The store the index was built from. */
  readonly store: ElementStore;
  /** The metamodel it was built with: its relation kinds with the meaning `replacement`. */
  readonly metamodel: Metamodel;
  /** By `targetKey` of the target's repository and UUID, in store order, then relation kind, then item. */
  readonly byTarget: ReadonlyMap<string, readonly Succession[]>;
}

const targetKey = (repository: string, id: string): string => `${repository}\0${id}`;

const placeOf = (record: ElementRecord): string => `${record.repository}\0${record.file}`;

/**
 * Every item with a UUID under a relation kind with the meaning `replacement`, by the repository it
 * names (the source's own when it names none; an item whose `repository` is not text names none)
 * and its UUID. One pass over the store: about 4 relation kinds' keys per element, no schema check.
 */
export const buildSuccessionIndex = (store: ElementStore, metamodel: Metamodel): SuccessionIndex => {
  const kinds = relationKindsWithMeaning(metamodel, "replacement");
  const byTarget = new Map<string, Succession[]>();
  for (const source of store.elements) {
    for (const kind of kinds) {
      for (const [, item] of relationItems(kind.key, { many: true }, source.data[kind.key])) {
        if (!hasId(item) || !isUuid(item.id)) {
          continue;
        }
        const repository = item["repository"] === undefined ? source.repository : item["repository"];
        if (typeof repository !== "string") {
          continue;
        }
        const key = targetKey(repository, item.id);
        const list = byTarget.get(key) ?? [];
        list.push({ source, kind, item });
        byTarget.set(key, list);
      }
    }
  }
  return { store, metamodel, byTarget };
};

/**
 * The succession indexes of a workspace, by the element store each was built from (with the
 * metamodel it was built with). Built on first use of a store by `successionsFor`, without a `get`
 * of any other state, so a view after a write never reloads the workspace; an index is dropped with
 * its store (a WeakMap, like the unreadable files of `missing-targets.ts`). Not carried over a
 * change of the store (ADR-0008): the first view of a superseded element after a save or a watcher
 * batch builds the index of the new store again (one pass, about 23 ms at 50,000 elements), while
 * views of elements with a valid status never build one.
 */
export const successionIndexState = defineWorkspaceState(
  "successions",
  (): WeakMap<ElementStore, SuccessionIndex> => new WeakMap(),
);

/**
 * The relations that name the successors of `record` in `index` (SR-072 AK3): none unless its
 * status is marked invalid and its repository has exactly one element with its UUID (a missing or
 * ambiguous target is another check, SR-089, SR-088); otherwise the relations to its repository
 * and UUID from other files, in store order, then relation kind, then item. `record` need not be
 * the store's copy (a file just written).
 */
export const successionsOf = (
  index: SuccessionIndex,
  metamodel: Metamodel,
  record: ElementRecord,
): readonly Succession[] => {
  if (
    !invalidStatuses(metamodel).has(String(record.data["status"])) ||
    resolveTarget(index.store, record.repository, { id: record.id }).kind !== "found"
  ) {
    return [];
  }
  const place = placeOf(record);
  return (index.byTarget.get(targetKey(record.repository, record.id)) ?? []).filter(
    (s) => placeOf(s.source) !== place,
  );
};

/**
 * The successions of `record` as `store` holds them, for a view built on `store` with `metamodel`
 * (`ElementViewInput.successions`): from the workspace's index of that store, built when there is
 * none or it was built with another metamodel. Synchronous and without loading any state, so it
 * cannot fail after a command wrote its file. Builds no index when `record`'s status is valid.
 */
export const successionsFor = (
  workspace: Workspace,
  store: ElementStore,
  metamodel: Metamodel,
  record: ElementRecord,
): readonly Succession[] => {
  if (!invalidStatuses(metamodel).has(String(record.data["status"]))) {
    return [];
  }
  const memo = workspace.get(successionIndexState);
  let index = memo.get(store);
  if (index?.metamodel !== metamodel) {
    index = buildSuccessionIndex(store, metamodel);
    memo.set(store, index);
  }
  return successionsOf(index, metamodel, record);
};
