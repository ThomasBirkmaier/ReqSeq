import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { CommandRuntime } from "@logreq/core";
import {
  CommandError,
  PRODUCT_VERSION,
  Workspace,
  createCommandRuntime,
  agentInstructions,
  defineTestCommand,
  loadContracts,
} from "@logreq/core";
import { Client } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool, serveMcp } from "./server.js";
import { toolName } from "./tools.js";
import { LineTransport } from "./transport.js";

const entry = (name: string, effect = "read", input: Record<string, unknown> = {}) => ({
  name,
  summary: `Test command ${name}.`,
  effect,
  stage: 1,
  implements: ["SR-080"],
  input: { type: "object", additionalProperties: false, ...input },
  output: { type: "object" },
});

const catalog = {
  "logreq-catalog": 1,
  commands: [
    entry("test.echo", "read", { properties: { text: { type: "string" } }, required: ["text"] }),
    entry("test.fail"),
    entry("test.wait"),
    entry("test.later", "write-files"),
  ],
};

/**
 * Upper bounds of the product `tools/list` result and of one tool in it, in bytes of JSON (#303). Raise them
 * only on purpose, when the catalog grows: an agent puts the whole list into its context.
 */
const TOOLS_LIST_MAX_BYTES = 48 * 1024;
const TOOL_MAX_BYTES = 6 * 1024;

let waitAborted: (() => void) | undefined;
let waitStarted: (() => void) | undefined;

/** The error object of a tool error: the JSON text of its only content. */
const errorOf = (result: Awaited<ReturnType<Client["callTool"]>>): unknown => {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  const [content] = result.content as { type: string; text: string }[];
  expect(content?.type).toBe("text");
  return JSON.parse(content?.text ?? "") as unknown;
};

const runtime = createCommandRuntime({
  contracts: loadContracts({ catalog }),
  validateOutput: true,
  commands: [
    defineTestCommand({
      name: "test.echo",
      run: (ctx, input: { text: string }) => Promise.resolve({ text: input.text, root: ctx.workspace.root }),
    }),
    defineTestCommand({
      name: "test.fail",
      run: () => Promise.reject(new CommandError("element.read-only", "Read-only element", { id: "x" })),
    }),
    defineTestCommand({
      name: "test.wait",
      run: (ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => {
            waitAborted?.();
            reject(new Error("stopped"));
          });
          waitStarted?.();
        }),
    }),
  ],
});

interface Session {
  readonly client: Client;
  readonly served: Promise<void>;
  /** Ends the client's side of the pipe, like an agent that exits. */
  end(): void;
}

let dir: string;
let workspace: Workspace;
const sessions: Session[] = [];

/** A client and `serveMcp` connected by two pipes with the stdio framing, as `logreq mcp` runs. */
const open = async (signal?: AbortSignal, rt: CommandRuntime = runtime): Promise<Session> => {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const served = serveMcp({
    runtime: rt,
    workspace,
    input: toServer,
    output: { write: (text) => toClient.write(text) },
    ...(signal === undefined ? {} : { signal }),
  });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(new LineTransport(toClient, { write: (text) => toServer.write(text) }));
  const session = { client, served, end: () => toServer.end() };
  sessions.push(session);
  return session;
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-mcp-"));
  workspace = new Workspace(dir);
  waitAborted = undefined;
  waitStarted = undefined;
});

