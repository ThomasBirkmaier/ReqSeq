// End-to-end tests of `reqseq serve api` and `reqseq mcp` (ADR-0009, ADR-0011): the built binary as a real
// process on a fixture workspace. On Linux CI inside `unshare -rn`: only loopback exists.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LineTransport } from "@reqseq/mcp";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const cliDir = fileURLToPath(new URL("../../", import.meta.url));
const bin = path.join(cliDir, "dist", "bin.js");
// The spawned CLI fails any connection that leaves the machine, like the test process (SR-077).
const blockNetwork = pathToFileURL(
  path.join(cliDir, "..", "..", "scripts", "test-support", "block-network.mjs"),
).href;

const fixtures: FixtureWorkspace[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      child.kill();
    }
  }
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

beforeAll(() => {
  if (!existsSync(bin)) {
    throw new Error(`${bin} is missing: run pnpm build before pnpm test:e2e`);
  }
});

/** `reqseq <args>` in the fixture, with the OS cache folder inside the fixture on every OS. */
const start = async (
  args: readonly string[],
): Promise<{ child: ChildProcessWithoutNullStreams; ws: FixtureWorkspace }> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-004/one-repository", git: true });
  fixtures.push(ws);
  const home = ws.path("home");
  const child = spawn(process.execPath, ["--import", blockNetwork, bin, ...args], {
    cwd: ws.root,
    stdio: "pipe",
    env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CACHE_HOME: home, LOCALAPPDATA: home },
  });
  children.push(child);
  return { child, ws };
};

const exited = (child: ChildProcessWithoutNullStreams): Promise<number | null> =>
  new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
    }
    child.on("exit", (code) => {
      resolve(code);
    });
  });

const firstLines = (child: ChildProcessWithoutNullStreams): Promise<string> =>
  new Promise((resolve, reject) => {
    let text = "";
    child.stdout.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
      if (text.includes("Stop with Ctrl-C.\n")) {
        resolve(text);
      }
    });
    child.on("exit", () => {
      reject(new Error(`reqseq ended early: ${text}`));
    });
  });

