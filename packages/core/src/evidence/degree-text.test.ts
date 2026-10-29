// The display rule of the verification degree (SR-037, #592 Q3): one decimal, rounded down, on every access.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { degreePercent, degreeShareOf } from "./degree-text.js";

describe("degreePercent (SR-037)", () => {
  it("[SR-037/AK1] shows 6 of 10 as 60 %", () => {
    expect(degreePercent(6 / 10)).toBe("60 %");
  });

  it("rounds down to one decimal, so 100 % only when everything counted is verified (#592 Q3)", () => {
    expect([2 / 3, 9 / 14, 0.29, 1, 0, 1 / 3, 999 / 1000, 49_999 / 50_000].map(degreePercent)).toEqual([
      "66.6 %",
      "64.2 %",
      "29 %",
      "100 %",
      "0 %",
      "33.3 %",
      "99.9 %",
      "99.9 %",
    ]);
  });

  it("never drops a whole tenth for a fraction of up to 2,000 requirements", () => {
    const wrong: string[] = [];
    for (let n = 1; n <= 2000; n += 1) {
      for (let k = 0; k <= n; k += 1) {
        // Integer arithmetic: the exact tenths of k/n, rounded down.
        const exact = `${String(Math.floor((1000 * k) / n) / 10)} %`;
        if (degreePercent(k / n) !== exact) {
          wrong.push(`${String(k)}/${String(n)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("degreeShareOf (SR-037)", () => {
  it("gives the share of a value with a number share next to an object counts", () => {
    expect(degreeShareOf({ share: 0.6, total: 10, counts: { open: 2 } })).toBe(0.6);
  });

  it("gives nothing for any other value", () => {
    expect(
      [
        undefined,
        null,
        0.6,
        "0.6",
        [{ share: 0.6, counts: {} }],
        { total: 0, counts: {} },
        { share: "60 %", counts: {} },
        { share: 0.6 },
        { share: 0.6, counts: null },
        { share: 0.6, counts: [1, 2] },
        { share: 0.6, counts: 3 },
      ].map(degreeShareOf),
    ).toEqual(Array.from({ length: 11 }, () => undefined));
  });
});

describe("degree-text.ts (SR-037)", () => {
  it("imports nothing: the app's renderer loads it as @reqseq/core/verification-degree, without the rest of core", async () => {
    const source = await readFile(new URL("degree-text.ts", import.meta.url), "utf8");
    expect(source.split("\n").filter((line) => /^\s*(import|export .* from)\b/.test(line))).toEqual([]);
  });
});
