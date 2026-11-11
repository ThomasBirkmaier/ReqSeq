// Playwright `globalSetup` of the Electron tests (playwright.config.ts): one Node compile cache for the CLI and
// MCP processes the tests start, filled before the first test (#1356, #1339, #1399), as the CLI e2e suite does
// (packages/cli/test/support/compile-cache.ts, #1448).
//
// Node writes the compile cache when a process exits. On the Windows runner the CLI call that first fills it
// wrote its answer within about a second and then took 6 to 7 s more to end (the report of `timedCli` in
// `app.ts`, in 3 of 30 Windows shard jobs, each time the first CLI call of the run); before #1407 every launch
// had a cache of its own, so every first call of a test paid that, and a test that waits on the call stalled
// (#1356) or hung (#1339, #1399). Filled here, the tests' CLI calls only read it.
//
// The folder reaches the workers as REQSEQ_TEST_COMPILE_CACHE, not as NODE_COMPILE_CACHE: the workers pass
// their environment to the app, which runs as it ships, without a compile cache (ADR-0008). `app.ts` gives it
// to the spawned CLIs. A REQSEQ_TEST_COMPILE_CACHE of the outer environment is used (an empty one counts as unset),
// warmed too and not removed; a NODE_COMPILE_CACHE of the outer environment is not used for the CLIs. `reqseq mcp`
// loads its server lazily, so the first MCP start of a run still compiles that part; no flake is known there.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The variable that names the folder for `app.ts`. */
export const TEST_COMPILE_CACHE = "REQSEQ_TEST_COMPILE_CACHE";

const CLI = fileURLToPath(new URL("../../../cli/dist/bin.js", import.meta.url));
const ELECTRON = createRequire(import.meta.url)("electron") as string;
/** Ends a hanging warm-up, which would otherwise hold the whole Electron step until the job's timeout. */
const WARM_UP_LIMIT_MS = 60_000;

/** Runs `reqseq --version` on `program` (Node, or Electron as Node: its V8 has a cache of its own). */
const warm = (program: string, env: NodeJS.ProcessEnv): Promise<void> =>
  new Promise((resolve, reject) => {
    execFile(program, [CLI, "--version"], { env, timeout: WARM_UP_LIMIT_MS }, (error, _stdout, stderr) => {
      if (error === null) {
        resolve();
      } else {
        reject(
          new Error(
            `reqseq --version on ${program} failed while warming the compile cache: ${error.message} ${stderr}`,
          ),
        );
      }
    });
  });

export default async function setup(): Promise<() => Promise<void>> {
  const outer = process.env[TEST_COMPILE_CACHE];
  const own = outer === undefined || outer === "";
  const folder = own ? await mkdtemp(path.join(os.tmpdir(), "reqseq-app-compile-cache-")) : outer;
  process.env[TEST_COMPILE_CACHE] = folder;
  // Without a build there is nothing to warm: the first launch names what is missing.
  if (existsSync(CLI)) {
    const env = { ...process.env, NODE_COMPILE_CACHE: folder };
    await warm(process.execPath, env);
    await warm(ELECTRON, { ...env, ELECTRON_RUN_AS_NODE: "1" });
  }
  return async () => {
    if (own) {
      if (outer === undefined) {
        Reflect.deleteProperty(process.env, TEST_COMPILE_CACHE);
      } else {
        process.env[TEST_COMPILE_CACHE] = outer;
      }
      await rm(folder, { recursive: true, force: true, maxRetries: 3 });
    }
  };
}
