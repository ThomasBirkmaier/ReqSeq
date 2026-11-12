#!/usr/bin/env node
// `pnpm mutate <files>`: a local mutation run of chosen source files with Stryker (#1335). Never in CI.
// Usage: mutate.mjs <packages/<pkg>/src/... .ts files> [--tests <glob>]... [--concurrency <n>]
// It runs the unit tests of the packages the files belong to (or those of `--tests`), prints the score per file and the surviving
// mutants, and writes Stryker's JSON report to test-results/mutation/mutation.json. Static mutants (module-level
// code, which the runner never reloads) are not run, because they would show as survived (ignoreStatic).
// Stryker opens no outbound connection, but its parent process listens on a random TCP port of all interfaces for the
// log lines of its workers, which connect over localhost: that port is reachable from the LAN while a run lasts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "../..");
export const REPORT = "test-results/mutation/mutation.json";
const USAGE = "Usage: pnpm mutate <packages/<pkg>/src/... .ts files> [--tests <glob>]... [--concurrency <n>]";
// Packages whose tests import @reqseq/core through its build (packages/core/dist), not its sources.
const NEEDS_CORE_BUILD = new Set(["api", "app", "cli", "mcp"]);

/**
 * The tests left out of every run, by a part of their name, with the reason: they fail under instrumentation although
 * the code is right, so they would fail the dry run.
 */
const EXCLUDED_TESTS = [
  // Timing tests miss their bound under instrumentation (model/markdown-links.test.ts: 16 s against 10 s).
  "linear time",
  "N-036",
];
/** The same, only when a file of the package is mutated. */
const EXCLUDED_TESTS_OF = {
  // [SR-079/AK-yvqq] in api/src/server.test.ts reads server.ts, listen.ts, handler.ts and index.ts from disk and matches
  // their text; Stryker's instrumented copies hold its mutant switches (`process.env`, more `.listen(` calls).
  api: ["has no address option"],
};

/** The parts of the names of the tests a run over the files of `packages` leaves out. */
export const excludedTests = (packages) => [
  ...EXCLUDED_TESTS,
  ...packages.flatMap((p) => EXCLUDED_TESTS_OF[p] ?? []),
];

/**
 * The source files and options of the command line `argv` (without node and the script). Files are made relative
 * to `root`, from `cwd` (pnpm runs scripts in the root; INIT_CWD is where it was called).
 */
export function parseArgs(argv, { root = ROOT, cwd = process.env.INIT_CWD ?? process.cwd() } = {}) {
  const files = [];
  const tests = [];
  let concurrency;
  let i = 0;
  const value = (option, what) => {
    const next = argv[++i];
    if (next === undefined || next.startsWith("-")) {
      throw new Error(`${option} needs ${what}`);
    }
    return next;
  };
  for (; i < argv.length; i++) {
    if (argv[i] === "--tests") {
      tests.push(value("--tests", "a glob"));
    } else if (argv[i] === "--concurrency") {
      concurrency = Number(value("--concurrency", "a whole number of at least 1"));
      if (!Number.isInteger(concurrency) || concurrency < 1) {
        throw new Error("--concurrency needs a whole number of at least 1");
      }
    } else if (argv[i].startsWith("-")) {
      throw new Error(`unknown option ${argv[i]}`);
    } else {
      files.push(path.relative(root, path.resolve(cwd, argv[i])).replaceAll("\\", "/"));
    }
  }
  if (files.length === 0) {
    throw new Error("name at least one source file");
  }
  return { files, tests, concurrency };
}

/** The package of each file (`core` for `packages/core/src/x.ts`); a test or a file outside a package's `src/` fails. */
export function packagesOf(files) {
  const packages = new Set();
  for (const file of files) {
    const match = /^packages\/([^/]+)\/src\/.+\.tsx?$/.exec(file);
    if (!match || /\.test\.tsx?$/.test(file)) {
      throw new Error(`${file} is no source file under packages/<pkg>/src/`);
    }
    packages.add(match[1]);
  }
  return [...packages].sort();
}

/** The unit test globs of `packages` (e2e, perf and delivery tests stay out through the base config). */
export const testGlobs = (packages) =>
  packages.flatMap((pkg) => [`packages/${pkg}/src/**/*.test.ts`, `packages/${pkg}/test/**/*.test.ts`]);

