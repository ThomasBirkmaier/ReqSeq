#!/usr/bin/env node
// The countable part of the issue check (spec-change, step 8): it compares the SR line of an epic
// with the SR lines of its sub-issues, and with the acceptance criteria of the SRs a spec PR added or
// changed. It reports every acceptance criterion of the epic that no sub-issue carries, every one a
// sub-issue carries that the epic does not name, every one of a required SR that no sub-issue carries,
// and every number that the SR in spec/ does not have. The reading of the issues against the concept
// and the approved wording stays with the agent that runs the check.
//
// An SR line reads `SR: SR-210 (AK1–AK7), SR-139 (AK6)` (CLAUDE.md, Issues): numbers and ranges with
// `-` or `–`; an SR without parentheses stands for all of its criteria.
//
// Usage: node scripts/issue-check/issue-check.mjs --epic <n> [--require "SR-210, SR-061 (AK2)"]
// --require names what the spec PR added or changed: an SR alone for all its criteria (a new SR),
// an SR with criteria for those only.
// Reads the issues with `gh api` (REST) and spec/ from the working directory; exits with 1 on a gap.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readSpec } from "../trace-check/trace-check.mjs";

const ALL = "all";
const ENTRY = /(SR-\d{3})(?:\s*\(([^)]*)\))?/g;

/**
 * Parses the `SR:` line of an issue body (or a bare list in that format) into a map of SR to a set
 * of criterion numbers, or `all`. Each part it cannot read is pushed to `unreadable`.
 */
export function parseSrLine(body, unreadable = []) {
  const line = String(body ?? "")
    .split(/\r?\n/)
    .find((l) => /^\s*SR:/.test(l) || /^\s*SR-\d{3}/.test(l));
  const result = new Map();
  if (line === undefined) {
    return result;
  }
  for (const [, sr, list] of line.replace(/^\s*SR:/, "").matchAll(ENTRY)) {
    if (list === undefined) {
      result.set(sr, ALL);
      continue;
    }
    const numbers = result.get(sr) instanceof Set ? result.get(sr) : new Set();
    for (const part of list.split(",")) {
      const range = part.trim().match(/^AK(\d+)(?:\s*[-–]\s*(?:AK)?(\d+))?$/);
      const from = Number(range?.[1]);
      const to = range?.[2] === undefined ? from : Number(range[2]);
      if (range === null || to < from) {
        unreadable.push(`${sr} (${part.trim()})`);
        continue;
      }
      for (let n = from; n <= to; n += 1) {
        numbers.add(n);
      }
    }
    if (result.get(sr) !== ALL) {
      result.set(sr, numbers);
    }
  }
  return result;
}

/** Expands `all` to the criterion numbers of the SR in spec/; an unknown SR stays empty. */
function numbersOf(entry, sr, counts) {
  if (entry === ALL) {
    return new Set(Array.from({ length: counts.get(sr) ?? 0 }, (_, i) => i + 1));
  }
  return entry ?? new Set();
}

/** The criterion numbers per SR that a list of issues carries together. */
function unionOf(issues, counts, unreadable) {
  const union = new Map();
  for (const issue of issues) {
    for (const [sr, entry] of parseSrLine(issue.body, unreadable)) {
      union.set(sr, new Set([...(union.get(sr) ?? []), ...numbersOf(entry, sr, counts)]));
    }
  }
  return union;
}

/** Pushes `message(sr, numbers)` for each SR of `from` with numbers that `to` lacks. */
function pushMissing(problems, from, to, message) {
  for (const [sr, numbers] of from) {
    const missing = [...numbers].filter((n) => !to.get(sr)?.has(n));
    if (missing.length > 0) {
      problems.push(message(sr, list(missing)));
    }
  }
}

/**
 * Compares the epic with its sub-issues and the required SRs. `counts` maps an SR to the number of
 * its acceptance criteria in spec/. Returns one line per gap.
 */