afterEach(async () => {
  for (const session of sessions.splice(0)) {
    session.end();
    await session.served;
    await session.client.close();
  }
  await workspace.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("serveMcp", () => {
  it("lists one tool per implemented catalog command with the catalog's schemas", async () => {
    const { client } = await open();
    expect(client.getServerVersion()).toMatchObject({ name: "logreq", version: PRODUCT_VERSION });
    const { tools } = await client.listTools();
    expect(tools.map((t) => [t.name, t.annotations?.readOnlyHint, t.description])).toEqual([
      ["test_echo", true, "Test command test.echo."],
      ["test_fail", true, "Test command test.fail."],
      ["test_wait", true, "Test command test.wait."],
    ]);
    expect(tools[0]?.inputSchema).toEqual(catalog.commands[0]?.input);
    // No output schemas: MCP does not need them for structured content, and they made up most of the list.
    expect(tools.map((t) => t.outputSchema)).toEqual([undefined, undefined, undefined]);
  });

  it("[SR-079/AK1] opens no network socket: no network module, and no socket while a session runs", async () => {
    const files = (await fs.readdir(import.meta.dirname)).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = await fs.readFile(path.join(import.meta.dirname, file), "utf8");
      expect([file, code.match(/["'](node:)?(net|http|https|http2|dgram|tls)["']/g)]).toEqual([file, null]);
    }
    const network = (): string[] =>
      process.getActiveResourcesInfo().filter((name) => /^(TCP|UDP)|PipeServer/.test(name));
    const before = network();
    const { client } = await open();
    await client.callTool({ name: "test_echo", arguments: { text: "x" } });
    expect(network()).toEqual(before);
  });

  it("answers a call with the command output as structured content and as JSON text", async () => {
    const { client } = await open();
    const result = await client.callTool({ name: "test_echo", arguments: { text: "Größe" } });
    const output = { text: "Größe", root: workspace.root };
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(output) }],
      structuredContent: output,
    });
  });

  it("answers a CommandError with a tool error that carries the error object as JSON text only", async () => {
    const { client } = await open();
    const failed = await client.callTool({ name: "test_fail", arguments: {} });
    const error = { code: "element.read-only", message: "Read-only element", details: { id: "x" } };
    // No structuredContent: it would have to match the output schema of the tool.
    expect(failed).toEqual({ isError: true, content: [{ type: "text", text: JSON.stringify(error) }] });
  });

  it("leaves input checks to core: same input.invalid as on every access", async () => {
    const { client } = await open();
    const invalid = await client.callTool({ name: "test_echo", arguments: { text: 1 } });
    expect(errorOf(invalid)).toMatchObject({
      code: "input.invalid",
      details: { command: "test.echo" },
    });
    const missing = await client.callTool({ name: "test_echo" });
    expect(errorOf(missing)).toMatchObject({ code: "input.invalid" });
  });

  it("answers a call to a catalog command it does not list with command.not-implemented, as every access", async () => {
    const { client } = await open();
    const later = await client.callTool({ name: "test_later", arguments: {} });
    expect(errorOf(later)).toEqual({
      code: "command.not-implemented",
      message: "Command test.later is not implemented yet",
      details: { command: "test.later" },
    });
    // A name outside the catalog is no tool at all: a protocol error, as the SDK gives it.
    await expect(client.callTool({ name: "test_nope", arguments: {} })).rejects.toThrow(
      "Tool test_nope not found",
    );
  });

  it("sends the instructions of core in its initialize result", async () => {
    const { client } = await open();
    expect(client.getInstructions()).toBe(agentInstructions(runtime, toolName));
  });

  it("ends when the input ends", async () => {
    const session = await open();
    session.end();
    await expect(session.served).resolves.toBeUndefined();
  });

  it("ends when its signal aborts, and aborts running calls", async () => {
    const controller = new AbortController();
    const { client, served } = await open(controller.signal);
    const started = new Promise<void>((resolve) => {
      waitStarted = resolve;
    });
    const aborted = new Promise<void>((resolve) => {
      waitAborted = resolve;
    });
    const call = client.callTool({ name: "test_wait", arguments: {} }).catch((error: unknown) => error);
    await started;
    controller.abort();
    await expect(served).resolves.toBeUndefined();
    await aborted;
    await client.close();
    await expect(call).resolves.toBeInstanceOf(Error);
  });

  it("does not start a session when the signal has aborted already", async () => {
    const controller = new AbortController();
    controller.abort();
    const toServer = new PassThrough();
    await serveMcp({
      runtime,
      workspace,
      input: toServer,
      output: { write: () => true },
      signal: controller.signal,
    });
    toServer.end();
  });
});

describe("callTool", () => {
  it("answers internal without the error text when the runtime fails outside of a CommandError", async () => {
    const broken: CommandRuntime = { ...runtime, invoke: () => Promise.reject(new Error("/secret/path")) };
    const result = await callTool(broken, workspace, "test.echo", {}, new AbortController().signal);
    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({ code: "internal", message: "Internal error in the MCP server" }),
        },
      ],
    });
  });

  it("runs on the runtime of the process by default", async () => {
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const served = serveMcp({
      workspace,
      input: toServer,
      output: { write: (text) => toClient.write(text) },
    });
    const client = new Client({ name: "test", version: "1" });
    await client.connect(new LineTransport(toClient, { write: (text) => toServer.write(text) }));
    const listed = await client.listTools();
    expect(listed.tools.some((t) => t.name === "workspace_status")).toBe(true);
    // #303: the list was 1 MB when every tool schema carried whole schema files; an agent puts all of it
    // into its context. Each tool now carries only the definitions it uses.
    expect(Buffer.byteLength(JSON.stringify(listed))).toBeLessThan(TOOLS_LIST_MAX_BYTES);
    for (const tool of listed.tools) {
      expect([tool.name, Buffer.byteLength(JSON.stringify(tool)) < TOOL_MAX_BYTES]).toEqual([
        tool.name,
        true,
      ]);
    }
    expect(client.getInstructions()).toContain("workspace_status");
    toServer.end();
    await served;
    await client.close();
  });
});
