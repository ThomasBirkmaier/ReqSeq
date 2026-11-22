// SR-228 on the command line, the local API and the MCP server: a connection counts 1 s after
// `initialize` was answered, or after the first request of a revision without it arrived, with its client
// cut to 40 grapheme clusters (AK1), and 5 s after it ended,
// also by a crash, only as the one connected last (AK2); an MCP server process records its connection in
// the cache folder of the copy only (AK5), only MCP servers of this copy count (AK6), and
// `workspace.agents` gives the same connections on every access (AK7, SR-080 AK2).
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { startApiServer } from "@reqseq/api";
import { AGENT_LIVE_MS, Workspace, cacheFolder, createCommandRuntime } from "@reqseq/core";
import { LineTransport, serveMcp } from "@reqseq/mcp";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EXIT, runCli } from "../src/index.js";

const runtime = createCommandRuntime();

// The OS cache folder (the cache folder of every copy, ADR-0008) lies in a temporary folder on every OS.
let cacheHome = "";
let fixture: FixtureWorkspace;
let other: FixtureWorkspace;
beforeAll(async () => {
  cacheHome = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-cache-home-"));
  for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
    vi.stubEnv(name, cacheHome);
  }
  fixture = await createFixtureWorkspace({ fixture: "SR-004/one-repository", git: true });
  // Another copy of the same workspace: its own cache folder.
  other = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await fixture.cleanup();
  await other.cleanup();
  await fs.rm(cacheHome, { recursive: true, force: true, maxRetries: 3 });
});

class Sink {
  text = "";
  write(text: string): boolean {
    this.text += text;
    return true;
  }
}

/** `reqseq workspace agents --json` in `root`. */
const agentsViaCli = async (root = fixture.root): Promise<unknown> => {
  const stdout = new Sink();
  const code = await runCli({
    argv: ["workspace", "agents", "--json"],
    cwd: root,
    stdin: Readable.from([]),
    stdout,
    stderr: new Sink(),
    runtime,
  });
  expect(code).toBe(EXIT.ok);
  return JSON.parse(stdout.text) as unknown;
};

interface Session {
  readonly client: Client;
  readonly workspace: Workspace;
  close(): Promise<void>;
}

/** An MCP session of client `name` on `root`, as `reqseq mcp` opens it (with the cache folder of the copy). */
const mcpSession = async (name: string, root = fixture.root): Promise<Session> => {
  const workspace = new Workspace(root, { cacheFolder: cacheFolder(root) });
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const served = serveMcp({
    runtime,
    workspace,
    input: toServer,
    output: { write: (t) => toClient.write(t) },
  });
  const client = new Client({ name, version: "1" });
  await client.connect(new LineTransport(toClient, { write: (t) => toServer.write(t) }));
  return {
    client,
    workspace,
    close: async () => {
      toServer.end();
      await served;
      await client.close();
      await workspace.close();
    },
  };
};

/** `POST /v1/commands/<name>` of a local API with its token. */
const post = (port: number, token: string, name: string): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: `/v1/commands/${name}`,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        });
      },
    );
    req.on("error", reject);
    req.end("{}");
  });

/** An API server on the fixture, with the cache folder of the copy. */
const withApi = async <T>(use: (call: (name: string) => Promise<unknown>) => Promise<T>): Promise<T> => {
  const folder = cacheFolder(fixture.root);
  const workspace = new Workspace(fixture.root, { cacheFolder: folder });
  const server = await startApiServer({ workspace, runtime, cacheFolder: folder });
  try {
    const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
    return await use((name) => post(server.port, token, name));
  } finally {
    await server.close();
    await workspace.close();
  }
};

/** Every file below `top` with its text, `.git` included, so that a change of Git shows as well. */
const filesOf = async (top: string): Promise<Record<string, string>> => {
  const entries = await fs.readdir(top, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [path.relative(top, file), await fs.readFile(file, "base64")]),
    ),
  ) as Record<string, string>;
};

const agentFiles = async (folder: string): Promise<string[]> =>
  (await fs.readdir(folder).catch(() => [])).filter((name) => /^agent-.*\.json$/.test(name));

describe("recording a connection (SR-228 AK5, AK6)", () => {
  it("[SR-228/AK-dymn] an MCP server writes its connection only into the cache folder of the copy, not into the workspace or Git", async () => {
    const cache = cacheFolder(fixture.root);
    await fs.rm(cache, { recursive: true, force: true });
    const before = await filesOf(fixture.root);
    const session = await mcpSession("recording");
    try {
      await vi.waitFor(async () => {
        expect(await agentFiles(cache)).toHaveLength(1);
      });
      // Nothing but the connection is in the cache folder (no model cache either: no tool was called).
      expect(await fs.readdir(cache)).toEqual(await agentFiles(cache));
    } finally {
      await session.close();
    }
    expect(await filesOf(fixture.root)).toEqual(before);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: fixture.root, encoding: "utf8" })).toBe("");
  });

  it("[SR-228/AK-n2xx] an MCP server of another copy or workspace and calls through the API do not count as connected", async () => {
    const elsewhere = await mcpSession("elsewhere", other.root);
    try {
      await vi.waitFor(async () => {
        expect(await agentFiles(cacheFolder(other.root))).toHaveLength(1);
      });
      await withApi(async (call) => {
        await call("element.list");
        const viaApi = (await call("workspace.agents")) as { connected: unknown[] };
        expect(viaApi.connected).toEqual([]);
      });
      expect(((await agentsViaCli()) as { connected: unknown[] }).connected).toEqual([]);
      expect(await agentsViaCli(other.root)).toMatchObject({ connected: [{ client: "elsewhere" }] });
    } finally {
      await elsewhere.close();
    }
  });
});

