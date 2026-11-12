// How an output names the criteria a record names (SR-205 AK2): `namedCriterion` and
// `criterionNameAt`. The counting through `elementCriteria` is tested in status.test.ts.
import { describe, expect, it } from "vitest";
import { resolveCriterionRefs } from "../model/index.js";
import { criterionNameAt, namedCriterion } from "./criteria.js";

const OLD = [{ key: "kred", text: "Red" }, "Plain old", { key: "kgon", text: "Gone" }];
const CURRENT = ["Plain", { key: "kred", text: "Red now" }];

const named = (ref: number | string, items: readonly unknown[] | undefined) => {
  const [resolved] = resolveCriterionRefs([ref], items, CURRENT);
  if (resolved === undefined) {
    throw new Error("nothing resolved");
  }
  return namedCriterion(resolved, CURRENT, items);
};

describe("namedCriterion (SR-205 AK2)", () => {
  it("[SR-205/AK2] names a criterion with the number of the current version, its key and text; a key the current version lacks without number, with the text of the named version; a number without key with that version's text", () => {
    // A number of the older version whose key the current version carries: current number, key, text.
    expect(named(1, OLD)).toEqual({ criterion: 2, key: "kred", text: "Red now" });
    // A key gone from the current version: the key and the old text, no number.
    expect(named("kgon", OLD)).toEqual({ key: "kgon", text: "Gone" });
    expect(named(3, OLD)).toEqual({ key: "kgon", text: "Gone" });
    // A number whose criterion had no key in the named version: that number and that version's text.
    expect(named(2, OLD)).toEqual({ criterion: 2, text: "Plain old" });
    // Without the items of the named version (no Git): the number or key as named, no text.
    expect(named(2, undefined)).toEqual({ criterion: 2 });
    expect(named("kxyz", undefined)).toEqual({ key: "kxyz" });
    // A number beyond the named version, and a key it lacks.
    expect(named(9, OLD)).toEqual({ criterion: 9 });
    expect(named("kxyz", OLD)).toEqual({ key: "kxyz" });
  });

  it("names a position of the current items with its key and text where they are strings", () => {
    expect(criterionNameAt(CURRENT, 1)).toEqual({ criterion: 1, text: "Plain" });
    expect(criterionNameAt(CURRENT, 2)).toEqual({ criterion: 2, key: "kred", text: "Red now" });
    expect(criterionNameAt([null], 1)).toEqual({ criterion: 1 });
  });

  it("names a key of another form as none, as element.get does (SR-204 AK5)", () => {
    expect(criterionNameAt([{ key: "KDAS", text: "Upper" }], 1)).toEqual({ criterion: 1, text: "Upper" });
    const [resolved] = resolveCriterionRefs([1], [{ key: "KDAS", text: "Upper old" }], ["Gone"]);
    expect(
      resolved === undefined
        ? undefined
        : namedCriterion(resolved, ["Gone"], [{ key: "KDAS", text: "Upper old" }]),
    ).toEqual({
      criterion: 1,
      text: "Upper old",
    });
  });
});
