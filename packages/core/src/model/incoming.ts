// The incoming relation index (ADR-0008): for each target, every relation and inline reference
// that points at it. A relation is stored only in the file of its source (ADR-0004, D-040), so the
// elements that point at an element are found here instead of in a walk over the store (N-036).
// The trace block builds its children on it (`trace/graph.ts`: chain, related, cycles; SR-022,
// SR-023, SR-090), and SR-024 its affected elements.
//
// What counts (ADR-0004, D-012):
// - the items of every frontmatter key that holds relations (`relationKey`): relation kinds and
//   properties of kind `relation`, so validity and packages count too; a property wins over a
//   relation kind of the same key, as in every check. An item counts when it is a mapping with a
//   text `id` (`hasId`), as the element view and the missing-target check read it; its version and
//   other keys are not checked (their shape is SR-085's). A value of the wrong shape (one target
//   where a list belongs, or the reverse) has no items, as in `relationItems`;
// - the inline references of the text (`ElementRecord.references`, #240).
// A target is named by repository and UUID (D-058). A relation item without `repository` points into
// the source's own repository; one whose `repository` is not text names none and is left out (no
// record can lie there; `targetState` calls it `unknown-repository`). An inline reference names the
// repository it gives. Without one it points where `resolveReference` resolves it (#250): into the
// source's own repository when the UUID is there or nowhere; otherwise into the one other repository
// with the UUID (a link written before references named their repository), and, when several other
// repositories have it (`ambiguous`, which `referenceTargetState` reports), into each of them, so
// whoever asks for one of those elements (SR-024) still sees it.
//
// The index is raw: it also holds a source's relations to itself and relations to a UUID that
// several files of a repository share (SR-088); whoever reads it decides what they mean.
//
// Cost (ADR-0008): one pass over the store, over each element's own frontmatter keys and references,
// one small link object per relation (no path array: `relationPath` makes it when it is reported).
// At 50,000 elements and 200,000 relations this is bound by memory access (each record, value, item
// and UUID is touched once), so the index is keyed by the UUID strings the items already hold rather
// than by a composed key, and a walk reads the links it stored instead of the sources again.
import type { Metamodel } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { ElementRecord } from "./elements.js";
import type { TextReference } from "./references.js";
import { resolveReference } from "./references.js";
import type { RelationKey, TargetItem } from "./relation-keys.js";
import { hasId, relationKey } from "./relation-keys.js";
import type { ElementStore } from "./store.js";
import type { ValuePath } from "./values.js";

/** A relation in the frontmatter of `source` that points at a target. */
export interface IncomingRelation {
  readonly kind: "relation";
  /** The element whose file stores the relation. */
  readonly source: ElementRecord;
  /** The frontmatter key: a relation kind or a property of kind `relation` (`relationKey`). */
  readonly key: string;
  /** The position of the item in the list under `key`; undefined for a single target (`relationPath`). */
  readonly index: number | undefined;
  /** The item as written (the parsed object itself): a mapping with a text `id`; other keys unchecked. */
  readonly item: TargetItem;
  /** The repository the item points into (see the file comment). */
  readonly repository: string;
}

/**
 * Where a relation lies in its source's frontmatter: `[key, index]` for an item of a list, `[key]`
 * for a single target. The store keeps no YAML document, so a command that reports a line looks it
 * up from the path (`findingLocator`, `lineOf`).
 */
export const relationPath = ({ key, index }: Pick<IncomingRelation, "key" | "index">): ValuePath =>
  index === undefined ? [key] : [key, index];

/** An inline reference in the text of `source` that points at a target (SR-066). */
export interface IncomingReference {
  readonly kind: "reference";
  readonly source: ElementRecord;
  /**
   * The reference as the store keeps it, with the line of its link in the source's file. Where it
   * points (see the file comment) is decided when it is asked for (`incomingTo`): most references
   * name no repository, and resolving them all would cost a lookup each when the index is built.
   */
  readonly reference: TextReference;
}

/** A relation or an inline reference that points at a target. */
export type IncomingLink = IncomingRelation | IncomingReference;

/** The relations and inline references of one element store, by the UUID they name. */
export interface IncomingIndex {
  /** The store the index was built from. */
  readonly store: ElementStore;
  /** The metamodel it was built with: which keys hold relations. */
  readonly metamodel: Metamodel;
  /**
   * The relations by the UUID they name, whatever repository they point into (`repository`): in
   * store order of the sources, then per source in the order of its frontmatter keys, then by item.
   * A walk along relations (the chain) reads only these.
   */
  readonly relationsById: ReadonlyMap<string, readonly IncomingRelation[]>;
  /**
   * The inline references by the UUID they name, whatever repository they point into
   * (`incomingTo` decides it): in store order of the sources, then text order.
   */
  readonly referencesById: ReadonlyMap<string, readonly IncomingReference[]>;
}

