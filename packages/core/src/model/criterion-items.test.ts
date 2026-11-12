// The reference of a test name to a criterion as element.get writes it and element.resolve and the
// app's "Go to" read it (SR-205 AK1, AK5): split at the first `/`, as enrich-junit reads a name.
import { describe, expect, it } from "vitest";
import { criterionReference, criterionReferenceOf } from "./criterion-items.js";

describe("criterionReferenceOf (SR-205 AK5)", () => {
  it("[SR-205/AK-ndnj] reads one bracket token, or a reference and a criterion suffix without brackets", () => {
    expect(criterionReferenceOf(criterionReference("SR-036", "k7f3"))).toEqual({
      ref: "SR-036",
      criterion: "k7f3",
    });
    expect(criterionReferenceOf("  SR-036/AK-k7f3 ")).toEqual({ ref: "SR-036", criterion: "k7f3" });
    expect(criterionReferenceOf("SR-036/AK2")).toEqual({ ref: "SR-036", criterion: 2 });
    expect(criterionReferenceOf("[SR-036/AK0]")).toEqual({ ref: "SR-036", malformed: "[SR-036/AK0]" });
    // A token that names the whole requirement.
    expect(criterionReferenceOf("[SR-036]")).toEqual({ ref: "SR-036" });
    expect(criterionReferenceOf("[SR-036/slow]")).toEqual({ ref: "SR-036" });
  });

  it("[SR-205/AK-ndnj] leaves other text alone: a plain reference, an identifier with `/`, a name with several tokens or stray brackets", () => {
    for (const text of ["SR-036", "SYS/REQ/001", "[SR-1] [SR-2]", "x [SR-036/AK-k7f3]", "A[1]/AK-k7f3"]) {
      expect(criterionReferenceOf(text)).toBeUndefined();
    }
  });
});
