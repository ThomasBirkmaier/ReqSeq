// The acceptance criteria of an element (D-072, `acceptance-criteria.ts`): the key of the property
// with the meaning `acceptance-criteria`, the count of its values, and their criterion keys (SR-204).
import { describe, expect, it } from "vitest";
import type { CommandError } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import type { RandomInt } from "./acceptance-criteria.js";
import {
  acceptanceCriteriaKeyOf,
  carriedCriteria,
  criteriaCount,
  newCriterionKey,
  reconcileCriteria,
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
  const sequence = (...values: number[]): RandomInt => () => values.shift() ?? 0;

  it("[SR-204/AK1] makes a new key of a consonant and three letters or digits, retried until no criterion has it", () => {
    // b, then b, b, b: "bbbb" is taken, so the next draw gives "cbbb".
    const key = newCriterionKey(new Set(["bbbb"]), sequence(0, 0, 0, 0, 1, 0, 0, 0));
    expect(key).toBe("cbbb");
    expect(newCriterionKey(new Set())).toMatch(/^[bcdfghjkmnpqrstvwxyz][bcdfghjkmnpqrstvwxyz0-9]{3}$/u);
  });

  it("[SR-204/AK1] carries the keys of stored criteria, each at its first item only, and a key in a wrong form as its text", () => {
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

  it("[SR-204/AK4] keeps a key by text, never by position, and gives a new one to another text", () => {
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

  it("[SR-204/AK5] refuses a given key in a wrong form or given twice, with its position", () => {
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
      { index: 1, position: 2, reason: "criterion-key-invalid" },
    ]);
    expect(refused([{ key: "abcd", text: "A" }, { key: "abcd", text: "B" }])).toEqual([
      "input.invalid",
      { index: 1, position: 2, reason: "criterion-key-duplicate", criterionKey: "abcd" },
    ]);
  });

  it("gives keys only in the value of the acceptance criteria", () => {
    const model = metamodel([{ key: "ak", kind: "text", many: true, meaning: "acceptance-criteria" }]);
    expect(withCriterionKeys(model, "other", undefined, ["A"])).toEqual(["A"]);
    expect(withCriterionKeys(model, "ak", undefined, "A")).toBe("A");
    expect(withCriterionKeys(model, "ak", [{ key: "abcd", text: "A" }], ["A"])).toEqual([{ key: "abcd", text: "A" }]);
  });
});
