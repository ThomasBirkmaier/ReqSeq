// Short IDs (D-017, D-056, SR-084): how the tool shows the UUID of an element. The prefix of its type,
// a dash and the last hex digits of the UUID without dashes: at least 6, more until no other element
// of the workspace has a UUID that ends the same way. Only the display grows; the file name keeps the
// prefix and the 12 digits it got when the element was created and never changes (D-056, SR-084 AK3).
// Computing short IDs reads nothing and writes nothing. The identifiers of the elements (#305,
// `identifier-index.ts`) are kept with them: people name elements by both, and both are built from
// the same states and carried over a change of the store the same way (#184).
import type { Problem } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { UNKNOWN_TYPE_PREFIX, findType, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { ElementMatch, ElementRecord } from "./elements.js";
import type { IdentifierIndex } from "./identifier-index.js";
import {
  buildIdentifierIndex,
  elementsWithIdentifier,
  identifierValue,
  updateIdentifierIndex,
} from "./identifier-index.js";
import type { ElementStore } from "./store.js";
import { carryStoreUpdate, elementStoreState } from "./store.js";
import { normalizeRef } from "./uuid.js";

/** Digits of the UUID a short ID shows at least (D-017, D-056, SR-084 AK1). */
export const SHORT_ID_MIN_LENGTH = 6;

// The prefix of an element whose type the metamodel does not know (decision on #154); the metamodel
// owns it, since its check refuses a type with it.
export { UNKNOWN_TYPE_PREFIX };

/**
 * What a short ID names: one element, none, or several (SR-060 AK3: `ref.unknown`, `ref.ambiguous`).
 * Several elements are ordered by UUID digits from the end, then like the element store.
 */
export type ShortIdMatch = ElementMatch;

export interface ShortIds {
  /** `SR-46fb54`: the prefix of the element's type, a dash and the tail of its UUID (SR-084 AK1, AK2). */
  of(element: ElementRecord): string;
  /**
   * The last hex digits of a UUID without dashes that a short ID shows: at least 6, and one more
   * than it shares with the UUID of any other element of the workspace (SR-084 AK2). For a UUID of
   * no element (a relation target in a missing repository) the tail that tells it apart from all.
   */
  tail(id: string): string;
  /**
   * The elements a short ID names: those whose UUID ends with its 6 to 32 digits and whose type has
   * its prefix. Every short ID that `of` returns finds its element, and so does a longer tail such
   * as the 12 digits of the file name. A tail shorter than the one shown fits more than one UUID: it
   * is ambiguous unless the prefix leaves one element. Two files with the same UUID (SR-088) are
   * ambiguous; a wrong prefix or a malformed short ID is unknown. Any case is accepted
   * (`normalizeRef`, #309).
   */
  find(shortId: string): ShortIdMatch;
  /**
   * The elements whose UUID ends with the digits of `shortId`, whatever their type: none for a
   * malformed short ID. Never a match by itself (a reference must not be retargeted to another
   * element); `element.resolve` names them as candidates when `find` gives unknown and the prefix
   * may be outdated (SR-060, #275).
   */
  withTail(shortId: string): readonly ElementRecord[];
  /**
   * The identifier of `element` (#305): its text value of the property with the meaning
   * `identifier`; undefined when it has none or no property has the meaning.
   */
  identifierOf(element: Pick<ElementRecord, "data">): string | undefined;
  /**
   * The elements whose identifier is `value` in any case (#305), by repository, then file; of every
   * type (an identifier is unique per type only). None when no property has the meaning.
   */
  withIdentifier(value: string): readonly ElementRecord[];
}

/** `common.schema.json#/$defs/shortId`. */
const SHORT_ID_PATTERN = /^[A-Z][A-Z0-9]*-[0-9a-f]{6,32}$/;

/** A UUID of the workspace and the elements with it (more than one when files share it, SR-088). */
interface Entry {
  readonly id: string;
  /** The hex digits of the UUID from the last to the first, so that a common end is a common start. */
  readonly digits: string;
  readonly elements: readonly ElementRecord[];
}

/** What `buildShortIds` builds, kept so that `updateShortIds` can start from it. */
interface Index {
  /** Entries by the first `SHORT_ID_MIN_LENGTH` reversed digits, that is the last digits of the UUID; sorted. */
  readonly groups: ReadonlyMap<string, readonly Entry[]>;
  /** Digits a UUID shares at the end with its closest other UUID, for UUIDs not alone in their group. */
  readonly shared: ReadonlyMap<string, number>;
  readonly metamodel: Metamodel;
  /** The identifiers of the elements (#305). */
  readonly identifiers: IdentifierIndex;
}

/** The index of each `ShortIds` that `buildShortIds` or `updateShortIds` made. */
const indexes = new WeakMap<ShortIds, Index>();

const reversedDigits = (id: string): string => {
  let digits = "";
  for (let i = id.length - 1; i >= 0; i--) {
    const c = id.charAt(i);
    if (c !== "-") {
      digits += c;
    }
  }
  return digits;
};

/**
 * The group of a UUID: its last `SHORT_ID_MIN_LENGTH` hex digits. The short ID of an element depends
 * only on the UUIDs in its group (and its type), so a change of the store changes the short IDs of
 * the groups of the UUIDs it changes and of no other (#184).
 */
export const shortIdGroup = (id: string): string => {
  // A UUID ends with 12 hex digits, so the cheap way fits it (200,000 relations are tested).
  const end = id.slice(-SHORT_ID_MIN_LENGTH);
  return end.includes("-") ? id.replaceAll("-", "").slice(-SHORT_ID_MIN_LENGTH) : end;
};

/** The key of a UUID's group in `Index.groups`: its last digits from the last. */
const groupKey = (id: string): string => reversedDigits(shortIdGroup(id));

const commonStart = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && a.charCodeAt(n) === b.charCodeAt(n)) {
    n++;
  }
  return n;
};

