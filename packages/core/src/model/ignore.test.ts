import { describe, expect, it } from "vitest";
import { compileGlob, ignoreMatcher } from "./ignore.js";

const matches = (pattern: string, paths: readonly string[]): readonly string[] =>
  paths.filter((p) => compileGlob(pattern).test(p));

describe("ignore globs", () => {
  it("anchors a pattern at the repository root and matches names literally", () => {
    expect(matches("docs", ["docs", "a/docs", "docsx", "Docs"])).toEqual(["docs"]);
    expect(matches("a.b+c(d)", ["a.b+c(d)", "aXb+c(d)"])).toEqual(["a.b+c(d)"]);
    expect(matches("[x]{y}", ["[x]{y}", "x"])).toEqual(["[x]{y}"]);
  });

  it("is case-sensitive on every OS", () => {
    expect(matches("Docs/*.md", ["Docs/a.md", "docs/a.md", "Docs/A.MD"])).toEqual(["Docs/a.md"]);
  });

  it("matches any characters within one name with * and one character with ?", () => {
    expect(matches("*.md", ["a.md", ".hidden.md", "sub/a.md"])).toEqual(["a.md", ".hidden.md"]);
    expect(matches("SR-??.md", ["SR-01.md", "SR-1.md", "SR-0/.md"])).toEqual(["SR-01.md"]);
  });

  it("matches any number of names with **, hidden ones included", () => {
    expect(matches("**", ["a", ".x/b.md"])).toEqual(["a", ".x/b.md"]);
    expect(matches("**/*.draft.md", ["a.draft.md", "x/.y/a.draft.md", "a.md"])).toEqual([
      "a.draft.md",
      "x/.y/a.draft.md",
    ]);
    expect(matches("a/**/b", ["a/b", "a/x/b", "a/x/.y/b", "a/xb"])).toEqual(["a/b", "a/x/b", "a/x/.y/b"]);
  });

  it("matches the folder itself with x/**, so the walk skips it as a whole", () => {
    expect(matches("docs/**", ["docs", "docs/a.md", "docs/.vuepress/b.md", "docsx"])).toEqual([
      "docs",
      "docs/a.md",
      "docs/.vuepress/b.md",
    ]);
  });

  it("drops a leading ./ or / and trailing slashes", () => {
    expect(matches("./site/", ["site", "site/a.md"])).toEqual(["site"]);
    expect(matches("/site/**", ["site", "site/a.md", "x/site"])).toEqual(["site", "site/a.md"]);
  });

  it("compiles a run of * within a name to one wildcard, so matching stays fast", () => {
    expect(compileGlob("a**********x").source).toBe("^a[^/]*x$");
    const glob = compileGlob("**********x");
    const started = performance.now();
    expect(glob.test("a".repeat(5000))).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("treats ** directly after ** as one **", () => {
    expect(compileGlob("**/**").source).toBe(compileGlob("**").source);
    expect(matches("**/**", ["a", "a/b"])).toEqual(["a", "a/b"]);
    expect(matches("a/**/**", ["a", "a/b", "a/b/c", "b"])).toEqual(["a", "a/b", "a/b/c"]);
    expect(matches("a/**/**/c", ["a/c", "a/b/c", "a/b"])).toEqual(["a/c", "a/b/c"]);
  });

  it("matches when any of several patterns does, and nothing without patterns", () => {
    const ignored = ignoreMatcher(["docs/**", "*.tmp.md"]);
    expect(["docs/a.md", "x.tmp.md", "req/a.md"].filter(ignored)).toEqual(["docs/a.md", "x.tmp.md"]);
    expect(ignoreMatcher([])("docs")).toBe(false);
  });
});
