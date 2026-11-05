import { describe, expect, it } from "vitest";
import { compactAt } from "./patch-limits.js";
import { LayeredMap } from "./layered-map.js";

const entries = <K, V>(map: LayeredMap<K, V>): [K, V | undefined][] =>
  [...map.entries()].sort(([a], [b]) => (String(a) < String(b) ? -1 : 1));

describe("LayeredMap (#215)", () => {
  it("gives what was set, also undefined and null, and nothing for a key never set", () => {
    const map = new LayeredMap<string, number | null | undefined>();
    expect(map.set("a", 1).set("u", undefined).set("n", null)).toBe(map);
    expect([map.get("a"), map.get("u"), map.get("n"), map.get("x")]).toEqual([1, undefined, null, undefined]);
    expect([map.has("a"), map.has("u"), map.has("n"), map.has("x")]).toEqual([true, true, true, false]);
    expect(entries(map)).toEqual([
      ["a", 1],
      ["n", null],
      ["u", undefined],
    ]);
  });

  it("forks without the dropped keys, and neither map sees what the other sets later", () => {
    const old = new LayeredMap<string, number | undefined>();
    old.set("a", 1).set("b", 2).set("c", undefined);
    // The first fork hands the entries on as a base of both.
    const first = old.fork(["b"]);
    expect(entries(old)).toEqual([
      ["a", 1],
      ["b", 2],
      ["c", undefined],
    ]);
    expect(entries(first)).toEqual([
      ["a", 1],
      ["c", undefined],
    ]);
    expect([first.has("b"), first.get("b"), first.has("c"), first.get("c")]).toEqual([
      false,
      undefined,
      true,
      undefined,
    ]);
    old.set("d", 4);
    first.set("b", 20).set("e", 5);
    expect([old.get("b"), old.has("e"), first.has("d")]).toEqual([2, false, false]);
    // A fork of a fork: its own entries and the dropped keys are copied; a key set again counts.
    const second = first.fork(["a", "e"]);
    second.set("a", 10);
    expect(entries(second)).toEqual([
      ["a", 10],
      ["b", 20],
      ["c", undefined],
    ]);
    expect(entries(first)).toEqual([
      ["a", 1],
      ["b", 20],
      ["c", undefined],
      ["e", 5],
    ]);
    // A fork of the old map after its first one: the base is shared, the old one's own entries copied.
    expect(entries(old.fork(["a"]))).toEqual([
      ["b", 2],
      ["c", undefined],
      ["d", 4],
    ]);
  });

  it("marks only the dropped keys its base holds, so keys never set do not bring the compaction closer", () => {
    const map = new LayeredMap<number, number>();
    map.set(0, 0).set(1, 1);
    const limit = compactAt(0);
    let fork = map.fork([5]);
    fork.set(7, 7);
    // Many keys neither the base nor the top holds, and one the top holds: no marker, no compaction.
    fork = fork.fork([7, ...Array.from({ length: limit * 2 }, (_, i) => 100 + i)]);
    expect(entries(fork)).toEqual([
      [0, 0],
      [1, 1],
    ]);
    fork.set(5, 50);
    expect([fork.get(5), fork.has(7), map.has(5)]).toEqual([50, false, false]);
  });

  it("gets a base of its own once the own entries and dropped keys reach compactAt", () => {
    let map = new LayeredMap<number, number>();
    const limit = compactAt(0);
    // One key more than the steps below drop: the compacted base keeps it.
    for (let key = 0; key <= limit; key++) {
      map.set(key, key);
    }
    const fork = map.fork([0]);
    // Below the limit the fork shares the base; from the limit on it gets one of its own.
    map = fork;
    for (let step = 1; step < limit; step++) {
      map = map.fork([step]);
      map.set(step, -step);
    }
    expect(entries(map)).toEqual(
      [
        ...Array.from({ length: limit - 1 }, (_, i) => [i + 1, -(i + 1)] as [number, number]),
        [limit, limit],
      ].sort(([a], [b]) => (String(a) < String(b) ? -1 : 1)),
    );
    expect(map.get(0)).toBeUndefined();
    expect(fork.get(5)).toBe(5);
  });
});
