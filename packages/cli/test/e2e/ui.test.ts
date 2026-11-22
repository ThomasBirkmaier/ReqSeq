// End-to-end tests of `reqseq ui` (SR-247, ADR-0020): the built binary as a real process that serves the built
// pages of the web UI (packages/web/dist, `pnpm build`) on a fixture workspace, asked with raw HTTP requests,
// which can send any Host, Origin or token a browser would refuse to forge. On Linux CI inside `unshare -rn`, as
// servers.test.ts. Run after `pnpm build` with `pnpm test:e2e`.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { LineTransport } from "@reqseq/mcp";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterEach, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { externalAddresses, probe } from "../support/probe.js";
import { bin, blockNetwork, requireBuiltCli } from "../support/reqseq.js";

const ELEMENT = "e8df96ea-a168-4d90-8d65-6328cee88fb3";

const children: ChildProcessWithoutNullStreams[] = [];
const fixtures: FixtureWorkspace[] = [];

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null) {
      child.kill();
      await exited(child);
    }
  }
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

const exited = (child: ChildProcessWithoutNullStreams): Promise<number | null> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode);
      return;
    }
    child.once("exit", (code) => {
      resolve(code);
    });
  });

const workspace = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
  fixtures.push(ws);
  return ws;
};

/** A folder outside every workspace, removed after the test. */
const emptyFolder = async (): Promise<string> => {
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-ui-e2e-")));
  onTestFinished(() => fs.rm(folder, { recursive: true, force: true, maxRetries: 3 }));
  return folder;
};

interface Started {
  readonly child: ChildProcessWithoutNullStreams;
  /** Standard output and error so far. */
  readonly out: () => string;
  readonly err: () => string;
}

interface Running extends Started {
  readonly url: string;
  readonly base: string;
  readonly port: number;
  readonly token: string;
}

/**
 * `reqseq ui <args>` in `cwd`, with home and OS cache folder in `home` (default: a new one) and the network
 * block. `env` is added to the environment (`PATH` for the opener).
 */
const spawnUi = async (
  args: readonly string[],
  cwd: string,
  options: { readonly home?: string; readonly env?: Readonly<Record<string, string>> } = {},
): Promise<Started> => {
  const home = options.home ?? (await emptyFolder());
  const child = spawn(process.execPath, ["--import", blockNetwork, bin, "ui", ...args], {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      DISPLAY: "",
      WAYLAND_DISPLAY: "",
      HOME: home,
      USERPROFILE: home,
      XDG_CACHE_HOME: home,
      LOCALAPPDATA: home,
      ...options.env,
    },
  });
  children.push(child);
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString("utf8")));
  return { child, out: () => out, err: () => err };
};

/** The address line `reqseq ui` prints first; rejects when the process ends before. */
const ADDRESS = /^ReqSeq UI on (http:\/\/127\.0\.0\.1:(\d+)\/#token=([\w-]+))$/m;

const running = async (started: Started): Promise<Running> => {
  const match = await new Promise<RegExpExecArray>((resolve, reject) => {
    const check = (): void => {
      const found = ADDRESS.exec(started.out());
      if (found !== null && started.out().includes("Stop with Ctrl-C.\n")) {
        resolve(found);
      }
    };
    started.child.stdout.on("data", check);
    started.child.once("exit", () => {
      reject(new Error(`reqseq ui ended early: ${started.out()} ${started.err()}`));
    });
    check();
  });
  const [, url = "", port = "", token = ""] = match;
  return { ...started, url, port: Number(port), token, base: `http://127.0.0.1:${port}` };
};

const ui = async (
  args: readonly string[],
  cwd: string,
  options?: Parameters<typeof spawnUi>[2],
): Promise<Running> => running(await spawnUi(args, cwd, options));

interface Reply {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly text: string;
}

/** One request with exactly these headers (Host defaults to the server's own), on a fresh connection. */
const request = (
  server: Running,
  method: string,
  target: string,
  headers: Readonly<Record<string, string>> = {},
  body?: string,
): Promise<Reply> =>
  new Promise((resolve, reject) => {
    const sent = http.request(
      {
        host: "127.0.0.1",
        port: server.port,
        method,
        path: target,
        agent: false,
        headers: { host: `127.0.0.1:${String(server.port)}`, ...headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    sent.on("error", reject);
    sent.end(body);
  });

/** The headers of a request of the page: the token, and the generation of the open workspace. */
const auth = (server: Running, generation = 1): Record<string, string> => ({
  authorization: `Bearer ${server.token}`,
  "x-reqseq-workspace": String(generation),
  "content-type": "application/json",
});

const command = async (
  server: Running,
  name: string,
  input: unknown = {},
  headers: Readonly<Record<string, string>> = auth(server),
): Promise<{ readonly status: number; readonly body: unknown }> => {
  const reply = await request(server, "POST", `/api/${name}`, headers, JSON.stringify(input));
  return { status: reply.status, body: JSON.parse(reply.text) as unknown };
};

/** Whether a TCP connection to `port` on 127.0.0.1 is accepted. */
const answers = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });

/** Whether this machine has the IPv6 loopback address: a server can listen on it. */
const hasIpv6Loopback = (): Promise<boolean> =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.listen(0, "::1", () => {
      server.close(() => {
        resolve(true);
      });
    });
  });

