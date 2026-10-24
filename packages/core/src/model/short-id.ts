// Short IDs (D-017, D-056, SR-084): how the tool shows the UUID of an element. The prefix of its type,
// a dash and the last hex digits of the UUID without dashes: at least 6, more until no other element
// of the workspace has a UUID that ends the same way. Only the display grows; the file name keeps the
// prefix and the 12 digits it got when the element was created and never changes (D-056, SR-084 AK3).
// Computing short IDs reads nothing and writes nothing.
import type { Metamodel } from "../metamodel/index.js";
import { findType, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { ElementRecord } from "./elements.js";
import { elementStoreState } from "./store.js";

/** Digits of the UUID a short ID shows at least (D-017, D-056, SR-084 AK1). */
export const SHORT_ID_MIN_LENGTH = 6;

/**
 * Prefix of an element whose type the metamodel does not know (SR-016 AK3), or of every element
 * while the metamodel is missing. Assumption until spec question #154 is answered (option 1).
 */
export const UNKNOWN_TYPE_PREFIX = "UNKNOWN";

/** What a short ID names: one element, none, or several (SR-060 AK3: `ref.unknown`, `ref.ambiguous`). */
export type ShortIdMatch =
  | { readonly kind: "found"; readonly element: ElementRecord }
  | { readonly kind: "unknown" }
  /** Several elements, ordered by UUID digits from the end, then like the element store. */
  | { readonly kind: "ambiguous"; readonly elements: readonly ElementRecord[] };

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
   * ambiguous; a wrong prefix or a malformed short ID is unknown.
   */
  find(shortId: string): ShortIdMatch;
}

/** `common.schema.json#/$defs/shortId`. */
const SHORT_ID_PATTERN = /^[A-Z][A-Z0-9]*-[0-9a-f]{6,32}$/;

/** A UUID of the workspace and the elements with it (more than one when files share it, SR-088). */
interface Entry {
  /** The hex digits of the UUID from the last to the first, so that a common end is a common start. */
  readonly digits: string;
  readonly elements: readonly ElementRecord[];
}

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

const commonStart = (a: string, b: string): number => {
  let n = 0;
  while (n < a.length && a.charCodeAt(n) === b.charCodeAt(n)) {
    n++;
  }
  return n;
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
  /** Entries by the first `SHORT_ID_MIN_LENGTH` reversed digits, that is the last digits of the UUID. */
  const groups = new Map<string, Entry[]>();
  for (const [id, elements] of byId) {
    const digits = reversedDigits(id);
    const key = digits.slice(0, SHORT_ID_MIN_LENGTH);
    const entry: Entry = { digits, elements };
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [entry]);
    } else {
      group.push(entry);
    }
  }

  /** Digits a UUID shares at the end with its closest other UUID, for UUIDs not alone in their group. */
  const shared = new Map<string, number>();
  const raise = (digits: string, n: number): void => {
    shared.set(digits, Math.max(shared.get(digits) ?? 0, n));
  };
  for (const group of groups.values()) {
    group.sort((a, b) => (a.digits < b.digits ? -1 : 1));
    group.reduce<string | undefined>((previous, { digits }) => {
      if (previous !== undefined) {
        const n = commonStart(previous, digits);
        raise(previous, n);
        raise(digits, n);
      }
      return digits;
    }, undefined);
  }

  const sharedDigits = (digits: string): number => {
    const known = shared.get(digits);
    if (known !== undefined) {
      return known;
    }
    // Alone in its group, or the UUID of no element: compare with the group it would be in.
    let n = 0;
    for (const other of groups.get(digits.slice(0, SHORT_ID_MIN_LENGTH)) ?? []) {
      if (other.digits !== digits) {
        n = Math.max(n, commonStart(other.digits, digits));
      }
    }
    return n;
  };

  const tail = (id: string): string => {
    const length = Math.max(SHORT_ID_MIN_LENGTH, sharedDigits(reversedDigits(id)) + 1);
    return id.replaceAll("-", "").slice(-length);
  };

  const prefixOf = (element: ElementRecord): string =>
    findType(metamodel, element.type)?.prefix ?? UNKNOWN_TYPE_PREFIX;

  const find = (shortId: string): ShortIdMatch => {
    if (!SHORT_ID_PATTERN.test(shortId)) {
      return { kind: "unknown" };
    }
    const dash = shortId.indexOf("-");
    const prefix = shortId.slice(0, dash);
    const digits = reversedDigits(shortId.slice(dash + 1));
    const matches = (groups.get(digits.slice(0, SHORT_ID_MIN_LENGTH)) ?? [])
      .filter((entry) => entry.digits.startsWith(digits))
      .flatMap((entry) => entry.elements)
      .filter((element) => prefixOf(element) === prefix);
    const [first, ...others] = matches;
    if (first === undefined) {
      return { kind: "unknown" };
    }
    return others.length === 0 ? { kind: "found", element: first } : { kind: "ambiguous", elements: matches };
  };

  return { of: (element) => `${prefixOf(element)}-${tail(element.id)}`, tail, find };
};

/**
 * The short IDs of a workspace, built on first use from the element store and the metamodel and
 * reset with either of them, so a new element, a moved or changed file (SR-007) or a changed type
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
  { dependsOn: [elementStoreState, metamodelState] },
);
