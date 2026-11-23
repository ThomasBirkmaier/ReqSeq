import { describe, expect, it } from "vitest";
import { verificationLabel } from "./verification.js";

describe("verificationLabel", () => {
  it("words the status alone without counted criteria, in both forms", () => {
    expect(verificationLabel({ status: "indirect" }, "long")).toBe("indirect");
    expect(verificationLabel({ status: "indirect" }, "short")).toBe("indirect");
  });

  it("counts the verified criteria: long with the ones not verified by number and key, short as a count", () => {
    const cell = {
      status: "open" as const,
      criteria: {
        verified: 1,
        total: 3,
        notVerified: [{ criterion: 2, key: "k7f3" }, { criterion: 3 }],
      },
    };
    expect(verificationLabel(cell, "long")).toBe("open, 1 of 3 criteria, AK2 (k7f3), AK3 not verified");
    expect(verificationLabel(cell, "short")).toBe("open · 1 of 3");
    expect(verificationLabel({ status: "verified", criteria: { verified: 3, total: 3 } }, "long")).toBe(
      "verified, 3 of 3 criteria",
    );
  });
});
