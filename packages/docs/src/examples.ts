// Tested examples (SR-140 AK2): every `reqseq` command in a ```sh block of a guide page runs, in page order, in a
// fresh empty folder, with the command line of this build; a ```text title="Output" block right after it is the
// expected output of the block's last command. A failing example stops `docs:generate` and fails the docs test.
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { Readable } from "node:stream";
import { runCli } from "@reqseq/cli";

/** A hand-written page: its path below the guide folder, with `/`, and its Markdown. */
export interface GuidePage {
  readonly path: string;
  readonly text: string;
}

/** One command of an example: its line in the page, its arguments after `reqseq`, and the expected output. */
export interface Step {
  readonly line: number;
  readonly argv: readonly string[];
  readonly expected?: readonly string[];
}

/** What a command printed and its exit code. */
export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `reqseq` with these arguments in the folder `cwd`. */
export type CliRun = (argv: readonly string[], cwd: string) => Promise<CliResult>;

interface Block {
  readonly line: number;
  readonly lang: string;
  readonly meta: string;
  readonly lines: readonly string[];
  /** Only blank lines lie between the end of the previous block and this one. */
  readonly adjacent: boolean;
}

const FENCE = /^(`{3,}|~{3,})([^\s`]*)\s*(.*)$/;

/** A closing fence: only the fence character, at least as many as the opening fence. */
const closes = (line: string, fence: string): boolean => {
  const text = line.trim();
  return text.length >= fence.length && text === fence.charAt(0).repeat(text.length);
};

/** The fenced code blocks of a page, with the line of their opening fence (from 1); an unclosed one runs to the end. */
function blocks(text: string): Block[] {
  const found: Block[] = [];
  let open: (Block & { readonly fence: string; readonly lines: string[] }) | undefined;
  let prose = true;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (open !== undefined) {
      if (closes(line, open.fence)) {
        found.push(open);
        open = undefined;
        prose = false;
      } else {
        open.lines.push(line);
      }
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence === null) {
      prose ||= line.trim() !== "";
      continue;
    }
    // The three groups always take part in a match.
    const [, mark, lang, meta] = fence as unknown as [string, string, string, string];
    open = { line: index + 1, fence: mark, lang, meta, lines: [], adjacent: !prose };
  }
  return open === undefined ? found : [...found, open];
}

const SHELL = /[|&;<>()$`\\*?{}[\]~]/;

// A double-quoted part, a single-quoted part, blanks, a plain part, or a quote without its end.
const WORD_PARTS = /"([^"]*)"|'([^']*)'|(\s+)|([^\s"']+)|(["'])/g;

/** The words of a command line: split at blanks, '...' and "..." quote; shell features are refused. */
export function commandWords(line: string): string[] {
  const words: string[] = [];
  let word: string | undefined;
  for (const match of line.matchAll(WORD_PARTS)) {
    const [text, double, single, blank, , quote] = match;
    if (quote !== undefined) {
      throw new Error(`unclosed quote in \`${line}\``);
    }
    if (blank !== undefined) {
      words.push(...(word === undefined ? [] : [word]));
      word = undefined;
      continue;
    }
    const shell = double === undefined && single === undefined ? SHELL.exec(text) : null;
    if (shell !== null) {
      throw new Error(`\`${shell[0]}\` is a shell feature, which examples cannot use: \`${line}\``);
    }
    word = (word ?? "") + (double ?? single ?? text);
  }
  return word === undefined ? words : [...words, word];
}

const isOutput = (block: Block): boolean => block.lang === "text" && /\btitle="Output"/.test(block.meta);

/** The steps of a page: the commands of its ```sh blocks that start with `reqseq`, in order. */
export function pageSteps(page: GuidePage): Step[] {
  const found = blocks(page.text);
  const steps: Step[] = [];
  for (const [index, block] of found.entries()) {
    if (block.lang !== "sh") {
      continue;
    }
    const commands = block.lines
      .map((text, at) => ({ text: text.trim(), line: block.line + at + 1 }))
      .filter((command) => command.text !== "" && !command.text.startsWith("#"));
    const runnable = commands.filter((command) => /^reqseq(\s|$)/.test(command.text));
    if (runnable.length === 0) {
      continue;
    }
    if (runnable.length !== commands.length) {
      throw new Error(
        `${page.path}:${String(block.line)}: a block with \`reqseq\` commands has other commands too`,
      );
    }
    const next = found[index + 1];
    const expected = next !== undefined && next.adjacent && isOutput(next) ? next.lines : undefined;
    for (const [at, command] of runnable.entries()) {
      const argv = commandWords(command.text).slice(1);
      const last = at === runnable.length - 1 && expected !== undefined;
      steps.push(last ? { line: command.line, argv, expected } : { line: command.line, argv });
    }
  }
  return steps;
}