/** Waits until `ms` milliseconds have passed since `from` (Date.now()). */
const until = async (from: number, ms: number): Promise<void> => {
  const left = from + ms - Date.now();
  if (left > 0) {
    await new Promise((resolve) => setTimeout(resolve, left));
  }
};

describe("workspace.agents after a connection began or ended (SR-228 AK1, AK2)", () => {
  it("[SR-228/AK-zn8v] names a connection 1 s after initialize was answered, with its client cut to 40 grapheme clusters and its start", async () => {
    await fs.rm(cacheFolder(fixture.root), { recursive: true, force: true });
    // 38 letters, a letter with a combining accent and a family emoji: 40 grapheme clusters, then more.
    const family = "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}";
    const name = `${"a".repeat(38)}e\u0301${family}cut off`;
    const before = Date.now();
    const long = await mcpSession(name);
    // `connect` resolves once the answer to `initialize` has arrived.
    const answered = Date.now();
    const unnamed = await mcpSession("\u200b\u0007");
    try {
      await until(Date.now(), 1000);
      const output = (await agentsViaCli()) as {
        connected: { client: string | null; since: string }[];
      };
      expect(output.connected.map((c) => c.client)).toEqual([`${"a".repeat(38)}e\u0301${family}`, null]);
      const since = Date.parse(output.connected[0]?.since ?? "");
      // Whole milliseconds of the clock, so at most one before the first look at it.
      expect(since).toBeGreaterThanOrEqual(before - 1);
      expect(since).toBeLessThanOrEqual(answered + 1);
    } finally {
      await unnamed.close();
      await long.close();
    }
  });

  it("[SR-228/AK-zn8v] names a connection of a revision without initialize 1 s after its first request arrived, with its client cut to 40 grapheme clusters and its start", async () => {
    await fs.rm(cacheFolder(fixture.root), { recursive: true, force: true });
    const family = "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}";
    const name = `${"a".repeat(38)}e\u0301${family}cut off`;
    /** A raw MCP server on the fixture, as `reqseq mcp` serves it, and a way to write one request line. */
    const rawSession = (): { send: (message: object) => void; close: () => Promise<void> } => {
      const workspace = new Workspace(fixture.root, { cacheFolder: cacheFolder(fixture.root) });
      const toServer = new PassThrough();
      const served = serveMcp({ runtime, workspace, input: toServer, output: { write: () => true } });
      return {
        send: (message) => toServer.write(`${JSON.stringify(message)}\n`),
        close: async () => {
          toServer.end();
          await served;
          await workspace.close();
        },
      };
    };
    const meta = (client?: object): object => ({
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      ...(client === undefined ? {} : { "io.modelcontextprotocol/clientInfo": client }),
    });
    const named = rawSession();
    const unnamed = rawSession();
    try {
      // A ping names no revision and connects nothing.
      named.send({ jsonrpc: "2.0", id: 1, method: "ping", params: {} });
      const before = Date.now();
      named.send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: { _meta: meta({ name, version: "1" }) },
      });
      // `subscriptions/listen` gets no answer: its arrival connects, without a name.
      unnamed.send({ jsonrpc: "2.0", id: 1, method: "subscriptions/listen", params: { _meta: meta() } });
      const sent = Date.now();
      await until(sent, 1000);
      const output = (await agentsViaCli()) as {
        connected: { client: string | null; since: string }[];
      };
      // Both arrived within a few milliseconds, so either may be first.
      expect(output.connected.map((c) => c.client)).toHaveLength(2);
      expect(output.connected.map((c) => c.client)).toEqual(
        expect.arrayContaining([`${"a".repeat(38)}e\u0301${family}`, null]),
      );
      for (const connection of output.connected) {
        const since = Date.parse(connection.since);
        expect(since).toBeGreaterThanOrEqual(before - 1);
        expect(since).toBeLessThanOrEqual(sent + 1000);
      }
    } finally {
      await unnamed.close();
      await named.close();
    }
  });

  it("[SR-228/AK-v1gc] 5 s after the last connection ended names no connection, but the client connected last and when", async () => {
    await fs.rm(cacheFolder(fixture.root), { recursive: true, force: true });
    const session = await mcpSession("leaving agent");
    await vi.waitFor(async () => {
      expect(await agentsViaCli()).toMatchObject({ connected: [{ client: "leaving agent" }] });
    });
    await session.close();
    const ended = Date.now();
    await until(ended, 5000);
    const output = (await agentsViaCli()) as { connected: unknown[]; last: { client: string; at: string } };
    expect([output.connected, output.last.client]).toEqual([[], "leaving agent"]);
    expect(Math.abs(Date.parse(output.last.at) - ended)).toBeLessThan(2000);
  });

  it("[SR-228/AK-v1gc] 5 s after a crash, whose process wrote no end, names no connection, but the crashed client and its last beat", async () => {
    const cache = cacheFolder(fixture.root);
    await fs.rm(cache, { recursive: true, force: true });
    await fs.mkdir(cache, { recursive: true });
    const file = path.join(cache, "agent-4343-0a1b2c3d.json");
    const since = new Date(Date.now() - 60_000).toISOString();
    await fs.writeFile(
      file,
      JSON.stringify({ version: 1, process: "4343-0a1b2c3d", client: "crashing", since, ended: null }),
    );
    // The last beat, in whole seconds as every file system keeps them; then the process is gone.
    const beat = new Date(Math.floor(Date.now() / 1000) * 1000);
    await fs.utimes(file, beat, beat);
    await until(beat.getTime(), 5000);
    expect(await agentsViaCli()).toEqual({
      answer: "0 agents connected to this copy; the connection that ended last was crashing.",
      recorded: true,
      connected: [],
      last: { client: "crashing", at: beat.toISOString() },
    });
  });
});

