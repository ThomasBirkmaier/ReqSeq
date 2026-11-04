// An immutable map over a shared base map plus a small overlay of changes (#215, ADR-0008 file
// watching): the element store and the states carried over its changes patch one changed file in
// O(changed) instead of copying maps of 50,000 entries (N-036).

import { compactAt } from "./patch-limits.js";

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
 * (with `order`) every key in that order. Never `instanceof Map`, never cloned or posted to a
 * worker: use it through `ReadonlyMap` only.
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
    const from = map instanceof PatchedMap && map.#order === order ? (map as PatchedMap<K, V>) : undefined;
    const base = from === undefined ? map : from.#base;
    const overlay = new Map<K, V | typeof DELETED>(from === undefined ? [] : from.#overlay);
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
      : new PatchedMap<K, V>(new Map<K, V>(patched), new Map(), size, order);
  }

  get(key: K): V | undefined {
    if (this.#overlay.size > 0 && this.#overlay.has(key)) {
      const value = this.#overlay.get(key);
      return value === DELETED ? undefined : value;
    }
    return this.#base.get(key);
  }

  has(key: K): boolean {
    if (this.#overlay.size > 0 && this.#overlay.has(key)) {
      return this.#overlay.get(key) !== DELETED;
    }
    return this.#base.has(key);
  }

  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this) {
      callback.call(thisArg, value, key, this);
    }
  }

  *entries(): MapIterator<[K, V]> {
    if (this.#overlay.size === 0) {
      yield* this.#base;
      return undefined;
    }
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
