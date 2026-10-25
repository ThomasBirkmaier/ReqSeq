// The read pool of a cold load (ADR-0008, #148) end to end: the built binary loads a workspace with
// more element files than the pool's threshold (1,000), so its worker threads read them from
// `dist`, and the process still exits on its own when the command is done.
// Run after `pnpm build` with `pnpm test:e2e`.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { LargeFixtureWorkspace, VersionFunction } from "@logreq/testkit";
import { generateLargeWorkspace, writeLargeWorkspace } from "@logreq/testkit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cliEnv } from "../support/logreq.js";

const cliDir = fileURLToPath(new URL("../../", import.meta.url));
const bin = path.join(cliDir, "dist", "bin.js");
// The spawned CLI fails any connection that leaves the machine, like the test process (SR-077).
const blockNetwork = pathToFileURL(
  path.join(cliDir, "..", "..", "scripts", "test-support", "block-network.mjs"),
).href;

const ELEMENTS = 1_200;
/** A process that has not exited by then counts as hanging (for example on a worker left running). */
const EXIT_WITHIN_MS = 20_000;

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const logreq = (args: readonly string[], cwd: string): Promise<Run> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", blockNetwork, bin, ...args], {
      cwd,
      stdio: "pipe",
      env: cliEnv(),
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`logreq ${args.join(" ")} did not exit within ${String(EXIT_WITHIN_MS)} ms`));
    }, EXIT_WITHIN_MS);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
    child.stdin.end();
  });

/**
 * A version in the format of ADR-0005. The check does not compare versions, so it need not be the
 * one core computes; the perf suite checks that one.
 */
const version: VersionFunction = (subject) =>
  `n1:${createHash("sha256").update(JSON.stringify(subject)).digest("hex").slice(0, 16)}`;

let fixture: LargeFixtureWorkspace;

beforeAll(async () => {
  if (!existsSync(bin)) {
    throw new Error(`${bin} is missing: run \`pnpm build\` before \`pnpm test:e2e\``);
  }
  fixture = await writeLargeWorkspace(
    generateLargeWorkspace({ version, elements: ELEMENTS, relations: ELEMENTS * 2 }),
  );
}, 120_000);

afterAll(async () => {
  await fixture.cleanup();
});

describe("cold load in worker threads (ADR-0008, #148)", () => {
  it("checks a workspace of 1,200 element files and exits", async () => {
    const run = await logreq(["workspace", "check", "--json"], fixture.workspaceRoot);
    expect(run.stderr).toBe("");
    expect(run.code).toBe(0);
    const output = JSON.parse(run.stdout) as { ok: boolean; problems: unknown[]; checkedElements: number };
    expect(output).toMatchObject({ ok: true, problems: [], checkedElements: ELEMENTS });
  });
});
