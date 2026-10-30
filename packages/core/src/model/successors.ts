// The successors of a superseded element (SR-072 AK3, D-045): the element view names them, and the
// superseded element has no relation to them. A successor is the source of a relation of a kind
// with the meaning `succession` (D-059) to an element whose status the metamodel marks invalid
// (D-044, ADR-0004), whichever command or person set that status. The relations are read where
// they are stored, in the successors' files, the way the element view reads its own relations
// (`relationItems`, `hasId`, `isUuid`), so a target without a version or with another key still
// names its successor; its shape is the value-kind check's (SR-085). The AK2 hints
// (`superseded.ts`) read only items that are complete relation targets (`isRelationTarget`).
//
// A view does a lookup instead of a walk over the store (N-036): in the incoming relation index of
// ADR-0008 when the workspace has it for the store (a chain ran, and saves carry it; #272), else in
// the succession index, collected once per element store (`successionIndexState`) by the repository
// and UUID the relations point at. The succession index costs about 23 ms per store and is not
// carried; building the incoming index for a view would cost 0.3 to 0.5 s.
import type { MetamodelRelationKind } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { relationKindsWithMeaning } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { ElementRecord } from "./elements.js";
import { isUuid } from "./elements.js";
import type { IncomingIndex } from "./incoming.js";
import { incomingState } from "./incoming.js";
import type { TargetItem } from "./relation-keys.js";
import { hasId, relationItems, relationKey } from "./relation-keys.js";
import { resolveTarget } from "./relations.js";
import type { ElementStore } from "./store.js";
import { invalidStatuses } from "./superseded.js";

/** One relation from a successor: `item` is an item of the list under `kind.key` in `source`. */
export interface Succession {
  readonly source: ElementRecord;
  readonly kind: MetamodelRelationKind;
  readonly item: TargetItem;
}

/** The relations with the meaning `succession` of one element store, by the target they name. */
export interface SuccessionIndex {
  /** The store the index was built from. */
  readonly store: ElementStore;
  /** The metamodel it was built with: its relation kinds with the meaning `succession`. */
  readonly metamodel: Metamodel;
  /** By `targetKey` of the target's repository and UUID, in store order, then relation kind, then item. */
  readonly byTarget: ReadonlyMap<string, readonly Succession[]>;
}

const targetKey = (repository: string, id: string): string => `${repository}\0${id}`;

const placeOf = (record: ElementRecord): string => `${record.repository}\0${record.file}`;

/**
 * Every item with a UUID under a relation kind with the meaning `succession`, by the repository it
 * names (the source's own when it names none; an item whose `repository` is not text names none)
 * and its UUID. One pass over the store: about 4 relation kinds' keys per element, no schema check.
 */
export const buildSuccessionIndex = (store: ElementStore, metamodel: Metamodel): SuccessionIndex => {
  const kinds = relationKindsWithMeaning(metamodel, "succession");
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
): readonly Succession[] =>
  succeeds(index.store, metamodel, record)
    ? othersThan(record, index.byTarget.get(targetKey(record.repository, record.id)) ?? [])
    : [];

/** Whether `record` can have successors in `store`: its status is marked invalid and it resolves to one element. */
const succeeds = (store: ElementStore, metamodel: Metamodel, record: ElementRecord): boolean =>
  invalidStatuses(metamodel).has(String(record.data["status"])) &&
  resolveTarget(store, record.repository, { id: record.id }).kind === "found";

/** The successions from files other than `record`'s. */
const othersThan = (record: ElementRecord, successions: readonly Succession[]): readonly Succession[] => {
  const place = placeOf(record);
  return successions.filter((s) => placeOf(s.source) !== place);
};

/**
 * The relations with the meaning `succession` among the incoming relations of `record`'s
 * repository and UUID in `incoming`, as `buildSuccessionIndex` collects them: in store order, then
 * relation kind (metamodel order), then item. Undefined when the index cannot tell: it holds the
 * items of a succession kind's key only when that key is a list of relations (`relationKey`; keys
 * are unique across properties and relation kinds, ADR-0004).
 */
const fromIncoming = (
  incoming: IncomingIndex,
  kinds: readonly MetamodelRelationKind[],
  record: ElementRecord,
): readonly Succession[] | undefined => {
  if (kinds.some((kind) => relationKey(incoming.metamodel, kind.key)?.many !== true)) {
    return undefined;
  }
  const ranked = new Map(kinds.map((kind, at) => [kind.key, { kind, at }]));
  /** The successions of each source, the sources in store order (the order of the index's list). */
  const bySource = new Map<
    ElementRecord,
    { readonly at: number; readonly item: number; readonly succession: Succession }[]
  >();
  for (const link of incoming.relationsById.get(record.id) ?? []) {
    const rank = ranked.get(link.key);
    if (rank === undefined || link.repository !== record.repository || !isUuid(link.item.id)) {
      continue;
    }
    const list = bySource.get(link.source) ?? [];
    list.push({
      at: rank.at,
      item: Number(link.index),
      succession: { source: link.source, kind: rank.kind, item: link.item },
    });
    bySource.set(link.source, list);
  }
  return [...bySource.values()].flatMap((list) =>
    list.sort((a, b) => a.at - b.at || a.item - b.item).map((entry) => entry.succession),
  );
};

/**
 * The successions of `record` as `store` holds them, for a view built on `store` with `metamodel`
 * (`ElementViewInput.successions`): from the incoming relation index of that store when the
 * workspace has it (#272), else from the workspace's succession index of that store, built when
 * there is none or it was built with another metamodel. Synchronous and without loading any state,
 * so it cannot fail after a command wrote its file. Builds no index when `record`'s status is valid,
 * and never the incoming one.
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
  const incoming = workspace.peek(incomingState)?.get(store);
  if (incoming?.metamodel === metamodel) {
    const found = succeeds(store, metamodel, record)
      ? fromIncoming(incoming, relationKindsWithMeaning(metamodel, "succession"), record)
      : [];
    if (found !== undefined) {
      return othersThan(record, found);
    }
  }
  const memo = workspace.get(successionIndexState);
  let index = memo.get(store);
  if (index?.metamodel !== metamodel) {
    index = buildSuccessionIndex(store, metamodel);
    memo.set(store, index);
  }
  return successionsOf(index, metamodel, record);
};
