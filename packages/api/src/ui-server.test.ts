// The UI server over real HTTP on loopback (ADR-0020), with a command runner that gives fixed outputs (the
// test seam) and a fake folder of page files. Not tagged with SR-247 or SR-248 AKs: their contract tests
// start `reqseq ui` (#2303, #2304).
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { InvokeContext } from "@reqseq/core";
import { CommandError, getCommandRuntime } from "@reqseq/core";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeEach, describe, expect, it, onTestFinished } from "vitest";
import type { UiServer, UiServerOptions } from "./ui-server.js";
import { PAGE_CSP, createUiServer } from "./ui-server.js";

interface Call {
  readonly name: string;
  readonly input: unknown;
  readonly root: string;
  readonly access: InvokeContext["access"];
  readonly signal: boolean;
}

/** What each command of the runner does; default: answers with its name. */
let behaviour: (name: string, input: unknown, ctx: InvokeContext) => Promise<unknown>;
const calls: Call[] = [];
/** The workspaces the server marked as opened (`workspace.markOpened`), apart from the other calls. */
const marked: { readonly root: string; readonly access: InvokeContext["access"] }[] = [];
/** What `workspace.markOpened` does; default: succeeds. */
let marking: () => Promise<unknown>;

const runner = {
  contracts: getCommandRuntime().contracts,
  invoke: (name: string, input: unknown, ctx: InvokeContext): Promise<unknown> => {
    if (name === "workspace.markOpened") {
      marked.push({ root: ctx.workspace.root, access: ctx.access });
      return marking();
    }
    calls.push({
      name,
      input,
      root: ctx.workspace.root,
      access: ctx.access,
      signal: ctx.signal !== undefined,
    });
    return behaviour(name, input, ctx);
  },
};

let pages: string;

beforeEach(async () => {
  calls.length = 0;
  marked.length = 0;
  behaviour = (name) => Promise.resolve({ ran: name });
  marking = () => Promise.resolve({ root: "marked" });
  pages = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-ui-pages-"));
  await fs.mkdir(path.join(pages, "assets"));
  await fs.writeFile(path.join(pages, "index.html"), "<!doctype html><title>ReqSeq</title>");
  await fs.writeFile(path.join(pages, "assets", "app.js"), "console.log(1);");
  await fs.writeFile(path.join(pages, "assets", "KaTeX Main.woff2"), "font");
  await fs.writeFile(path.join(pages, "notes.txt"), "not a page file");
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-ui-outside-"));
  onTestFinished(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, "secret.js"), "secret");
  await fs.symlink(path.join(outside, "secret.js"), path.join(pages, "assets", "link.js"), "file");
  await fs.symlink(outside, path.join(pages, "linked"), "junction");
});

afterEach(async () => {
  await fs.rm(pages, { recursive: true, force: true });
});

const start = async (options: Partial<UiServerOptions> = {}): Promise<UiServer> => {
  const server = await createUiServer({ pages, runner, ...options });
  onTestFinished(() => server.close());
  return server;
};

interface Reply {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly text: string;
  readonly json: () => unknown;
}

/** One request with exactly these headers (a fresh connection, no proxy). */
const request = (
  server: UiServer,
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
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            text,
            json: () => JSON.parse(text) as unknown,
          });
        });
      },
    );
    sent.on("error", reject);
    sent.end(body);
  });

const auth = (server: UiServer, generation = 0): Record<string, string> => ({
  authorization: `Bearer ${server.token}`,
  "x-reqseq-workspace": String(generation),
});

const command = (server: UiServer, name: string, input: unknown = {}, generation = 0): Promise<Reply> =>
  request(server, "POST", `/api/${name}`, auth(server, generation), JSON.stringify(input));

/** The events of `/api/events` as they come. */
const events = async (
  server: UiServer,
): Promise<{ readonly seen: { event: string; data: unknown }[]; until: (n: number) => Promise<void> }> => {
  const seen: { event: string; data: unknown }[] = [];
  const waiters: (() => void)[] = [];
  await new Promise<void>((resolve, reject) => {
    const sent = http.get(
      {
        host: "127.0.0.1",
        port: server.port,
        path: "/api/events",
        agent: false,
        headers: { authorization: `Bearer ${server.token}` },
      },
      (response) => {
        expect(response.headers["content-type"]).toBe("text/event-stream; charset=utf-8");
        let buffer = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          buffer += chunk;
          for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
            const [event = "", data = ""] = buffer
              .slice(0, end)
              .split("\n")
              .map((line) => line.slice(line.indexOf(": ") + 2));
            seen.push({ event, data: JSON.parse(data) as unknown });
            buffer = buffer.slice(end + 2);
            waiters.splice(0).forEach((wake) => {
              wake();
            });
          }
        });
        response.on("error", () => undefined);
        resolve();
      },
    );
    sent.on("error", reject);
    onTestFinished(() => {
      sent.destroy();
    });
  });
  const until = async (n: number): Promise<void> => {
    while (seen.length < n) {
      await new Promise<void>((wake) => waiters.push(wake));
    }
  };
  return { seen, until };
};