const post = (
  url: string,
  token: string,
  name: string,
): Promise<{ status: number | undefined; body: unknown }> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      `${url}/v1/commands/${name}`,
      { method: "POST", headers: { authorization: `Bearer ${token}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });

/**
 * The addresses of this machine that other machines can reach: not loopback, and no IPv6 link-local
 * addresses (they need a zone). None inside `unshare -rn` on Linux CI; the CI runners of macOS and Windows
 * have some.
 */
const externalAddresses = (): string[] =>
  Object.values(os.networkInterfaces())
    .flatMap((list) => list ?? [])
    .filter((info) => !info.internal && !info.address.toLowerCase().startsWith("fe80:"))
    .map((info) => info.address);

/**
 * Connect to `port` on each address in a separate Node process, which has no network block: this process
 * fails every connection to an address that is not loopback. The addresses are this machine's own, so
 * nothing leaves the machine. Prints one result per address: "connected", "timeout" or the error code.
 */
const PROBE = `
const net = require("node:net");
const [port, ...hosts] = process.argv.slice(1);
Promise.all(hosts.map((host) => new Promise((resolve) => {
  const socket = net.connect({ host, port: Number(port), timeout: 3000 });
  socket.once("connect", () => { socket.destroy(); resolve("connected"); });
  socket.once("timeout", () => { socket.destroy(); resolve("timeout"); });
  socket.once("error", (error) => resolve(String(error.code)));
}))).then((results) => console.log(JSON.stringify(results)));
`;

const probe = (port: number, hosts: readonly string[]): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", PROBE, String(port), ...hosts], { stdio: "pipe" });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("exit", () => {
      resolve(JSON.parse(out) as string[]);
    });
  });

describe("reqseq serve api", () => {
  const external = externalAddresses();

  it.skipIf(external.length === 0)(
    "[SR-079/AK2] cannot be reached on the addresses that other machines use",
    async () => {
      const { child } = await start(["serve", "api"]);
      const lines = await firstLines(child);
      const file = /^Port and token: (.+)$/m.exec(lines)?.[1] ?? "";
      const { port } = JSON.parse(await fs.readFile(file, "utf8")) as { port: number };
      // 127.0.0.1 first: the probe does reach the API there.
      const [loopback, ...results] = await probe(port, ["127.0.0.1", ...external]);
      expect(loopback).toBe("connected");
      expect(results).toHaveLength(external.length);
      for (const [index, result] of results.entries()) {
        expect([external[index], result]).not.toEqual([external[index], "connected"]);
      }
    },
  );

  it("[SR-079/AK1] serves the workspace on loopback only, with the token from api.json", async () => {
    const { child } = await start(["serve", "api"]);
    const lines = await firstLines(child);
    const file = /^Port and token: (.+)$/m.exec(lines)?.[1] ?? "";
    const endpoint = JSON.parse(await fs.readFile(file, "utf8")) as {
      port: number;
      token: string;
      urls: string[];
    };
    expect(endpoint.urls[0]).toBe(`http://127.0.0.1:${String(endpoint.port)}`);
    for (const url of endpoint.urls) {
      expect(url).toMatch(/^http:\/\/(127\.0\.0\.1|\[::1\]):\d+$/);
      const reply = await post(url, endpoint.token, "workspace.status");
      expect(reply.status).toBe(200);
      expect(reply.body).toMatchObject({ name: "Weather station", readOnly: false });
    }
    expect((await post(endpoint.urls[0] ?? "", "wrong", "workspace.status")).status).toBe(401);
    if (process.platform !== "win32") {
      // Windows has no SIGTERM handler: kill() ends the process at once.
      child.kill("SIGTERM");
      expect(await exited(child)).toBe(0);
      // The API removes its own api.json when it stops.
      expect(existsSync(file)).toBe(false);
    }
  });

  it("refuses a second API for the same copy, and asks the first one directly even with a proxy set", async () => {
    const { child, ws } = await start(["serve", "api"]);
    await firstLines(child);
    const home = ws.path("home");
    // The proxy is not loopback: the network block would fail a request through it, and the first API
    // would then count as stopped.
    const second = spawn(process.execPath, ["--import", blockNetwork, bin, "serve", "api"], {
      cwd: ws.root,
      stdio: "pipe",
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CACHE_HOME: home,
        LOCALAPPDATA: home,
        NODE_USE_ENV_PROXY: "1",
        HTTP_PROXY: "http://192.0.2.1:9",
        http_proxy: "http://192.0.2.1:9",
        // Empty, so that no NO_PROXY of the environment exempts loopback from the proxy.
        NO_PROXY: "",
        no_proxy: "",
      },
    });
    children.push(second);
    let stderr = "";
    second.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    // A second API that starts would serve until the test times out: fail at once instead.
    const outcome = await Promise.race([
      exited(second),
      firstLines(second).then(
        () => "started" as const,
        () => "ended" as const,
      ),
    ]);
    if (outcome === "started") {
      second.kill();
      expect.fail("The second API started although the first one runs");
    }
    expect(outcome).toBe(2);
    expect(stderr).toContain("A ReqSeq API for this working copy runs already at http://127.0.0.1:");
  });
});

describe("reqseq mcp", () => {
  it("serves MCP on standard input and output and exits 0 when the input ends", async () => {
    const { child } = await start(["mcp"]);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    const client = new Client({ name: "e2e", version: "1" });
    await client.connect(new LineTransport(child.stdout, { write: (text) => child.stdin.write(text) }));
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "workspace_status")?.annotations?.readOnlyHint).toBe(true);
    const result = await client.callTool({ name: "workspace_status", arguments: {} });
    expect(result.structuredContent).toMatchObject({ name: "Weather station", readOnly: false });
    child.stdin.end();
    expect(await exited(child)).toBe(0);
    expect(stderr).toBe("");
    await client.close();
  });

  it.skipIf(process.platform === "win32")("exits 0 at SIGTERM while its input is still open", async () => {
    // Windows has no SIGTERM handler: kill() ends the process at once.
    const { child } = await start(["mcp"]);
    const client = new Client({ name: "e2e", version: "1" });
    await client.connect(new LineTransport(child.stdout, { write: (text) => child.stdin.write(text) }));
    await client.listTools();
    child.kill("SIGTERM");
    expect(await exited(child)).toBe(0);
    await client.close();
  });
});
