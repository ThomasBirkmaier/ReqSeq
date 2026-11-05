import { describe, expect, it } from "vitest";
import { isKnownVersion, isOutdatedVersion, isVersion } from "./is-version.js";

const A = "n1:1111111111111111";
const B = "n1:2222222222222222";
const A2 = "n2:1111111111111111";
const B2 = "n2:2222222222222222";

describe("versions", () => {
  it("knows a version of any normal form and one of a form the tool computes", () => {
    expect(isVersion("n3:1111111111111111")).toBe(true);
    expect(isVersion("n1:11")).toBe(false);
    expect(isKnownVersion(A)).toBe(true);
    expect(isKnownVersion(A2)).toBe(true);
    expect(isKnownVersion("n3:1111111111111111")).toBe(false);
    expect(isKnownVersion(5)).toBe(false);
  });

  it("[SR-025] calls a link outdated when its version differs from the current one in its own form", () => {
    expect(isOutdatedVersion(A, { n1: B, n2: A2 })).toBe(true);
    expect(isOutdatedVersion(A, { n1: A, n2: B2 })).toBe(false);
    expect(isOutdatedVersion(A2, { n1: B, n2: A2 })).toBe(false);
    expect(isOutdatedVersion(A2, { n1: A, n2: B2 })).toBe(true);
    // A version of an unknown normal form is not compared, a missing current version is no
    // difference, and a stored value that is no text has none.
    expect(isOutdatedVersion("n3:1111111111111111", { n1: B, n2: B2 })).toBe(false);
    expect(isOutdatedVersion(A, undefined)).toBe(false);
    expect(isOutdatedVersion(undefined, { n1: B, n2: B2 })).toBe(false);
    expect(isOutdatedVersion(5, { n1: B, n2: B2 })).toBe(false);
  });
});
