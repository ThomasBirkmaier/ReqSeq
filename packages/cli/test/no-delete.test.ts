// SR-099 (D-045): the command line, the local API and the MCP server offer no delete of an element. Each
// offers exactly the catalog commands (ADR-0002 rule 3), and the catalog has none
// (packages/core/src/commands/no-delete.test.ts). A delete that is not in the catalog is refused by each
// adapter and leaves the element file as it was. The app offers the same through its preload bridge, which is
// generic over the catalog (ADR-0010); the Electron tests check the bridge in the app itself.
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { MessagePort } from "node:worker_threads";
import { MessageChannel } from "node:worker_threads";
import { startApiServer } from "@logreq/api";
import type { IpcRendererLike } from "@logreq/app";
import { createBridge, createCoreHost } from "@logreq/app";
import { Workspace, createCommandRuntime } from "@logreq/core";
import { LineTransport, serveMcp, toolName } from "@logreq/mcp";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EXIT, runCli } from "../src/index.js";

/** The product catalog and implementations. */
const runtime = createCommandRuntime();
const catalogNames = runtime.contracts.commands.map((c) => c.name);

/** Words of an action that would delete something; see the core test for the one allowed exception. */
const DELETE_LIKE = /delete|remove|destroy|erase|purge|drop|unlink|trash|discard|clear|wipe/i;
/** Removes a relation entry from the source file; the element and its file stay. */
const RELATION_REMOVE = "relation.remove";

const ELEMENT_FILE = "requirements/SR-6328cee88fb3.md";
const REF = "SR-e88fb3";

let fixture: FixtureWorkspace;
let cache: string;
let original: string;

const elementFile = (): Promise<string> => fs.readFile(path.join(fixture.root, ELEMENT_FILE), "utf8");

// The OS cache folder (the model cache of every CLI command, SR-082) lies in a temporary folder on every OS.
let cacheHome = "";
beforeAll(async () => {
  cacheHome = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-cache-home-"));
  for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
    vi.stubEnv(name, cacheHome);
  }
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(cacheHome, { recursive: true, force: true });
});

beforeAll(async () => {
  fixture = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
  cache = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-no-delete-"));
  original = await elementFile();
});

afterAll(async () => {
  await fixture.cleanup();
  await fs.rm(cache, { recursive: true, force: true, maxRetries: 3 });
});

class Sink {
  text = "";
  write(text: string): boolean {
    this.text += text;
    return true;
  }
}

const cli = async (argv: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
  const stdout = new Sink();
  const stderr = new Sink();
  const code = await runCli({
    argv: [...argv],
    cwd: fixture.root,
    stdin: Readable.from([]),
    stdout,
    stderr,
    runtime,
  });
  return { code, stdout: stdout.text, stderr: stderr.text };
};

/** The names in the "Commands:" section of a commander help text. */
const commandsOfHelp = (help: string): string[] =>
  [...(help.split("Commands:\n")[1] ?? "").matchAll(/^ {2}([a-z][a-z-]*)\b/gm)].map((m) => m[1] ?? "");

describe("the command line offers no delete (SR-099)", () => {
  it("[SR-099/AK1] offers exactly the catalog groups and actions, none of them a delete", async () => {
    const top = await cli(["--help"]);
    expect(top.code).toBe(EXIT.ok);
    const groups = [...new Set(catalogNames.map((name) => name.split(".")[0] ?? ""))];
    expect(commandsOfHelp(top.stdout).sort()).toEqual([...groups, "help", "mcp", "serve"].sort());
    for (const group of groups) {
      const help = await cli([group, "--help"]);
      expect(help.code).toBe(EXIT.ok);
      const actions = catalogNames
        .filter((name) => name.startsWith(`${group}.`))
        .map((name) => name.slice(group.length + 1).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
      const offered = commandsOfHelp(help.stdout).filter((name) => name !== "help");
      expect([group, offered.sort()]).toEqual([group, actions.sort()]);
      const deletes = offered.filter((action) => DELETE_LIKE.test(action));
      expect(deletes.map((action) => `${group}.${action}`)).toEqual(
        group === "relation" ? [RELATION_REMOVE] : [],
      );
    }
  });

  it("[SR-099/AK1] refuses `element delete` as a usage error and keeps the element file", async () => {
    for (const action of ["delete", "remove", "rm"]) {
      const result = await cli(["element", action, REF, "--workspace", fixture.root]);
      expect([action, result.code, result.stdout]).toEqual([action, EXIT.usage, ""]);
      expect(result.stderr).toContain(`unknown command '${action}'`);
    }
    expect(await elementFile()).toBe(original);
  });
});

describe("the local API offers no delete (SR-099)", () => {
  const request = (
    port: number,
    token: string,
    method: string,
    route: string,
    body = "",
  ): Promise<{ status: number | undefined; body: unknown }> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method,
          path: route,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          });
        },
      );
      req.on("error", reject);
      req.end(body);
    });

  it("[SR-099/AK1] lists only catalog commands and refuses DELETE and unknown delete commands", async () => {
    const workspace = new Workspace(fixture.root);
    const server = await startApiServer({ workspace, runtime, cacheFolder: cache });
    try {
      const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
      const list = await request(server.port, token, "GET", "/v1/commands");
      expect(list.status).toBe(200);
      const listed = (list.body as { commands: { name: string }[] }).commands.map((c) => c.name);
      expect(listed).toEqual(catalogNames);

      for (const route of ["/v1/commands", "/v1/commands/element.update", "/v1/commands/element.get"]) {
        const reply = await request(server.port, token, "DELETE", route);
        expect([route, reply.status]).toEqual([route, 405]);
      }
      for (const name of ["element.delete", "element.remove"]) {
        const reply = await request(server.port, token, "POST", `/v1/commands/${name}`, `{"ref":"${REF}"}`);
        expect([name, reply.status, reply.body]).toEqual([
          name,
          400,
          { code: "input.invalid", message: `Unknown command: ${name}`, details: { command: name } },
        ]);
      }
    } finally {
      await server.close();
      await workspace.close();
    }
    expect(await elementFile()).toBe(original);
  });
});

