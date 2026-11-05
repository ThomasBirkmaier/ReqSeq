// A memo that a carried state goes on filling, forked in O(changed) (#215, ADR-0008 file watching):
// the verification status keeps the versions it read, its walks and the results of its evaluator
// over a store change, without those the change can reach. A copy of each memo (50,000 entries at
// N-036) cost about 40 ms per save; a fork shares what the memo held with the memo it came from.

import { compactAt } from "./patch-limits.js";

/** An undefined value in the maps below (`get` gives undefined for a key that is not there too). */
const UNDEFINED: unique symbol = Symbol("undefined");

/** A key of the base that a fork dropped, as an entry of the top: a miss there goes on to the base. */
const DROPPED: unique symbol = Symbol("dropped");

type Stored<V> = V | typeof UNDEFINED;

/** The value `stored` stands for: `UNDEFINED` is only stored for a value undefined, so `V` holds it. */
const unstored = <V>(stored: Stored<V>): V => (stored === UNDEFINED ? (undefined as V) : stored);

/**
 * A map that is changed with `set` and forked with `fork`: a base shared with the maps it was
 * forked from or into and never changed, and on top the entries of this map and a marker for each
 * key of the base dropped since. A fork gets the entries of its map at that time without the
 * dropped keys; the entries either map sets later stay its own. Read it with `get` and `has` (one or
 * two lookups); `entries` walks every entry (for tests and compaction only).
 */
export class LayeredMap<K, V> {
  #base: ReadonlyMap<K, Stored<V>>;
  #top: Map<K, Stored<V> | typeof DROPPED>;

  constructor(
    base: ReadonlyMap<K, Stored<V>> = new Map<K, Stored<V>>(),
    top: Map<K, Stored<V> | typeof DROPPED> = new Map<K, Stored<V> | typeof DROPPED>(),
  ) {
    this.#base = base;
    this.#top = top;
  }

  get(key: K): V | undefined {
    // The top holds no undefined (`UNDEFINED`), and a null value there stays null.
    const top = this.#top.get(key);
    if (top !== undefined) {
      return top === UNDEFINED || top === DROPPED ? undefined : top;
    }
    const value = this.#base.get(key);
    return value === UNDEFINED ? undefined : value;
  }

  has(key: K): boolean {
    const value = this.#top.get(key);
    return value === undefined ? this.#base.has(key) : value !== DROPPED;
  }

  set(key: K, value: V): this {
    // Not `??`: a null value stays null.
    if (value === undefined) {
      this.#top.set(key, UNDEFINED);
    } else {
      this.#top.set(key, value);
    }
    return this;
  }

  /** Every entry: those of the base that are not dropped and not set again, then those set. */
  *entries(): IterableIterator<[K, V]> {
    for (const [key, value] of this.#base) {
      if (!this.#top.has(key)) {
        yield [key, unstored(value)];
      }
    }
    for (const [key, value] of this.#top) {
      if (value !== DROPPED) {
        yield [key, unstored(value)];
      }
    }
  }

  /**
   * A new map with the entries of this one but those of `drop`. A key the base does not hold needs
   * no marker (a base never changes). A map with nothing below its own entries hands them on as the
   * base of both (it goes on with an empty top), so the first fork copies nothing; otherwise the top
   * is copied, and from `compactAt` of its entries and markers on the fork gets a base of its own
   * (one pass over every entry).
   */
  fork(drop: Iterable<K>): LayeredMap<K, V> {
    if (this.#base.size === 0) {
      this.#base = this.#top as ReadonlyMap<K, Stored<V>>;
      this.#top = new Map();
    }
    const base = this.#base;
    const top = new Map(this.#top);
    for (const key of drop) {
      if (base.has(key)) {
        top.set(key, DROPPED);
      } else {
        top.delete(key);
      }
    }
    if (top.size < compactAt(base.size)) {
      return new LayeredMap(base, top);
    }
    const own = new Map<K, Stored<V>>();
    for (const [key, value] of base) {
      if (!top.has(key)) {
        own.set(key, value);
      }
    }
    for (const [key, value] of top) {
      if (value !== DROPPED) {
        own.set(key, value);
      }
    }
    return new LayeredMap(own);
  }
}
