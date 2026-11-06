// The acceptance criteria of an element (D-072, `acceptance-criteria.ts`): the key of the property
// with the meaning `acceptance-criteria` and the count of its values.
import { describe, expect, it } from "vitest";
import type { Metamodel } from "../metamodel/index.js";
import { acceptanceCriteriaKeyOf, criteriaCount } from "./acceptance-criteria.js";

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
