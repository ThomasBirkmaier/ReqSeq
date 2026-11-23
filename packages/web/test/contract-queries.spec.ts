// SR-080 AK4: every value of the workspace and every setting of the tool that the web UI shows can be queried
// over the command line, the API and the MCP server. The page reads what it shows only from the server: a
// catalog command (`POST api/<command>`), the open of a workspace (`POST ui/workspace`) and the event stream
// (`GET api/events`, generation and change notices); the browser storage holds how the page shows things (theme,
// view), which the criterion leaves out. The test walks every area of the page on the built `reqseq ui`, records
// each request, and replays each read command the page ran, with the same input, over the built CLI and over the
// MCP server (`reqseq mcp`) on the same workspace: both give the output the page received. The local API runs the
// same `invoke` as the MCP server and the CLI (ADR-0002); SR-080 AK1 shows that every catalog command is one of
// its routes, and the cross-access test that all accesses give the same result.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { Page, Response } from "@playwright/test";
import { BIN, scratch, startCliUi } from "./contract.js";
import { drawn, expect, open, test } from "./fixtures.js";
import type { Run } from "./start-ui.js";
import { createWorkspace, runOn, runner } from "./start-ui.js";

const run = promisify(execFile);

/** The catalog of core (catalog order of `schemas/commands/catalog.header.json`): each command with whether it reads. */
const catalog = (): ReadonlyMap<string, boolean> =>
  new Map(runner.contracts.commands.map((c) => [c.name, c.effect === "read"]));

const QUEUES = [
  "evidence-outdated",
  "approved-no-evidence",
  "missing-relation",
  "links",
  "needs-without",
  "drafts",
  "problems",
];

const enc = encodeURIComponent;

/** Every area of the page: overviews, queues, lists, one element of each type with its pages, review, workspace. */
async function routes(read: Run): Promise<string[]> {
  const mm = await read("metamodel.get", {});
  const types = mm.types.filter((t) => !t.abstract);
  const out = ["/q/overview", ...QUEUES.map((q) => `/q/${q}`), "/l/all", "/l/search?q=the"];
  out.push(...types.map((t) => `/l/type/${enc(t.key)}`));
  const [perspective] = (await read("perspective.list", {})).perspectives;
  if (perspective !== undefined) {
    out.push(`/l/perspective/${enc(perspective.name)}`);
  }
  const [filter] = (await read("filter.list", {})).filters;
  if (filter !== undefined) {
    out.push(`/l/filter/${enc(filter.name)}`);
  }
  for (const type of types) {
    const { partial = [] } = await read("element.list", {
      limit: 1,
      fields: ["identifier"],
      selection: { where: { type: [type.key] } },
    });
    for (const e of partial) {
      const ref = enc(e.identifier ?? e.shortId);
      out.push(`/e/${ref}`, `/evidence/${ref}`, `/graph/${ref}`, `/impact/${ref}`, `/edit/${ref}`);
      if (type.meaning === "variant") {
        out.push(`/variant/${ref}`);
      }
      if (type.meaning === "package") {
        out.push(`/l/package/${ref}`);
      }
    }
  }
  if (types[0] !== undefined) {
    out.push(`/new?type=${enc(types[0].key)}`);
  }
  out.push("/matrix", "/c", "/r");
  // One element that changed since the newest baseline, so the page compares its two versions.
  const changes = await read("baseline.changes", { limit: 1 });
  if (changes.baseline !== undefined) {
    const got = await read("baseline.get", { baseline: changes.baseline.name, limit: 5000 });
    const changed =
      got.elements.find((e) => e.state === "changed") ?? got.elements.find((e) => e.state === "added");
    if (changed !== undefined) {
      out.push(`/c/${changed.id}`);
    }
  }
  out.push("/w/problems", "/w/export", "/w/import", "/w/settings", "/w/open");
  return out;
}

/** One command the page ran: its name, its input and what the server answered. */
interface Answered {
  readonly name: string;
  readonly input: unknown;
  readonly status: number;
  readonly output: unknown;
}

/**
 * Records every request of `page` other than a command call, the open of a workspace, the event stream and a file
 * of the pages on the server at `origin` (script, style, font, picture), and the answers of the command calls and
 * of the opens.
 */
