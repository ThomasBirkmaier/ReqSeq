// An immutable map over a shared base map plus a small overlay of changes (#215, ADR-0008 file
// watching): the element store and the states carried over its changes patch one changed file in
// O(changed) instead of copying maps of 50,000 entries (N-036).

import { compactAt, plainAt } from "./patch-limits.js";

/** A key the overlay deletes from the base. */
const DELETED: unique symbol = Symbol("deleted");

/** The changes of a patch: a value sets the key, undefined deletes it. */
export type MapChanges<K, V> = Iterable<readonly [K, V | undefined]>;

/** How a patch is made; tests set them. */
export interface PatchOptions<K> {
  /**
   * Keys in this order (`byPath` for the files of a repository): iteration merges keys that are not
   * in the base into their sorted place; the base must be in this order. Default: unordered, new keys
   * after those of the base, in the order they were added.
   */
  readonly order?: ((a: K, b: K) => number) | undefined;
  /**
   * From this many overlay entries the patch builds a new base (compaction) instead of growing the
   * overlay further; a shared base is never changed. Default: `compactAt` (`patch-limits.ts`).
   */
  readonly compactAt?: number | undefined;
}

/**
 * A `ReadonlyMap` that never changes: a base map, shared by every map patched from it and never
 * changed, and an overlay of the keys set or deleted since. `get` and `has` look into the overlay
 * first; with an empty overlay they are the base's. Iteration gives the keys of the base in its
 * order with the overlay's values, then (unordered) the new keys in the order they were added, or
 * (with `order`) every key in that order. A hot read loop (a walk over every relation) reads
 * `plainOf(map)` instead: a plain `Map` of the entries, built once and kept, so its call sites see
 * one map class and pay one lookup, as on a store read in full; the few reads of a carry never build
 * it. Never `instanceof Map`, never cloned or posted to a worker: use it through `ReadonlyMap` only.
 */
export class PatchedMap<K, V> implements ReadonlyMap<K, V> {
  readonly size: number;
  /** Read as a map (`Object.prototype.toString`), as test matchers compare maps. */
  readonly [Symbol.toStringTag] = "Map";
  readonly #base: ReadonlyMap<K, V>;
  readonly #overlay: ReadonlyMap<K, V | typeof DELETED>;
  readonly #order: ((a: K, b: K) => number) | undefined;
  /** The overlay's keys that are not in the base, sorted by `order`; built on the first ordered iteration. */
  #added: K[] | undefined;
  /** Every entry in a plain map, built by `plain` once; never changed. */
  #flat: Map<K, V> | undefined;
  /** How often `plainOf` asked for this map. */
  #asks = 0;

  private constructor(
    base: ReadonlyMap<K, V>,
    overlay: ReadonlyMap<K, V | typeof DELETED>,
    size: number,
    order: ((a: K, b: K) => number) | undefined,
  ) {
    this.#base = base;
    this.#overlay = overlay;
    this.size = size;
    this.#order = order;
  }