describe("the MCP server offers no delete (SR-099)", () => {
  it("[SR-099/AK1] offers one tool per implemented catalog command, none that deletes an element, and refuses a delete tool", async () => {
    const workspace = new Workspace(fixture.root);
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const served = serveMcp({
      runtime,
      workspace,
      input: toServer,
      output: { write: (t) => toClient.write(t) },
    });
    const client = new Client({ name: "no-delete", version: "1" });
    try {
      await client.connect(new LineTransport(toClient, { write: (t) => toServer.write(t) }));
      const { tools } = await client.listTools();
      // Only implemented commands are listed (#303); the catalog itself has no delete either (tests above).
      expect(tools.map((t) => t.name)).toEqual(
        catalogNames.filter((name) => runtime.commands.has(name)).map(toolName),
      );
      expect(
        tools.map((t) => t.name).filter((name) => DELETE_LIKE.test(name.slice(name.indexOf("_") + 1))),
      ).toEqual([toolName(RELATION_REMOVE)]);

      await expect(client.callTool({ name: "element_delete", arguments: { ref: REF } })).rejects.toThrow(
        "Tool element_delete not found",
      );
    } finally {
      toServer.end();
      await served;
      await client.close();
      await workspace.close();
    }
    expect(await elementFile()).toBe(original);
  });
});

describe("the app offers no delete (SR-099)", () => {
  /** The core side of the app's IPC on one end of a Node MessageChannel (Electron's port in the app). */
  const connect = (workspace: Workspace) => {
    const host = createCoreHost({ runtime, workspace });
    const { port1, port2 } = new MessageChannel();
    const port: MessagePort = port1;
    host.connect({
      post: (message) => {
        port.postMessage(message);
      },
      onMessage: (listener) => {
        port.on("message", listener);
      },
      onClose: (listener) => {
        port.on("close", listener);
      },
      close: () => {
        port.close();
      },
    });
    let deliver: Parameters<IpcRendererLike["on"]>[1] | undefined;
    const bridge = createBridge({
      on: (_channel, listener) => {
        deliver = listener;
      },
      invoke: () => Promise.resolve(false),
    });
    deliver?.({ ports: [port2] }, { open: true });
    return { bridge, close: () => host.close() };
  };

  it("[SR-099/AK1] offers invoke over the catalog, lists only catalog commands and refuses unknown delete commands", async () => {
    const app = connect(new Workspace(fixture.root));
    try {
      expect(Object.keys(app.bridge).sort()).toEqual(["commands", "copyText", "invoke", "on"]);
      const listed = (await app.bridge.commands()).map((c) => c.name);
      expect(listed).toEqual(catalogNames);
      expect(listed.filter((name) => DELETE_LIKE.test(name.slice(name.indexOf(".") + 1)))).toEqual([
        RELATION_REMOVE,
      ]);
      for (const name of ["element.delete", "element.remove"]) {
        expect([name, await app.bridge.invoke(name, { ref: REF })]).toEqual([
          name,
          {
            ok: false,
            error: { code: "input.invalid", message: `Unknown command: ${name}`, details: { command: name } },
          },
        ]);
      }
    } finally {
      await app.close();
    }
    expect(await elementFile()).toBe(original);
  });
});
