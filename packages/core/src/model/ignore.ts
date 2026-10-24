// The `ignore` globs of the workspace file (workspace.schema.json): paths relative to each
// repository that are never read as elements. One fixed dialect on every OS, compiled once per
// pattern; the element walk (discover.ts) uses it, and so will the watcher (SR-007).
//
// Dialect: `/` separates folders; `*` matches any characters within one name, `?` one character,
// `**` as a whole name matches any number of names, including none. Every other character is
// literal (no `[...]` classes, no `{a,b}`). Matching is case-sensitive, and `*`, `?` and `**` match
// names starting with `.` too. A pattern is anchored at the repository root; a leading `/` or `./`
// and a trailing `/` are dropped. `x/**` also matches `x` itself, so the folder is skipped as a
// whole. A run of `*` within a name is one `*`, and `**/**` is one `**`, so no pattern can make the
// RegExp backtrack exponentially. workspace.schema.json refuses `\` and `//` in a pattern.

/** Characters that mean something in a RegExp, plus the glob wildcards `*` and `?`. */
const SPECIAL = /[.+^${}()|[\]\\*?]/g;

const nameSource = (name: string): string =>
  name
    .replace(/\*+/g, "*")
    .replace(SPECIAL, (ch) => (ch === "*" ? "[^/]*" : ch === "?" ? "[^/]" : `\\${ch}`));

/** The RegExp of one glob of the dialect above. */
export const compileGlob = (pattern: string): RegExp => {
  const names = pattern
    .replace(/^\.?\//, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter((name, i, all) => name !== "**" || all[i - 1] !== "**");
  let source = "";
  // Whether the next name needs a `/` before it (false at the start and after a leading or inner `**`).
  let separate = false;
  for (const [i, name] of names.entries()) {
    if (name !== "**") {
      source += `${separate ? "/" : ""}${nameSource(name)}`;
      separate = true;
    } else if (names.length === 1) {
      source += ".*";
    } else if (i === names.length - 1) {
      source += "(?:/.*)?";
    } else {
      source += separate ? "/(?:.*/)?" : "(?:.*/)?";
      separate = false;
    }
  }
  return new RegExp(`^${source}$`, "u");
};

/** A test for repository-relative paths (`/` separators) that is true when any of `patterns` matches. */
export const ignoreMatcher = (patterns: readonly string[]): ((relativePath: string) => boolean) => {
  const compiled = patterns.map(compileGlob);
  return (relativePath) => compiled.some((glob) => glob.test(relativePath));
};