describe("workspace.agents on every access (SR-228 AK7, SR-080 AK2)", () => {
  it("[SR-228/AK-sggn] gives each connection with its client and start, and the one connected last, as the same object through the CLI, the API and MCP", async () => {
    await fs.rm(cacheFolder(fixture.root), { recursive: true, force: true });
    expect(await agentsViaCli()).toEqual({
      answer: "0 agents connected to this copy; no connection has ended.",
      recorded: true,
      connected: [],
      last: null,
    });

    const first = await mcpSession("first agent");
    await vi.waitFor(async () => {
      expect(await agentsViaCli()).toMatchObject({ connected: [{ client: "first agent" }] });
    });
    await first.close();

    const second = await mcpSession("second agent");
    try {
      const viaCli = await vi.waitFor(async () => {
        const output = (await agentsViaCli()) as { connected: unknown[] };
        expect(output.connected).toHaveLength(1);
        return output;
      });
      expect(viaCli).toEqual({
        answer: "1 agent connected to this copy; the connection that ended last was first agent.",
        recorded: true,
        connected: [{ client: "second agent", since: expect.any(String) as unknown }],
        last: { client: "first agent", at: expect.any(String) as unknown },
      });
      const viaApi = await withApi((call) => call("workspace.agents"));
      const viaMcp = (await second.client.callTool({ name: "workspace_agents", arguments: {} }))
        .structuredContent;
      expect([viaApi, viaMcp]).toEqual([viaCli, viaCli]);
    } finally {
      await second.close();
    }
  });

  it("[SR-224/AK-cw40] gives the same answer through the CLI, the API and MCP", async () => {
    await fs.rm(cacheFolder(fixture.root), { recursive: true, force: true });
    const session = await mcpSession("answering agent");
    try {
      const viaCli = await vi.waitFor(async () => {
        const output = (await agentsViaCli()) as { answer: string; connected: unknown[] };
        expect(output.connected).toHaveLength(1);
        return output;
      });
      const viaApi = (await withApi((call) => call("workspace.agents"))) as { answer: string };
      const viaMcp = (await session.client.callTool({ name: "workspace_agents", arguments: {} }))
        .structuredContent as { answer: string };
      expect([viaCli.answer, viaApi.answer, viaMcp.answer]).toEqual([
        "1 agent connected to this copy; no connection has ended.",
        "1 agent connected to this copy; no connection has ended.",
        "1 agent connected to this copy; no connection has ended.",
      ]);
    } finally {
      await session.close();
    }
  });

  it("[SR-228/AK-sggn] gives a connection whose process crashed as the one connected last", async () => {
    const cache = cacheFolder(fixture.root);
    await fs.rm(cache, { recursive: true, force: true });
    await fs.mkdir(cache, { recursive: true });
    const since = "2026-11-18T09:00:00.000Z";
    const file = path.join(cache, "agent-4242-0a1b2c3d.json");
    await fs.writeFile(
      file,
      JSON.stringify({ version: 1, process: "4242-0a1b2c3d", client: "crashed", since, ended: null }),
    );
    expect(await agentsViaCli()).toMatchObject({ connected: [{ client: "crashed", since }], last: null });
    // No beat for longer than AGENT_LIVE_MS: the process is gone.
    // Whole seconds: every file system keeps them.
    const beat = new Date(Math.floor((Date.now() - AGENT_LIVE_MS) / 1000) * 1000 - 1000);
    await fs.utimes(file, beat, beat);
    expect(await agentsViaCli()).toEqual({
      answer: "0 agents connected to this copy; the connection that ended last was crashed.",
      recorded: true,
      connected: [],
      last: { client: "crashed", at: beat.toISOString() },
    });
  });
});
