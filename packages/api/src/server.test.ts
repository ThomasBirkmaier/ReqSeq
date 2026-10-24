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
  loadContracts,
} from "@logreq/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAIN_BYTES, HTTP_STATUS_BY_CLASS, MAX_BODY_BYTES } from "./handler.js";
import type { ApiServer } from "./server.js";
import { LOOPBACK_HOSTS, PORT_ATTEMPTS, listenOnAll, startApiServer, urlOf } from "./server.js";

/** A handler for servers of listenOnAll that no test sends a request to. */
const unused = (): void => undefined;

// Test-only catalog: echo, every error class, a crash, a command that waits for its signal, odd outputs.
const entry = (name: string, input: Record<string, unknown> = {}) => ({
  name,
  summary: `Test command ${name}.`,
  effect: "read",
  stage: 1,
  implements: ["SR-080"],
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
  ],
};

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
            body: text === "" ? "" : JSON.parse(text),
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

  it("refuses to start while api.json names a running process, and replaces the file of a stopped one", async () => {
    const file = path.join(dir, "api.json");
    await fs.writeFile(file, JSON.stringify({ pid: process.pid }));
    await expect(
      startApiServer({ workspace: new Workspace(dir), runtime, cacheFolder: dir }),
    ).rejects.toMatchObject({
      code: "input.invalid",
      message: expect.stringContaining(`runs already (process ${String(process.pid)})`) as unknown,
      details: { pid: process.pid },
    });
    // Not a process (any more), or not an endpoint at all: the file is replaced.
    for (const text of [
      JSON.stringify({ pid: 2147483646 }),
      JSON.stringify({ pid: 0 }),
      JSON.stringify({ pid: 1.5 }),
      JSON.stringify({ pid: "1" }),
      "null",
      "1",
      "{",
    ]) {
      await fs.writeFile(file, text);
      const api = await start();
      await api.close();
      server = undefined;
    }
  });

  it("counts a process of another user as running", async () => {
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    });
    await fs.writeFile(path.join(dir, "api.json"), JSON.stringify({ pid: 1 }));
    await expect(
      startApiServer({ workspace: new Workspace(dir), runtime, cacheFolder: dir }),
    ).rejects.toMatchObject({ details: { pid: 1 } });
  });

  it("stops listening when api.json cannot be written", async () => {
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

  it("runs a command with the body as input and answers with its output as JSON", async () => {
    const reply = await request({ body: JSON.stringify({ a: [1, "ü"] }) });
    expect(reply.status).toBe(200);
    expect(reply.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(reply.body).toEqual({ input: { a: [1, "ü"] } });
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
    expect(large.status).toBe(413);
  });

  it("answers 413 as soon as a body passes the limit, before the client has sent it all", async () => {
    const chunk = Buffer.alloc(1024 * 1024, 0x20);
    const reply = await new Promise<{ status: number | undefined; sent: number }>((resolve) => {
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
        resolve({ status: res.statusCode, sent });
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
    expect(reply.status).toBe(413);
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
    socket.on("data", () => undefined);
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
  });

  it("maps every error class to its HTTP status, with the error object as body", async () => {
    const codes = {
      "input.invalid": "input",
      "element.not-found": "not-found",
      "file.changed-on-disk": "conflict",
      "git.unavailable": "unavailable",
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
    expect(later.body).toMatchObject({ message: "Command test.later is not implemented yet" });
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