/** The Stryker options of a run over `files`. */
export const strykerOptions = ({ files, concurrency }) => ({
  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
  // In worker threads vi.stubEnv("HOME") does not reach os.homedir(), so listFolder.test.ts fails the dry run.
  vitest: { configFile: "scripts/mutate/vitest.mutate.config.mjs", pool: "forks" },
  mutate: files,
  coverageAnalysis: "perTest",
  // Module-level mutants show as survived although the runner never reloads the module (about 5 % of them).
  ignoreStatic: true,
  dryRunTimeoutMinutes: 30,
  ...(concurrency ? { concurrency } : {}),
  reporters: ["json", "progress-append-only"],
  jsonReporter: { fileName: REPORT },
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
  // Not copied into the sandbox; anchored at the root, because `delivery` alone also matches fixtures/SR-053/delivery.
  // Builds (dist) stay: the adapters' tests read packages/core/dist.
  ignorePatterns: [
    "/.claude/worktrees",
    "/test-results",
    "/coverage",
    "/build",
    "/delivery",
    "packages/app/out",
    "packages/docs/site/node_modules",
    "toolchain/packaging/node_modules",
  ],
});

/** Mutation score in percent: killed and timed-out mutants of all that were run and valid. */
const score = (c) => {
  const detected = c.Killed + c.Timeout;
  const valid = detected + c.Survived + c.NoCoverage;
  return valid === 0 ? "n/a" : ((100 * detected) / valid).toFixed(1);
};

const emptyCounts = () => ({ Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0, Errors: 0, Ignored: 0 });

/** Counts per file and in total, and the survivors (status Survived or NoCoverage) without static mutants. */
export function summarize(results, root = ROOT) {
  const files = new Map();
  const total = emptyCounts();
  const survivors = [];
  for (const m of results) {
    const file = path.relative(root, path.resolve(root, m.fileName)).split(path.sep).join("/");
    if (!files.has(file)) {
      files.set(file, emptyCounts());
    }
    const key = m.static && m.status !== "Ignored" ? "Ignored" : m.status in total ? m.status : "Errors";
    files.get(file)[key]++;
    total[key]++;
    if ((m.status === "Survived" || m.status === "NoCoverage") && !m.static) {
      const { line, column } = m.location.start;
      survivors.push(
        `${file}:${line}:${column} ${m.mutatorName}${m.replacement ? ` -> ${m.replacement}` : ""}`,
      );
    }
  }
  return { files: [...files].sort(([a], [b]) => a.localeCompare(b)), total, survivors };
}

/** The summary as text: one line per file, the total, then the survivors. */
export function format({ files, total, survivors }) {
  const width = Math.max(5, ...files.map(([f]) => f.length));
  const row = (name, c) =>
    `${name.padEnd(width)}  ${String(score(c)).padStart(5)}  killed ${c.Killed}  timeout ${c.Timeout}  survived ${c.Survived}  no coverage ${c.NoCoverage}  errors ${c.Errors}  static ${c.Ignored}`;
  const lines = [`${"file".padEnd(width)}  score`, ...files.map(([f, c]) => row(f, c)), row("total", total)];
  lines.push("", survivors.length ? `Survivors (${survivors.length}):` : "No survivors.", ...survivors);
  return lines.join("\n");
}

async function main(argv) {
  let args;
  let packages;
  try {
    args = parseArgs(argv);
    packages = packagesOf(args.files);
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    return 2;
  }
  const missing = args.files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (missing.length) {
    console.error(`not found: ${missing.join(", ")}`);
    return 2;
  }
  if (
    packages.some((p) => NEEDS_CORE_BUILD.has(p)) &&
    !fs.existsSync(path.join(ROOT, "packages/core/dist"))
  ) {
    console.error("The tests of cli, api, mcp and app read packages/core/dist: run `pnpm build` first.");
    return 2;
  }
  process.chdir(ROOT);
  // Read by vitest.mutate.config.mjs in Stryker's worker processes, which inherit the environment.
  process.env.REQSEQ_MUTATE_INCLUDE = JSON.stringify(args.tests.length ? args.tests : testGlobs(packages));
  process.env.REQSEQ_MUTATE_EXCLUDE = JSON.stringify(excludedTests(packages));
  const { Stryker } = await import("@stryker-mutator/core");
  const results = await new Stryker(strykerOptions(args)).runMutationTest();
  console.log(`\n${format(summarize(results))}\n\nReport: ${REPORT}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
