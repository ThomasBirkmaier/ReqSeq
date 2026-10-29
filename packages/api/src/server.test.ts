import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { CommandRuntime } from "@logreq/core";
import {
  CommandError,
  Workspace,
  cacheFolder,
  createCommandRuntime,
  defineTestCommand,
  fileSchemaValidator,
  isTempFile,
  loadContracts,
  lockCacheFile,
} from "@logreq/core";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { DRAIN_BYTES, HTTP_STATUS_BY_CLASS, MAX_BODY_BYTES } from "./handler.js";
import type { ApiServer } from "./server.js";
import {
  HEADERS_TIMEOUT_MS,
  LOOPBACK_HOSTS,
  PORT_ATTEMPTS,
  REQUEST_TIMEOUT_MS,
  PROBE_TIMEOUT_MS,
  listenOnAll,
  refuseRunningApi,
  startApiServer,
  urlOf,
} from "./server.js";

/** A handler for servers of listenOnAll that no test sends a request to. */
const unused = (): void => undefined;

// Test-only catalog: echo, every error class, a crash, a command that waits for its signal, odd outputs.
const entry = (name: string, input: Record<string, unknown> = {}) => ({
  name,
  title: "Test command",
  summary: `Test command ${name}.`,
  effect: "read",
  stage: 1,
  implements: ["SR-080"],
  arguments: [],
  input: { type: "object", additionalProperties: true, ...input },
  output: { type: "object" },
});

const catalog = {
  "logreq-catalog": 1,
  commands: [
    entry("test.echo"),
    entry("test.fail", { properties: { code: { type: "string" } }, required: ["code"] }),
    entry("test.crash"),
    entry("test.wait"),
    entry("test.nothing"),
    entry("test.circular"),
    entry("test.later"),
    entry("test.large"),
    entry("test.lateFail"),
    { ...entry("test.rows"), jsonLines: { items: "rows", fields: ["mark"] } },
  ],
};

/** About `megabytes` MB of compact JSON in one output (#277). */
const largeOutput = (megabytes: number): { items: { n: number; text: string }[] } => ({
  items: Array.from({ length: megabytes * 10_000 }, (_, n) => ({ n, text: `Größe ${"x".repeat(80)}` })),
});

let aborted: ((reason: unknown) => void) | undefined;
let started: (() => void) | undefined;

const runtime = createCommandRuntime({
  contracts: loadContracts({ catalog }),
  validateOutput: false,
  commands: [
    defineTestCommand({ name: "test.echo", run: (_ctx, input: unknown) => Promise.resolve({ input }) }),
    defineTestCommand({
      name: "test.fail",
      run: (_ctx, input: { code: string }) =>
        Promise.reject(new CommandError(input.code as "element.not-found", `Failed with ${input.code}`)),
    }),
    defineTestCommand({ name: "test.crash", run: () => Promise.reject(new Error("crash at /secret/path")) }),
    defineTestCommand({
      name: "test.wait",
      run: (ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => {
            aborted?.(ctx.signal.reason);
            reject(new Error("stopped"));
          });
          started?.();
        }),
    }),
    defineTestCommand({ name: "test.nothing", run: () => Promise.resolve(undefined) }),
    defineTestCommand({
      name: "test.large",
      run: (_ctx, input: { megabytes?: number }) => Promise.resolve(largeOutput(input.megabytes ?? 3)),
    }),
    defineTestCommand({
      // Fine in its first chunks, then a value JSON cannot hold.
      name: "test.lateFail",
      run: () => Promise.resolve({ ...largeOutput(3), last: 1n }),
    }),
    defineTestCommand({
      name: "test.rows",
      run: (_ctx, input: { fail?: boolean; rows?: unknown[] }) =>
        input.fail === true
          ? Promise.reject(new CommandError("input.invalid", "No rows"))
          : Promise.resolve({ mark: 2, other: "x", rows: input.rows ?? [{ a: 1 }, { a: "Größe" }] }),
    }),
    defineTestCommand({
      name: "test.circular",
      run: () => {
        const loop: Record<string, unknown> = {};
        loop["self"] = loop;
        return Promise.resolve(loop);
      },
    }),
  ],
});

interface Reply {
  readonly status: number | undefined;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: unknown;
}

interface RequestOptions {
  readonly method?: string;
  readonly path?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Buffer;
  readonly host?: string;
}

/**
 * Make `listen` on `host` fail with `code`, as an OS without that address or with the port taken does: the
 * first `times` tries (default every one). Returns the ports asked for on `host`.
 */
const failListen = (host: string, code: string, times = Infinity): number[] => {
  const original = Reflect.get(http.Server.prototype, "listen") as (
    this: http.Server,
    ...args: unknown[]
  ) => http.Server;
  const ports: number[] = [];
  vi.spyOn(http.Server.prototype, "listen").mockImplementation(function (this: http.Server, ...args) {
    const options: unknown = args[0];
    if (typeof options === "object" && options !== null && (options as net.ListenOptions).host === host) {
      ports.push(Number((options as net.ListenOptions).port));
      if (ports.length <= times) {
        process.nextTick(() => this.emit("error", Object.assign(new Error(code), { code })));
        return this;
      }
    }
    return original.apply(this, args);
  });
  return ports;
};

const closeAll = (servers: readonly http.Server[]): Promise<unknown[]> =>
  Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));

/** An api.json with the process ID of this process, which runs. */
const endpointText = (fields: Record<string, unknown>): string =>
  JSON.stringify({ "logreq-api": 1, port: 1, token: "t", urls: [], pid: process.pid, ...fields });

