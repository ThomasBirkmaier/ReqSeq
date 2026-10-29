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
// - the inline references of the text (`ElementRecord.references`, #240) and of the properties marked
//   `markdown` (`ElementRecord.propertyReferences`, SR-127; `referencesOf`).
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
//
// Carried over a change of the store (#184, #267): a save or a watcher batch derives the index of
// the new store from the old one (`carryIncomingIndex`, through the `carry` hook of `incomingState`)
// instead of building it again, so the first chain after a save does not pay the build (SR-082 AK4).
// Each list stays in the order a fresh build gives it; the order of the UUIDs in the maps is not
// defined (a carried index adds new ones last).
import type { Metamodel } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { ElementRecord } from "./elements.js";
import type { LinkedReference, TextReference } from "./references.js";
import { referencesOf, resolveReference } from "./references.js";
import type { RelationKey, TargetItem } from "./relation-keys.js";
import { hasId, relationKey } from "./relation-keys.js";
import type { ElementStore, StoreUpdate } from "./store.js";
import { byPath, carryStoreUpdate, elementStoreState } from "./store.js";
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
  readonly reference: LinkedReference;
}

/** A relation or an inline reference that points at a target. */
export type IncomingLink = IncomingRelation | IncomingReference;

/**
 * The relations and inline references of one element store, by the UUID they name. The order of
 * the UUIDs in the maps is not defined (a carried index adds new ones last); the order of each list
 * is.
 */
export interface IncomingIndex {
  /** The store the index was built from or carried over to. */
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

/** One map per metamodel object (`relationKeysOf`). */
const relationKeyMaps = new WeakMap<Metamodel, ReadonlyMap<string, RelationKey>>();

/** The keys of a metamodel that hold relations, as `relationKey` defines them, in the order properties, then relation kinds. */
export const relationKeysOf = (metamodel: Metamodel): ReadonlyMap<string, RelationKey> => {
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

/** Takes the links of one source, in the order of its frontmatter keys and items, then of its text. */
interface LinkSink {
  relation(id: string, link: IncomingRelation): void;
  reference(id: string, link: IncomingReference): void;
}

/** Gives every relation and inline reference of `source` that the index holds (see the file comment) to `sink`. */
const linksOf = (
  source: ElementRecord,
  keys: ReadonlyMap<string, RelationKey>,
  metamodel: Metamodel,
  sink: LinkSink,
): void => {
  const addItem = (key: string, index: number | undefined, item: unknown): void => {
    if (!hasId(item)) {
      return;
    }
    const named = item["repository"];
    const repository = named === undefined ? source.repository : named;
    if (typeof repository === "string") {
      sink.relation(item.id, { kind: "relation", source, key, index, item, repository });
    }
  };
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
        addItem(key, undefined, value);
      }
    } else if (relation.many) {
      for (let index = 0; index < value.length; index += 1) {
        addItem(key, index, value[index]);
      }
    }
  }
  for (const reference of referencesOf(source, metamodel)) {
    sink.reference(reference.id, { kind: "reference", source, reference });
  }
};

/** Appends `link` to the list of `id` in `byId`. */
const add = <T>(byId: Map<string, T[]>, id: string, link: T): void => {
  const links = byId.get(id);
  if (links === undefined) {
    byId.set(id, [link]);
  } else {
    links.push(link);
  }
};

/** A sink that appends each link to the list of the UUID it names. */
const collector = (
  relationsById: Map<string, IncomingRelation[]>,
  referencesById: Map<string, IncomingReference[]>,
): LinkSink => ({
  relation: (id, link) => {
    add(relationsById, id, link);
  },
  reference: (id, link) => {
    add(referencesById, id, link);
  },
});

/**
 * The incoming relation index of `store`: one pass over its elements, their frontmatter keys that
 * hold relations and their inline references; no file read and no schema check (ADR-0008).
 */
export const buildIncomingIndex = (store: ElementStore, metamodel: Metamodel): IncomingIndex => {
  const keys = relationKeysOf(metamodel);
  const relationsById = new Map<string, IncomingRelation[]>();
  const referencesById = new Map<string, IncomingReference[]>();
  const sink = collector(relationsById, referencesById);
  for (const source of store.elements) {
    linksOf(source, keys, metamodel, sink);
  }
  return { store, metamodel, relationsById, referencesById };
};

