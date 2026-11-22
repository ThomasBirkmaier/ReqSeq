// `pnpm lint`: ESLint over the whole repository, in one process per group of files (#2215).
//
// Typed linting (ADR-0016) builds one TypeScript program per tsconfig, and one ESLint process keeps every program it
// built until it ends. Over the whole repository that held about 3.5 GB of live heap, near the 4 GB limit, and the
// `static` job ran out of memory now and then. core holds most of it (about 1.2 GB when linted alone), so it gets a
// process of its own and the rest a second; the two run at once. Every file is still linted with the same
// configuration, and a file's result does not depend on the other files of its process.
//
// Usage: node scripts/lint/lint.mjs [extra ESLint arguments, e.g. --fix]
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The packages linted in a process of their own; the last group lints everything else. */
export const OWN_PROCESS = ["packages/core"];

/** The ESLint arguments of each process: one per package of OWN_PROCESS, then the rest of the repository. */
export function lintGroups(extra = []) {
  const common = ["--max-warnings", "0", ...extra];
  const rest = OWN_PROCESS.flatMap((dir) => ["--ignore-pattern", `${dir}/**`]);
  return [...OWN_PROCESS.map((dir) => [dir, ...common]), [".", ...rest, ...common]];
}

/** Runs one ESLint process with the 4 GB heap and resolves with its exit code and its output. */
function runEslint(args) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--max-old-space-size=4096", path.join(root, "node_modules", "eslint", "bin", "eslint.js"), ...args],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const groups = lintGroups(process.argv.slice(2));
  const results = await Promise.all(groups.map(runEslint));
  let failed = 0;
  results.forEach(({ code, output }, i) => {
    // Each process reports after it ends, so the reports of the groups do not interleave.
    if (output !== "" || code !== 0) {
      console.log(`eslint ${groups[i].join(" ")} (exit ${code})`);
      process.stdout.write(output);
    }
    failed = Math.max(failed, code);
  });
  process.exitCode = failed;
}
