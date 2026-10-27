// SR-117 on the command line, the local API and the MCP server: the mode „Agent folgen“ is display
// state of the app, so none of them can switch it (AK4), and the last API or MCP access they record
// is the same object on every access (SR-080 AK2, `workspace.activity`). The app's side follows with
// its own tests.
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { startApiServer } from "@logreq/api";
import { Workspace, cacheFolder, createCommandRuntime } from "@logreq/core";
import { LineTransport, serveMcp } from "@logreq/mcp";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EXIT, runCli } from "../src/index.js";

const runtime = createCommandRuntime();
const FOLLOW = /follow/i;
const ELEMENT_ID = "e8df96ea-a168-4d90-8d65-6328cee88fb3";

// The OS cache folder (the cache folder of every copy, ADR-0008) lies in a temporary folder on every OS.
let cacheHome = "";
let fixture: FixtureWorkspace;
beforeAll(async () => {
  cacheHome = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-cache-home-"));
  for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
    vi.stubEnv(name, cacheHome);
  }
  fixture = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await fixture.cleanup();
  await fs.rm(cacheHome, { recursive: true, force: true, maxRetries: 3 });
});

class Sink {
  text = "";
  write(text: string): boolean {
    this.text += text;
    return true;
  }
}

const cli = async (argv: readonly string[]): Promise<{ code: number; stdout: string }> => {
  const stdout = new Sink();
  const code = await runCli({
    argv: [...argv],
    cwd: fixture.root,
    stdin: Readable.from([]),
    stdout,
    stderr: new Sink(),
    runtime,
  });
  return { code, stdout: stdout.text };
};

/** An MCP session on a workspace of the fixture, as `logreq mcp` opens it (with the cache folder of the copy). */
const mcpSession = async (): Promise<{ client: Client; close(): Promise<void> }> => {
  const workspace = new Workspace(fixture.root, { cacheFolder: cacheFolder(fixture.root) });
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const served = serveMcp({
    runtime,
    workspace,
    input: toServer,
    output: { write: (t) => toClient.write(t) },
  });
  const client = new Client({ name: "agent-activity", version: "1" });
  await client.connect(new LineTransport(toClient, { write: (t) => toServer.write(t) }));
  return {
    client,
    close: async () => {
      toServer.end();
      await served;
      await client.close();
      await workspace.close();
    },
  };
};

/** `GET` or `POST` a path of a local API with its token. */
const request = (
  port: number,
  token: string,
  method: string,
  route: string,
): Promise<{ status: number | undefined; body: unknown }> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path: route, headers: { authorization: `Bearer ${token}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        });
      },
    );
    req.on("error", reject);
    req.end(method === "POST" ? "{}" : undefined);
  });

/** Every key of a JSON value, at any depth. */
const keysOf = (value: unknown): string[] =>
  typeof value === "object" && value !== null
    ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
    : [];

/** An API server on a workspace of the fixture, with the cache folder of the copy. */
const withApi = async <T>(use: (port: number, token: string) => Promise<T>): Promise<T> => {
  const folder = cacheFolder(fixture.root);
  const workspace = new Workspace(fixture.root, { cacheFolder: folder });
  const server = await startApiServer({ workspace, runtime, cacheFolder: folder });
  try {
    const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
    return await use(server.port, token);
  } finally {
    await server.close();
    await workspace.close();
  }
};

describe("no access but the app switches the mode „Agent folgen“ (SR-117 AK4)", () => {
  it("[SR-117/AK4] no catalog command, API path or MCP tool switches the follow mode", async () => {
    const { commands } = runtime.contracts;
    expect(commands.filter((c) => FOLLOW.test(c.name) || FOLLOW.test(c.title))).toEqual([]);
    // The one command of SR-117 only reads, and takes nothing that could switch a mode.
    const activity = commands.find((c) => c.name === "workspace.activity");
    expect([activity?.effect, activity?.input]).toEqual([
      "read",
      { type: "object", properties: {}, additionalProperties: false },
    ]);
    const schema = runtime.contracts.schemas.find(
      (s) => s["$id"] === "https://logreq.dev/schemas/activity.schema.json",
    );
    expect(schema).toBeDefined();
    expect(keysOf(schema).filter((key) => /follow|mode/i.test(key))).toEqual([]);

    const help = await cli(["workspace", "--help"]);
    expect([help.code, FOLLOW.test(help.stdout)]).toEqual([EXIT.ok, false]);

    const session = await mcpSession();
    try {
      const { tools } = await session.client.listTools();
      expect(tools.filter((t) => FOLLOW.test(t.name) || FOLLOW.test(t.title ?? ""))).toEqual([]);
    } finally {
      await session.close();
    }

    await withApi(async (port, token) => {
      const list = await request(port, token, "GET", "/v1/commands");
      const listed = (list.body as { commands: { name: string; title: string }[] }).commands;
      expect(listed.filter((c) => FOLLOW.test(c.name) || FOLLOW.test(c.title))).toEqual([]);
    });
  });
});

describe("the last agent access on every access (SR-117, SR-080 AK2)", () => {
  it("gives the element an MCP session read as the same object through the CLI, the API and MCP", async () => {
    const empty = await cli(["workspace", "activity", "--json"]);
    expect(JSON.parse(empty.stdout)).toEqual({ activity: null });

    const reading = await mcpSession();
    try {
      await reading.client.callTool({ name: "element_get", arguments: { ref: "SR-e88fb3" } });
    } finally {
      // Closing the session writes what it recorded.
      await reading.close();
    }

    const viaCli = JSON.parse((await cli(["workspace", "activity", "--json"])).stdout) as unknown;
    expect(viaCli).toEqual({
      activity: {
        access: "mcp",
        command: "element.get",
        effect: "read",
        at: expect.any(String) as unknown,
        element: { id: ELEMENT_ID, repository: "system" },
      },
    });

    const viaApi = await withApi(async (port, token) => {
      const reply = await request(port, token, "POST", "/v1/commands/workspace.activity");
      return reply.body;
    });
    const asking = await mcpSession();
    let viaMcp: unknown;
    try {
      viaMcp = (await asking.client.callTool({ name: "workspace_activity", arguments: {} }))
        .structuredContent;
    } finally {
      await asking.close();
    }
    expect([viaApi, viaMcp]).toEqual([viaCli, viaCli]);
  });
});
