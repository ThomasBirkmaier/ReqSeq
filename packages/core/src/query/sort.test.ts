// compareNatural (#418): digit runs by number, everything else by code units; pure, no locale.
import { describe, expect, it } from "vitest";
import { compareNatural } from "./sort.js";

const sign = (n: number): number => Math.sign(n);

describe("compareNatural", () => {
  it("orders digit runs by number, not by text", () => {
    expect(sign(compareNatural("sr-9", "sr-10"))).toBe(-1);
    expect(sign(compareNatural("sr-10", "sr-100"))).toBe(-1);
    expect(sign(compareNatural("sr-100", "sr-9"))).toBe(1);
    expect(sign(compareNatural("sr-2-b", "sr-2-a"))).toBe(1);
    expect(sign(compareNatural("a1b10", "a1b9"))).toBe(1);
  });

  it("skips leading zeros: equal numbers compare equal whatever the zeros", () => {
    expect(compareNatural("sr-069", "sr-69")).toBe(0);
    expect(compareNatural("sr-0", "sr-000")).toBe(0);
    expect(compareNatural("sr-007x", "sr-7x")).toBe(0);
    expect(sign(compareNatural("sr-010", "sr-9"))).toBe(1);
    expect(sign(compareNatural("sr-009", "sr-10"))).toBe(-1);
    expect(sign(compareNatural("sr-007x", "sr-7y"))).toBe(-1);
  });

  it("is exact for runs longer than a double can hold", () => {
    const small = `x${"9".repeat(40)}`;
    const large = `x1${"0".repeat(40)}`;
    expect(sign(compareNatural(small, large))).toBe(-1);
    expect(sign(compareNatural(`${small}1`, `${small}0`))).toBe(1);
    expect(sign(compareNatural(`x${"1".repeat(30)}2`, `x${"1".repeat(30)}3`))).toBe(-1);
  });

  it("compares other characters, a digit against a non-digit, and non-ASCII digits by code units", () => {
    expect(sign(compareNatural("a", "b"))).toBe(-1);
    expect(sign(compareNatural("a1", "ab"))).toBe(-1);
    expect(sign(compareNatural("1", "a"))).toBe(-1);
    expect(sign(compareNatural("-", "1"))).toBe(-1);
    // Arabic-Indic digits are text: U+0661 is after every ASCII digit and letter.
    expect(sign(compareNatural("sr-١", "sr-9"))).toBe(1);
    expect(sign(compareNatural("sr-١٠", "sr-٢"))).toBe(-1);
  });

  it("puts a text before one it is a prefix of, and handles empty texts", () => {
    expect(compareNatural("", "")).toBe(0);
    expect(sign(compareNatural("", "a"))).toBe(-1);
    expect(sign(compareNatural("a", ""))).toBe(1);
    expect(sign(compareNatural("sr-1", "sr-1a"))).toBe(-1);
    expect(sign(compareNatural("sr-1a", "sr-1"))).toBe(1);
    expect(sign(compareNatural("sr-", "sr-0"))).toBe(-1);
    expect(compareNatural("sr-1", "sr-1")).toBe(0);
  });

  it("is antisymmetric and transitive on every text of length 0 to 3 over a small alphabet", () => {
    const alphabet = ["a", "A", "-", "0", "1", "9", "é"];
    let texts = [""];
    let layer = [""];
    for (let length = 1; length <= 3; length += 1) {
      layer = layer.flatMap((text) => alphabet.map((letter) => text + letter));
      texts = texts.concat(layer);
    }
    expect(texts).toHaveLength(1 + 7 + 49 + 343);
    for (const a of texts) {
      for (const b of texts) {
        expect(sign(compareNatural(a, b)) + sign(compareNatural(b, a))).toBe(0);
      }
    }
    // Transitivity: sorting with the comparison gives a sequence where every earlier text is <= every later one.
    const sorted = texts.toSorted(compareNatural);
    let violations = 0;
    sorted.forEach((earlier, i) => {
      for (const later of sorted.slice(i + 1)) {
        if (compareNatural(earlier, later) > 0) {
          violations += 1;
        }
      }
    });
    expect(violations).toBe(0);
    // And the triple check on a sample that includes every pair of the short texts.
    const short = texts.filter((text) => text.length <= 2);
    for (const a of short) {
      for (const b of short) {
        for (const c of short) {
          if (compareNatural(a, b) <= 0 && compareNatural(b, c) <= 0) {
            expect(compareNatural(a, c)).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  });
});