/** A TCP server on 127.0.0.1 that is no API: its URL, and close. */
const loopbackServer = async (
  onConnection: (socket: net.Socket) => void,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const tcp = net.createServer(onConnection);
  await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${String((tcp.address() as net.AddressInfo).port)}`,
    close: () =>
      new Promise((resolve) => {
        tcp.close(() => {
          resolve();
        });
      }),
  };
};

let dir: string;
let server: ApiServer | undefined;
let token: string;

const request = (options: RequestOptions = {}): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: options.host ?? "127.0.0.1",
        port: server?.port,
        method: options.method ?? "POST",
        path: options.path ?? "/v1/commands/test.echo",
        // An empty value leaves the header out.
        headers: Object.fromEntries(
          Object.entries({ authorization: `Bearer ${token}`, ...options.headers }).filter(
            ([, v]) => v !== "",
          ),
        ),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode,
            headers: res.headers,
            // JSON Lines (#319) stay text.
            body:
              text === "" || res.headers["content-type"]?.startsWith("application/json") !== true
                ? text
                : JSON.parse(text),
          });
        });
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });

const start = async (port = 0, rt: CommandRuntime = runtime): Promise<ApiServer> => {
  server = await startApiServer({ workspace: new Workspace(dir), runtime: rt, port, cacheFolder: dir });
  const endpoint = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
  token = endpoint.token;
  return server;
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-api-"));
  aborted = undefined;
  started = undefined;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await server?.close();
  server = undefined;
  await fs.rm(dir, { recursive: true, force: true });
});

describe("listening", () => {
  it("[SR-079/AK1] listens on the loopback addresses only, all on one port", async () => {
    const api = await start();
    expect(api.addresses.length).toBeGreaterThan(0);
    expect(api.addresses[0]?.address).toBe("127.0.0.1");
    for (const address of api.addresses) {
      expect(LOOPBACK_HOSTS).toContain(address.address);
      expect(address.port).toBe(api.port);
    }
    expect(api.urls).toEqual(api.addresses.map(urlOf));
  });

  it("writes IPv6 addresses in brackets in URLs", () => {
    expect(urlOf({ address: "::1", family: "IPv6", port: 8 })).toBe("http://[::1]:8");
    expect(urlOf({ address: "127.0.0.1", family: "IPv4", port: 8 })).toBe("http://127.0.0.1:8");
  });

  it("[SR-079/AK3] has no address option: the bind addresses are a constant", async () => {
    expect(LOOPBACK_HOSTS).toEqual(["127.0.0.1", "::1"]);
    // The only place that listens takes the constant; nothing reads the environment for an address.
    const sources = await Promise.all(
      ["server.ts", "handler.ts", "index.ts"].map((f) =>
        fs.readFile(path.join(import.meta.dirname, f), "utf8"),
      ),
    );
    const code = sources.join("\n");
    expect(code.match(/listenOn(?:All|ce)\(\w+/g)).toEqual([
      "listenOnce(hosts",
      "listenOnAll(LOOPBACK_HOSTS",
    ]);
    expect(code.match(/\.listen\([^)]*\)/g)).toEqual([".listen({ host, port, exclusive: true }, ()"]);
    expect(code).not.toMatch(/process\.env|0\.0\.0\.0|"::"/);
  });

  it("bounds slow senders: headers and body each have a time limit (#200)", async () => {
    const probe = await listenOnAll(["127.0.0.1"], 0, unused);
    expect(probe.servers.map((s) => [s.headersTimeout, s.requestTimeout])).toEqual([
      [HEADERS_TIMEOUT_MS, REQUEST_TIMEOUT_MS],
    ]);
    await closeAll(probe.servers);
  });

  it("uses a given port", async () => {
    const probe = await listenOnAll(["127.0.0.1"], 0, unused);
    const free = probe.port;
    await closeAll(probe.servers);
    const api = await start(free);
    expect(api.port).toBe(free);
  });

  it("refuses ports outside 0..65535 and ports in use", async () => {
    for (const port of [-1, 1.5, 65536, Number.NaN]) {
      await expect(startApiServer({ workspace: new Workspace(dir), runtime, port })).rejects.toMatchObject({
        code: "input.invalid",
      });
    }
    const api = await start();
    const other = path.join(dir, "other");
    await expect(
      startApiServer({ workspace: new Workspace(dir), runtime, port: api.port, cacheFolder: other }),
    ).rejects.toMatchObject({
      code: "input.invalid",
      message: expect.stringContaining("EADDRINUSE") as unknown,
    });
  });

  it("skips an address the machine does not have (no IPv6), but not the first one", async () => {
    failListen("::1", "EADDRNOTAVAIL");
    const { servers, port } = await listenOnAll(LOOPBACK_HOSTS, 0, unused);
    expect(servers.map((s) => s.address())).toEqual([{ address: "127.0.0.1", family: "IPv4", port }]);
    await closeAll(servers);
    vi.restoreAllMocks();
    failListen("127.0.0.1", "EAFNOSUPPORT");
    await expect(listenOnAll(LOOPBACK_HOSTS, 0, unused)).rejects.toMatchObject({ code: "internal" });
  });

  it("tries a new free port when ::1 has the one of 127.0.0.1 taken, if any port will do", async () => {
    const asked = failListen("::1", "EADDRINUSE", 1);
    const { servers, port } = await listenOnAll(["127.0.0.1", "::1"], 0, unused);
    await closeAll(servers);
    expect(asked).toHaveLength(2);
    expect(asked[1]).toBe(port);
  });

  it(`gives up after ${String(PORT_ATTEMPTS)} tries, and does not try again for a given port`, async () => {
    const asked = failListen("::1", "EADDRINUSE");
    await expect(listenOnAll(["127.0.0.1", "::1"], 0, unused)).rejects.toMatchObject({
      code: "input.invalid",
    });
    expect(asked).toHaveLength(PORT_ATTEMPTS);
    const probe = await listenOnAll(["127.0.0.1"], 0, unused);
    await closeAll(probe.servers);
    await expect(listenOnAll(["127.0.0.1", "::1"], probe.port, unused)).rejects.toMatchObject({
      code: "input.invalid",
    });
    expect(asked).toHaveLength(PORT_ATTEMPTS + 1);
  });

  it("does not try again when the first address fails or a later one fails otherwise", async () => {
    const first = failListen("127.0.0.1", "EADDRINUSE");
    await expect(listenOnAll(["127.0.0.1", "::1"], 0, unused)).rejects.toMatchObject({
      code: "input.invalid",
    });
    expect(first).toHaveLength(1);
    vi.restoreAllMocks();
    const later = failListen("::1", "EACCES");
    await expect(listenOnAll(["127.0.0.1", "::1"], 0, unused)).rejects.toMatchObject({
      code: "input.invalid",
      message: expect.stringContaining("EACCES") as unknown,
    });
    expect(later).toHaveLength(1);
  });

  it("closes what it opened when a later address fails", async () => {
    failListen("::1", "EADDRINUSE");
    const opened: http.Server[] = [];
    const original = Reflect.get(http.Server.prototype, "on") as (
      this: http.Server,
      ...args: unknown[]
    ) => http.Server;
    vi.spyOn(http.Server.prototype, "on").mockImplementation(function (this: http.Server, ...args) {
      opened.push(this);
      return original.apply(this, args);
    });
    await expect(listenOnAll(LOOPBACK_HOSTS, 0, unused)).rejects.toMatchObject({
      code: "input.invalid",
      message: expect.stringMatching(/^Cannot listen on ::1 port \d+ \(EADDRINUSE\)$/) as unknown,
    });
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.every((s) => !s.listening)).toBe(true);
  });

  it("writes api.json with port and token, readable by the owner only", async () => {
    const api = await start();
    expect(api.endpointFile).toBe(path.join(dir, "api.json"));
    const endpoint = JSON.parse(await fs.readFile(api.endpointFile, "utf8")) as Record<string, unknown>;
    expect(fileSchemaValidator("api-endpoint.schema.json")(endpoint)).toBe(true);
    expect(endpoint).toMatchObject({ "logreq-api": 1, port: api.port, urls: api.urls, pid: process.pid });
    if (process.platform !== "win32") {
      expect((await fs.stat(api.endpointFile)).mode & 0o777).toBe(0o600);
    }
  });

  it("writes api.json into the cache folder of the workspace by default", async () => {
    for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
      vi.stubEnv(name, dir);
    }
    const workspace = new Workspace(path.join(dir, "ws"));
    server = await startApiServer({ workspace, runtime });
    expect(server.endpointFile).toBe(path.join(cacheFolder(workspace.root), "api.json"));
    expect(server.endpointFile.startsWith(dir)).toBe(true);
  });

  it("removes its api.json when it closes, but not one that another API wrote", async () => {
    const api = await start();
    await api.close();
    await expect(fs.stat(api.endpointFile)).rejects.toMatchObject({ code: "ENOENT" });
    const again = await start();
    await fs.writeFile(again.endpointFile, '{"token":"of another API"}');
    await again.close();
    expect(await fs.readFile(again.endpointFile, "utf8")).toBe('{"token":"of another API"}');
    await fs.rm(again.endpointFile);
    const gone = await start();
    await fs.rm(gone.endpointFile);
    await expect(gone.close()).resolves.toBeUndefined();
    server = undefined;
  });

  it("puts api.json into the cache folder the workspace was opened with", async () => {
    const folder = path.join(dir, "workspace-cache");
    const server = await startApiServer({ workspace: new Workspace(dir, { cacheFolder: folder }), runtime });
    onTestFinished(() => server.close());
    expect(server.endpointFile).toBe(path.join(folder, "api.json"));
  });

  it("refuseRunningApi asks before a start: free, starting, or running", async () => {
    const workspace = new Workspace(dir);
    await expect(refuseRunningApi({ workspace, cacheFolder: dir })).resolves.toBeUndefined();
    await expect(fs.readdir(dir)).resolves.not.toContain("api.json");
    const lock = await lockCacheFile(dir, "api.json");
    await expect(refuseRunningApi({ workspace, cacheFolder: dir })).rejects.toMatchObject({
      code: "input.invalid",
      message: expect.stringContaining("runs already or is starting") as unknown,
    });
    await lock?.release();
    const first = await start();
    await expect(refuseRunningApi({ workspace, cacheFolder: dir })).rejects.toMatchObject({
      code: "input.invalid",
      details: { url: first.urls[0], folder: dir },
    });
  });

  it("refuses to start while the API of api.json answers there with its token", async () => {
    const first = await start();
    const before = await fs.readFile(first.endpointFile, "utf8");
    await expect(
      startApiServer({ workspace: new Workspace(dir), runtime, cacheFolder: dir }),
    ).rejects.toMatchObject({
      code: "input.invalid",
      message:
        `A LogReq API for this working copy runs already at ${String(first.urls[0])}. Stop it first. ` +
        `If it does not answer, remove api.json in ${dir}.`,
      details: { url: first.urls[0], folder: dir },
    });
    // The running API keeps its file, its token and its connections.
    expect(await fs.readFile(first.endpointFile, "utf8")).toBe(before);
    expect((await request()).status).toBe(200);
  });

  it("of two starts at the same time for one working copy, exactly one starts", async () => {
    const lockFile = path.join(dir, "api.json.lock");
    for (let round = 0; round < 20; round++) {
      const results = await Promise.allSettled(
        [0, 1].map(() => startApiServer({ workspace: new Workspace(dir), runtime, cacheFolder: dir })),
      );
      const started = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      const refused = results.flatMap((result): unknown[] =>
        result.status === "rejected" ? [result.reason] : [],
      );
      expect(started).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(refused[0]).toBeInstanceOf(CommandError);
      expect(refused[0]).toMatchObject({
        code: "input.invalid",
        message: expect.stringContaining("A LogReq API for this working copy runs already") as unknown,
      });
      // The one that started owns api.json, and no lock is left.
      const [winner] = started;
      const endpoint = JSON.parse(await fs.readFile(path.join(dir, "api.json"), "utf8")) as object;
      expect(endpoint).toMatchObject({ urls: winner?.urls });
      await expect(fs.stat(lockFile)).rejects.toMatchObject({ code: "ENOENT" });
      await winner?.close();
    }
  });

  it("refuses to start while another start holds the lock, and leaves its lock alone", async () => {
    const lockFile = path.join(dir, "api.json.lock");
    const held = JSON.stringify({ pid: process.pid, nonce: "another start" });
    await fs.writeFile(lockFile, held);
    await expect(
      startApiServer({ workspace: new Workspace(dir), runtime, cacheFolder: dir }),
    ).rejects.toMatchObject({
      code: "input.invalid",
      message:
        "A LogReq API for this working copy runs already or is starting. Stop it first. " +
        `If none runs, remove api.json.lock in ${dir}.`,
      details: { folder: dir },
    });
    expect(await fs.readFile(lockFile, "utf8")).toBe(held);
    await expect(fs.stat(path.join(dir, "api.json"))).rejects.toMatchObject({ code: "ENOENT" });
    // The lock of a start that crashed is stale: the next start breaks it.
    await fs.writeFile(lockFile, JSON.stringify({ pid: 2147483646, nonce: "crashed" }));
    await start();
    await expect(fs.stat(lockFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it(
    "counts an API that accepts but does not answer in time, and a process of another user, as running",
    { timeout: 15_000 },
    async () => {
      const file = path.join(dir, "api.json");
      const silent = await loopbackServer((socket) => {
        // Accepts and never answers, like an API whose event loop is busy.
        socket.on("error", () => undefined).resume();
      });
      try {
        await fs.writeFile(file, endpointText({ urls: [silent.url] }));
        const started = performance.now();
        await expect(
          startApiServer({ workspace: new Workspace(dir), runtime, cacheFolder: dir }),
        ).rejects.toMatchObject({ code: "input.invalid", details: { url: silent.url } });
        expect(performance.now() - started).toBeGreaterThanOrEqual(PROBE_TIMEOUT_MS - 50);
      } finally {
        await silent.close();
      }
      const first = await start();
      const endpoint = JSON.parse(await fs.readFile(first.endpointFile, "utf8")) as object;
      await fs.writeFile(file, JSON.stringify({ ...endpoint, pid: 1 }));
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      });
      await expect(
        startApiServer({ workspace: new Workspace(dir), runtime, cacheFolder: dir }),
      ).rejects.toMatchObject({ details: { url: first.urls[0] } });
    },
  );

  it(
    "replaces api.json when its process does not run, or no API answers there with its token",
    { timeout: 15_000 },
    async () => {
      const file = path.join(dir, "api.json");
      const other = await start();
      let hangUp: { url: string; close: () => Promise<void> } | undefined;
      const hosts: unknown[] = [];
      try {
        const otherEndpoint = JSON.parse(await fs.readFile(other.endpointFile, "utf8")) as object;
        await fs.rm(other.endpointFile);
        const stopped = await start();
        const stoppedUrls = stopped.urls;
        await stopped.close();
        // Accepts and hangs up at once.
        hangUp = await loopbackServer((socket) => socket.destroy());
        const connect = Reflect.get(net.Socket.prototype, "connect") as (
          this: net.Socket,
          ...args: unknown[]
        ) => net.Socket;
        vi.spyOn(net.Socket.prototype, "connect").mockImplementation(function (this: net.Socket, ...args) {
          // http passes Node's normalized argument array: [options, callback].
          const options: unknown = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
          hosts.push((options as { host?: unknown } | undefined)?.host);
          return connect.apply(this, args);
        });
        const replace = async (text: string): Promise<void> => {
          await fs.writeFile(file, text);
          const api = await start();
          await api.close();
          server = undefined;
        };
        // The process of the file does not run (or the file has no process ID): replaced without asking,
        // even when the URLs and the token are those of a running API.
        for (const pid of [2147483646, 0, 1.5, "1", undefined]) {
          await replace(JSON.stringify({ ...otherEndpoint, pid }));
        }
        expect(hosts).toEqual([]);
        for (const text of [
          // The process ID runs (this process, as when an ID is reused), but no API answers at the URLs.
          endpointText({ urls: stoppedUrls }),
          endpointText({ urls: [hangUp.url] }),
          // The URLs of a running API, but not its token: 401.
          JSON.stringify({ ...otherEndpoint, pid: process.pid, token: "wrong" }),
          // Never asked: not loopback, or not in the form that api.json has.
          endpointText({ urls: ["http://192.0.2.1:80", "http://localhost:80", "https://127.0.0.1:80", 8] }),
          endpointText({ urls: ["http://127.0.0.1:99999"] }),
          endpointText({ urls: "http://127.0.0.1:80" }),
          endpointText({ token: 1, urls: stoppedUrls }),
          "null",
          "1",
          "{",
        ]) {
          await replace(text);
        }
      } finally {
        await hangUp?.close();
        await other.close();
      }
      expect(hosts.length).toBeGreaterThan(0);
      expect(hosts.filter((host) => host !== "127.0.0.1" && host !== "::1")).toEqual([]);
    },
  );

  it("rejects with the Node error when the lock of api.json cannot be taken", async () => {
    await fs.writeFile(path.join(dir, "file"), "");
    const failing = startApiServer({
      workspace: new Workspace(dir),
      runtime,
      cacheFolder: path.join(dir, "file"),
    });
    await expect(failing).rejects.toMatchObject({
      code: expect.stringMatching(/^(EEXIST|ENOTDIR)$/) as unknown,
    });
  });

  it("stops listening and gives the lock back when api.json cannot be written", async () => {
    const opened: http.Server[] = [];
    const listen = Reflect.get(http.Server.prototype, "listen") as (
      this: http.Server,
      ...args: unknown[]
    ) => http.Server;
    vi.spyOn(http.Server.prototype, "listen").mockImplementation(function (this: http.Server, ...args) {
      opened.push(this);
      return listen.apply(this, args);
    });
    vi.spyOn(fs, "rename").mockRejectedValue(Object.assign(new Error("EIO"), { code: "EIO" }));
    await expect(
      startApiServer({ workspace: new Workspace(dir), runtime, cacheFolder: dir }),
    ).rejects.toThrow("EIO");
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.every((s) => !s.listening)).toBe(true);
    vi.restoreAllMocks();
    expect((await fs.readdir(dir)).filter((name) => !isTempFile(name))).toEqual([]);
  });

  it("runs on the runtime of the process by default", async () => {
    server = await startApiServer({ workspace: new Workspace(dir), cacheFolder: dir });
    token = (JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string }).token;
    const reply = await request({ path: "/v1/commands/test.echo" });
    expect(reply.body).toMatchObject({ code: "input.invalid", message: "Unknown command: test.echo" });
  });
});

describe("refusals before a command runs", () => {
  beforeEach(async () => {
    await start();
  });

  it("accepts the loopback host names with the port", async () => {
    for (const host of ["127.0.0.1", "localhost", "LOCALHOST", "[::1]"]) {
      const reply = await request({ headers: { host: `${host}:${String(server?.port)}` } });
      expect(reply.status).toBe(200);
    }
  });

  it("refuses any other Host header (DNS rebinding)", async () => {
    for (const host of ["evil.example", `evil.example:${String(server?.port)}`, "127.0.0.1", "127.0.0.1:1"]) {
      const reply = await request({ headers: { host } });
      expect(reply.status).toBe(403);
      expect(reply.body).toMatchObject({ code: "input.invalid" });
    }
  });

  it("refuses a request without Host header", async () => {
    const socket = net.connect(server?.port ?? 0, "127.0.0.1");
    socket.end(`POST /v1/commands/test.echo HTTP/1.0\r\nAuthorization: Bearer ${token}\r\n\r\n`);
    const chunks: Buffer[] = [];
    for await (const chunk of socket) {
      chunks.push(chunk as Buffer);
    }
    expect(Buffer.concat(chunks).toString("utf8")).toMatch(/^HTTP\/1\.1 403/);
  });

  it("refuses requests with an Origin header (no browser access)", async () => {
    const reply = await request({ headers: { origin: "http://127.0.0.1" } });
    expect(reply.status).toBe(403);
  });

  it("refuses a missing or wrong token", async () => {
    for (const authorization of [
      "",
      `Bearer ${token.replace(/^./, token.startsWith("a") ? "b" : "a")}`,
      "Bearer x",
      `Basic ${token}`,
      `Bearer${token}`,
    ]) {
      const reply = await request({ headers: { authorization } });
      expect(reply.status).toBe(401);
      expect(reply.headers["www-authenticate"]).toBe("Bearer");
    }
  });

  it("takes the Bearer scheme in any case (RFC 9110)", async () => {
    for (const authorization of [`bearer ${token}`, `BEARER  ${token}`]) {
      expect((await request({ headers: { authorization } })).status).toBe(200);
    }
  });

  it("answers 404 outside the commands and 405 for other methods", async () => {
    expect((await request({ path: "/" })).status).toBe(404);
    expect((await request({ path: "/v1/commandsx" })).status).toBe(404);
    expect((await request({ path: "/v1/commands/%E0%A4%A" })).status).toBe(404);
    const get = await request({ method: "GET" });
    expect([get.status, get.headers.allow]).toEqual([405, "POST"]);
    const post = await request({ path: "/v1/commands" });
    expect([post.status, post.headers.allow]).toEqual([405, "GET"]);
  });
});

describe("keep-alive after an answer that needs no body (#200)", () => {
  beforeEach(async () => {
    await start();
  });

  /** Every answer that the server gives without running a command, as a request with a body. */
  const early = (): { name: string; status: number; options: RequestOptions }[] => [
    { name: "wrong Host", status: 403, options: { headers: { host: "evil.example" } } },
    { name: "Origin", status: 403, options: { headers: { origin: "http://127.0.0.1" } } },
    { name: "no token", status: 401, options: { headers: { authorization: "" } } },
    { name: "unknown path", status: 404, options: { path: "/v1/other" } },
    { name: "a target URL cannot read", status: 404, options: { path: "//[/" } },
    { name: "GET on a command", status: 405, options: { method: "GET" } },
    { name: "DELETE on a command", status: 405, options: { method: "DELETE" } },
    { name: "POST on the catalog", status: 405, options: { path: "/v1/commands" } },
    { name: "the catalog", status: 200, options: { method: "GET", path: "/v1/commands" } },
  ];

  /**
   * Sends requests one after the other on one keep-alive agent with one socket: their statuses and
   * `connection` headers, and how many sockets they took. A body is framed with `content-length`, or chunked
   * when `chunked` is set: Node's client sends a GET or DELETE body without any framing otherwise, and no
   * server can tell such bytes from the next request.
   */
  const onOneAgent = async (
    requests: readonly (RequestOptions & { readonly chunked?: boolean })[],
  ): Promise<{ answers: [number | undefined, string | undefined][]; sockets: number }> => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const sockets = new Set<unknown>();
    const answers: [number | undefined, string | undefined][] = [];
    try {
      for (const options of requests) {
        const body = options.body ?? "";
        answers.push(
          await new Promise<[number | undefined, string | undefined]>((resolve, reject) => {
            const req = http.request({
              agent,
              host: "127.0.0.1",
              port: server?.port,
              method: options.method ?? "POST",
              path: options.path ?? "/v1/commands/test.echo",
              headers: Object.fromEntries(
                Object.entries({
                  authorization: `Bearer ${token}`,
                  ...(options.chunked === true
                    ? { "transfer-encoding": "chunked" }
                    : { "content-length": String(Buffer.byteLength(body)) }),
                  ...options.headers,
                }).filter(([, v]) => v !== ""),
              ),
            });
            req.on("socket", (socket) => sockets.add(socket));
            req.on("response", (res) => {
              res.resume();
              res.on("end", () => {
                resolve([res.statusCode, res.headers.connection]);
              });
            });
            req.on("error", reject);
            if (options.chunked === true) {
              // Two chunks, so the body really is chunked.
              req.write(body.slice(0, 1));
              req.end(body.slice(1));
            } else {
              req.end(body);
            }
          }),
        );
      }
      return { answers, sockets: sockets.size };
    } finally {
      agent.destroy();
    }
  };

  const bodies = {
    small: { body: '{"ref":"SR-1"}' },
    chunked: { body: '{"ref":"SR-1"}', chunked: true },
    "4 MiB": { body: Buffer.alloc(4 * 1024 * 1024, 0x20) },
  } as const;

  for (const [kind, framing] of Object.entries(bodies)) {
    it(`keeps the connection after every early answer to a request with a ${kind} body`, async () => {
      for (const { name, status, options } of early()) {
        const result = await onOneAgent([{ ...options, ...framing }, {}]);
        expect({ name, ...result }).toEqual({
          name,
          answers: [
            [status, "keep-alive"],
            [200, "keep-alive"],
          ],
          sockets: 1,
        });
      }
    });
  }

  it("answers a refused request after its body, also when the body comes in parts", async () => {
    const socket = net.connect(server?.port ?? 0, "127.0.0.1");
    const host = `Host: 127.0.0.1:${String(server?.port)}\r\n`;
    let answer = "";
    socket.on("data", (data: Buffer) => (answer += data.toString("utf8")));
    const failed = new Promise<never>((_, reject) => socket.on("error", reject));
    onTestFinished(() => {
      socket.destroy();
    });
    socket.write(`POST /v1/commands/test.echo HTTP/1.1\r\n${host}Content-Length: 10\r\n\r\n{"a":`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Nothing yet: the server reads the whole body first.
    expect(answer).toBe("");
    // The rest of the body, then the next request in the same write (pipelined).
    socket.write(
      `"bc"}POST /v1/commands/test.echo HTTP/1.1\r\n${host}Authorization: Bearer ${token}\r\n` +
        `Content-Length: 2\r\nConnection: close\r\n\r\n{}`,
    );
    await Promise.race([new Promise((resolve) => socket.on("close", resolve)), failed]);
    expect(answer).toMatch(
      /^HTTP\/1\.1 401 [^]*Missing or wrong token[^]*\r\nHTTP\/1\.1 200 [^]*"input":\{\}/,
    );
  });

  it("closes the connection after an early answer to a body over the limit, with its own status", async () => {
    const large = Buffer.alloc(MAX_BODY_BYTES + 1, 0x20);
    const unauthorized = await onOneAgent([{ body: large, headers: { authorization: "" } }, {}]);
    expect(unauthorized).toEqual({
      answers: [
        [401, "close"],
        [200, "keep-alive"],
      ],
      sockets: 2,
    });
    const catalogListing = await onOneAgent([{ method: "GET", path: "/v1/commands", body: large }, {}]);
    expect(catalogListing.answers).toEqual([
      [200, "close"],
      [200, "keep-alive"],
    ]);
  });

  it("cuts the connection when a client sends on and on after an early answer", async () => {
    const socket = net.connect(server?.port ?? 0, "127.0.0.1");
    const limit = 10 * (MAX_BODY_BYTES + DRAIN_BYTES);
    socket.write(
      `POST /v1/other HTTP/1.1\r\nHost: 127.0.0.1:${String(server?.port)}\r\n` +
        `Content-Length: ${String(limit)}\r\n\r\n`,
    );
    let answer = "";
    socket.on("data", (data: Buffer) => (answer += data.toString("utf8")));
    const chunk = Buffer.alloc(1024 * 1024, 0x20);
    const sent = await new Promise<number>((resolve) => {
      let total = 0;
      socket.on("error", () => undefined);
      socket.on("close", () => {
        resolve(total);
      });
      const send = (): void => {
        while (!socket.destroyed && total < limit) {
          total += chunk.length;
          if (!socket.write(chunk)) {
            socket.once("drain", send);
            return;
          }
        }
        socket.end();
      };
      send();
    });
    expect(sent).toBeLessThan(limit);
    // As for 413: the early answer says close, and the server still drains DRAIN_BYTES before it cuts.
    expect(sent).toBeGreaterThan(MAX_BODY_BYTES + DRAIN_BYTES);
    expect(answer).toMatch(/^HTTP\/1\.1 401 [^]*\r\nconnection: close\r\n/i);
  });
});

describe("commands", () => {
  beforeEach(async () => {
    await start();
  });

  it("lists the catalog with what is implemented", async () => {
    const reply = await request({ method: "GET", path: "/v1/commands" });
    expect(reply.status).toBe(200);
    const { commands } = reply.body as { commands: { name: string; implemented: boolean }[] };
    expect(commands.map((c) => [c.name, c.implemented])).toEqual(
      catalog.commands.map((c) => [c.name, c.name !== "test.later"]),
    );
    expect(commands[0]).toMatchObject(catalog.commands[0] ?? {});
  });

  it("passes its access to core, which records the element of an API call (SR-117)", async () => {
    const spy = vi.spyOn(runtime, "invoke");
    onTestFinished(() => {
      spy.mockRestore();
    });
    await request({ body: "{}" });
    expect(spy.mock.calls.at(-1)?.[2]).toMatchObject({ access: "api" });
  });

  it("runs a command with the body as input and answers with its output as JSON", async () => {
    const reply = await request({ body: JSON.stringify({ a: [1, "ü"] }) });
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(reply.body).toEqual({ input: { a: [1, "ü"] } });
  });

  it("[SR-061/AK4] answers with one line per item when Accept names application/x-ndjson (#319)", async () => {
    const reply = await request({
      path: "/v1/commands/test.rows",
      headers: { accept: "application/x-ndjson" },
    });
    expect([reply.status, reply.headers["content-type"], reply.headers["cache-control"]]).toEqual([
      200,
      "application/x-ndjson; charset=utf-8",
      "no-store",
    ]);
    expect(reply.body).toBe('{"mark":2,"a":1}\n{"mark":2,"a":"Größe"}\n');
    // Among other types, and with any weight above 0; none for no items.
    for (const accept of [
      "application/json;q=0.5, application/x-ndjson;q=0.9",
      "*/*, APPLICATION/X-NDJSON; q=1",
    ]) {
      const lines = await request({ path: "/v1/commands/test.rows", headers: { accept } });
      expect([accept, lines.status, lines.body]).toEqual([accept, 200, reply.body]);
    }
    const none = await request({
      path: "/v1/commands/test.rows",
      headers: { accept: "application/x-ndjson" },
      body: '{"rows":[]}',
    });
    expect([none.status, none.headers["content-type"], none.body]).toEqual([
      200,
      "application/x-ndjson; charset=utf-8",
      "",
    ]);
  });

  it("answers as before unless Accept names application/x-ndjson with a weight above 0 (#319)", async () => {
    for (const accept of ["", "text/plain", "application/x-ndjson;q=0", "application/x-ndjson;q=0.000"]) {
      const json = await request({ path: "/v1/commands/test.rows", headers: { accept } });
      expect([accept, json.status, json.headers["content-type"], json.body]).toEqual([
        accept,
        200,
        "application/json; charset=utf-8",
        { mark: 2, other: "x", rows: [{ a: 1 }, { a: "Größe" }] },
      ]);
    }
    // Errors stay the JSON error object.
    const failed = await request({
      path: "/v1/commands/test.rows",
      headers: { accept: "application/x-ndjson" },
      body: '{"fail":true}',
    });
    expect([failed.status, failed.headers["content-type"], failed.body]).toEqual([
      400,
      "application/json; charset=utf-8",
      { code: "input.invalid", message: "No rows" },
    ]);
  });

  it("answers JSON for a command without JSON Lines when JSON is acceptable too, else 406 (#319)", async () => {
    for (const accept of [
      "application/x-ndjson, application/json",
      "application/x-ndjson, */*;q=0.1",
      "application/x-ndjson, application/*",
    ]) {
      const json = await request({ headers: { accept }, body: "{}" });
      expect([accept, json.status, json.body]).toEqual([accept, 200, { input: {} }]);
    }
    for (const accept of [
      "application/x-ndjson",
      "application/x-ndjson, application/json;q=0, */*",
      "application/x-ndjson, */*;q=0",
    ]) {
      const refused = await request({ headers: { accept }, body: "{}" });
      expect([accept, refused.status, refused.body]).toEqual([
        accept,
        406,
        {
          code: "input.invalid",
          message: "test.echo answers only with application/json, not with application/x-ndjson",
        },
      ]);
    }
    // An unknown command is left to core, as without Accept.
    const unknown = await request({
      path: "/v1/commands/test.none",
      headers: { accept: "application/x-ndjson" },
    });
    expect([unknown.status, unknown.body]).toMatchObject([400, { message: "Unknown command: test.none" }]);
  });

  it("takes an empty body (also with a byte order mark) as {}", async () => {
    expect((await request()).body).toEqual({ input: {} });
    expect((await request({ body: "\uFEFF  \n" })).body).toEqual({ input: {} });
    expect((await request({ body: '\uFEFF{"x":1}' })).body).toEqual({ input: { x: 1 } });
  });

  it("refuses a body that is not JSON or is too large", async () => {
    const bad = await request({ body: "{" });
    expect([bad.status, bad.body]).toEqual([
      400,
      { code: "input.invalid", message: "The request body is not valid JSON" },
    ]);
    // Just over the limit: the server reads it to the end and answers 413.
    const large = await request({ body: Buffer.alloc(MAX_BODY_BYTES + 1, 0x20) });
    expect([large.status, large.headers.connection, large.body]).toEqual([
      413,
      "close",
      { code: "input.invalid", message: `The request body is larger than ${String(MAX_BODY_BYTES)} bytes` },
    ]);
  });

  it("closes the connection after a 413, so that a keep-alive client sends on a new one", async () => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    const sockets = new Set<unknown>();
    const send = (body: Buffer): Promise<number | undefined> =>
      new Promise((resolve, reject) => {
        const req = http.request({
          agent,
          host: "127.0.0.1",
          port: server?.port,
          method: "POST",
          path: "/v1/commands/test.echo",
          headers: { authorization: `Bearer ${token}` },
        });
        req.on("socket", (socket) => sockets.add(socket));
        req.on("response", (res) => {
          res.resume();
          res.on("end", () => {
            resolve(res.statusCode);
          });
        });
        req.on("error", reject);
        req.end(body);
      });
    try {
      expect(await send(Buffer.alloc(MAX_BODY_BYTES + 1, 0x20))).toBe(413);
      expect(await send(Buffer.from("{}"))).toBe(200);
      expect(sockets.size).toBe(2);
    } finally {
      agent.destroy();
    }
  });

  it("answers 413 as soon as a body passes the limit, before the client has sent it all", async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0x20);
    const reply = await new Promise<{
      status: number | undefined;
      connection: string | undefined;
      sent: number;
    }>((resolve) => {
      const req = http.request({
        host: "127.0.0.1",
        port: server?.port,
        method: "POST",
        path: "/v1/commands/test.echo",
        headers: { authorization: `Bearer ${token}` },
      });
      let sent = 0;
      let answered = false;
      req.on("response", (res) => {
        answered = true;
        resolve({ status: res.statusCode, connection: res.headers.connection, sent });
        res.resume();
        req.destroy();
      });
      req.on("error", () => undefined);
      // Stops at the answer; ends after three times the limit if none comes.
      const send = (): void => {
        while (!answered && sent < 3 * MAX_BODY_BYTES) {
          sent += chunk.length;
          if (!req.write(chunk)) {
            req.once("drain", send);
            return;
          }
        }
        req.end();
      };
      send();
    });
    expect([reply.status, reply.connection]).toEqual([413, "close"]);
    expect(reply.sent).toBeLessThan(3 * MAX_BODY_BYTES);
    // The server keeps serving.
    expect((await request()).status).toBe(200);
  });

  it("cuts the connection when a client sends on and on after the 413", async () => {
    const socket = net.connect(server?.port ?? 0, "127.0.0.1");
    const limit = 10 * (MAX_BODY_BYTES + DRAIN_BYTES);
    socket.write(
      `POST /v1/commands/test.echo HTTP/1.1\r\nHost: 127.0.0.1:${String(server?.port)}\r\n` +
        `Authorization: Bearer ${token}\r\nContent-Length: ${String(limit)}\r\n\r\n`,
    );
    let answer = "";
    socket.on("data", (data: Buffer) => (answer += data.toString("utf8")));
    const chunk = Buffer.alloc(1024 * 1024, 0x20);
    const sent = await new Promise<number>((resolve) => {
      let total = 0;
      socket.on("error", () => undefined);
      socket.on("close", () => {
        resolve(total);
      });
      const send = (): void => {
        while (!socket.destroyed && total < limit) {
          total += chunk.length;
          if (!socket.write(chunk)) {
            socket.once("drain", send);
            return;
          }
        }
        socket.end();
      };
      send();
    });
    expect(sent).toBeLessThan(limit);
    // The 413 says that the connection closes, and still the server drains DRAIN_BYTES before it cuts.
    expect(sent).toBeGreaterThan(MAX_BODY_BYTES + DRAIN_BYTES);
    expect(answer).toMatch(/^HTTP\/1\.1 413 [^]*\r\nconnection: close\r\n/i);
  });

  it("maps every error class to its HTTP status, with the error object as body", async () => {
    const codes = {
      "input.invalid": "input",
      "element.not-found": "not-found",
      "file.changed-on-disk": "conflict",
      "git.unavailable": "unavailable",
      "command.not-implemented": "not-implemented",
      internal: "internal",
    } as const;
    for (const [code, errorClass] of Object.entries(codes)) {
      const reply = await request({ path: "/v1/commands/test.fail", body: JSON.stringify({ code }) });
      expect([reply.status, reply.body]).toEqual([
        HTTP_STATUS_BY_CLASS[errorClass],
        { code, message: `Failed with ${code}` },
      ]);
    }
  });

  it("reports core's errors unchanged: unknown, not implemented, invalid input, internal", async () => {
    const unknown = await request({ path: "/v1/commands/test.nope" });
    expect([unknown.status, unknown.body]).toEqual([
      400,
      { code: "input.invalid", message: "Unknown command: test.nope", details: { command: "test.nope" } },
    ]);
    const later = await request({ path: "/v1/commands/test.later" });
    expect([later.status, later.body]).toEqual([
      501,
      {
        code: "command.not-implemented",
        message: "Command test.later is not implemented yet",
        details: { command: "test.later" },
      },
    ]);
    const invalid = await request({ path: "/v1/commands/test.fail", body: "{}" });
    expect(invalid).toMatchObject({ status: 400, body: { code: "input.invalid" } });
    const crash = await request({ path: "/v1/commands/test.crash" });
    expect([crash.status, crash.body]).toEqual([
      500,
      { code: "internal", message: "Internal error in test.crash", details: { command: "test.crash" } },
    ]);
  });

  it("sends null for no output and internal for an output that is not JSON", async () => {
    expect((await request({ path: "/v1/commands/test.nothing" })).body).toBeNull();
    const circular = await request({ path: "/v1/commands/test.circular" });
    expect([circular.status, circular.body]).toEqual([
      500,
      { code: "internal", message: "Internal error in the local API" },
    ]);
  });

  it("aborts the command when the client goes away", async () => {
    const reason = new Promise((resolve) => {
      aborted = resolve;
    });
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const req = http.request({
      host: "127.0.0.1",
      port: server?.port,
      method: "POST",
      path: "/v1/commands/test.wait",
      headers: { authorization: `Bearer ${token}` },
    });
    req.on("error", () => undefined);
    req.end();
    await running;
    req.destroy();
    await expect(reason).resolves.toBeDefined();
    // The server keeps serving.
    expect((await request()).status).toBe(200);
  });

  it("aborts running commands and closes connections when it closes", async () => {
    const reason = new Promise((resolve) => {
      aborted = resolve;
    });
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const reply = request({ path: "/v1/commands/test.wait" }).catch((error: unknown) => error);
    await running;
    await server?.close();
    server = undefined;
    await expect(reason).resolves.toBeDefined();
    await expect(reply).resolves.toBeInstanceOf(Error);
  });

  it("survives a client that breaks off while sending the body", async () => {
    const socket = net.connect(server?.port ?? 0, "127.0.0.1");
    socket.write(
      `POST /v1/commands/test.echo HTTP/1.1\r\nHost: 127.0.0.1:${String(server?.port)}\r\n` +
        `Authorization: Bearer ${token}\r\nContent-Length: 100\r\n\r\n{"a":`,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    socket.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await request()).status).toBe(200);
  });
});

describe("a runtime that fails outside of a CommandError", () => {
  it("answers internal without the error text", async () => {
    const broken: CommandRuntime = { ...runtime, invoke: () => Promise.reject(new Error("/secret/path")) };
    await start(0, broken);
    const reply = await request();
    expect([reply.status, reply.body]).toEqual([
      500,
      { code: "internal", message: "Internal error in the local API" },
    ]);
  });
});

describe("large answers are streamed (#277)", () => {
  /** The raw answer: status, headers, text, and whether the connection broke before the end. */
  const raw = (body = "{}", path = "/v1/commands/test.large") =>
    new Promise<{
      status: number | undefined;
      headers: http.IncomingHttpHeaders;
      text: string;
      broken: boolean;
    }>((resolve) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: server?.port,
          method: "POST",
          path,
          headers: { authorization: `Bearer ${token}` },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          const done = (broken: boolean) => (): void => {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              text: Buffer.concat(chunks).toString("utf8"),
              broken,
            });
          };
          res.on("end", done(false));
          res.on("error", done(true));
        },
      );
      req.end(body);
    });

  it("streams an answer larger than one chunk with chunked encoding, byte for byte the compact JSON", async () => {
    await start();
    const reply = await raw();
    expect(reply.status).toBe(200);
    expect(reply.headers["transfer-encoding"]).toBe("chunked");
    expect(reply.headers["content-length"]).toBeUndefined();
    expect(reply.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(reply.broken).toBe(false);
    expect(reply.text).toBe(`${JSON.stringify(largeOutput(3))}\n`);
  });

  it("sends a small answer with the same headers and bytes as before", async () => {
    await start();
    const reply = await raw('{"a":"ä"}', "/v1/commands/test.echo");
    expect(reply.headers["transfer-encoding"]).toBe("chunked");
    expect(reply.headers["content-length"]).toBeUndefined();
    expect(reply.text).toBe('{"input":{"a":"ä"}}\n');
  });

  it("cuts the connection when serialising fails after the headers were sent", async () => {
    await start();
    const reply = await raw("{}", "/v1/commands/test.lateFail");
    expect(reply.status).toBe(200);
    expect(reply.broken).toBe(true);
    expect((await request()).status).toBe(200);
  });

  it("waits for the client to read, and stops and finishes writing when it goes away", async () => {
    await start();
    const write = vi.spyOn(http.ServerResponse.prototype, "write");
    const gone = new Promise<void>((resolve) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: server?.port,
          method: "POST",
          path: "/v1/commands/test.large",
          headers: { authorization: `Bearer ${token}` },
        },
        (res) => {
          // Reads one piece, then stops reading (back-pressure) and goes away.
          res.once("data", () => {
            res.pause();
            setTimeout(() => {
              req.destroy();
              resolve();
            }, 100);
          });
        },
      );
      req.end('{"megabytes":40}');
    });
    await gone;
    await new Promise((resolve) => setTimeout(resolve, 200));
    // The answer stopped and its writing finished (review S1): no more writes, and no drain wait
    // left on the response, whatever the socket buffers took before the client went away.
    const writes = write.mock.calls.length;
    const response = write.mock.contexts.at(-1) as http.ServerResponse;
    expect(writes).toBeGreaterThan(0);
    expect(response.destroyed).toBe(true);
    expect(response.listenerCount("drain")).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(write.mock.calls.length).toBe(writes);
    write.mockRestore();
    expect((await request()).status).toBe(200);
  });
});
