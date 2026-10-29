// Runs the built `reqseq` binary (packages/cli/dist/bin.js) as a new process, for the CLI tests that
// spawn it: the e2e suite (`pnpm test:e2e`) and the performance suite (`pnpm test:perf`). Both need
// `pnpm build` first. The process loads the network block of the test run, so it fails any connection
// that leaves the machine (SR-077).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const cliDir = fileURLToPath(new URL("../../", import.meta.url));

/** The built binary. */
export const bin = path.join(cliDir, "dist", "bin.js");

/** `--import` URL of the network block (scripts/test-support/block-network.mjs). */
export const blockNetwork = pathToFileURL(
  path.join(cliDir, "..", "..", "scripts", "test-support", "block-network.mjs"),
).href;

/**
 * A temporary home and OS cache folder for every spawned CLI of this test process, so that no model
 * cache (SR-082) or `api.json` lands in the real cache of the user or the runner. Removed when the
 * process exits.
 */
export const cacheHome = mkdtempSync(path.join(os.tmpdir(), "reqseq-cache-home-"));
process.once("exit", () => {
  rmSync(cacheHome, { recursive: true, force: true });
});

/**
 * The environment of a spawned CLI: this process's, with home and OS cache folder (Linux, macOS,
 * Windows) in `home` (default `cacheHome`).
 */
export const cliEnv = (home: string = cacheHome): NodeJS.ProcessEnv => ({
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  XDG_CACHE_HOME: home,
  LOCALAPPDATA: home,
});

/** Throws when the binary is not built, naming the command that builds and runs the suite. */
export function requireBuiltCli(suite: string): void {
  if (!existsSync(bin)) {
    throw new Error(`${bin} is missing: run pnpm build before ${suite}`);
  }
}

export interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  readonly cwd: string;
  /** Variables added to the environment of `cliEnv()` (they win over its cache folder). */
  readonly env?: Readonly<Record<string, string>>;
}

/** Runs `reqseq <args>` with an empty stdin and collects its exit code and output. */
export const reqseq = (args: readonly string[], options: RunOptions): Promise<Run> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", blockNetwork, bin, ...args], {
      cwd: options.cwd,
      stdio: "pipe",
      env: { ...cliEnv(), ...options.env },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
    child.stdin.end();
  });
