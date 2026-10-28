// The UUIDs that verification entries name (#588): variants of views and missing children.
import { describe, expect, it } from "vitest";
import { variantIdsOf, verificationNameIds } from "./names.js";

const P = "58858858-0000-4000-8000-0000000000";
const [V1, V2, C1, C2] = [`${P}c1`, `${P}c2`, `${P}b1`, `${P}b2`];

describe("verificationNameIds (#588)", () => {
  it("gives the variant of each view and the missing children, each once, in order; nothing for the core", () => {
    expect(
      verificationNameIds([
        { view: "core", status: "open", missingChildren: [C1, C2] },
        { view: V1, status: "indirect" },
        { view: V2, status: "open", missingChildren: [C2] },
        { view: V1, status: "verified" },
      ]),
    ).toEqual([C1, C2, V1, V2]);
    expect(verificationNameIds([{ view: "core", status: "verified" }])).toEqual([]);
  });

  it("variantIdsOf gives the variant of a view, none for the core", () => {
    expect([variantIdsOf("core"), variantIdsOf(V1)]).toEqual([[], [V1]]);
  });
});
