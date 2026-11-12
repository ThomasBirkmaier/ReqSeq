#!/usr/bin/env node
// Renames the test name tags of this repository from the number of an acceptance criterion to its
// criterion key, `[SR-036/AK2]` -> `[SR-036/AK-k7f3]` (#1419, SR-029 AK10 and AK13). The key is read
// from the element file in spec/: the one at position n of `acceptance-criteria`. So the script is
// re-run from the spec whenever spec/ got new keys before the rename merged (keys come from the file
// content, #1418); it renames only number tags, so a second run changes nothing.
//
// Where a tag is renamed:
// - test files and cross-access scenario modules (as trace-check reads them): in the name of an
//   active test (`testNameStrings`) and in comments; a tag in another string is test data or the name
//   of a skipped test and is left, and listed, except in the files of `RUN_TIME_NAMES`, whose strings
//   build test names at run time;
// - other source files (.ts, .tsx, .js, .mjs): in comments only;
// - Markdown files: everywhere, since they cite tests by their names (verification/, package docs).
// A tag whose SR is not in spec/, whose number has no criterion there, or whose criterion has no key
// that no other criterion of the SR carries is left and listed. The files of `EXCLUDED` use a tag as
// an example of the format, not as a reference, and are changed by hand.
//
// Usage: node scripts/criterion-keys/rename-tags.mjs [--check]
// --check writes nothing and exits with 1 when a tag would be renamed.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { keyOf, readSpec, scanSource, testNameStrings } from "../trace-check/trace-check.mjs";

const NUMBER_TAG = /\[(SR-\d{3})\/AK(\d+)\]/g;
const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "coverage",
  "spec",
  ".reqseq",
  "test-results",
  ".claude",
]);
const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|mjs)$/;
const SCENARIO_MODULE = /(^|\/)test\/cross-access\/scenarios\/[^/]+\/[^/]+\.ts$/;
const SOURCE_FILE = /\.(ts|tsx|js|mjs)$/;
// Files whose tags are examples of the format, as paths from the root with `/`.
export const EXCLUDED = new Set([
  "CLAUDE.md",
  "README.md",
  // Its number reference is the example of a refused one.
  "docs/guide/how-to/give-acceptance-criteria-their-keys.md",
  "scripts/criterion-keys/rename-tags.mjs",
  "scripts/criterion-keys/rename-tags.test.mjs",
  "scripts/spec-migrate/convert.mjs",
  "scripts/trace-check/trace-check.mjs",
  "scripts/trace-check/trace-check.test.mjs",
]);

// Test files whose tags in other strings are parts of test names built at run time, so every tag counts.
export const RUN_TIME_NAMES = new Set(["packages/core/src/commands/no-status-change.test.ts"]);

/** The key tag for `[id/AKn]` from spec/, or why there is none. */
export function keyTag(spec, id, n) {
  const sr = spec.srs.get(id);
  if (sr === undefined) {
    return { why: `${id} is not in spec/` };
  }
  const key = keyOf(sr.criteria[n - 1]);
  if (key === undefined) {
    return { why: `${id} has no acceptance criterion AK${n} with a criterion key` };
  }
  if (sr.criteria.filter((item) => keyOf(item) === key).length > 1) {
    return { why: `${id} has more than one acceptance criterion with the key ${key}` };
  }
  return { tag: `[${id}/AK-${key}]` };
}

/** How a file is read: `test`, `source`, `doc`, or undefined for a file the script leaves alone. */
export function modeOf(file) {
  if (EXCLUDED.has(file)) {
    return undefined;
  }
  if (TEST_FILE.test(file) || SCENARIO_MODULE.test(file)) {
    return "test";
  }
  if (SOURCE_FILE.test(file)) {
    return "source";
  }
  return file.endsWith(".md") ? "doc" : undefined;
}

/**
 * The text of `file` with its number tags renamed (see the file comment), and each tag it renamed
 * and left: { text, renamed: [{ from, to, line }], left: [{ tag, line, why }] }.
 */
export function renameText(spec, text, file, mode) {
  const { strings } = mode === "doc" ? { strings: [] } : scanSource(text);
  const names = new Set(mode === "test" ? testNameStrings(text, file).map((s) => s.start) : []);
  const renamed = [];
  const left = [];
  let line = 1;
  let last = 0;
  const lineAt = (offset) => {
    for (let i = last; i < offset; i++) {
      if (text[i] === "\n") {
        line++;
      }
    }
    last = offset;
    return line;
  };
  const out = text.replace(NUMBER_TAG, (tag, id, n, offset) => {
    const at = lineAt(offset);
    // A tag in a string counts when one of the strings around it is a test name (a template literal
    // holds the strings of its `${...}` parts).
    const containing = strings.filter((s) => offset > s.start && offset < s.end);
    if (containing.length > 0 && !containing.some((s) => names.has(s.start)) && !RUN_TIME_NAMES.has(file)) {
      left.push({ tag, line: at, why: "in a string that is no name of an active test" });
      return tag;
    }
    const to = keyTag(spec, id, Number(n));
    if (to.tag === undefined) {
      left.push({ tag, line: at, why: to.why });
      return tag;
    }
    renamed.push({ from: tag, to: to.tag, line: at });
    return to.tag;
  });
  return { text: out, renamed, left };
}

/** The files below root the script reads, as paths from root with `/`. */
export function candidateFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) {
        continue;
      }
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else if (entry.isFile()) {
        files.push(path.relative(root, p).split(path.sep).join("/"));
      }
    }
  };
  walk(root);
  return files.filter((file) => modeOf(file) !== undefined).sort();
}

/** Renames in every file below root; writes unless `check`. Returns the report lines and the counts. */
export function renameTags(root, { check = false } = {}) {
  const spec = readSpec(path.join(root, "spec"));
  const lines = [];
  const distinct = new Set();
  let count = 0;
  let files = 0;
  for (const file of candidateFiles(root)) {
    const p = path.join(root, file);
    const text = fs.readFileSync(p, "utf8");
    if (!/\[SR-\d{3}\/AK\d+\]/.test(text)) {
      continue;
    }
    const result = renameText(spec, text, file, modeOf(file));
    for (const { tag, line, why } of result.left) {
      lines.push(`left ${file}:${line} ${tag}: ${why}`);
    }
    if (result.renamed.length > 0) {
      files++;
      count += result.renamed.length;
      for (const { from } of result.renamed) {
        distinct.add(from);
      }
      if (!check) {
        fs.writeFileSync(p, result.text);
      }
    }
  }
  lines.push(
    `${check ? "would rename" : "renamed"} ${count} tags (${distinct.size} distinct) in ${files} files`,
  );
  return { lines, count, distinct: distinct.size, files };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const check = process.argv.includes("--check");
  const { lines, count } = renameTags(process.cwd(), { check });
  console.log(lines.join("\n"));
  process.exit(check && count > 0 ? 1 : 0);
}