/** Whether an inline reference of a source in `sourceRepository` points into `repository` (see the file comment). */
const pointsInto = (
  store: ElementStore,
  sourceRepository: string,
  reference: TextReference,
  repository: string,
): boolean => {
  if (reference.repository !== undefined) {
    return reference.repository === repository;
  }
  const match = resolveReference(store, sourceRepository, reference);
  switch (match.kind) {
    case "found":
      return match.element.repository === repository;
    case "ambiguous":
      return match.elements.some((element) => element.repository === repository);
    case "unknown":
      return sourceRepository === repository;
  }
};

/** The keys of a metamodel that hold relations, as `relationKey` defines them; one map per metamodel object. */
const relationKeyMaps = new WeakMap<Metamodel, ReadonlyMap<string, RelationKey>>();

const relationKeysOf = (metamodel: Metamodel): ReadonlyMap<string, RelationKey> => {
  let keys = relationKeyMaps.get(metamodel);
  if (keys === undefined) {
    const candidates = new Set([...metamodel.properties, ...metamodel.relations].map((d) => d.key));
    keys = new Map(
      [...candidates].flatMap((key) => {
        const relation = relationKey(metamodel, key);
        return relation === undefined ? [] : [[key, relation] as const];
      }),
    );
    relationKeyMaps.set(metamodel, keys);
  }
  return keys;
};

/**
 * The incoming relation index of `store`: one pass over its elements, their frontmatter keys that
 * hold relations and their inline references; no file read and no schema check (ADR-0008).
 */
export const buildIncomingIndex = (store: ElementStore, metamodel: Metamodel): IncomingIndex => {
  const keys = relationKeysOf(metamodel);
  const relationsById = new Map<string, IncomingRelation[]>();
  const referencesById = new Map<string, IncomingReference[]>();
  const add = <T>(byId: Map<string, T[]>, id: string, link: T): void => {
    const links = byId.get(id);
    if (links === undefined) {
      byId.set(id, [link]);
    } else {
      links.push(link);
    }
  };
  const addItem = (source: ElementRecord, key: string, index: number | undefined, item: unknown): void => {
    if (!hasId(item)) {
      return;
    }
    const named = item["repository"];
    const repository = named === undefined ? source.repository : named;
    if (typeof repository === "string") {
      add(relationsById, item.id, { kind: "relation", source, key, index, item, repository });
    }
  };
  for (const source of store.elements) {
    const { data } = source;
    for (const key of Object.keys(data)) {
      const relation = keys.get(key);
      if (relation === undefined) {
        continue;
      }
      const value: unknown = data[key];
      if (!Array.isArray(value)) {
        // One target; under a key with `many` it has none (SR-085 reports it).
        if (!relation.many) {
          addItem(source, key, undefined, value);
        }
      } else if (relation.many) {
        for (let index = 0; index < value.length; index += 1) {
          addItem(source, key, index, value[index]);
        }
      }
    }
    for (const reference of source.references ?? []) {
      add(referencesById, reference.id, { kind: "reference", source, reference });
    }
  }
  return { store, metamodel, relationsById, referencesById };
};

const NONE: readonly never[] = Object.freeze([]);

/**
 * The relations and inline references that point at the UUID `id` in `repository`: the relations in
 * the order of `IncomingIndex.relationsById`, then the references in the order of
 * `referencesById`. Raw: a source's relations to itself are included, and all records that share
 * the UUID in `repository` get the same links.
 */
export const incomingTo = (index: IncomingIndex, repository: string, id: string): IncomingLink[] => [
  ...(index.relationsById.get(id) ?? NONE).filter((link) => link.repository === repository),
  ...(index.referencesById.get(id) ?? NONE).filter((link) =>
    pointsInto(index.store, link.source.repository, link.reference, repository),
  ),
];

/**
 * The incoming relation indexes of a workspace, by the element store each was built from (with the
 * metamodel it was built with). Built on first use of a store by `incomingFor`, without a `get` of
 * any other state; an index is dropped with its store (a WeakMap, like the succession index). Not
 * carried over a change of the store (ADR-0008, #267): the first command after a save or a watcher
 * batch that needs it builds the index of the new store again.
 */
export const incomingState = defineWorkspaceState(
  "incoming",
  (): WeakMap<ElementStore, IncomingIndex> => new WeakMap(),
);

/**
 * The incoming relation index of `store` with `metamodel` from the workspace's memo, built when
 * there is none or it was built with another metamodel. Synchronous and without loading any state:
 * the caller reads store and metamodel once and derives everything from them (ADR-0008).
 */
export const incomingFor = (
  workspace: Workspace,
  store: ElementStore,
  metamodel: Metamodel,
): IncomingIndex => {
  const memo = workspace.get(incomingState);
  let index = memo.get(store);
  if (index?.metamodel !== metamodel) {
    index = buildIncomingIndex(store, metamodel);
    memo.set(store, index);
  }
  return index;
};
