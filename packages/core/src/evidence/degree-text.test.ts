// The display rule of the verification degree (SR-037, ThomasBirkmaier/ReqSeq-archive#592 Q3): one decimal, rounded down, on every access.
import { describe, expect, it } from "vitest";
import { degreeClause, degreePercent, degreeShareOf, minimumHeadText } from "./degree-text.js";

describe("degreeClause (SR-037)", () => {
  const counts = { open: 0, verified: 0, indirect: 0, failed: 0, outdated: 0 };

  it("agrees noun and verb with the requirements counted, not with the verified ones (#2270)", () => {
    expect(degreeClause({ total: 1, share: 0, counts: { ...counts, open: 1 } }, " in the core")).toBe(
      "0 of 1 requirement in the core is verified or indirectly verified (0 %)",
    );
    expect(degreeClause({ total: 3, share: 1 / 3, counts: { ...counts, verified: 1, open: 2 } })).toBe(
      "1 of 3 requirements are verified or indirectly verified (33.3 %)",
    );
    expect(degreeClause({ total: 0, counts }, " in view core")).toBe(
      "0 of 0 requirements in view core are verified or indirectly verified",
    );
  });
});

describe("minimumHeadText (SR-153)", () => {
  it("names the rows that meet the minima, of those they apply to, and their share rounded down", () => {
    expect(minimumHeadText(2, 5, 2 / 5)).toBe("2 of 5 · 40 %");
    expect(minimumHeadText(2, 3, 2 / 3)).toBe("2 of 3 · 66.6 %");
  });
});

describe("degreePercent (SR-037)", () => {
  it("[SR-037/AK-zxtb] shows 6 of 10 as 60 %", () => {
    expect(degreePercent(6 / 10)).toBe("60 %");
  });

  it("rounds down to one decimal, so 100 % only when everything counted is verified (ThomasBirkmaier/ReqSeq-archive#592 Q3)", () => {
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
