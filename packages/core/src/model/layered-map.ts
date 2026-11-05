// A memo that a carried state goes on filling, forked in O(changed) (#215, ADR-0008 file watching):
// the verification status keeps the versions it read, its walks and the results of its evaluator
// over a store change, without those the change can reach. A copy of each memo (50,000 entries at
// N-036) cost about 40 ms per save; a fork shares what the memo held with the memo it came from.

import { compactAt } from "./patch-limits.js";

/** An undefined value in the maps below (`get` gives undefined for a key that is not there too). */
const UNDEFINED: unique symbol = Symbol("undefined");

type Stored<V> = V | typeof UNDEFINED;

/**
 * A map that is changed with `set` and forked with `fork`: a base shared with the maps it was
 * forked from or into and never changed, the keys dropped from that base since, and the entries of
 * this map on top. A fork gets the entries of its map at that time without the dropped keys; the
 * entries either map sets later stay its own. Read it with `get` and `has` (one to three lookups);
 * `entries` walks every entry (for tests and compaction only).
 */
export class LayeredMap<K, V> {
  #base: ReadonlyMap<K, Stored<V>>;
  readonly #dropped: ReadonlySet<K>;
  #top: Map<K, Stored<V>>;

  constructor(
    base: ReadonlyMap<K, Stored<V>> = new Map<K, Stored<V>>(),
    dropped: ReadonlySet<K> = new Set<K>(),
    top: Map<K, Stored<V>> = new Map<K, Stored<V>>(),
  ) {
    this.#base = base;
    this.#dropped = dropped;
    this.#top = top;
  }

  get(key: K): V | undefined {
    let value = this.#top.get(key);
    if (value === undefined && !this.#dropped.has(key)) {
      value = this.#base.get(key);
    }
    return value === UNDEFINED ? undefined : value;
  }

  has(key: K): boolean {
    return this.#top.has(key) || (!this.#dropped.has(key) && this.#base.has(key));
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
  *entries(): IterableIterator<[K, V | undefined]> {
    for (const [key, value] of this.#base) {
      if (!this.#dropped.has(key) && !this.#top.has(key)) {
        yield [key, value === UNDEFINED ? undefined : value];
      }
    }
    for (const [key, value] of this.#top) {
      yield [key, value === UNDEFINED ? undefined : value];
    }
  }

  /**
   * A new map with the entries of this one but those of `drop`. A map with nothing below its own
   * entries hands them on as the base of both (it goes on with an empty top), so the first fork
   * copies nothing; otherwise the own entries and the dropped keys are copied, and from
   * `compactAt` of them on the fork gets a base of its own (one pass over every entry).
   */
  fork(drop: Iterable<K>): LayeredMap<K, V> {
    if (this.#base.size === 0 && this.#dropped.size === 0) {
      this.#base = this.#top;
      this.#top = new Map();
      return new LayeredMap(this.#base, new Set(drop));
    }
    const dropped = new Set(this.#dropped);
    const top = new Map(this.#top);
    for (const key of drop) {
      dropped.add(key);
      top.delete(key);
    }
    if (dropped.size + top.size < compactAt(this.#base.size)) {
      return new LayeredMap(this.#base, dropped, top);
    }
    const base = new Map<K, Stored<V>>();
    for (const [key, value] of this.#base) {
      if (!dropped.has(key)) {
        base.set(key, value);
      }
    }
    for (const [key, value] of top) {
      base.set(key, value);
    }
    return new LayeredMap(base);
  }
}
