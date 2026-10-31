// SR-142 on the local API, the MCP server and the command line: through API and MCP a command takes
// only local paths inside the repositories of the workspace (AK1, AK2); the command line takes the
// same path outside (AK3). The fixture SR-061/export has the Git repositories `system` (the workspace
// root) and `sensor`; `outside/` next to them belongs to no repository.
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { startApiServer } from "@reqseq/api";
import { Workspace, cacheFolder, createCommandRuntime } from "@reqseq/core";
import { LineTransport, serveMcp } from "@reqseq/mcp";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { EXIT, runCli } from "../src/index.js";

const runtime = createCommandRuntime();

/** A pytest-style JUnit file whose one test case names SR-0000b1 (system) or SR-0000e1 (sensor). */
const junit = (shortId: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites><testsuite name="s" tests="1"><testcase classname="c" name="[${shortId}] works" time="0"/></testsuite></testsuites>\n`;

// The OS cache folder (the cache folder of every copy, ADR-0008) lies in a temporary folder on every OS.
let cacheHome = "";
beforeAll(async () => {
  cacheHome = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-cache-home-"));
  for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
    vi.stubEnv(name, cacheHome);
  }
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(cacheHome, { recursive: true, force: true, maxRetries: 3 });
});

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

/** A Git copy of the fixture with `outside/delivery.xml`, `system/evidence/ci/run.xml` and `sensor/run.xml`. */
const fixture = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({
    fixture: "SR-061/export",
    git: ["system", "sensor"],
    files: {
      "outside/delivery.xml": junit("SR-0000b1"),
      "system/evidence/ci/run.xml": junit("SR-0000b1"),
      "sensor/run.xml": junit("SR-0000e1"),
    },
  });
  fixtures.push(ws);
  return ws;
};

/** The files of `outside/` with their text, and the Git status of both repositories: what a refused call must leave. */
const state = async (ws: FixtureWorkspace): Promise<unknown> => {
  const files = await fs.readdir(ws.path("outside"), { recursive: true });
  const outside = await Promise.all(
    files.sort().map(async (f) => [f, await fs.readFile(ws.path(`outside/${f}`), "utf8").catch(() => "")]),
  );
  return {
    outside,
    system: await ws.git(["status", "--porcelain", "--untracked-files=all"], "system"),
    sensor: await ws.git(["status", "--porcelain", "--untracked-files=all"], "sensor"),
  };
};

class Sink {
  text = "";
  write(text: string): boolean {
    this.text += text;
    return true;
  }
}

/** `reqseq <argv>` in `system`, in this process. */
const cli = async (ws: FixtureWorkspace, argv: readonly string[]): Promise<{ code: number; out: string }> => {
  const stdout = new Sink();
  const stderr = new Sink();
  const code = await runCli({
    argv: [...argv],
    cwd: ws.path("system"),
    stdin: Readable.from([]),
    stdout,
    stderr,
    runtime,
  });
  return { code, out: stdout.text + stderr.text };
};

type ApiCall = (
  command: string,
  input: unknown,
) => Promise<{ status: number | undefined; body: Record<string, unknown> }>;

/** An API server on the workspace `system` for `use`, which calls its commands. */
const withApi = async (ws: FixtureWorkspace, use: (call: ApiCall) => Promise<void>): Promise<void> => {
  const folder = cacheFolder(ws.path("system"));
  const workspace = new Workspace(ws.path("system"), { cacheFolder: folder });
  const server = await startApiServer({ workspace, runtime, cacheFolder: folder });
  try {
    const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
    const call: ApiCall = (command, input) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port: server.port,
            method: "POST",
            path: `/v1/commands/${command}`,
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
              resolve({
                status: res.statusCode,
                body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
              });
            });
          },
        );
        req.on("error", reject);
        req.end(JSON.stringify(input));
      });
    await use(call);
  } finally {
    await server.close();
    await workspace.close();
  }
};

/** Calls the MCP tool of `command` on the workspace `system`: the error object, or the output. */
const mcp = async (
  ws: FixtureWorkspace,
  command: string,
  input: Record<string, unknown>,
): Promise<{ isError: boolean; body: Record<string, unknown> }> => {
  const workspace = new Workspace(ws.path("system"), { cacheFolder: cacheFolder(ws.path("system")) });
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const served = serveMcp({
    runtime,
    workspace,
    input: toServer,
    output: { write: (t) => toClient.write(t) },
  });
  const client = new Client({ name: "local-paths", version: "1" });
  await client.connect(new LineTransport(toClient, { write: (t) => toServer.write(t) }));
  try {
    const result = await client.callTool({ name: command.replace(".", "_"), arguments: input });
    if (result.isError === true) {
      const [content] = result.content as { text: string }[];
      return { isError: true, body: JSON.parse(String(content?.text)) as Record<string, unknown> };
    }
    return { isError: false, body: result.structuredContent as Record<string, unknown> };
  } finally {
    toServer.end();
    await served;
    await client.close();
    await workspace.close();
  }
};

const refusedFor = (fields: readonly string[]): unknown => ({
  code: "input.invalid",
  message: expect.stringContaining("only local paths inside the repositories of the workspace") as unknown,
  details: expect.objectContaining({ reason: "outside-repositories", fields }) as unknown,
});

describe("local paths through API and MCP only inside the repositories (SR-142)", () => {
  it("[SR-142/AK1] the MCP server refuses an absolute path outside the repositories and reads and writes nothing", async () => {
    const ws = await fixture();
    const before = await state(ws);
    const reply = await mcp(ws, "evidence.enrichJunit", {
      file: ws.path("outside/delivery.xml"),
      item: "b1",
    });
    expect(reply).toEqual({ isError: true, body: refusedFor(["file"]) });
    expect(JSON.stringify(reply.body)).not.toContain(ws.root);
    // The same with a target inside: the source outside is not read.
    const into = await mcp(ws, "evidence.enrichJunit", {
      file: ws.path("outside/delivery.xml"),
      output: "evidence/ci/copy.xml",
      item: "b1",
    });
    expect(into.body).toEqual(refusedFor(["file"]));
    expect(await state(ws)).toEqual(before);
  });

  it("[SR-142/AK1] the API refuses a path that leaves the repositories through ..", async () => {
    const ws = await fixture();
    const before = await state(ws);
    await withApi(ws, async (api) => {
      const store = await api("data.store", { folder: "../outside" });
      expect([store.status, store.body]).toEqual([400, refusedFor(["folder"])]);
      const image = await api("element.addAttachment", {
        ref: "SR-0000b1",
        sourcePath: "../outside/delivery.xml",
      });
      expect([image.status, image.body]).toEqual([400, refusedFor(["sourcePath"])]);
      const check = await api("workspace.check", {
        changedFiles: ["requirements/SR-0000000000b1.md", "../outside/x.md"],
      });
      expect([check.status, check.body]).toEqual([400, refusedFor(["changedFiles[1]"])]);
    });
    expect(await state(ws)).toEqual(before);
  });

  it("[SR-142/AK1] the API and the MCP server refuse a path through a link inside a repository that leads out", async () => {
    const ws = await fixture();
    await fs.symlink(ws.path("outside"), ws.path("system/out"), "junction");
    const before = await state(ws);
    await withApi(ws, async (api) => {
      const store = await api("data.store", { folder: "out" });
      expect([store.status, store.body]).toEqual([400, refusedFor(["folder"])]);
      // A write target that does not exist yet is judged by its nearest existing folder.
      const output = await api("evidence.enrichJunit", {
        file: "evidence/ci/run.xml",
        output: "out/new/run.xml",
        item: "b1",
      });
      expect([output.status, output.body]).toEqual([400, refusedFor(["output"])]);
    });
    const reply = await mcp(ws, "evidence.enrichJunit", { file: "out/delivery.xml", item: "b1" });
    expect(reply).toEqual({ isError: true, body: refusedFor(["file"]) });
    expect(await state(ws)).toEqual(before);
  });

  it("[SR-142/AK2] the API and the MCP server run a command on a path inside a repository", async () => {
    const ws = await fixture();
    await withApi(ws, async (api) => {
      const viaApi = await api("evidence.enrichJunit", { file: "evidence/ci/run.xml", item: "b1" });
      expect([viaApi.status, viaApi.body["files"]]).toEqual([200, ["evidence/ci/run.xml"]]);
    });
    expect(await fs.readFile(ws.path("system/evidence/ci/run.xml"), "utf8")).toContain("reqseq:element");
    const viaMcp = await mcp(ws, "evidence.enrichJunit", { file: "../sensor/run.xml", item: "e1" });
    expect([viaMcp.isError, viaMcp.body["files"]]).toEqual([false, ["../sensor/run.xml"]]);
    expect(await fs.readFile(ws.path("sensor/run.xml"), "utf8")).toContain("reqseq:element");
    const stored = await mcp(ws, "data.store", { folder: ws.path("sensor/states") });
    expect(stored.isError).toBe(false);
    expect(await fs.readdir(ws.path("sensor/states"))).toHaveLength(1);
  });

  it("[SR-142/AK3] the command line accepts the same path outside the repositories", async () => {
    const ws = await fixture();
    const enrich = await cli(ws, ["evidence", "enrich-junit", ws.path("outside/delivery.xml"), "b1"]);
    expect(enrich.code, enrich.out).toBe(EXIT.ok);
    expect(await fs.readFile(ws.path("outside/delivery.xml"), "utf8")).toContain("reqseq:element");
    const store = await cli(ws, ["data", "store", "../outside"]);
    expect(store.code, store.out).toBe(EXIT.ok);
    expect((await fs.readdir(ws.path("outside"))).filter((f) => f.endsWith(".jsonl"))).toHaveLength(1);
  });
});