/**
 * The relations and inline references of `source` that an index of `metamodel` holds, in the order
 * of its frontmatter keys and items, then of its text: what a source points at (SR-092).
 */
export const outgoingLinks = (source: ElementRecord, metamodel: Metamodel): IncomingLink[] => {
  const links: IncomingLink[] = [];
  const push = (_id: string, link: IncomingLink): void => {
    links.push(link);
  };
  linksOf(source, relationKeysOf(metamodel), metamodel, { relation: push, reference: push });
  return links;
};

const NONE: readonly never[] = Object.freeze([]);

/**
 * One list of the index before a change (`links`) without the links whose source lies in a changed
 * file, merged with `added`, the links of the records in the changed files after it (in store
 * order), by the store order of their sources (`before`). No source is in both, so the list is in
 * the order a fresh build gives it.
 */
const carriedList = <T extends IncomingLink>(
  links: readonly T[],
  added: readonly T[],
  changed: (source: ElementRecord) => boolean,
  before: (a: ElementRecord, b: ElementRecord) => boolean,
): T[] => {
  const out: T[] = [];
  const rest = added.values();
  let head = rest.next();
  for (const link of links) {
    if (changed(link.source)) {
      continue;
    }
    while (head.done !== true && before(head.value.source, link.source)) {
      out.push(head.value);
      head = rest.next();
    }
    out.push(link);
  }
  for (; head.done !== true; head = rest.next()) {
    out.push(head.value);
  }
  return out;
};

/**
 * A copy of `byId` with the lists of the UUIDs in `affected` carried over (`carriedList`); a UUID
 * whose list comes out empty is left out, as a fresh build has no list for it.
 */
const carriedMap = <T extends IncomingLink>(
  byId: ReadonlyMap<string, readonly T[]>,
  affected: ReadonlySet<string>,
  added: ReadonlyMap<string, readonly T[]>,
  changed: (source: ElementRecord) => boolean,
  before: (a: ElementRecord, b: ElementRecord) => boolean,
): ReadonlyMap<string, readonly T[]> => {
  const next = new Map(byId);
  for (const id of affected) {
    const links = carriedList(byId.get(id) ?? NONE, added.get(id) ?? NONE, changed, before);
    if (links.length === 0) {
      next.delete(id);
    } else {
      next.set(id, links);
    }
  }
  return next;
};

/**
 * The incoming relation index of `update.to`, carried over from `index`, the index of `update.from`
 * (a save or a watcher batch; #184, #267): the links whose source lies in a changed file
 * (`StoreUpdate.files`) are dropped, the links of the records in those files now are added, and
 * every other list and link is kept as the same object. `index` itself is not changed. Each list is
 * in the order a fresh build gives it; the maps themselves may name their UUIDs in another order (a
 * UUID that was not in `index` comes last). The records of the changed files, before and after, are
 * those of `StoreUpdate.ids` that lie in them (`storeUpdate` names the UUIDs of both). Costs a copy
 * of both maps plus the lists of the UUIDs that these records point at (N-036).
 */