  /**
   * `map` with `changes` applied, as a new map; `map` is not changed. A `PatchedMap` with the same
   * `order` shares its base and copies its overlay only; any other map becomes the base as it is
   * (it must not be changed afterwards).
   */
  static patch<K, V>(
    map: ReadonlyMap<K, V>,
    changes: MapChanges<K, V>,
    options: PatchOptions<K> = {},
  ): PatchedMap<K, V> {
    const order = options.order;
    const { base, overlay } = PatchedMap.#startOf(map, order);
    let size = map.size;
    for (const [key, value] of changes) {
      const had = overlay.has(key) ? overlay.get(key) !== DELETED : base.has(key);
      if (value === undefined) {
        if (base.has(key)) {
          overlay.set(key, DELETED);
        } else {
          overlay.delete(key);
        }
      } else {
        overlay.set(key, value);
      }
      size += Number(value !== undefined) - Number(had);
    }
    const patched = new PatchedMap<K, V>(base, overlay, size, order);
    return overlay.size < (options.compactAt ?? compactAt(size))
      ? patched
      : new PatchedMap<K, V>(new Map<K, V>(patched.#merged()), new Map(), size, order);
  }

  /**
   * The base and a copy of the overlay a patch of `map` starts from: a `PatchedMap` with the same
   * order shares its base, or its plain entries once it built them (they are never changed); any
   * other map is the base itself.
   */
  static #startOf<K, V>(
    map: ReadonlyMap<K, V>,
    order: ((a: K, b: K) => number) | undefined,
  ): { base: ReadonlyMap<K, V>; overlay: Map<K, V | typeof DELETED> } {
    if (!(map instanceof PatchedMap) || map.#order !== order) {
      return { base: map, overlay: new Map() };
    }
    const from = map as PatchedMap<K, V>;
    return from.#flat === undefined
      ? { base: from.#base, overlay: new Map(from.#overlay) }
      : { base: from.#flat, overlay: new Map() };
  }

  get(key: K): V | undefined {
    const flat = this.#flat;
    if (flat !== undefined) {
      return flat.get(key);
    }
    // One lookup in the overlay: its values are never undefined (undefined deletes).
    const value = this.#overlay.get(key);
    if (value === undefined) {
      return this.#base.get(key);
    }
    return value === DELETED ? undefined : value;
  }

  has(key: K): boolean {
    const flat = this.#flat;
    if (flat !== undefined) {
      return flat.has(key);
    }
    const value = this.#overlay.get(key);
    return value === undefined ? this.#base.has(key) : value !== DELETED;
  }

  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this) {
      callback.call(thisArg, value, key, this);
    }
  }

  entries(): MapIterator<[K, V]> {
    const flat = this.#flat;
    if (flat !== undefined) {
      return flat.entries();
    }
    return this.#overlay.size === 0 ? this.#base.entries() : this.#merged();
  }

  /** `plainOf`: counts the ask; from `plainAt` asks on, the `plain` entries, else this map. */
  asked(): ReadonlyMap<K, V> {
    if (this.#flat !== undefined) {
      return this.#flat;
    }
    this.#asks += 1;
    return this.#asks < plainAt(this.size) ? this : this.plain();
  }

  /**
   * The entries as a plain `Map`, built on the first call and kept (a later patch takes it as its
   * base); never change it. With no overlay a plain base is given as it is.
   */
  plain(): ReadonlyMap<K, V> {
    if (this.#flat !== undefined) {
      return this.#flat;
    }
    this.#flat =
      this.#overlay.size === 0 && this.#base instanceof Map
        ? (this.#base as Map<K, V>)
        : new Map(this.#merged());
    return this.#flat;
  }

  /** The entries of base and overlay merged, as `entries` gives them. */
  *#merged(): MapIterator<[K, V]> {
    const order = this.#order;
    const added = this.#addedKeys();
    let next = 0;
    for (const [key, value] of this.#base) {
      if (order !== undefined) {
        for (; next < added.length && order(added[next] as K, key) < 0; next++) {
          yield this.#entryOf(added[next] as K);
        }
      }
      const now = this.#overlay.has(key) ? this.#overlay.get(key) : value;
      if (now !== DELETED) {
        yield [key, now as V];
      }
    }
    for (; next < added.length; next++) {
      yield this.#entryOf(added[next] as K);
    }
    return undefined;
  }

  *keys(): MapIterator<K> {
    for (const [key] of this.entries()) {
      yield key;
    }
    return undefined;
  }

  *values(): MapIterator<V> {
    for (const [, value] of this.entries()) {
      yield value;
    }
    return undefined;
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  #entryOf(key: K): [K, V] {
    return [key, this.#overlay.get(key) as V];
  }

  #addedKeys(): readonly K[] {
    if (this.#added === undefined) {
      const added: K[] = [];
      for (const [key, value] of this.#overlay) {
        if (value !== DELETED && !this.#base.has(key)) {
          added.push(key);
        }
      }
      this.#added = this.#order === undefined ? added : added.sort(this.#order);
    }
    return this.#added;
  }
}

/**
 * `map` for a lookup in a hot read loop (one per relation of a check, #215): a `PatchedMap` asked
 * `plainAt` times gives its `plain` entries from then on (built once and kept), so the loop's call
 * sites see one map class and pay one lookup, as on a store read in full; before that, and for the
 * few lookups of a carry over one changed file, the map itself. Any other map as it is.
 */
export const plainOf = <K, V>(map: ReadonlyMap<K, V>): ReadonlyMap<K, V> =>
  map instanceof PatchedMap ? (map as PatchedMap<K, V>).asked() : map;
