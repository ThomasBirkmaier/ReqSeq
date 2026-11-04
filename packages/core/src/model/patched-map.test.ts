import { describe, expect, it } from "vitest";
import { PatchedMap, plainOf } from "./patched-map.js";
import { byPath } from "./path-order.js";

const entries = <K, V>(map: ReadonlyMap<K, V>): [K, V][] => [...map];

describe("PatchedMap (#215)", () => {
  it("reads like the map with the changes applied, and leaves the map it was patched from as it was", () => {
    const base = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    const once = PatchedMap.patch(base, [
      ["b", 20],
      ["c", undefined],
      ["d", 4],
      ["x", undefined],
    ]);
    expect(entries(once)).toEqual([
      ["a", 1],
      ["b", 20],
      ["d", 4],
    ]);
    expect(once.size).toBe(3);
    expect([once.get("a"), once.get("b"), once.get("c"), once.get("d")]).toEqual([1, 20, undefined, 4]);
    expect([once.has("a"), once.has("c"), once.has("d"), once.has("x")]).toEqual([true, false, true, false]);
    expect([...once.keys()]).toEqual(["a", "b", "d"]);
    expect([...once.values()]).toEqual([1, 20, 4]);
    // A patch of a patch: the first stays as it was.
    const twice = PatchedMap.patch(once, [
      ["d", undefined],
      ["c", 30],
      ["e", 5],
    ]);
    expect(entries(twice)).toEqual([
      ["a", 1],
      ["b", 20],
      ["c", 30],
      ["e", 5],
    ]);
    expect(twice.size).toBe(4);
    expect(entries(once)).toEqual([
      ["a", 1],
      ["b", 20],
      ["d", 4],
    ]);
    expect(entries(base)).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(Object.prototype.toString.call(twice)).toBe("[object Map]");
  });

  it("with no change reads the base, and passes each entry and itself to forEach", () => {
    const base = new Map([["a", 1]]);
    const same = PatchedMap.patch(base, []);
    expect([same.get("a"), same.has("a"), same.has("b"), same.size]).toEqual([1, true, false, 1]);
    const seen: unknown[] = [];
    const self = { name: "this" };
    same.forEach(function (this: unknown, value, key, map) {
      seen.push([this, key, value, map === same]);
    }, self);
    expect(seen).toEqual([[self, "a", 1, true]]);
  });

  it("in path order, merges new keys into their place, also one deleted and added again", () => {
    const base = new Map([
      ["b", 1],
      ["d", 2],
      ["f", 3],
    ]);
    const first = PatchedMap.patch(
      base,
      [
        ["e", 10],
        ["a", 11],
        ["d", undefined],
        ["g", 12],
      ],
      { order: byPath },
    );
    expect([...first.keys()]).toEqual(["a", "b", "e", "f", "g"]);
    const second = PatchedMap.patch(
      first,
      [
        ["d", 20],
        ["c", 21],
      ],
      { order: byPath },
    );
    expect(entries(second)).toEqual([
      ["a", 11],
      ["b", 1],
      ["c", 21],
      ["d", 20],
      ["e", 10],
      ["f", 3],
      ["g", 12],
    ]);
    // Iterated again: the same order (the sorted new keys are kept).
    expect([...second.keys()]).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    // A patch without the order does not share the overlay: new keys come last.
    expect([...PatchedMap.patch(second, [["0", 0]]).keys()]).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "0",
    ]);
  });

  it("builds a new base from `compactAt` overlay entries, without changing the shared one", () => {
    const base = new Map([
      ["a", 1],
      ["c", 3],
    ]);
    const kept = PatchedMap.patch(base, [["b", 2]], { order: byPath, compactAt: 3 });
    const compacted = PatchedMap.patch(
      kept,
      [
        ["d", 4],
        ["a", undefined],
      ],
      { order: byPath, compactAt: 3 },
    );
    expect(entries(compacted)).toEqual([
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
    const after = PatchedMap.patch(compacted, [["a", 0]], { order: byPath, compactAt: 3 });
    expect(entries(after)).toEqual([
      ["a", 0],
      ["b", 2],
      ["c", 3],
      ["d", 4],
    ]);
    expect(entries(kept)).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(entries(base)).toEqual([
      ["a", 1],
      ["c", 3],
    ]);
  });

  it("equals a Map that took the same changes, over many random patches", () => {
    let seed = 215;
    const random = (n: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const keys = Array.from({ length: 40 }, (_, i) => `k${String(i).padStart(2, "0")}`);
    for (const order of [byPath, undefined]) {
      const reference = new Map(keys.filter((_, i) => i % 3 === 0).map((k) => [k, 0]));
      let map: ReadonlyMap<string, number> = new Map(reference);
      for (let step = 0; step < 200; step++) {
        const changes: [string, number | undefined][] = [];
        for (let n = random(4); n >= 0; n--) {
          const key = `k${String(random(keys.length)).padStart(2, "0")}`;
          changes.push([key, random(3) === 0 ? undefined : step]);
        }
        for (const [key, value] of changes) {
          if (value === undefined) {
            reference.delete(key);
          } else {
            reference.set(key, value);
          }
        }
        map = PatchedMap.patch(map, changes, { order, compactAt: 16 });
        expect(map.size).toBe(reference.size);
        const sorted = [...reference].sort(([a], [b]) => byPath(a, b));
        expect(order === undefined ? [...map].sort(([a], [b]) => byPath(a, b)) : [...map]).toEqual(sorted);
      }
    }
  });

  it("gives hot read loops its entries as a plain map from `plainAt` asks on, built once and kept", () => {
    const base = new Map(Array.from({ length: 10 }, (_, i): [string, number] => [`k${String(i)}`, i]));
    expect(plainOf(base)).toBe(base);
    const patched = PatchedMap.patch(base, [
      ["k1", 10],
      ["k2", undefined],
      ["x", 11],
    ]);
    // Below 1,024 asks: the map itself.
    for (let i = 1; i < 1_024; i++) {
      expect(plainOf(patched)).toBe(patched);
    }
    const plain = plainOf(patched);
    expect(plain).not.toBe(patched);
    expect(Object.getPrototypeOf(plain)).toBe(Map.prototype);
    expect([...plain]).toEqual([...patched]);
    expect(plainOf(patched)).toBe(plain);
    expect(patched.plain()).toBe(plain);
    // Read through the plain entries from now on.
    expect([patched.get("k1"), patched.get("k2"), patched.has("x"), patched.has("k2")]).toEqual([
      10,
      undefined,
      true,
      false,
    ]);
    expect([...patched.keys()]).toEqual([...plain.keys()]);
    // A patch takes the plain entries as its base, unchanged.
    const next = PatchedMap.patch(patched, [["k3", 30]]);
    expect(next.get("k3")).toBe(30);
    expect(plain.get("k3")).toBe(3);
    expect(next.size).toBe(10);
  });

  it("gives a plain base without changes as it is, and a map over another kind of base as a copy", () => {
    const base = new Map([["a", 1]]);
    const same = PatchedMap.patch(base, []);
    expect(same.plain()).toBe(base);
    const ordered = PatchedMap.patch(base, [["b", 2]], { order: byPath });
    const over = PatchedMap.patch(ordered, []);
    expect(over.plain()).not.toBe(ordered);
    expect([...over.plain()]).toEqual([
      ["a", 1],
      ["b", 2],
    ]);
  });
});