function record(
  page: Page,
  origin: string,
): {
  readonly other: string[];
  readonly answers: Promise<Answered>[];
  readonly opened: Promise<unknown>[];
} {
  const other: string[] = [];
  const answers: Promise<Answered>[] = [];
  const opened: Promise<unknown>[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    const method = request.method();
    const server = url.origin === origin;
    const known =
      (method === "POST" && (url.pathname.startsWith("/api/") || url.pathname === "/ui/workspace")) ||
      (method === "GET" && (url.pathname === "/api/events" || !/^\/(?:api|ui)\//u.test(url.pathname)));
    // `data:` and `blob:` URLs load nothing from a server.
    if (!["data:", "blob:"].includes(url.protocol) && (!server || !known)) {
      other.push(`${method} ${request.url()}`);
    }
  });
  page.on("response", (response: Response) => {
    const request = response.request();
    const { pathname } = new URL(request.url());
    if (request.method() !== "POST") {
      return;
    }
    if (pathname === "/ui/workspace") {
      opened.push(response.json());
    } else if (pathname.startsWith("/api/")) {
      answers.push(
        response.json().then((output: unknown) => ({
          name: decodeURIComponent(pathname.slice("/api/".length)),
          input: request.postDataJSON() as unknown,
          status: response.status(),
          output,
        })),
      );
    }
  });
  return { other, answers, opened };
}

/**
 * `output` with the UUID a dry run of `element.create` gives the new element, which is new on every run, and the
 * parts of it in the short ID and the file name, replaced by placeholders; any other output as it is.
 */
const comparable = (name: string, output: unknown): unknown => {
  const id = (output as { element?: { id?: unknown } } | null)?.element?.id;
  if (name !== "element.create" || typeof id !== "string") {
    return output;
  }
  const text = JSON.stringify(output)
    .replaceAll(id, "<new id>")
    .replaceAll(id.slice(-12), "<new id 12>")
    .replaceAll(id.slice(-6), "<new id 6>");
  return JSON.parse(text) as unknown;
};

/**
 * The CLI arguments of command `name`: `element.searchFields` is `element search-fields`, as `kebab` of
 * packages/cli/src/fields.ts names an action; this package does not depend on the CLI package.
 */
const cliCommand = (name: string): string[] => {
  const [group = "", action = ""] = name.split(".");
  return [group, action.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)];
};

/** Runs command `name` with `input` over the built CLI and resolves with its JSON output. */
async function overCli(name: string, input: unknown, root: string, env: NodeJS.ProcessEnv): Promise<unknown> {
  const { stdout } = await run(
    process.execPath,
    [BIN, ...cliCommand(name), "--input", JSON.stringify(input), "--workspace", root, "--json"],
    { cwd: root, env, maxBuffer: 256 * 1024 * 1024 },
  ).catch((error: unknown) => {
    throw new Error(`reqseq ${name} failed: ${String((error as { stderr?: unknown }).stderr ?? error)}`);
  });
  return JSON.parse(stdout) as unknown;
}

/** The MCP server of the built CLI over standard input and output, with one call per command. */
async function mcpServer(
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<{
  readonly call: (name: string, input: unknown) => Promise<unknown>;
  readonly stop: () => Promise<void>;
}> {
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [BIN, "mcp", "--workspace", root], {
    cwd: root,
    env,
    stdio: "pipe",
  });
  const waiting = new Map<
    number,
    { resolve: (message: Record<string, unknown>) => void; reject: (error: Error) => void }
  >();
  let errors = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => (errors += chunk));
  const exited = new Promise<void>((resolve) => {
    child.once("exit", (code) => {
      for (const pending of waiting.values()) {
        pending.reject(new Error(`reqseq mcp ended with ${String(code)}:\n${errors}`));
      }
      waiting.clear();
      resolve();
    });
  });
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    let end = buffer.indexOf("\n");
    while (end >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      let message: Record<string, unknown> | undefined;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // Not a JSON-RPC message (an empty line): nothing waits for it.
      }
      const id = message?.["id"];
      if (message !== undefined && typeof id === "number") {
        waiting.get(id)?.resolve(message);
        waiting.delete(id);
      }
      end = buffer.indexOf("\n");
    }
  });
  let next = 0;
  const request = (method: string, params: unknown): Promise<Record<string, unknown>> => {
    next += 1;
    const id = next;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  };
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "contract-test", version: "0" },
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  return {
    call: async (name, input) => {
      const answer = await request("tools/call", { name: name.replace(".", "_"), arguments: input });
      const result = answer["result"] as { structuredContent?: unknown; isError?: boolean } | undefined;
      if (result === undefined || result.isError === true) {
        throw new Error(`MCP ${name} failed: ${JSON.stringify(answer)}\n${errors}`);
      }
      return result.structuredContent;
    },
    // Waits for the end of the process, so that no file of the workspace is still open when it is removed.
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await exited;
      }
    },
  };
}