/**
 * Sorts one group (by code units, so the result does not depend on the order of files) and sets
 * in `shared` how many digits each UUID shares with its neighbours, which share the longest end.
 */
const link = (group: Entry[], shared: Map<string, number>): void => {
  const raise = (digits: string, n: number): void => {
    shared.set(digits, Math.max(shared.get(digits) ?? 0, n));
  };
  group.sort((a, b) => (a.digits < b.digits ? -1 : 1));
  group.reduce<string | undefined>((previous, { digits }) => {
    if (previous !== undefined) {
      const n = commonStart(previous, digits);
      raise(previous, n);
      raise(digits, n);
    }
    return digits;
  }, undefined);
};

/** The short IDs of an index; `of` and `find` take constant time on average. */
const shortIdsOf = (index: Index): ShortIds => {
  const { groups, shared, metamodel, identifiers } = index;

  const tailOf = (id: string): string => {
    const group = groups.get(groupKey(id));
    // Alone in its group (most UUIDs), or the UUID of no element and no group: the shortest tail,
    // without reading all digits (SR-082 AK4, #227).
    if (group === undefined || (group.length === 1 && group[0]?.id === id)) {
      return shortIdGroup(id);
    }
    // In a group with others, `link` noted what it shares; the UUID of no element: compare with
    // the group it would be in.
    const digits = reversedDigits(id);
    const shares = shared.get(digits) ?? Math.max(...group.map((other) => commonStart(other.digits, digits)));
    return id.replaceAll("-", "").slice(-Math.max(SHORT_ID_MIN_LENGTH, shares + 1));
  };

  // Each tail once per index (it never changes): a chain or a list of affected elements names tens
  // of thousands of elements, on every call (SR-082 AK4, #227).
  const tails = new Map<string, string>();
  const tail = (id: string): string => {
    let known = tails.get(id);
    if (known === undefined) {
      known = tailOf(id);
      tails.set(id, known);
    }
    return known;
  };

  const prefixOf = (element: ElementRecord): string =>
    findType(metamodel, element.type)?.prefix ?? UNKNOWN_TYPE_PREFIX;

  const withTail = (given: string): readonly ElementRecord[] => {
    const shortId = normalizeRef(given);
    if (!SHORT_ID_PATTERN.test(shortId)) {
      return [];
    }
    const digits = reversedDigits(shortId.slice(shortId.indexOf("-") + 1));
    return (groups.get(digits.slice(0, SHORT_ID_MIN_LENGTH)) ?? [])
      .filter((entry) => entry.digits.startsWith(digits))
      .flatMap((entry) => entry.elements);
  };

  const find = (given: string): ShortIdMatch => {
    const shortId = normalizeRef(given);
    const prefix = shortId.slice(0, shortId.indexOf("-"));
    const matches = withTail(shortId).filter((element) => prefixOf(element) === prefix);
    const [first, ...others] = matches;
    if (first === undefined) {
      return { kind: "unknown" };
    }
    return others.length === 0 ? { kind: "found", element: first } : { kind: "ambiguous", elements: matches };
  };

  const ids: ShortIds = {
    of: (element) => `${prefixOf(element)}-${tail(element.id)}`,
    tail,
    find,
    withTail,
    identifierOf: (element) => identifierValue(element, identifiers.key),
    withIdentifier: (value) => elementsWithIdentifier(identifiers, value),
  };
  indexes.set(ids, index);
  return ids;
};

/**
 * `{ identifier }` of `element` for an output that names it next to its short ID (#305), `{}` when
 * it has none.
 */
export const identifierField = (
  shortIds: ShortIds,
  element: Pick<ElementRecord, "data">,
): { readonly identifier?: string } => {
  const identifier = shortIds.identifierOf(element);
  return identifier === undefined ? {} : { identifier };
};

/**
 * The short IDs of the elements of `byId` (the element store), with the type prefixes of
 * `metamodel`. One pass: the UUIDs are grouped by their last 6 digits, each group is sorted (by code
 * units, so the result does not depend on the order of files), and neighbours in a group share the
 * longest end. O(n log n) for n UUIDs; `of` and `find` then take constant time on average.
 */
