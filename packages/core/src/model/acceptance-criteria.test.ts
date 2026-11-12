// The acceptance criteria of an element (D-072, `acceptance-criteria.ts`): the key of the property
// with the meaning `acceptance-criteria`, the count of its values, and their criterion keys (SR-204).
import { describe, expect, it } from "vitest";
import type { CommandError } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import type { RandomInt } from "./acceptance-criteria.js";
import { criterionLabel } from "./criterion-items.js";
import {
  acceptanceCriteriaKeyOf,
  carriedCriteria,
  compareCriterionRefs,
  criteriaCount,
  criteriaItemsOf,
  newCriterionKey,
  reconcileCriteria,
  resolveCriterionRefs,
  seededRandom,
  withCriterionKeys,
} from "./acceptance-criteria.js";

/** A metamodel with `properties` only, as far as the lookup reads it. */
const metamodel = (properties: readonly object[]): Metamodel => ({ properties }) as unknown as Metamodel;

describe("acceptance criteria (D-072)", () => {
  it("finds the property with the meaning once per metamodel, unless it cannot hold the list", () => {
    const model = metamodel([
      { key: "title", kind: "text", meaning: "title" },
      { key: "ak", kind: "text", many: true, meaning: "acceptance-criteria" },
    ]);
    expect(acceptanceCriteriaKeyOf(model)).toBe("ak");
    // Memoised: the same object gives the same key without a new search.
    (model.properties as object[]).length = 0;
    expect(acceptanceCriteriaKeyOf(model)).toBe("ak");
    expect(acceptanceCriteriaKeyOf(metamodel([]))).toBeUndefined();
    expect(
      acceptanceCriteriaKeyOf(metamodel([{ key: "ak", kind: "text", meaning: "acceptance-criteria" }])),
    ).toBeUndefined();
  });

  it("counts the values of a list, and none of another value or without the key", () => {
    expect(criteriaCount({ ak: ["a", "b", "c"] }, "ak")).toBe(3);
    expect(criteriaCount({ ak: "a" }, "ak")).toBe(0);
    expect(criteriaCount({}, "ak")).toBe(0);
    expect(criteriaCount({ ak: ["a"] }, undefined)).toBe(0);
  });
});

describe("criterion keys (SR-204)", () => {
  /** A random source that gives `values` in turn, then 0. */
  const sequence =
    (...values: number[]): RandomInt =>
    () =>
      values.shift() ?? 0;

  it("[SR-204/AK-qg2w] makes a new key of a consonant and three letters or digits, retried until no criterion has it", () => {
    // b, then b, b, b: "bbbb" is taken, so the next draw gives "cbbb".
    const key = newCriterionKey(new Set(["bbbb"]), sequence(0, 0, 0, 0, 1, 0, 0, 0));
    expect(key).toBe("cbbb");
    expect(newCriterionKey(new Set())).toMatch(/^[bcdfghjkmnpqrstvwxyz][bcdfghjkmnpqrstvwxyz0-9]{3}$/u);
  });

  it("draws the same keys from the same seed and other keys from another seed", () => {
    const keys = (seed: string): string[] => {
      const random = seededRandom(seed);
      return [newCriterionKey(new Set(), random), newCriterionKey(new Set(), random)];
    };
    expect(keys("a")).toEqual(keys("a"));
    expect(keys("a")[0]).not.toBe(keys("a")[1]);
    expect(keys("a")).not.toEqual(keys("b"));
  });

  it("[SR-204/AK-qg2w] carries the keys of stored criteria, each at its first item only, and a key in a wrong form as its text", () => {
    expect(
      carriedCriteria([
        { key: "first", text: "A" },
        "B",
        { key: "first", text: "C" },
        { key: "Bad", text: "D" },
        { text: "E" },
        5,
      ]),
    ).toEqual([{ key: "first", text: "A" }, "B", "C", "D", "E", 5]);
    expect(carriedCriteria("one")).toEqual([]);
  });

  it("[SR-204/AK-ftt1] keeps a key by text, never by position, and gives a new one to another text", () => {
    const previous = [
      { key: "aaaa", text: "A" },
      { key: "bbbb", text: "B" },
    ];
    expect(reconcileCriteria("ak", previous, ["B", "C", "A"], sequence(1, 1, 1, 1))).toEqual([
      { key: "bbbb", text: "B" },
      { key: "cccc", text: "C" },
      { key: "aaaa", text: "A" },
    ]);
    // Unchanged texts without a given key: the stored items as they are, also without keys.
    const unkeyed = ["A", "B"];
    expect(reconcileCriteria("ak", unkeyed, ["A", { text: "B" }])).toBe(unkeyed);
    // No previous list: every entry gets a key; an item that is no text stays as it is.
    expect(reconcileCriteria("ak", "one", ["A", 5], sequence(2, 2, 2, 2))).toEqual([
      { key: "dddd", text: "A" },
      5,
    ]);
  });

  it("[SR-204/AK-b2q6] refuses a given key in a wrong form or given twice, with its position", () => {
    const refused = (next: unknown[]): unknown => {
      try {
        reconcileCriteria("ak", [], next);
      } catch (error) {
        return [(error as CommandError).code, (error as CommandError).details];
      }
      return undefined;
    };
    expect(refused(["A", { key: undefined, text: "B" }])).toEqual([
      "input.invalid",
      { key: "ak", index: 1, position: 2, reason: "criterion-key-invalid" },
    ]);
    expect(
      refused([
        { key: "abcd", text: "A" },
        { key: "abcd", text: "B" },
      ]),
    ).toEqual([
      "input.invalid",
      { key: "ak", index: 1, position: 2, reason: "criterion-key-duplicate", criterionKey: "abcd" },
    ]);
  });

  it("gives keys only in the value of the acceptance criteria", () => {
    const model = metamodel([{ key: "ak", kind: "text", many: true, meaning: "acceptance-criteria" }]);
    expect(withCriterionKeys(model, "other", undefined, ["A"])).toEqual(["A"]);
    expect(withCriterionKeys(model, "ak", undefined, "A")).toBe("A");
    expect(withCriterionKeys(model, "ak", [{ key: "abcd", text: "A" }], ["A"])).toEqual([
      { key: "abcd", text: "A" },
    ]);
  });
});

