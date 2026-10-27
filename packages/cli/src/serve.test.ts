// `logreq serve api` and `logreq mcp` in-process (ADR-0009); the built binaries are in test/e2e/servers.test.ts.
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { CommandRuntime } from "@logreq/core";
import {
  cacheFolder,
  lockCacheFile,
  createCommandRuntime,
  defineTestCommand,
  defineWorkspaceState,
  getCommandRuntime,
  loadContracts,
} from "@logreq/core";
import { LineTransport } from "@logreq/mcp";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace, untilWatching } from "@logreq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunCliOptions } from "./main.js";
import { EXIT, runCli } from "./main.js";

const entry = (name: string) => ({
  name,
  title: "Test command",
  summary: `Test command ${name}.`,
  effect: "read",
  stage: 1,
  implements: ["SR-080"],
  arguments: [],
  input: { type: "object" },
  output: { type: "object" },
});

const failingState = defineWorkspaceState("fails-on-close", () => 1, {
  dispose: () => {
    throw new Error("dispose failed at /secret/path");
  },
});

const runtimeFor = (names: readonly string[]): CommandRuntime =>
  createCommandRuntime({
    contracts: loadContracts({ catalog: { "logreq-catalog": 1, commands: names.map(entry) } }),
    validateOutput: true,
    commands: [
      defineTestCommand({ name: "test.root", run: (ctx) => Promise.resolve({ root: ctx.workspace.root }) }),
      defineTestCommand({
        name: "test.closeFails",
        run: (ctx) => Promise.resolve({ state: ctx.workspace.get(failingState) }),
      }),
    ].filter((c) => names.includes(c.name)),
  });

const runtime = runtimeFor(["test.root", "test.closeFails"]);

class Sink {
  text = "";
  write(text: string): boolean {
    this.text += text;
    return true;
  }
}

let fixture: FixtureWorkspace;

beforeEach(async () => {
  fixture = await createFixtureWorkspace({ files: { "logreq-workspace.yaml": "logreq-workspace: 1\n" } });
  // The cache folder of the OS user lands in the fixture on every OS.
  for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
    vi.stubEnv(name, fixture.path("home"));
  }
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fixture.cleanup();
});

interface Run extends RunCliOptions {
  /** Standard output, unless `stdout` was given. */
  readonly out: Sink;
  readonly err: Sink;
}

const options = (argv: string[], extra: Partial<RunCliOptions> = {}): Run => {
  const out = new Sink();
  const err = new Sink();
  return {
    argv,
    cwd: fixture.root,
    stdin: Readable.from([]),
    stdout: out,
    stderr: err,
    runtime,
    ...extra,
    out,
    err,
  };
};

const post = (
  port: number,
  token: string,
  name: string,
): Promise<{ status: number | undefined; body: unknown }> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: `/v1/commands/${name}`,
        headers: { authorization: `Bearer ${token}` },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });

/** Wait until the server has written its start lines. */
const started = async (sink: Sink): Promise<void> => {
  while (!sink.text.includes("Stop with Ctrl-C.")) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("logreq serve api", () => {
  it("serves the workspace of the current folder until the signal aborts, then exits 0", async () => {
    const controller = new AbortController();
    const opts = options(["serve", "api"], { signal: controller.signal });
    const exit = runCli(opts);
    await started(opts.out);
    const file = path.join(cacheFolder(fixture.root), "api.json");
    expect(opts.out.text).toMatch(/^LogReq API on http:\/\/127\.0\.0\.1:(\d+)/);
    expect(opts.out.text).toContain(`Port and token: ${file}\n`);
    const endpoint = JSON.parse(await fs.readFile(file, "utf8")) as { port: number; token: string };
    expect(await post(endpoint.port, endpoint.token, "test.root")).toEqual({
      status: 200,
      body: { root: fixture.root },
    });
    controller.abort();
    expect(await exit).toBe(EXIT.ok);
    // The API listens once the workspace is loaded (SR-082); the line says why it takes a while.
    expect(opts.err.text).toBe("Loading the workspace...\n");
  });

  it("takes --port and --workspace", async () => {
    await fs.mkdir(fixture.path("other"));
    const controller = new AbortController();
    const opts = options(["serve", "api", "--port", "0", "--workspace", "other"], {
      signal: controller.signal,
    });
    const exit = runCli(opts);
    await started(opts.out);
    controller.abort();
    expect(await exit).toBe(EXIT.ok);
    expect(opts.out.text).toContain(cacheFolder(fixture.path("other")));
  });

  it("stops without listening when it is stopped while the workspace loads (SR-082)", async () => {
    const controller = new AbortController();
    controller.abort();
    const opts = options(["serve", "api"], { signal: controller.signal });
    expect(await runCli(opts)).toBe(EXIT.ok);
    expect(opts.out.text).toBe("");
    await expect(fs.stat(path.join(cacheFolder(fixture.root), "api.json"))).rejects.toThrow();
  });

  it("refuses a second API before it loads the workspace (ADR-0009)", async () => {
    const lock = await lockCacheFile(cacheFolder(fixture.root), "api.json");
    const opts = options(["serve", "api"]);
    expect(await runCli(opts)).toBe(EXIT.usage);
    expect(opts.err.text).toMatch(
      /^error input\.invalid: A LogReq API for this working copy runs already or is starting/,
    );
    await lock?.release();
  });

  it("keeps its workspace current with files changed outside the tool (SR-007)", async () => {
    const changed = await createFixtureWorkspace({ fixture: "SR-007/external-changes" });
    try {
      const controller = new AbortController();
      const opts = options(["serve", "api"], {
        cwd: changed.root,
        signal: controller.signal,
        runtime: getCommandRuntime(),
      });
      const exit = runCli(opts);
      await started(opts.out);
      const endpoint = JSON.parse(
        await fs.readFile(path.join(cacheFolder(changed.root), "api.json"), "utf8"),
      ) as {
        port: number;
        token: string;
      };
      const statuses = async (): Promise<readonly string[]> =>
        (
          (await post(endpoint.port, endpoint.token, "metamodel.get")).body as { statuses: { key: string }[] }
        ).statuses.map((s) => s.key);
      expect(await statuses()).toEqual(["draft", "approved"]);
      const model = changed.path("metamodel/model.yaml");
      const original = await fs.readFile(model, "utf8");
      const withStatus = (key: string): string =>
        original.replace(
          "  - { key: approved, name: Approved }\n",
          `  - { key: approved, name: Approved }\n  - { key: ${key}, name: ${key} }\n`,
        );
      // A probe first: FSEvents (macOS) starts asynchronously and may miss the first change.
      await untilWatching({
        probe: () => fs.writeFile(model, withStatus("probe")),
        seen: async () => (await statuses()).includes("probe"),
      });
      await fs.writeFile(model, withStatus("rejected"));
      // Poll until the server shows the new file; how soon events arrive differs between systems.
      const start = performance.now();
      while (!(await statuses()).includes("rejected") && performance.now() - start < 10_000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(await statuses()).toEqual(["draft", "approved", "rejected"]);
      controller.abort();
      expect(await exit).toBe(EXIT.ok);
    } finally {
      await changed.cleanup();
    }
  });

  it("refuses a port that is not a number from 0 to 65535 (exit 2)", async () => {
    for (const port of ["abc", "-1", "70000", ""]) {
      const opts = options(["serve", "api", "--port", port]);
      expect(await runCli(opts)).toBe(EXIT.usage);
      // Refused before the workspace loads.
      expect(opts.err.text).toMatch(/^error input\.invalid: Port must be a whole number/);
    }
  });

  it("[SR-079/AK3] offers no option to listen on another address", async () => {
    const opts = options(["serve", "api", "--help"]);
    expect(await runCli(opts)).toBe(EXIT.ok);
    const flags = opts.out.text.match(/--[a-z-]+/g);
    expect([...new Set(flags)].sort()).toEqual(["--help", "--port", "--workspace"]);
    const mcp = options(["mcp", "--help"]);
    expect(await runCli(mcp)).toBe(EXIT.ok);
    expect([...new Set(mcp.out.text.match(/--[a-z-]+/g))].sort()).toEqual(["--help", "--workspace"]);
  });
});

describe("logreq mcp", () => {
  const session = async (signal?: AbortSignal, rt: CommandRuntime = runtime) => {
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const opts = options(["mcp"], {
      stdin: toServer,
      stdout: { write: (text: string) => toClient.write(text) },
      runtime: rt,
      ...(signal === undefined ? {} : { signal }),
    });
    const exit = runCli(opts);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(new LineTransport(toClient, { write: (text) => toServer.write(text) }));
    return { client, exit, end: () => toServer.end(), stderr: opts.err };
  };

  it("serves MCP on standard input and output until the input ends, then exits 0", async () => {
    const { client, exit, end, stderr } = await session();
    const result = await client.callTool({ name: "test_root", arguments: {} });
    expect(result.structuredContent).toEqual({ root: fixture.root });
    end();
    expect(await exit).toBe(EXIT.ok);
    expect(stderr.text).toBe("");
    await client.close();
  });

  it("stops at the signal", async () => {
    const controller = new AbortController();
    const { client, exit } = await session(controller.signal);
    controller.abort();
    expect(await exit).toBe(EXIT.ok);
    await client.close();
  });

  it("exits 3 when the workspace cannot be closed, without the error text", async () => {
    const { client, exit, end, stderr } = await session();
    await client.callTool({ name: "test_closeFails", arguments: {} });
    end();
    expect(await exit).toBe(EXIT.internal);
    expect(stderr.text).toBe("error internal: Internal error in the command line\n");
    await client.close();
  });
});

describe("server commands and the catalog", () => {
  it("refuses a catalog group named like a server command", async () => {
    const opts = options(["--help"], { runtime: runtimeFor(["serve.files"]) });
    expect(await runCli(opts)).toBe(EXIT.internal);
    expect(opts.err.text).toBe("error internal: Internal error in the command line\n");
  });

  it("reports a server that cannot start on stderr (port in use: exit 2)", async () => {
    const blocker = http.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const { port } = blocker.address() as { port: number };
    const opts = options(["serve", "api", "--port", String(port)]);
    expect(await runCli(opts)).toBe(EXIT.usage);
    expect(opts.err.text).toMatch(
      /^Loading the workspace\.\.\.\nerror input\.invalid: Cannot listen on 127\.0\.0\.1 port \d+ \(EADDRINUSE\)/,
    );
    await new Promise((resolve) => blocker.close(resolve));
  });
});