describe("UI server: page files", () => {
  it("serves the files of the manifest read at start, / as index.html, with the page headers", async () => {
    const server = await start();
    expect(server.url).toBe(`http://127.0.0.1:${String(server.port)}/#token=${server.token}`);
    expect(server.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const page = await request(server, "GET", "/?x=1");
    expect([page.status, page.text, page.headers["content-type"]]).toEqual([
      200,
      "<!doctype html><title>ReqSeq</title>",
      "text/html; charset=utf-8",
    ]);
    expect(page.headers).toMatchObject({
      "content-security-policy": PAGE_CSP,
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
    });
    const script = await request(server, "HEAD", "/assets/app.js");
    expect([script.status, script.text, script.headers["content-type"]]).toEqual([
      200,
      "",
      "text/javascript; charset=utf-8",
    ]);
    const font = await request(server, "GET", "/assets/KaTeX%20Main.woff2");
    expect([font.status, font.text, font.headers["content-type"]]).toEqual([200, "font", "font/woff2"]);
    // A file written after the start, a link, an unknown type and a path that leaves the folder are no page files.
    await fs.writeFile(path.join(pages, "later.js"), "x");
    for (const target of [
      "/later.js",
      "/assets/link.js",
      "/linked/secret.js",
      "/notes.txt",
      "/assets/../index.html",
      "/%2e%2e/x.js",
      "/assets/%E0%A4%A.js",
    ]) {
      expect([target, (await request(server, "GET", target)).status]).toEqual([target, 401]);
    }
    expect(calls).toEqual([]);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "does not start when a page file cannot be read, and names it",
    async () => {
      const file = path.join(pages, "assets", "app.js");
      await fs.chmod(file, 0o000);
      await expect(createUiServer({ pages, runner })).rejects.toMatchObject({
        code: "internal",
        details: { file },
      });
    },
  );

  it("does not start without index.html", async () => {
    await fs.rm(path.join(pages, "index.html"));
    await expect(createUiServer({ pages, runner })).rejects.toMatchObject({ code: "file.folder-missing" });
    await expect(createUiServer({ pages: path.join(pages, "gone"), runner })).rejects.toMatchObject({
      code: "file.folder-missing",
    });
  });
});

describe("UI server: checks on every request", () => {
  it("refuses another Host, another Origin, Origin null and a cross-site fetch before the token", async () => {
    const server = await start();
    const host = `127.0.0.1:${String(server.port)}`;
    const refused = [
      await request(server, "GET", "/", { host: `example.com:${String(server.port)}` }),
      await request(server, "GET", "/", { origin: "http://example.com" }),
      await request(server, "GET", "/", { origin: "null" }),
      await command(server, "tool.guide").then(() =>
        request(server, "POST", "/api/tool.guide", { ...auth(server), origin: `https://${host}` }),
      ),
      await request(server, "POST", "/api/tool.guide", { ...auth(server), "sec-fetch-site": "cross-site" }),
    ];
    expect(refused.map((r) => r.status)).toEqual([403, 403, 403, 403, 403]);
    expect(refused[0]?.json()).toMatchObject({ code: "input.invalid" });
    expect(calls.map((c) => c.name)).toEqual(["tool.guide"]);
    // A page file is served to a cross-site fetch and with its own origin.
    expect((await request(server, "GET", "/", { "sec-fetch-site": "cross-site" })).status).toBe(200);
    expect(
      (
        await request(server, "GET", "/", {
          origin: `http://${host}`,
          host: `LOCALHOST:${String(server.port)}`,
        })
      ).status,
    ).toBe(403);
    expect((await request(server, "GET", "/", { origin: `http://${host}` })).status).toBe(200);
  });

  it("requires the bearer token for everything but a page file, and never reads a cookie", async () => {
    const server = await start();
    for (const headers of [
      {},
      { authorization: "Bearer wrong" },
      { authorization: `Basic ${server.token}` },
      { cookie: `token=${server.token}` },
    ]) {
      const reply = await request(server, "POST", "/api/tool.guide", {
        "x-reqseq-workspace": "0",
        ...headers,
      });
      expect([reply.status, reply.headers["www-authenticate"]]).toEqual([401, "Bearer"]);
    }
    expect(calls).toEqual([]);
    expect(
      (
        await request(server, "POST", "/api/tool.guide", {
          ...auth(server),
          authorization: `bearer ${server.token}`,
        })
      ).status,
    ).toBe(200);
  });

  it("answers unknown routes with 404 and sends the common headers, no CORS headers, on every answer", async () => {
    const server = await start();
    const replies = [
      await request(server, "GET", "/nothing", auth(server)),
      await request(server, "GET", "/api/workspace.recent", auth(server)),
      await request(server, "POST", "/api/%E0%A4%A", auth(server)),
      await request(server, "POST", "/ui/workspace/x", auth(server)),
      await request(server, "GET", "*", auth(server)),
      await request(server, "POST", "/api/events", auth(server)),
      await request(server, "GET", "/ui/workspace", auth(server)),
    ];
    expect(replies.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404, 404]);
    const ok = await command(server, "workspace.recent");
    for (const reply of [...replies, ok]) {
      expect(reply.headers).toMatchObject({
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
        "content-security-policy": "frame-ancestors 'none'",
      });
      expect(Object.keys(reply.headers).filter((h) => h.startsWith("access-control-"))).toEqual([]);
    }
    expect([ok.status, ok.json(), ok.headers["cache-control"]]).toEqual([
      200,
      { ran: "workspace.recent" },
      "no-store",
    ]);
    expect(calls).toEqual([
      { name: "workspace.recent", input: {}, root: process.cwd(), access: "ui", signal: true },
    ]);
  });
});

describe("UI server: commands and workspaces", () => {
  it("without a workspace runs only the commands that need none; others get workspace.not-found", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-ui-cwd-"));
    onTestFinished(() => fs.rm(cwd, { recursive: true, force: true }));
    const server = await start({ cwd });
    for (const name of ["tool.guide", "workspace.recent", "workspace.listFolder", "workspace.init"]) {
      expect([name, (await command(server, name)).status]).toEqual([name, 200]);
    }
    for (const [name, input] of [
      ["element.get", { ref: "SR-1" }],
      // It names the workspace in its output (#2370).
      ["tool.info", {}],
    ] as const) {
      const missing = await command(server, name, input);
      expect([name, missing.status, missing.json()]).toMatchObject([
        name,
        404,
        { code: "workspace.not-found" },
      ]);
    }
    expect(new Set(calls.map((c) => [c.root, c.access].join()))).toEqual(new Set([`${cwd},ui`]));
    // A write gets no abort signal: it runs to its end.
    expect(calls.find((c) => c.name === "workspace.init")?.signal).toBe(false);
  });

  it("answers as the API does: the error body with the status of its class, and 400 for a body that is no JSON", async () => {
    const server = await start();
    behaviour = () => Promise.reject(new CommandError("ref.unknown", "No such element"));
    const failed = await command(server, "tool.guide");
    expect([failed.status, failed.json()]).toEqual([
      404,
      { code: "ref.unknown", message: "No such element" },
    ]);
    behaviour = () => Promise.reject(new Error("crash"));
    const crashed = await command(server, "tool.guide");
    expect([crashed.status, crashed.json()]).toMatchObject([
      500,
      { message: "Internal error in the UI server" },
    ]);
    behaviour = () => Promise.resolve(undefined);
    expect((await command(server, "tool.guide")).text).toBe("null\n");
    const broken = await request(server, "POST", "/api/tool.guide", auth(server), "{");
    expect([broken.status, broken.json()]).toMatchObject([400, { code: "input.invalid" }]);
  });

  it("opens and switches the workspace, sends its generation, and refuses a request of another one", async () => {
    const first = await createFixtureWorkspace({ fixture: "SR-007/external-changes" });
    const second = await createFixtureWorkspace({ fixture: "SR-007/external-changes" });
    onTestFinished(() => first.cleanup());
    onTestFinished(() => second.cleanup());
    const server = await start({ workspace: first.root });
    const stream = await events(server);
    await stream.until(1);
    expect(stream.seen[0]).toEqual({ event: "workspace", data: { generation: 1 } });
    expect((await command(server, "element.get", { ref: "SR-1" }, 1)).status).toBe(200);
    for (const generation of [0, 2]) {
      const stale = await command(server, "element.get", {}, generation);
      expect([stale.status, stale.json()]).toMatchObject([409, { code: "workspace.changed" }]);
    }
    const without = await request(server, "POST", "/api/tool.info", {
      authorization: `Bearer ${server.token}`,
    });
    expect(without.status).toBe(409);
    const switched = await request(
      server,
      "POST",
      "/ui/workspace",
      auth(server),
      JSON.stringify({ path: second.root }),
    );
    expect([switched.status, switched.json()]).toEqual([200, { generation: 2, root: second.root }]);
    await stream.until(2);
    expect(stream.seen[1]).toEqual({ event: "workspace", data: { generation: 2 } });
    expect((await command(server, "element.get", {}, 1)).status).toBe(409);
    expect((await command(server, "element.get", {}, 2)).status).toBe(200);
    expect(calls.map((c) => c.root)).toEqual([first.root, second.root]);
    expect(marked).toEqual([
      { root: first.root, access: "ui" },
      { root: second.root, access: "ui" },
    ]);
  });

  it("reports a workspace it could not mark as opened and keeps it open", async () => {
    const first = await createFixtureWorkspace({ fixture: "SR-007/external-changes" });
    onTestFinished(() => first.cleanup());
    marking = () => Promise.reject(new CommandError("input.invalid", "Another process writes the list"));
    const reports: string[] = [];
    const server = await start({ workspace: first.root, report: (message) => reports.push(message) });
    expect(reports).toEqual(["The workspace was not marked as opened: Another process writes the list"]);
    expect((await command(server, "element.get", {}, 1)).status).toBe(200);
    // Without `report` the refusal changes nothing either.
    const quiet = await start({ workspace: first.root });
    expect((await command(quiet, "element.get", {}, 1)).status).toBe(200);
  });

  it("keeps the open workspace when the folder to open has no workspace, and refuses a body without a path", async () => {
    const first = await createFixtureWorkspace({ fixture: "SR-007/external-changes" });
    onTestFinished(() => first.cleanup());
    const server = await start({ workspace: first.root });
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-ui-empty-"));
    onTestFinished(() => fs.rm(empty, { recursive: true, force: true }));
    for (const folder of [empty, path.join(empty, "gone")]) {
      const reply = await request(
        server,
        "POST",
        "/ui/workspace",
        auth(server),
        JSON.stringify({ path: folder }),
      );
      expect([reply.status, reply.json()]).toMatchObject([404, { code: "workspace.not-found" }]);
    }
    for (const body of ["{}", '{"path":""}', '{"path":1}', "null", "[]"]) {
      expect([body, (await request(server, "POST", "/ui/workspace", auth(server), body)).status]).toEqual([
        body,
        400,
      ]);
    }
    expect((await command(server, "element.get", {}, 1)).status).toBe(200);
    expect(calls.map((c) => c.root)).toEqual([first.root]);
  });

  it("does not start when the workspace named at start has no workspace file", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-ui-empty-"));
    onTestFinished(() => fs.rm(empty, { recursive: true, force: true }));
    await expect(createUiServer({ pages, runner, workspace: empty })).rejects.toMatchObject({
      code: "workspace.not-found",
    });
  });

  it("aborts running reads on a switch and lets running writes finish first", async () => {
    const first = await createFixtureWorkspace({ fixture: "SR-007/external-changes" });
    const second = await createFixtureWorkspace({ fixture: "SR-007/external-changes" });
    onTestFinished(() => first.cleanup());
    onTestFinished(() => second.cleanup());
    const server = await start({ workspace: first.root });
    let finishWrite: (() => void) | undefined;
    const order: string[] = [];
    let running = 0;
    const bothRunning = new Promise<void>((resolve) => {
      behaviour = (name, _input, ctx) => {
        running += 1;
        if (running === 2) {
          resolve();
        }
        if (name === "element.update") {
          return new Promise((done) => {
            finishWrite = () => {
              order.push("write done");
              done({ written: true });
            };
          });
        }
        return new Promise((_done, fail) => {
          ctx.signal?.addEventListener("abort", () => {
            order.push("read aborted");
            fail(new Error("aborted"));
          });
        });
      };
    });
    const read = command(server, "element.get", { ref: "SR-1" }, 1);
    const write = command(server, "element.update", { ref: "SR-1" }, 1);
    await bothRunning;
    const switched = request(
      server,
      "POST",
      "/ui/workspace",
      auth(server, 1),
      JSON.stringify({ path: second.root }),
    );
    const stopped = await read;
    expect([stopped.status, stopped.json()]).toMatchObject([409, { code: "workspace.changed" }]);
    finishWrite?.();
    expect((await write).json()).toEqual({ written: true });
    expect((await switched).json()).toEqual({ generation: 2, root: second.root });
    expect(order).toEqual(["read aborted", "write done"]);
  });

  it("lets a write without a workspace finish before a switch opens the next one", async () => {
    const next = await createFixtureWorkspace({ fixture: "SR-007/external-changes" });
    onTestFinished(() => next.cleanup());
    const server = await start();
    const order: string[] = [];
    let finish: (() => void) | undefined;
    const running = new Promise<void>((resolve) => {
      behaviour = () =>
        new Promise((done) => {
          finish = () => {
            order.push("init done");
            done({ created: true });
          };
          resolve();
        });
    });
    const init = command(server, "workspace.init", { path: "x", name: "X" });
    await running;
    const switched = request(
      server,
      "POST",
      "/ui/workspace",
      auth(server),
      JSON.stringify({ path: next.root }),
    ).then((reply) => {
      order.push("switched");
      return reply;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    finish?.();
    expect((await init).json()).toEqual({ created: true });
    expect((await switched).status).toBe(200);
    expect(order).toEqual(["init done", "switched"]);
  });

  it("sends a change event with the scope and UUIDs the watcher reports", async () => {
    const first = await createFixtureWorkspace({ fixture: "SR-007/external-changes" });
    onTestFinished(() => first.cleanup());
    const server = await start({ workspace: first.root });
    const stream = await events(server);
    await stream.until(1);
    const file = first.path("requirements/SR-88cc6ebc472a.md");
    const original = await fs.readFile(file, "utf8");
    interface Change {
      readonly elements: { readonly changed: readonly string[] };
    }
    const changed = (): Change | undefined =>
      stream.seen
        .filter((e) => e.event === "change")
        .map((e) => e.data as Change)
        .find((d) => d.elements.changed.length > 0);
    // Changes until the watcher, which starts with the load in the background, reports one.
    for (let n = 1; changed() === undefined; n++) {
      await fs.writeFile(file, original.replace(/^title: .*$/mu, `title: Changed ${String(n)}`));
      await Promise.race([
        stream.until(stream.seen.length + 1),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    }
    const data = changed();
    expect(data).toMatchObject({ scope: "elements", elements: { changed: [expect.any(String) as unknown] } });
    expect(JSON.stringify(data)).not.toContain("Changed");
  }, 20_000);

  it("closes: aborts reads, waits for writes and listens no more", async () => {
    const first = await createFixtureWorkspace({ fixture: "SR-007/external-changes" });
    onTestFinished(() => first.cleanup());
    const server = await createUiServer({ pages, runner, workspace: first.root });
    expect(server.urls[0]).toBe(`http://127.0.0.1:${String(server.port)}`);
    let aborted = false;
    behaviour = (_name, _input, ctx) =>
      new Promise((_done, fail) => {
        ctx.signal?.addEventListener("abort", () => {
          aborted = true;
          fail(new Error("aborted"));
        });
      });
    const read = command(server, "element.get", {}, 1);
    while (calls.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await server.close();
    const stopped = await read;
    expect([stopped.status, stopped.json()]).toMatchObject([503, { code: "server.stopping" }]);
    expect(aborted).toBe(true);
    await expect(request(server, "GET", "/")).rejects.toThrow();
  });

  it("does not start on a busy port, and closes what it opened", async () => {
    const first = await start();
    await expect(createUiServer({ pages, runner, port: first.port })).rejects.toMatchObject({
      code: "input.invalid",
    });
    await expect(createUiServer({ pages, runner, port: -1 })).rejects.toMatchObject({
      code: "input.invalid",
    });
    // A start that fails marks nothing as opened (SR-247 AK3).
    const ws = await createFixtureWorkspace({ fixture: "SR-007/external-changes" });
    onTestFinished(() => ws.cleanup());
    await expect(
      createUiServer({ pages, runner, port: first.port, workspace: ws.root }),
    ).rejects.toMatchObject({ code: "input.invalid" });
    expect(marked).toEqual([]);
  });
});