/** The status of a GET of `url`, with the Host the URL names. */
const statusAt = (url: string): Promise<number | undefined> =>
  new Promise((resolve, reject) => {
    http
      .get(url, { agent: false }, (response) => {
        response.resume();
        resolve(response.statusCode);
      })
      .on("error", reject);
  });

/** A TCP port that was free a moment ago. */
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => {
        resolve(port);
      });
    });
  });

/** Opens the folder `path` in the running UI (`POST /ui/workspace`). */
const openFolder = (
  server: Running,
  folder: string,
  headers: Readonly<Record<string, string>> = auth(server),
): Promise<Reply> => request(server, "POST", "/ui/workspace", headers, JSON.stringify({ path: folder }));

/** The folder of the workspace the UI has open (`workspace.status`). */
const openRoot = async (server: Running): Promise<string | undefined> => {
  const { body } = await command(server, "workspace.status");
  return (body as { repositories?: { absolutePath: string }[] }).repositories?.[0]?.absolutePath;
};

/** `workspace.recent` as the UI asks it: the roots of the list, the last opened first. */
const recentRoots = async (server: Running, generation = 1): Promise<string[]> => {
  const { body } = await command(server, "workspace.recent", {}, auth(server, generation));
  return (body as { workspaces: { root: string }[] }).workspaces.map((entry) => entry.root);
};