// A short ID (`N-7fe707`) or the 12-digit file name ID: in an expected output, a sample that stands for the ID the
// run gets; later commands get the run's ID in its place.
const ID = /\b([A-Z]{1,5})-([0-9a-f]{6}(?:[0-9a-f]{6})?)\b/g;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches one expected line (with `...` for any text and sample IDs): the sample and run ID pairs, or undefined. */
function matchLine(expected: string, actual: string): [string, string][] | undefined {
  const samples: string[] = [];
  const pattern = expected
    .split(/(\.\.\.|\b[A-Z]{1,5}-[0-9a-f]{6}(?:[0-9a-f]{6})?\b)/)
    .map((part, index) => {
      if (index % 2 === 0) {
        return escape(part);
      }
      if (part === "...") {
        return ".*";
      }
      samples.push(part);
      return `(${part.replace(/-.*/, "")}-[0-9a-f]{${String(part.length - part.indexOf("-") - 1)}})`;
    })
    .join("");
  const match = new RegExp(`^${pattern}$`).exec(actual);
  return match === null
    ? undefined
    : samples.map((sample, index): [string, string] => [sample, String(match[index + 1])]);
}

/** Adds the pairs to the IDs; undefined when a sample would stand for two IDs. */
const merge = (
  into: Map<string, string>,
  found: readonly [string, string][],
): Map<string, string> | undefined => {
  const merged = new Map(into);
  for (const [sample, id] of found) {
    if ((merged.get(sample) ?? id) !== id) {
      return undefined;
    }
    merged.set(sample, id);
  }
  return merged;
};

/** Matches the expected lines (a line `...` stands for any number of lines) and returns the merged IDs. */
function matchLines(
  expected: readonly string[],
  actual: readonly string[],
  ids: Map<string, string>,
): Map<string, string> | undefined {
  const [first, ...rest] = expected;
  if (first === undefined) {
    return actual.length === 0 ? ids : undefined;
  }
  if (first === "...") {
    for (let skip = 0; skip <= actual.length; skip += 1) {
      const found = matchLines(rest, actual.slice(skip), ids);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  const line = matchLine(first, actual[0] ?? "");
  const merged = actual.length === 0 || line === undefined ? undefined : merge(ids, line);
  return merged === undefined ? undefined : matchLines(rest, actual.slice(1), merged);
}

const outputLines = (text: string | readonly string[]): string[] => {
  const lines = (typeof text === "string" ? text.split(/\r?\n/) : [...text]).map((line) => line.trimEnd());
  while (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
};

/** Runs the steps of one page in `cwd`, in order, and returns what failed (empty when all passed). */
export async function runSteps(
  path: string,
  steps: readonly Step[],
  cwd: string,
  run: CliRun,
): Promise<string[]> {
  let ids = new Map<string, string>();
  for (const step of steps) {
    const argv = step.argv.map((arg) => arg.replace(ID, (sample) => ids.get(sample) ?? sample));
    const shown = `${path}:${String(step.line)}: reqseq ${argv.join(" ")}`;
    const result = await run(argv, cwd);
    if (result.exitCode !== 0) {
      return [`${shown}: exit code ${String(result.exitCode)}\n${result.stderr}${result.stdout}`];
    }
    if (step.expected !== undefined) {
      const found = matchLines(outputLines(step.expected), outputLines(result.stdout), ids);
      if (found === undefined) {
        return [`${shown}: the output differs from the page\n${result.stdout}`];
      }
      ids = found;
    }
  }
  return [];
}

/** The Markdown pages of the guide folder, sorted by path. */
export async function readGuidePages(guideDir: string): Promise<GuidePage[]> {
  const entries = await readdir(guideDir, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  return Promise.all(
    files.map(async (file) => ({
      path: relative(guideDir, file).split(sep).join("/"),
      text: await readFile(file, "utf8"),
    })),
  );
}

/** Runs the examples of every page, each page in a fresh empty folder; throws with every failure. */
export async function checkExamples(pages: readonly GuidePage[], run: CliRun): Promise<number> {
  const failures: string[] = [];
  let count = 0;
  for (const page of pages) {
    const steps = pageSteps(page);
    if (steps.length === 0) {
      continue;
    }
    count += steps.length;
    const cwd = await mkdtemp(join(tmpdir(), "reqseq-docs-"));
    try {
      failures.push(...(await runSteps(page.path, steps, cwd, run)));
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
  if (failures.length > 0) {
    throw new Error(`docs: failing examples\n${failures.join("\n")}`);
  }
  return count;
}

/** `reqseq` of this build, in-process, with empty standard input. */
export const runReqseq: CliRun = async (argv, cwd) => {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli({
    argv,
    cwd,
    stdin: Readable.from([]),
    stdout: { write: (text: string) => void (stdout += text) },
    stderr: { write: (text: string) => void (stderr += text) },
  });
  return { exitCode, stdout, stderr };
};

/** Words of the prose of a page: frontmatter and code blocks left out. */
export function proseWords(text: string): number {
  const body = text.replace(/^---\r?\n[^]*?\r?\n---\r?\n/, "").replace(/^(`{3,}|~{3,})[^]*?^\1\s*$/gm, "");
  return body.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** The word budget of a hand-written page (ADR-0017): above it, `docs:generate` warns. */
export const WORD_BUDGET = 600;

/** A warning for each page above the word budget. */
export const wordWarnings = (pages: readonly GuidePage[]): string[] =>
  pages
    .map((page) => ({ page, words: proseWords(page.text) }))
    .filter(({ words }) => words > WORD_BUDGET)
    .map(
      ({ page, words }) =>
        `${page.path} has ${String(words)} words, above the budget of ${String(WORD_BUDGET)}`,
    );
