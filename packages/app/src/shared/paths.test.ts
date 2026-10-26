import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodedPath, isInside } from "./paths.js";

describe("isInside", () => {
  const root = path.resolve("/workspace/system");

  it("is true below the folder only", () => {
    expect(isInside(root, path.join(root, "images", "a.png"))).toBe(true);
    expect(isInside(root, path.join(root, "..a.png"))).toBe(true);
    expect(isInside(root, root)).toBe(false);
    expect(isInside(root, path.resolve(root, "..", "other", "a.png"))).toBe(false);
    expect(isInside(root, path.resolve(root, "..", "system-copy", "a.png"))).toBe(false);
  });
});

describe("decodedPath", () => {
  it("decodes the path and drops its leading slashes", () => {
    expect(decodedPath(new URL("app://logreq/assets/a%20b.js"))).toBe("assets/a b.js");
    expect(decodedPath(new URL("logreq-file://system//images/x.png"))).toBe("images/x.png");
  });

  it("is undefined for a path that does not decode", () => {
    expect(decodedPath(new URL("app://logreq/%E0%A4%A"))).toBeUndefined();
  });
});
