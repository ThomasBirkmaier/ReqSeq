import { describe, expect, it } from "vitest";
import { CHECK_ORDER } from "./hint-order.js";
import { SINCE_BASELINE_CODES } from "./hints/since-baseline.js";

describe("CHECK_ORDER", () => {
  it("names the since-baseline codes as one rank, as the hints block gives them", () => {
    // `hint-order.ts` imports nothing, so it writes the codes as literals; this keeps them equal.
    expect(CHECK_ORDER.find((codes) => codes.includes([...SINCE_BASELINE_CODES][0] ?? ""))).toEqual([
      ...SINCE_BASELINE_CODES,
    ]);
  });
});