export const carryIncomingIndex = (index: IncomingIndex, update: StoreUpdate): IncomingIndex => {
  const keys = relationKeysOf(index.metamodel);
  const inChangedFile = (source: ElementRecord): boolean =>
    update.files.get(source.repository)?.has(source.file) === true;
  const recordsIn = (store: ElementStore): ElementRecord[] =>
    [...update.ids].flatMap((id) => (store.byId.get(id) ?? NONE).filter(inChangedFile));
  // The sources of the lists before the change that lie in a changed file: by object, cheaper than
  // by repository and file for each link of a long list (a variant that every element names).
  const replaced = new Set(recordsIn(update.from));
  const changed = (source: ElementRecord): boolean => replaced.has(source);
  // Every source lies in a repository of the store, so `order` has it (`storeUpdate`: the same
  // repositories before and after, in the same order).
  const order = new Map(update.repositories.map((contents, at) => [contents.repository, at]));
  const before = (a: ElementRecord, b: ElementRecord): boolean =>
    a.repository === b.repository
      ? byPath(a.file, b.file) < 0
      : Number(order.get(a.repository)) < Number(order.get(b.repository));
  // The UUIDs the changed files pointed at before and point at now.
  const affected = new Set<string>();
  const note: LinkSink = {
    relation: (id) => {
      affected.add(id);
    },
    reference: (id) => {
      affected.add(id);
    },
  };
  for (const source of replaced) {
    linksOf(source, keys, index.metamodel, note);
  }
  const relations = new Map<string, IncomingRelation[]>();
  const references = new Map<string, IncomingReference[]>();
  const sink = collector(relations, references);
  for (const source of recordsIn(update.to).sort((a, b) => Number(before(b, a)) - Number(before(a, b)))) {
    linksOf(source, keys, index.metamodel, sink);
  }
  for (const id of [...relations.keys(), ...references.keys()]) {
    affected.add(id);
  }
  return {
    store: update.to,
    metamodel: index.metamodel,
    relationsById: carriedMap(index.relationsById, affected, relations, changed, before),
    referencesById: carriedMap(index.referencesById, affected, references, changed, before),
  };
};

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
 * The most UUIDs a store change may name (`StoreUpdate.ids`, before and after) for the index to be
 * carried over it. The carry runs inside `Workspace.replace`, in the thread that serves commands, and
 * costs a fixed 30 to 50 ms (copying both maps) plus about 0.1 ms per changed record at N-036
 * (50,000 elements, 200,000 relations, local runs: 0.13 to 0.25 s for 1,000, about 0.2 s for 2,000,
 * 0.3 to 0.4 s for 5,000, 1 s for all), while a build takes 0.3 to 0.5 s. Above the limit the new
 * store gets no index, and the next chain builds it, outside the change (#273). The same 1,000
 * files as the read pool's threshold for a watcher batch (ADR-0008).
 */
export const CARRY_LIMIT = 1_000;

/**
 * The incoming relation indexes of a workspace, by the element store each was built from (with the
 * metamodel it was built with). Built on first use of a store by `incomingFor`, without a `get` of
 * any other state; an index is dropped with its store (a WeakMap). Carried over a change of the
 * store (ADR-0008, #184, #267): when a save or a watcher batch replaces a store that has an index,
 * the index of the new store is derived from it (`carryIncomingIndex`) and added to the same memo,
 * so the next chain finds it ready; the index of the old store stays for a command that still holds
 * that store. A store without an index gets none (nothing is built for a save), and so does a store
 * after a change of more than `CARRY_LIMIT` UUIDs (a pull, a checkout): the next chain builds it.
 * Any other change of the store (a reset, a full read) drops the memo.
 */
export const incomingState = defineWorkspaceState(
  "incoming",
  (): WeakMap<ElementStore, IncomingIndex> => new WeakMap(),
  {
    dependsOn: [elementStoreState],
    carry: carryStoreUpdate((memo, update) => {
      const index = memo.get(update.from);
      if (index !== undefined && update.ids.size <= CARRY_LIMIT) {
        memo.set(update.to, carryIncomingIndex(index, update));
      }
      return memo;
    }),
  },
);

/**
 * The incoming relation index of `store` with `metamodel` from the workspace's memo, built when
 * there is none or it was built with another metamodel. Synchronous and without loading any state:
 * the caller reads store and metamodel once and derives everything from them (ADR-0008).
 */
export const incomingFor = (workspace: Workspace, store: ElementStore, metamodel: Metamodel): IncomingIndex =>
  incomingIn(workspace.get(incomingState), store, metamodel);

/**
 * The incoming relation index of `store` with `metamodel` from `memo` (the value of `incomingState`),
 * built and kept there when there is none or it was built with another metamodel. For a caller that
 * took the memo earlier, as a carry hook does inside `Workspace.replace` (#698).
 */
export const incomingIn = (
  memo: WeakMap<ElementStore, IncomingIndex>,
  store: ElementStore,
  metamodel: Metamodel,
): IncomingIndex => {
  let index = memo.get(store);
  if (index?.metamodel !== metamodel) {
    index = buildIncomingIndex(store, metamodel);
    memo.set(store, index);
  }
  return index;
};