describe("criteria a record names (D-072, SR-031 AK11)", () => {
  const current = [
    { key: "kone", text: "One" },
    "Two",
    { key: "kdup", text: "A" },
    { key: "kdup", text: "B" },
  ];

  it("resolves keys against the current items and numbers of an older version through their key there", () => {
    const old = ["Plain", { key: "kone", text: "One before" }, { key: "kold", text: "Gone" }];
    expect(resolveCriterionRefs([1, 2, 9, "kone", "kdup", "kxyz"], current, current)).toEqual([
      { ref: 1, position: 1, key: "kone" },
      { ref: 2, position: 2 },
      { ref: 9, problem: "unknown-number" },
      { ref: "kone", position: 1, key: "kone" },
      { ref: "kdup", problem: "duplicate-key", key: "kdup" },
      { ref: "kxyz", problem: "unknown-key", key: "kxyz" },
    ]);
    expect(resolveCriterionRefs([1, 2, 3, 4], old, current)).toEqual([
      { ref: 1, problem: "no-key" },
      { ref: 2, position: 1, key: "kone" },
      { ref: 3, problem: "unknown-key", key: "kold" },
      { ref: 4, problem: "unknown-number" },
    ]);
    expect(resolveCriterionRefs([1], undefined, current)).toEqual([{ ref: 1, problem: "no-history" }]);
  });

  it("reads the items under the key, none without key, list or values", () => {
    expect(criteriaItemsOf({ ac: ["One"] }, "ac")).toEqual(["One"]);
    expect(criteriaItemsOf({ ac: "One" }, "ac")).toEqual([]);
    expect(criteriaItemsOf({ ac: ["One"] }, undefined)).toEqual([]);
    expect(criteriaItemsOf(undefined, "ac")).toEqual([]);
  });

  it("orders numbers ascending before keys in code-unit order", () => {
    expect(["kb", 3, "ka", 1, "ka"].sort(compareCriterionRefs)).toEqual([1, 3, "ka", "ka", "kb"]);
  });

  it("[SR-205/AK-m2vv] labels a criterion with number and key, number only, or key only", () => {
    expect(criterionLabel({ criterion: 2, key: "k7f3" })).toBe("AK2 (k7f3)");
    expect(criterionLabel({ criterion: 2 })).toBe("AK2");
    expect(criterionLabel({ key: "k7f3" })).toBe("AK-k7f3");
    expect(criterionLabel({})).toBe("AK-");
  });
});