/** Runs `task` on each of `items`, `width` at a time. */
async function eachLimited<T>(
  items: readonly T[],
  width: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: width }, lane));
}

test("[SR-080/AK-hn1m] every value the web UI shows is the output of a command the CLI and the MCP server give alike", async ({
  page,
  kind,
}) => {
  test.setTimeout(300_000);
  const workspace = await createWorkspace(kind);
  const home = await scratch();
  const env = {
    ...process.env,
    HOME: home.dir,
    USERPROFILE: home.dir,
    XDG_CACHE_HOME: home.dir,
    LOCALAPPDATA: home.dir,
  };
  try {
    const commands = catalog();
    const walk = await routes(runOn(workspace.root));
    const ui = await startCliUi({ root: workspace.root, home: home.dir });
    try {
      const recorded = record(page, new URL(ui.url).origin);
      for (const route of walk) {
        await open(page, ui.url, route);
      }
      const answered = await Promise.all(recorded.answers);
      // (1) Only command calls of the catalog, besides the event stream and the files of the pages.
      const names = [...new Set(answered.map((a) => a.name))];
      expect(names.filter((n) => !commands.has(n))).toEqual([]);
      expect(answered.filter((a) => a.status !== 200).map((a) => a.name)).toEqual([]);
      // The walk only reads: read commands, and the dry runs of a write (SR-246) a form runs on what is typed.
      const reads = (a: Answered): boolean =>
        commands.get(a.name) === true || (a.input as { dryRun?: unknown } | null)?.dryRun === true;
      expect(answered.filter((a) => !reads(a)).map((a) => a.name)).toEqual([]);
      // The areas read at least these, so the walk did reach them.
      expect(names).toEqual(
        expect.arrayContaining([
          "element.get",
          "element.list",
          "hint.list",
          "trace.graph",
          "trace.matrix",
          "baseline.changes",
          "baseline.compare",
          "evidence.list",
          "workspace.status",
          "workspace.recent",
          "tool.info",
        ]),
      );
      // (2) Each read the page ran, run again with the same input, gives the output the page got: over the CLI,
      // then over the MCP server.
      const distinct = [
        ...new Map(answered.map((a) => [`${a.name} ${JSON.stringify(a.input)}`, a])).values(),
      ];
      await eachLimited(distinct, 4, async (a) => {
        const output = await overCli(a.name, a.input, workspace.root, env);
        expect([a.name, a.input, comparable(a.name, output)]).toEqual([
          a.name,
          a.input,
          comparable(a.name, a.output),
        ]);
      });
      const mcp = await mcpServer(workspace.root, env);
      try {
        // The MCP server counts its own connection among the connected agents (`workspace.agents`), so that answer
        // differs by this one connection; the CLI gave it above.
        for (const a of distinct.filter((x) => x.name !== "workspace.agents")) {
          const output = await mcp.call(a.name, a.input);
          expect([a.name, a.input, comparable(a.name, output)]).toEqual([
            a.name,
            a.input,
            comparable(a.name, a.output),
          ]);
        }
      } finally {
        await mcp.stop();
      }
      // (3) Opening the workspace that is open (`POST ui/workspace`): its answer names the root `tool.info` gives.
      await open(page, ui.url, "/w/open");
      await page.getByLabel("Folder of the workspace").fill(workspace.root);
      await page.getByRole("button", { name: "Open", exact: true }).click();
      await drawn(page, "/q/overview");
      const opened = (await Promise.all(recorded.opened)) as { root?: unknown }[];
      const info = (await overCli("tool.info", {}, workspace.root, env)) as { workspace: { path: string } };
      expect(opened.map((o) => o.root)).toEqual([info.workspace.path]);
      expect(recorded.other).toEqual([]);
    } finally {
      await ui.stop();
    }
  } finally {
    await home.done();
    await workspace.cleanup();
  }
});