export function checkIssues({ epic, subs, required = new Map(), counts }) {
  const problems = [];
  const unreadable = [];
  const union = unionOf(subs, counts, unreadable);
  const named = unionOf([epic], counts, unreadable);
  pushMissing(
    problems,
    named,
    union,
    (sr, l) => `#${epic.number} names ${sr} ${l}, but no sub-issue carries it`,
  );
  pushMissing(
    problems,
    union,
    named,
    (sr, l) => `a sub-issue carries ${sr} ${l}, but #${epic.number} does not name it`,
  );
  const known = new Map(
    [...required].filter(([sr]) => counts.has(sr)).map(([sr, e]) => [sr, numbersOf(e, sr, counts)]),
  );
  for (const sr of required.keys()) {
    if (!counts.has(sr)) {
      problems.push(`${sr} is not in spec/`);
    }
  }
  pushMissing(problems, known, union, (sr, l) => `${sr} ${l} is in no sub-issue`);
  for (const [sr, numbers] of unionOf([epic, ...subs], counts, [])) {
    const beyond = [...numbers].filter((n) => counts.has(sr) && n > counts.get(sr));
    if (beyond.length > 0) {
      problems.push(`${sr} has ${counts.get(sr)} criteria in spec/, not ${list(beyond)}`);
    }
  }
  return [...problems, ...unreadable.map((part) => `cannot read ${part} in an SR line`)];
}

const list = (numbers) =>
  [...new Set(numbers)]
    .sort((a, b) => a - b)
    .map((n) => `AK${n}`)
    .join(", ");

/** Reads one REST path with `gh api`. */
function ghApi(route) {
  return JSON.parse(execFileSync("gh", ["api", route], { encoding: "utf8" }));
}

/** Maps each SR in spec/ to the number of its acceptance criteria. */
export function criterionCounts(specDir) {
  return new Map([...readSpec(specDir).srs].map(([id, sr]) => [id, sr.criteria.length]));
}

/** Runs the check for an epic; `api` and `counts` are replaceable for tests. */
export function run({
  epicNumber,
  required,
  specDir,
  api = ghApi,
  counts = criterionCounts(specDir),
  repo = "ThomasBirkmaier/ReqSeq",
}) {
  const epic = api(`repos/${repo}/issues/${epicNumber}`);
  const subs = api(`repos/${repo}/issues/${epicNumber}/sub_issues?per_page=100`);
  const problems = checkIssues({ epic, subs, required, counts });
  const subList = subs.map((s) => `#${s.number}`).join(", ") || "none";
  return {
    problems,
    lines: [
      `epic #${epic.number}, sub-issues ${subList}`,
      ...(problems.length > 0 ? problems : ["every criterion is in a sub-issue"]),
    ],
  };
}

/**
 * Reads `--epic <n>` and `--require <list>` from the arguments. The list has the format of an SR
 * line, `SR-210, SR-061 (AK2)`: an SR alone requires all its criteria. Returns `error` for an
 * unknown argument or a part it cannot read.
 */
export function parseArgs(argv) {
  const required = new Map();
  const unreadable = [];
  let epicNumber;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--epic") {
      epicNumber = Number(argv[(i += 1)]);
    } else if (argv[i] === "--require") {
      for (const [sr, entry] of parseSrLine(String(argv[(i += 1)] ?? ""), unreadable)) {
        required.set(sr, entry);
      }
    } else {
      return { epicNumber, required, error: `unknown argument ${argv[i]}` };
    }
  }
  if (unreadable.length > 0) {
    return { epicNumber, required, error: `cannot read ${unreadable.join(", ")} in --require` };
  }
  return { epicNumber, required };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const { epicNumber, required, error } = parseArgs(process.argv.slice(2));
  if (error !== undefined || !Number.isInteger(epicNumber)) {
    console.error(
      error ??
        'usage: node scripts/issue-check/issue-check.mjs --epic <n> [--require "SR-210, SR-061 (AK2)"]',
    );
    process.exit(2);
  }
  const { lines, problems } = run({ epicNumber, required, specDir: path.join(process.cwd(), "spec") });
  console.log(lines.join("\n"));
  process.exit(problems.length > 0 ? 1 : 0);
}
