import { describe, expect, it } from "vitest";
import { fullOnHover, shortCommits } from "./commits.js";

const SHA1 = "a6730d7d61cd55d4a95a0ad2deb0089617885f5e";
const SHA256 = `${SHA1}0123456789abcdef01234567`;

describe("short commits", () => {
  it("cuts a full commit ID in a text to 7 characters and keeps the rest", () => {
    expect(shortCommits(`main@${SHA1} (macos-26)`)).toBe("main@a6730d7 (macos-26)");
    expect(shortCommits(SHA256)).toBe("a6730d7");
    expect(shortCommits(`${SHA1}, ${SHA1}`)).toBe("a6730d7, a6730d7");
  });

  it("leaves other values alone: short IDs, versions, longer hex words and upper case", () => {
    for (const text of [
      "a6730d7",
      "n2:2c4711e39fad856d",
      `${SHA1}0`,
      SHA1.toUpperCase(),
      "build 9.9.9",
      "",
    ]) {
      expect(shortCommits(text)).toBe(text);
    }
  });

  it("puts the full text on hover only where it was shortened", () => {
    expect(fullOnHover(`main@${SHA1}`)).toEqual({ title: `main@${SHA1}` });
    expect(fullOnHover("build 9.9.9")).toEqual({});
  });
});
