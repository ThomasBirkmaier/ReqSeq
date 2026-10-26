import { describe, expect, it } from "vitest";
import { isN1Version, isOutdatedVersion, isVersion } from "./is-version.js";

const A = "n1:1111111111111111";
const B = "n1:2222222222222222";

describe("versions", () => {
  it("knows a version of any normal form and one of normal form 1", () => {
    expect(isVersion("n2:1111111111111111")).toBe(true);
    expect(isVersion("n1:11")).toBe(false);
    expect(isN1Version(A)).toBe(true);
    expect(isN1Version("n2:1111111111111111")).toBe(false);
    expect(isN1Version(5)).toBe(false);
  });

  it("[SR-025] calls a link outdated when its normal-form-1 version differs from the current one", () => {
    expect(isOutdatedVersion(A, B)).toBe(true);
    expect(isOutdatedVersion(A, A)).toBe(false);
    // A version of another normal form is not compared, a missing current version is no difference,
    // and a stored value that is no text has none.
    expect(isOutdatedVersion("n2:1111111111111111", B)).toBe(false);
    expect(isOutdatedVersion(A, undefined)).toBe(false);
    expect(isOutdatedVersion(undefined, B)).toBe(false);
    expect(isOutdatedVersion(5, B)).toBe(false);
  });
});
