// Runs the built `logreq` binary (packages/cli/dist/bin.js) as a new process, for the CLI tests that
// spawn it: the e2e suite (`pnpm test:e2e`) and the performance suite (`pnpm test:perf`). Both need
// `pnpm build` first. The process loads the network block of the test run, so it fails any connection
// that leaves the machine (SR-077).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const cliDir = fileURLToPath(new URL("../../", import.meta.url));

/** The built binary. */
export const bin = path.join(cliDir, "dist", "bin.js");

/** `--import` URL of the network block (scripts/test-support/block-network.mjs). */
export const blockNetwork = pathToFileURL(
  path.join(cliDir, "..", "..", "scripts", "test-support", "block-network.mjs"),
).href;

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
  /** Variables added to the environment of the test process. */
  readonly env?: Readonly<Record<string, string>>;
}

/** Runs `logreq <args>` with an empty stdin and collects its exit code and output. */
export const logreq = (args: readonly string[], options: RunOptions): Promise<Run> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", blockNetwork, bin, ...args], {
      cwd: options.cwd,
      stdio: "pipe",
      env: { ...process.env, ...options.env },
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