describe("reqseq ui: start (SR-247)", () => {
  it("[SR-247/AK-d8zr] serves the workspace found or named on loopback, prints the address with the token and passes it to the opener, or says it could not", async () => {
    const ws = await workspace();
    const elsewhere = await emptyFolder();
    const tokens: string[] = [];
    // Found from a folder inside the workspace, and named with --workspace from elsewhere.
    for (const [args, cwd] of [
      [["--no-open"], ws.path("requirements")],
      [["--no-open", "--workspace", ws.root], elsewhere],
    ] as const) {
      const server = await ui(args, cwd);
      expect(server.url).toBe(`${server.base}/#token=${server.token}`);
      expect(server.token.length).toBeGreaterThanOrEqual(32);
      const status = await command(server, "workspace.status");
      expect([status.status, status.body]).toMatchObject([200, { name: "Weather station" }]);
      // Only loopback addresses: ::1 where the machine has it, never another one (AK4 checks other machines).
      // ::1 where the machine has it, asked there directly.
      if (await hasIpv6Loopback()) {
        expect(await statusAt(`http://[::1]:${String(server.port)}/`)).toBe(200);
      }
      tokens.push(server.token);
      expect(server.err()).toBe("");
      server.child.kill();
      await exited(server.child);
    }
    // The token is new on every start (AK6).
    expect(new Set(tokens).size).toBe(2);
    // Without --no-open the address goes to the system's opener, which cannot start here (no program on PATH):
    // the server keeps running and says so.
    const noOpener = await emptyFolder();
    const unopened = await ui([], ws.root, { env: { PATH: noOpener, Path: noOpener } });
    await expect.poll(() => unopened.err(), { timeout: 10_000 }).toContain("No browser was opened");
    expect((await command(unopened, "workspace.status")).status).toBe(200);
    // Windows' opener is rundll32.exe, which a test cannot stand in for; the platform's program is a unit test.
    if (process.platform !== "win32") {
      const opener = await emptyFolder();
      const record = path.join(opener, "opened.txt");
      for (const name of ["xdg-open", "open"]) {
        await fs.writeFile(path.join(opener, name), `#!/bin/sh\nprintf '%s' "$1" > '${record}'\n`, {
          mode: 0o755,
        });
      }
      const opened = await ui([], ws.root, {
        env: { PATH: `${opener}${path.delimiter}${String(process.env["PATH"])}` },
      });
      await expect
        .poll(() => fs.readFile(record, "utf8").catch(() => ""), { timeout: 10_000 })
        .toBe(opened.url);
      expect(opened.err()).toBe("");
      // With --no-open nothing is started.
      await fs.rm(record);
      const quiet = await ui(["--no-open"], ws.root, {
        env: { PATH: `${opener}${path.delimiter}${String(process.env["PATH"])}` },
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      await expect(fs.stat(record)).rejects.toMatchObject({ code: "ENOENT" });
      expect((await command(quiet, "workspace.status")).status).toBe(200);
    }
  }, 60_000);

  it("[SR-247/AK-qc3t] starts without a workspace where none is found, and not at all for a missing or unreadable one", async () => {
    const outside = await emptyFolder();
    const server = await ui(["--no-open"], outside);
    expect((await request(server, "GET", "/")).status).toBe(200);
    expect((await command(server, "workspace.recent", {}, auth(server, 0))).status).toBe(200);
    const status = await command(server, "workspace.status", {}, auth(server, 0));
    expect([status.status, status.body]).toMatchObject([404, { code: "workspace.not-found" }]);
    const broken = await emptyFolder();
    await fs.writeFile(path.join(broken, "reqseq-workspace.yaml"), "reqseq-workspace: [unclosed\n");
    const noFile = await emptyFolder();
    for (const [args, cwd] of [
      [["--no-open", "--workspace", path.join(outside, "gone")], outside],
      [["--no-open", "--workspace", noFile], outside],
      [["--no-open", "--workspace", broken], outside],
      // Found by the command line, as for every command, but unreadable.
      [["--no-open"], broken],
    ] as const) {
      const started = await spawnUi(args, cwd);
      const code = await exited(started.child);
      expect([args, cwd, code]).toEqual([args, cwd, 2]);
      expect(started.out()).toBe("");
      expect(started.err()).toMatch(/^error (workspace\.not-found|file\.faulty)/m);
    }
  }, 60_000);

  it("[SR-247/AK-wgjz] takes a free port, or the port --port names, and does not start on a busy or invalid one", async () => {
    const ws = await workspace();
    const free = await ui(["--no-open"], ws.root);
    expect(free.port).toBeGreaterThan(0);
    const wanted = await freePort();
    const named = await ui(["--no-open", "--port", String(wanted)], ws.root);
    expect(named.port).toBe(wanted);
    const home = await emptyFolder();
    for (const port of [String(wanted), "0", "0x50", "70000", "-1", "http"]) {
      const started = await spawnUi(["--no-open", "--port", port], ws.root, { home });
      expect([port, await exited(started.child)]).toEqual([port, 2]);
      expect(started.out()).toBe("");
      expect(started.err()).toMatch(port === String(wanted) ? /in use|busy|EADDRINUSE/i : /port/i);
    }
    // A start that failed marked nothing as opened.
    const recent = await spawnUi(["--no-open"], await emptyFolder(), { home });
    const listed = await running(recent);
    expect(await recentRoots(listed, 0)).toEqual([]);
  }, 60_000);
});

describe("reqseq ui: who reaches it (SR-247)", () => {
  // As for `serve api` (servers.test.ts): CI provides an external address and requires it (#1363).
  const external = externalAddresses();
  const required = process.env["REQSEQ_E2E_EXTERNAL_ADDRESS"] === "required";

  it.skipIf(external.length === 0 && !required)(
    "[SR-247/AK-f28m] cannot be reached on the addresses that other machines use",
    async () => {
      expect(external, "an address other than loopback (REQSEQ_E2E_EXTERNAL_ADDRESS)").not.toEqual([]);
      const server = await ui(["--no-open"], (await workspace()).root);
      const [loopback, ...results] = await probe(server.port, ["127.0.0.1", ...external]);
      expect(loopback).toBe("connected");
      expect(results).toHaveLength(external.length);
      for (const [index, result] of results.entries()) {
        expect([external[index], result]).not.toEqual([external[index], "connected"]);
      }
      // No option of the command names another address.
      const started = await spawnUi(["--no-open", "--host", "0.0.0.0"], (await workspace()).root);
      expect(await exited(started.child)).toBe(2);
      expect(started.out()).toBe("");
    },
  );

  it("[SR-247/AK-hs88] refuses a request whose Host is not loopback or localhost with its port, a page too, and runs nothing", async () => {
    const ws = await workspace();
    const other = await workspace();
    const server = await ui(["--no-open"], ws.root);
    const port = String(server.port);
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`]) {
      expect([host, (await request(server, "GET", "/", { host })).status]).toEqual([host, 200]);
    }
    for (const host of [
      `evil.example:${port}`,
      `evil.example`,
      `127.0.0.1:${String(server.port + 1)}`,
      `192.168.1.10:${port}`,
    ]) {
      expect([host, (await request(server, "GET", "/", { host })).status]).toEqual([host, 403]);
      expect([host, (await openFolder(server, other.root, { ...auth(server), host })).status]).toEqual([
        host,
        403,
      ]);
    }
    // Nothing ran: the workspace is still the first one, so its generation is still valid.
    expect(await openRoot(server)).toBe(ws.root);
  });

  it("[SR-247/AK-dk5t] runs nothing without the token in a header, a cookie does not count, and serves page files without it", async () => {
    const ws = await workspace();
    const other = await workspace();
    const server = await ui(["--no-open"], ws.root);
    expect((await request(server, "GET", "/")).status).toBe(200);
    expect((await request(server, "HEAD", "/index.html")).status).toBe(200);
    const page = (await request(server, "GET", "/")).text;
    expect(page).not.toContain("Weather station");
    expect(page).not.toContain(ELEMENT);
    const without = { "x-reqseq-workspace": "1", "content-type": "application/json" };
    for (const headers of [
      without,
      { ...without, authorization: "Bearer wrong" },
      { ...without, cookie: `token=${server.token}; reqseq-token=${server.token}` },
      { ...without, authorization: server.token },
    ]) {
      expect((await command(server, "workspace.status", {}, headers)).status).toBe(401);
      expect((await openFolder(server, other.root, headers)).status).toBe(401);
      expect((await request(server, "GET", "/api/events", headers)).status).toBe(401);
      // A page file is fetched with GET or HEAD only.
      expect((await request(server, "POST", "/index.html", headers)).status).toBe(401);
    }
    expect(await openRoot(server)).toBe(ws.root);
  });

  it("[SR-247/AK-hnqy] refuses a request whose Origin is not http:// with the Host of the request, and runs nothing", async () => {
    const ws = await workspace();
    const other = await workspace();
    const server = await ui(["--no-open"], ws.root);
    const port = String(server.port);
    for (const origin of [
      `http://evil.example`,
      `https://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      "null",
    ]) {
      const headers = { ...auth(server), origin };
      expect([origin, (await command(server, "workspace.status", {}, headers)).status]).toEqual([
        origin,
        403,
      ]);
      expect([origin, (await openFolder(server, other.root, headers)).status]).toEqual([origin, 403]);
      expect([origin, (await request(server, "GET", "/", { origin })).status]).toEqual([origin, 403]);
    }
    const own = { ...auth(server), origin: `http://127.0.0.1:${port}` };
    expect((await command(server, "workspace.status", {}, own)).status).toBe(200);
  });

  it("[SR-247/AK-zp1s] serves no page file that holds the token", async () => {
    const server = await ui(["--no-open"], (await workspace()).root);
    const index = await request(server, "GET", `/?token=${server.token}`);
    expect(index.status).toBe(200);
    const files = [...index.text.matchAll(/(?:src|href)="\.?\/?([^"#?]+)"/g)].map((m) => `/${m[1] ?? ""}`);
    expect(files.length).toBeGreaterThan(0);
    for (const file of ["/", "/index.html", ...files]) {
      const reply = await request(server, "GET", file);
      expect([file, reply.status]).toEqual([file, 200]);
      expect([file, reply.text.includes(server.token)]).toEqual([file, false]);
    }
  });

  it("[SR-247/AK-rq0f] grants no other origin access, forbids framing, and allows only its own sources and blob images", async () => {
    const server = await ui(["--no-open"], (await workspace()).root);
    const origin = { origin: "http://evil.example" };
    const replies = [
      await request(server, "GET", "/"),
      await request(server, "OPTIONS", "/api/workspace.status", {
        ...origin,
        "access-control-request-method": "POST",
      }),
      await request(server, "POST", "/api/workspace.status", auth(server), "{}"),
      await request(server, "POST", "/api/workspace.status", { "x-reqseq-workspace": "1" }, "{}"),
      await request(server, "GET", "/missing.js"),
    ];
    for (const reply of replies) {
      expect(Object.keys(reply.headers).filter((name) => name.startsWith("access-control-"))).toEqual([]);
      expect(reply.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    }
    const page = replies[0];
    expect(page?.headers["x-frame-options"]).toBe("DENY");
    const csp = new Map(
      String(page?.headers["content-security-policy"])
        .split(";")
        .map((part) => part.trim().split(/\s+/))
        .map(([name = "", ...values]) => [name, values]),
    );
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("img-src")).toEqual(["'self'", "blob:"]);
    for (const [name, values] of csp) {
      for (const value of values) {
        expect([name, value]).toSatisfy(
          ([, v]: string[]) =>
            ["'self'", "'none'", "'unsafe-inline'"].includes(v ?? "") ||
            (name === "img-src" && v === "blob:"),
        );
      }
    }
  });
});

describe("reqseq ui: stop and records (SR-247)", () => {
  it("[SR-247/AK-jv9g] answers no more after Ctrl-C, SIGTERM or the end of its terminal", async () => {
    const ws = await workspace();
    // On Windows kill() cannot send SIGINT or SIGHUP and ends the process at once (TerminateProcess), so there
    // only the end of the process is shown; the handlers of all three are unit tests (process.test.ts).
    const signals =
      process.platform === "win32" ? (["SIGTERM"] as const) : (["SIGINT", "SIGTERM", "SIGHUP"] as const);
    for (const signal of signals) {
      const server = await ui(["--no-open"], ws.root);
      expect(await answers(server.port)).toBe(true);
      server.child.kill(signal);
      const code = await exited(server.child);
      expect([signal, process.platform === "win32" ? 0 : code]).toEqual([signal, 0]);
      expect([signal, await answers(server.port)]).toEqual([signal, false]);
    }
  }, 60_000);

  it("ends when its standard input ends only under REQSEQ_UI_END_WITH_STDIN=1, as the desktop shell starts it", async () => {
    const ws = await workspace();
    const plain = await ui(["--no-open"], ws.root);
    plain.child.stdin.end();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(await answers(plain.port)).toBe(true);
    const shelled = await ui(["--no-open"], ws.root, { env: { REQSEQ_UI_END_WITH_STDIN: "1" } });
    expect(await answers(shelled.port)).toBe(true);
    shelled.child.stdin.end();
    expect(await exited(shelled.child)).toBe(0);
    expect(await answers(shelled.port)).toBe(false);
  }, 60_000);

  it("[SR-247/AK-c53z] leaves the last access of an agent as it was when the UI reads and changes an element", async () => {
    const ws = await workspace();
    const home = await emptyFolder();
    const activity = async (server: Running): Promise<unknown> =>
      ((await command(server, "workspace.activity")).body as { activity: unknown }).activity;
    const readAndChange = async (server: Running, title: string): Promise<void> => {
      const read = await command(server, "element.get", { ref: ELEMENT });
      expect(read.status).toBe(200);
      const { fileSha256 } = read.body as { fileSha256: string };
      const changed = await command(server, "element.update", {
        ref: ELEMENT,
        title,
        expectedFileSha256: fileSha256,
      });
      expect([changed.status, changed.body]).toMatchObject([200, {}]);
    };
    // Without an earlier access there is none afterwards.
    const first = await ui(["--no-open"], ws.root, { home });
    expect(await activity(first)).toBeNull();
    await readAndChange(first, "Show wind speed in the UI");
    expect(await activity(first)).toBeNull();
    first.child.kill();
    await exited(first.child);
    // An agent reads the element over MCP; the UI's reads and changes leave that access as the last one.
    const mcp = spawn(process.execPath, ["--import", blockNetwork, bin, "mcp"], {
      cwd: ws.root,
      stdio: "pipe",
      env: { ...process.env, HOME: home, USERPROFILE: home, XDG_CACHE_HOME: home, LOCALAPPDATA: home },
    });
    children.push(mcp);
    const client = new Client({ name: "e2e", version: "1" });
    await client.connect(new LineTransport(mcp.stdout, { write: (text) => mcp.stdin.write(text) }));
    await client.callTool({ name: "element_get", arguments: { ref: ELEMENT } });
    await client.close();
    mcp.stdin.end();
    await exited(mcp);
    const second = await ui(["--no-open"], ws.root, { home });
    const before = await activity(second);
    expect(before).toMatchObject({ access: "mcp", command: "element.get" });
    await readAndChange(second, "Show wind speed");
    expect(await activity(second)).toEqual(before);
  }, 60_000);

  it("[SR-247/AK-dfqv] puts the workspace it opens first in the recent workspaces, at start and after a switch", async () => {
    const ws = await workspace();
    const other = await workspace();
    const home = await emptyFolder();
    const atStart = await ui(["--no-open"], ws.root, { home });
    expect((await recentRoots(atStart))[0]).toBe(ws.root);
    expect((await openFolder(atStart, other.root)).status).toBe(200);
    expect(await recentRoots(atStart, 2)).toEqual([other.root, ws.root]);
    // Opened in a UI that started without one.
    const outside = await emptyFolder();
    const empty = await ui(["--no-open"], outside, { home });
    expect((await openFolder(empty, ws.root, auth(empty, 0))).status).toBe(200);
    expect(await recentRoots(empty)).toEqual([ws.root, other.root]);
  }, 60_000);
});
