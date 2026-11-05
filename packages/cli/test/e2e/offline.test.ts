// Working without network (SR-077, SR-078 AK1): the built binary with Node's connections blocked for
// every host but loopback (`block-network.mjs`, as for every spawned CLI of this suite), and on Linux CI
// inside `unshare -rn`, where no network exists at all. An attempt to leave the machine would fail the
// command; so the commands succeeding shows that they need no network and open no connection.
// Run after `pnpm build` with `pnpm test:e2e`.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { LineTransport } from "@reqseq/mcp";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { bin, blockNetwork, cliEnv, fileSha256, reqseq, requireBuiltCli } from "../support/reqseq.js";

const fixtures: FixtureWorkspace[] = [];
const children: ChildProcessWithoutNullStreams[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill();
  }
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

const workspace = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-069/filter" });
  fixtures.push(ws);
  return ws;
};

/** A Node process with the same block tries to reach a host of the documentation range (RFC 5737). */
const outwardAttempt = (): Promise<{ code: number | null; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", blockNetwork, "-e", 'require("node:net").connect(80, "192.0.2.1")'],
      { stdio: "pipe", env: cliEnv() },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stderr });
    });
  });

describe("without network", () => {
  it("[SR-078/AK1] fails a connection to another machine, so a command that tried one could not pass", async () => {
    const attempt = await outwardAttempt();
    expect(attempt.code).not.toBe(0);
    expect(attempt.stderr).toContain("network access blocked in tests: 192.0.2.1:80");
  });

  it("[SR-077/AK1] reads, searches, writes, checks and exports a workspace", async () => {
    const ws = await workspace();
    const run = (args: readonly string[]) => reqseq(args, { cwd: ws.root });
    for (const args of [
      ["workspace", "status", "--json"],
      ["element", "list", "--json"],
      ["element", "search", "wind", "--json"],
      ["trace", "chain", "SR-0000b1", "--json"],
      ["workspace", "check", "--json"],
      ["data", "export", "--json"],
    ]) {
      const result = await run(args);
      expect([args.join(" "), result.stderr]).toEqual([args.join(" "), ""]);
    }
    const sha = await fileSha256("SR-0000b1", { cwd: ws.root });
    const updated = await run([
      "element",
      "update",
      "SR-0000b1",
      "--title",
      "Show the wind offline",
      "--expected-file-sha256",
      sha,
    ]);
    expect([updated.code, updated.stderr]).toEqual([0, ""]);
  });

  it("[SR-077/AK2] keeps an agent's session going with no error message and keeps every change", async () => {
    const ws = await workspace();
    const child = spawn(process.execPath, ["--import", blockNetwork, bin, "mcp"], {
      cwd: ws.root,
      stdio: "pipe",
      env: cliEnv(),
    });
    children.push(child);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    const client = new Client({ name: "offline", version: "1" });
    await client.connect(new LineTransport(child.stdout, { write: (text) => child.stdin.write(text) }));
    // Several changes in one running session: none may depend on a connection that could drop.
    for (const title of ["Show the wind", "Show the wind at sea", "Show the wind on land"]) {
      const got = (await client.callTool({ name: "element_get", arguments: { ref: "SR-0000b1" } }))
        .structuredContent as { fileSha256: string };
      const result = await client.callTool({
        name: "element_update",
        arguments: { ref: "SR-0000b1", title, expectedFileSha256: got.fileSha256 },
      });
      expect(result.isError ?? false).toBe(false);
    }
    const file = (
      (await client.callTool({ name: "element_get", arguments: { ref: "SR-0000b1" } })).structuredContent as {
        element: { file: string };
      }
    ).element.file;
    await client.close();
    child.stdin.end();
    expect(stderr).toBe("");
    expect(await fs.readFile(ws.path(file.replace(/^[^:]+:/, "")), "utf8")).toContain(
      "Show the wind on land",
    );
  });
});