export const buildShortIds = (
  byId: ReadonlyMap<string, readonly ElementRecord[]>,
  metamodel: Metamodel,
): ShortIds => {
  const groups = new Map<string, Entry[]>();
  for (const [id, elements] of byId) {
    const digits = reversedDigits(id);
    const key = digits.slice(0, SHORT_ID_MIN_LENGTH);
    const entry: Entry = { id, digits, elements };
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [entry]);
    } else {
      group.push(entry);
    }
  }
  const shared = new Map<string, number>();
  for (const group of groups.values()) {
    link(group, shared);
  }
  return shortIdsOf({ groups, shared, metamodel, identifiers: buildIdentifierIndex(byId, metamodel) });
};

/**
 * The short IDs of `byId` (a store after a change, #184), built from `old`, the short IDs of the
 * store before it: only the groups of the UUIDs in `ids` (every UUID whose records changed, came
 * or went) are built again from `byId`, every other group is taken over. The same as
 * `buildShortIds(byId, metamodel)` when every other UUID has the same records in both stores, as
 * `StoreUpdate` guarantees, also for the identifiers (`updateIdentifierIndex`); `old` itself is not
 * changed, so a command that still holds it keeps a consistent view. `old` must come from
 * `buildShortIds` or `updateShortIds`.
 */
export const updateShortIds = (
  old: ShortIds,
  byId: ReadonlyMap<string, readonly ElementRecord[]>,
  ids: Iterable<string>,
): ShortIds => {
  const index = indexes.get(old);
  if (index === undefined) {
    throw new Error("updateShortIds needs short IDs from buildShortIds or updateShortIds");
  }
  const changed = new Map<string, Set<string>>();
  const changedIds = [...ids];
  // The records of a changed UUID before the change, for the identifiers: its entry in `index`.
  const recordsBefore = (id: string): readonly ElementRecord[] =>
    index.groups.get(groupKey(id))?.find((entry) => entry.id === id)?.elements ?? [];
  for (const id of changedIds) {
    const key = groupKey(id);
    changed.set(key, (changed.get(key) ?? new Set()).add(id));
  }
  const groups = new Map(index.groups);
  const shared = new Map(index.shared);
  for (const [key, idsOfGroup] of changed) {
    const before = groups.get(key) ?? [];
    for (const { digits } of before) {
      shared.delete(digits);
    }
    const group = before.filter((entry) => !idsOfGroup.has(entry.id));
    for (const id of idsOfGroup) {
      const elements = byId.get(id);
      if (elements !== undefined) {
        group.push({ id, digits: reversedDigits(id), elements });
      }
    }
    if (group.length === 0) {
      groups.delete(key);
    } else {
      link(group, shared);
      groups.set(key, group);
    }
  }
  return shortIdsOf({
    groups,
    shared,
    metamodel: index.metamodel,
    identifiers: updateIdentifierIndex(index.identifiers, byId, changedIds, recordsBefore),
  });
};

/**
 * The short IDs of a workspace, built on first use from the element store and the metamodel, reset
 * with either of them and carried over a change of the store that `applyStoreChange` applies
 * (`updateShortIds`, #184), so a new element, a moved or changed file (SR-007) or a changed type
 * prefix (SR-015) shows on the next read. Unique across every available repository of the
 * workspace; a missing repository cannot be taken into account (D-056).
 */
export const shortIdState = defineWorkspaceState(
  "short-ids",
  async (workspace): Promise<ShortIds> => {
    const [store, metamodel] = await Promise.all([
      workspace.get(elementStoreState),
      workspace.get(metamodelState),
    ]);
    return buildShortIds(store.byId, metamodel);
  },
  {
    dependsOn: [elementStoreState, metamodelState],
    // A save or a watcher batch builds only the groups of the UUIDs it changed again (#184).
    carry: carryStoreUpdate((value, update) =>
      value.then((old) => updateShortIds(old, update.to.byId, update.ids)),
    ),
  },
);

/**
 * The record of `store` that a problem naming an element (`elementId`) is about: by its UUID and its
 * repository and file, the element's own (`elementRepository`, `elementFile`) when the problem names
 * another file (outdated evidence names its record file), else the problem's. That names the copy
 * when several files share a UUID (SR-088). A problem that names no record of its UUID that way is
 * about the only record of the UUID when there is one; else undefined.
 */
export const problemElement = (
  store: ElementStore,
  problem: Problem & { readonly elementId: string },
): ElementRecord | undefined => {
  const records = store.byId.get(problem.elementId) ?? [];
  const repository = problem.elementRepository ?? problem.repository;
  const file = problem.elementFile ?? problem.file;
  const [only] = records;
  return (
    records.find((e) => e.repository === repository && e.file === file) ??
    (records.length === 1 ? only : undefined)
  );
};
