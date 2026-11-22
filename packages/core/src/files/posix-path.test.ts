import path from "node:path";
import { describe, expect, it } from "vitest";
import { dirname, join, normalize, relative } from "./posix-path.js";

const PATHS = [
  "",
  ".",
  "..",
  "/",
  "//",
  "//a",
  "///a",
  "a",
  "a/",
  "a//",
  "./",
  "../",
  "a/b",
  "a//b",
  "a/./b",
  "a/../b",
  "a/..",
  "a/../",
  "a/../..",
  "../a/../../b/",
  "/a/b/",
  "/..",
  "/../a",
  "/a/../../b",
  "./a/./b/../c/",
  "requirements/SR-1.md",
  "a/b/c.png",
  "Ä/ö.png",
];

describe("posix-path", () => {
  it("normalizes and takes the folder as node:path does", () => {
    for (const p of PATHS) {
      expect([p, normalize(p)]).toEqual([p, path.posix.normalize(p)]);
      expect([p, dirname(p)]).toEqual([p, path.posix.dirname(p)]);
    }
  });

  it("joins as node:path does", () => {
    for (const a of PATHS) {
      for (const b of PATHS) {
        expect([a, b, join(a, b)]).toEqual([a, b, path.posix.join(a, b)]);
      }
    }
  });

  it("gives the path between two absolute paths as node:path does", () => {
    const absolute = PATHS.map((p) => `/${p}`);
    for (const a of absolute) {
      for (const b of absolute) {
        expect([a, b, relative(a, b)]).toEqual([a, b, path.posix.relative(a, b)]);
      }
    }
  });
});
