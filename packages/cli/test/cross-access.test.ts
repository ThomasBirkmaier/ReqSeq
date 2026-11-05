// Cross-access test (ADR-0002 rule 8, ADR-0011, SR-080): every catalog command runs through core `invoke`,
// the CLI, the local API, the MCP server and the app on the same fixture workspace, and all five give the
// same result: the same output or the same error object, and the same files on disk afterwards. The app is
// its preload bridge and the core side of its IPC over a MessageChannel, the path every call of the
// renderer takes (ADR-0010); the Electron tests (packages/app/test) run it in the app itself. New catalog
// commands join automatically with a default scenario (input `{}`); when a command is implemented, add its
// explicit scenarios in a module of its own, cross-access/scenarios/<group>/<command>.ts (#527). Fixtures
// that more than one command uses are in cross-access/fixtures.ts.
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import type { MessagePort } from "node:worker_threads";
import { MessageChannel } from "node:worker_threads";
import { startApiServer } from "@reqseq/api";
import type { Channel, IpcRendererLike } from "@reqseq/app";
import { SAVE_CHANNEL, WORKSPACE_CHANNEL, createBridge, createCoreHost } from "@reqseq/app";
import type { CatalogEntry, CommandName } from "@reqseq/core";
import { CommandError, Workspace, createCommandRuntime, jsonChunks, jsonLines } from "@reqseq/core";
import { LineTransport, serveMcp, toolName } from "@reqseq/mcp";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";
import { EXIT, argvFor, runCli } from "../src/index.js";
import { YAML_OPTIONS, yamlPieces } from "../src/render.js";
import { EXPORT, ONE_REPOSITORY } from "./cross-access/fixtures.js";
import type { Copy, Outcome, Result, Scenario } from "./cross-access/scenario.js";
import { SCENARIOS, TEMPLATE_SETUPS } from "./cross-access/scenario.js";

/** The product catalog and implementations; outputs are checked against the catalog (vitest.config.ts). */
const runtime = createCommandRuntime();

/** Vite's `import.meta.glob`, which Vitest compiles to static imports; this package has no Vite types. */
interface GlobImportMeta {
  glob(pattern: string, options: { readonly eager: true }): Record<string, unknown>;
}
// Each module cross-access/scenarios/<group>/<command>.ts registers the explicit scenarios of one command
// with `scenariosOf` (and the setup of its own fixtures with `templateSetup`). The glob finds them, so a new
// command adds a file and edits no shared one (#527); as the imports are static, `vitest related` finds this
// test from a scenario module. trace-check reads the tags of the same files, exactly one folder deep.
// Vite turns `Object.keys(import.meta.glob(...))` into the keys alone, without importing the modules, so
// the glob gets a variable of its own.
const loaded = (import.meta as unknown as GlobImportMeta).glob("./cross-access/scenarios/*/*.ts", {
  eager: true,
});
const SCENARIO_MODULES = Object.keys(loaded);

const errorOf = (error: unknown): unknown => (error instanceof CommandError ? error.toJSON() : error);

/**
 * #277: the pieces the CLI (`--json`, `--yaml`) and the API stream join to the whole text, on every
 * output of the suite: `jsonChunks` to `JSON.stringify` (small chunk lengths, so the walk descends),
 * `yamlPieces` to `stringify` with the same options.
 */
const expectWholeText = (name: string, output: unknown): void => {
  const value = output ?? null;
  for (const [indent, chunkLength] of [
    [0, 64],
    [2, 64],
    [2, 4096],
  ] as const) {
    const whole = indent === 0 ? JSON.stringify(value) : JSON.stringify(value, null, 2);
    expect([name, indent, chunkLength, [...jsonChunks(value, { indent, chunkLength })].join("")]).toEqual([
      name,
      indent,
      chunkLength,
      whole,
    ]);
  }
  expect([name, [...yamlPieces(output)].join("")]).toEqual([name, stringify(output, YAML_OPTIONS)]);
};

const viaCore = async (root: string, entry: CatalogEntry, input: object): Promise<Outcome> => {
  const workspace = new Workspace(root);
  try {
    const output = await runtime.invoke(entry.name, input, { workspace });
    expectWholeText(entry.name, output);
    return { output };
  } catch (error) {
    return { error: errorOf(error) };
  } finally {
    await workspace.close();
  }
};

class Sink {
  text = "";
  write(text: string): boolean {
    this.text += text;
    return true;
  }
}

const viaCli = async (
  root: string,
  entry: CatalogEntry,
  input: Record<string, unknown>,
): Promise<Outcome> => {
  const stdout = new Sink();
  const stderr = new Sink();
  const argv = [...argvFor(entry, input, runtime.contracts.schemas), "--json", "--workspace", root];
  const code = await runCli({ argv, cwd: root, stdin: Readable.from([]), stdout, stderr, runtime });
  return code === EXIT.ok || code === EXIT.findings
    ? { output: JSON.parse(stdout.text) as unknown }
    : { error: JSON.parse(stderr.text) as unknown };
};

const viaApi = async (root: string, entry: CatalogEntry, input: object, cache: string): Promise<Outcome> => {
  const workspace = new Workspace(root);
  const server = await startApiServer({ workspace, runtime, cacheFolder: cache });
  try {
    const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
    const reply = await new Promise<{ status: number | undefined; body: unknown }>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: server.port,
          method: "POST",
          path: `/v1/commands/${entry.name}`,
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
      req.end(JSON.stringify(input));
    });
    return reply.status === 200 ? { output: reply.body } : { error: reply.body };
  } finally {
    await server.close();
    await workspace.close();
  }
};

const viaMcp = async (
  root: string,
  entry: CatalogEntry,
  input: Record<string, unknown>,
): Promise<Outcome> => {
  const workspace = new Workspace(root);
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const served = serveMcp({
    runtime,
    workspace,
    input: toServer,
    output: { write: (t) => toClient.write(t) },
  });
  const client = new Client({ name: "cross-access", version: "1" });
  try {
    await client.connect(new LineTransport(toClient, { write: (t) => toServer.write(t) }));
    const result = await client.callTool({ name: toolName(entry.name), arguments: input });
    if (result.isError !== true) {
      return { output: result.structuredContent };
    }
    // A tool error carries the error object as JSON text only (no structuredContent).
    const [content] = result.content as { type: string; text: string }[];
    return { error: JSON.parse(content?.text ?? "") as unknown };
  } finally {
    toServer.end();
    await served;
    await client.close();
    await workspace.close();
  }
};

/** The core side of the app's IPC on one end of a Node MessageChannel (Electron's port in the app). */
const nodeChannel = (port: MessagePort): Channel => ({
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

/**
 * The app on `workspace` without Electron: its preload bridge, connected to the core side of its IPC as
 * the main process connects them (a port per window). `close` closes the ports and the workspace.
 */
const connectApp = (
  workspace: Workspace,
): { bridge: ReturnType<typeof createBridge>; close: () => Promise<void> } => {
  const host = createCoreHost({ runtime, workspace });
  const { port1, port2 } = new MessageChannel();
  host.connect(nodeChannel(port1));
  let deliver: Parameters<IpcRendererLike["on"]>[1] | undefined;
  const bridge = createBridge({
    // The workspace of the window, and main's requests to save before a switch (SR-131), which no
    // command sends.
    on: (channel, listener) => {
      expect([WORKSPACE_CHANNEL, SAVE_CHANNEL]).toContain(channel);
      if (channel === WORKSPACE_CHANNEL) {
        deliver = listener;
      }
    },
    invoke: () => Promise.resolve(false),
    send: () => undefined,
  });
  deliver?.({ ports: [port2] }, { open: true });
  return { bridge, close: () => host.close() };
};

const viaApp = async (root: string, entry: CatalogEntry, input: object): Promise<Outcome> => {
  const app = connectApp(new Workspace(root));
  try {
    const result = await app.bridge.invoke(entry.name, input);
    return result.ok ? { output: result.output } : { error: result.error };
  } finally {
    await app.close();
  }
};

/** Absolute paths in the copy of the fixture as `<copy>/...`, so results of separate copies compare equal. */
const normalized = (value: unknown, top: string): unknown => {
  const text = JSON.stringify(value);
  const escaped = JSON.stringify(top).slice(1, -1);
  return JSON.parse(text.split(escaped).join("<copy>")) as unknown;
};

/**
 * What an access left on disk: every file of a copy except Git's own, as a path relative to the copy (with
 * `/`) and its text. Compared between the accesses, so a write must change the same files in the same way.
 */
const filesOf = async (top: string): Promise<Record<string, string>> => {
  const entries = await fs.readdir(top, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(top, path.join(e.parentPath, e.name)))
    .filter((relative) => !relative.split(path.sep).includes(".git"))
    .sort();
  return Object.fromEntries(
    await Promise.all(
      files.map(async (relative) => [
        relative.split(path.sep).join("/"),
        await fs.readFile(path.join(top, relative), "utf8"),
      ]),
    ),
  ) as Record<string, string>;
};

/**
 * Every fixture a scenario uses, each once: building one spawns `git` several times, and many scenarios
 * share a fixture (a list with repeats built over a hundred, which ran past the hook timeout on Windows, #304).
 */
const FIXTURES: readonly FixtureOptions[] = [
  ...new Set([
    ONE_REPOSITORY,
    ...[...SCENARIOS.values()].flatMap((list) =>
      list.flatMap((s) => (s.fixture === undefined ? [] : [s.fixture])),
    ),
  ]),
];
const templates = new Map<FixtureOptions, FixtureWorkspace>();
const copies: string[] = [];
let cache: string;

// Building the templates spawns `git` three times per repository. On Windows runners that can take seconds.
// The OS cache folder (the model cache of every CLI command, SR-082) lies in a temporary folder on every OS.
let cacheHome = "";
beforeAll(async () => {
  cacheHome = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-cache-home-"));
  for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
    vi.stubEnv(name, cacheHome);
  }
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await fs.rm(cacheHome, { recursive: true, force: true });
});

/**
 * Templates built at the same time. Each one waits mostly for `git` to start; one after the other, the 70 of
 * them took over 120 s on a loaded windows-2025 runner (#423).
 */
const BUILD_CONCURRENCY = 8;

beforeAll(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-cross-access-"));
  const queue = FIXTURES.values();
  const worker = async (): Promise<void> => {
    for (const options of queue) {
      const template = await createFixtureWorkspace(options);
      templates.set(options, template);
      await TEMPLATE_SETUPS.get(options)?.(template);
    }
  };
  await Promise.all(Array.from({ length: BUILD_CONCURRENCY }, worker));
}, 120_000);

// Removes the templates and one copy per scenario (over 250 Git work trees): on Windows that takes longer
// than the default hook timeout of 30 s (#304).
afterAll(async () => {
  await Promise.all([...templates.values()].map((f) => f.cleanup()));
  templates.clear();
  await Promise.all(
    [cache, ...copies.splice(0)].map((folder) =>
      fs.rm(folder, { recursive: true, force: true, maxRetries: 3 }),
    ),
  );
}, 120_000);

/**
 * A fresh copy of the scenario's fixture, Git repositories included. Copying the files is much cheaper
 * than building the fixture again with `git`. The copy has the same commits, so every access starts from
 * the same state.
 */
const copy = async (scenario: Scenario): Promise<Copy> => {
  const template = templates.get(scenario.fixture ?? ONE_REPOSITORY);
  if (template === undefined) {
    throw new Error(`No template for scenario ${scenario.name}`);
  }
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-cross-access-copy-")));
  copies.push(base);
  const top = path.join(base, "workspace");
  // The templates have no sample hooks: the testkit runs `git init` without its template folder.
  await fs.cp(template.root, top, { recursive: true });
  return { top, root: scenario.root === undefined ? top : path.join(top, ...scenario.root.split("/")) };
};

/**
 * A test runs one command through all four accesses. A write command gets four copies. Each access may
 * read Git through a child process. On Linux and macOS a test takes well under a second. Process starts on
 * Windows runners vary from 0.1 s to more than 1 s, so the default limit of 5 s is too tight there. This
 * limit only catches a hang. On the Windows runner of CI it is 60 s, as for every other test there
 * (vitest.config.ts, #701): a stall of 30 s timed out one test here in 158 Windows runs (#720).
 */
const TEST_TIMEOUT = process.platform === "win32" && process.env["CI"] === "true" ? 60_000 : 30_000;

const ACCESSES = ["core", "cli", "api", "mcp", "app"] as const;

/**
 * Commands whose output has the time of the call at the top (`generated`, data-export.schema.json): it is
 * checked to lie within the call of each access and then replaced by `<generated>`, every other field compared.
 */
const GENERATED_AT_TOP: ReadonlySet<string> = new Set(["data.export"]);

/** `outcome` with its top-level `generated` replaced, after checking it lies between `start` and `end` (ms). */
const withoutGenerated = (access: string, outcome: Outcome, start: number, end: number): Outcome => {
  if (!("output" in outcome)) {
    return outcome;
  }
  const { generated, ...rest } = outcome.output as { generated?: unknown };
  expect([access, generated]).toEqual([access, expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)]);
  const time = Date.parse(String(generated));
  expect([access, time >= Math.floor(start / 1000) * 1000 && time <= end]).toEqual([access, true]);
  return { output: { ...rest, generated: "<generated>" } };
};

/**
 * `result` of baseline.create with the date of the baseline (output and file) replaced by `<date>`, after
 * checking it lies between `start` and `end` (ms); an error is left as it is.
 */
const withoutDate = (access: string, result: Result, start: number, end: number): Result => {
  const date = (result.outcome as { output?: { baseline?: { date?: string } } }).output?.baseline?.date;
  if (date === undefined) {
    return result;
  }
  const time = Date.parse(date);
  expect([access, time >= Math.floor(start / 1000) * 1000 && time <= end]).toEqual([access, true]);
  return JSON.parse(JSON.stringify(result).split(date).join("<date>")) as Result;
};

/** A fresh copy of the scenario's fixture, prepared. */
const preparedCopy = async (scenario: Scenario): Promise<Copy> => {
  const made = await copy(scenario);
  await scenario.prepare?.(made);
  return made;
};

/**
 * Run a scenario through all five accesses. A write command gets a fresh copy per access, so each one starts
 * from the same files. A read command, and a command without an implementation (it cannot write), share one
 * copy. Either way, the files of the copy are compared after each access.
 */
const runAll = async (entry: CatalogEntry, scenario: Scenario): Promise<Record<string, Result>> => {
  const unchanging = entry.effect === "read" || !runtime.commands.has(entry.name);
  const shared = unchanging ? await preparedCopy(scenario) : undefined;
  // The files of the prepared template: a read changes none of them, not even the same way on every access.
  const untouched = shared === undefined ? undefined : normalized(await filesOf(shared.top), shared.top);
  const results: Record<string, Result> = {};
  for (const access of ACCESSES) {
    const { top, root } = shared ?? (await copy(scenario));
    await scenario.prepare?.({ top, root });
    const input = { ...scenario.input };
    const start = Date.now();
    const called =
      access === "core"
        ? await viaCore(root, entry, input)
        : access === "cli"
          ? await viaCli(root, entry, input)
          : access === "api"
            ? await viaApi(root, entry, input, cache)
            : access === "mcp"
              ? await viaMcp(root, entry, input)
              : await viaApp(root, entry, input);
    const end = Date.now();
    const outcome = GENERATED_AT_TOP.has(entry.name) ? withoutGenerated(access, called, start, end) : called;
    // A data file of data.store holds no time of the call (#319): its bytes are compared as they are.
    const files = await filesOf(top);
    const result = withoutDate(access, normalized({ outcome, files }, top) as Result, start, end);
    if (untouched !== undefined) {
      expect([access, result.files]).toEqual([access, untouched]);
    }
    const masked = masks(result, scenario.masks ?? []);
    results[access] = scenario.newElement === true ? maskNewElement(masked) : masked;
  }
  return results;
};

/** `result` with each match of `patterns` replaced by `<masked>` (see `Scenario.masks`). */
const masks = (result: Result, patterns: readonly RegExp[]): Result =>
  patterns.length === 0
    ? result
    : (JSON.parse(
        patterns.reduce((text, pattern) => text.replace(pattern, "<masked>"), JSON.stringify(result)),
      ) as Result);

/** The id of the new element in `result` replaced everywhere by placeholders (see `Scenario.newElement`). */
const maskNewElement = (result: Result): Result => {
  const output = (
    result.outcome as {
      output?: { element?: { id?: string; version?: string }; created?: readonly { id?: string }[] };
    }
  ).output;
  if (output?.created !== undefined) {
    // Versions first: a random id tail can also occur inside a version hash.
    let text = JSON.stringify(result).replace(/n[12]:[0-9a-f]{16}/g, "<version>");
    for (const [index, { id = "" }] of output.created.entries()) {
      const tail = id.replaceAll("-", "");
      text = text
        .split(id)
        .join(`<id${String(index)}>`)
        .split(tail.slice(-12))
        .join(`<tail12-${String(index)}>`)
        .split(tail.slice(-6))
        .join(`<tail6-${String(index)}>`);
    }
    return JSON.parse(text) as Result;
  }
  const element = output?.element;
  if (element?.id === undefined || element.version === undefined) {
    return result;
  }
  const digits = element.id.replaceAll("-", "");
  return JSON.parse(
    JSON.stringify(result)
      .split(element.id)
      .join("<id>")
      .split(element.version)
      .join("<version>")
      .split(digits.slice(-12))
      .join("<tail12>")
      .split(digits.slice(-6))
      .join("<tail6>"),
  ) as Result;
};

const DEFAULT: Scenario = { name: "default input {}", input: {}, expect: "output" };

describe(
  "cross-access: same result through core, CLI, API, MCP and the app",
  { timeout: TEST_TIMEOUT },
  () => {
    for (const entry of runtime.contracts.commands) {
      const explicit = SCENARIOS.get(entry.name as CommandName) ?? [];
      for (const scenario of [DEFAULT, ...explicit]) {
        it(`${scenario.tag ?? "[SR-080/AK2]"} ${entry.name}, ${scenario.name}`, async () => {
          const results = await runAll(entry, scenario);
          const core = results["core"];
          if (scenario !== DEFAULT) {
            expect(Object.keys(core?.outcome ?? {})).toEqual([scenario.expect]);
          }
          expect(Object.keys(core?.files ?? {}).length).toBeGreaterThan(0);
          expect(results).toEqual({ core, cli: core, api: core, mcp: core, app: core });
          scenario.check?.(results);
        });
      }
    }

    it("has scenarios only for catalog commands", () => {
      const names = new Set(runtime.contracts.commands.map((e) => e.name));
      expect([...SCENARIOS.keys()].filter((name) => !names.has(name))).toEqual([]);
      // Each module registers the command its path names, so none is loaded without scenarios.
      const byPath = SCENARIO_MODULES.map((file) =>
        file.replace(/^\.\/cross-access\/scenarios\/([^/]+)\/([^/]+)\.ts$/, "$1.$2"),
      );
      expect([...SCENARIOS.keys()].sort()).toEqual(byPath.sort());
    });
  },
);

describe("every catalog command on every access", { timeout: TEST_TIMEOUT }, () => {
  it("[SR-080/AK1] is a CLI subcommand, an API route, once implemented an MCP tool, and listed by the app", async () => {
    const { root } = await copy(DEFAULT);
    const names = runtime.contracts.commands.map((e) => e.name);
    for (const entry of runtime.contracts.commands) {
      const [group = "", action = ""] = argvFor(entry, {});
      const stdout = new Sink();
      const code = await runCli({
        argv: [group, action, "--help"],
        cwd: root,
        stdin: Readable.from([]),
        stdout,
        stderr: new Sink(),
        runtime,
      });
      expect([entry.name, code, stdout.text]).toEqual([
        entry.name,
        EXIT.ok,
        expect.stringContaining(`Usage: reqseq ${group} ${action} `),
      ]);
    }
    const workspace = new Workspace(root);
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const served = serveMcp({
      runtime,
      workspace,
      input: toServer,
      output: { write: (t) => toClient.write(t) },
    });
    const client = new Client({ name: "cross-access", version: "1" });
    await client.connect(new LineTransport(toClient, { write: (t) => toServer.write(t) }));
    // MCP lists only the implemented commands (#303): an agent puts the whole list into its context. A call to
    // one that is not listed still gives command.not-implemented, as every access (the scenarios above).
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(names.filter((n) => runtime.commands.has(n)).map(toolName));
    toServer.end();
    await served;
    await client.close();
    const server = await startApiServer({ workspace, runtime, cacheFolder: cache });
    const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
    const listed = await new Promise<unknown>((resolve, reject) => {
      http
        .get(
          {
            host: "127.0.0.1",
            port: server.port,
            path: "/v1/commands",
            headers: { authorization: `Bearer ${token}` },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            });
          },
        )
        .on("error", reject);
    });
    expect((listed as { commands: { name: string }[] }).commands.map((c) => c.name)).toEqual(names);
    await server.close();
    // The app's bridge lists the catalog for the command palette (SR-073 AK2), as the API does.
    const app = connectApp(workspace);
    expect((await app.bridge.commands()).map((c) => c.name)).toEqual(names);
    await app.close();
  });
});

/** The text of a POST to the API of `root` with an `Accept` header, and its content type. */
const apiText = async (
  root: string,
  name: string,
  input: object,
  accept: string,
): Promise<{ readonly type: string | undefined; readonly text: string }> => {
  const workspace = new Workspace(root);
  const server = await startApiServer({ workspace, runtime, cacheFolder: cache });
  try {
    const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: server.port,
          method: "POST",
          path: `/v1/commands/${name}`,
          headers: { authorization: `Bearer ${token}`, accept },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            resolve({ type: res.headers["content-type"], text: Buffer.concat(chunks).toString("utf8") });
          });
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(input));
    });
  } finally {
    await server.close();
    await workspace.close();
  }
};

describe("cross-access: JSON Lines (#319)", { timeout: TEST_TIMEOUT }, () => {
  it("[SR-061/AK4] the CLI with --jsonl and the API with application/x-ndjson give the same lines, those of the core output", async () => {
    const lined = runtime.contracts.commands.filter((e) => e.jsonLines !== undefined);
    expect(lined.map((e) => e.name)).toEqual(["data.export"]);
    for (const entry of lined) {
      const spec = entry.jsonLines;
      if (spec === undefined) {
        continue;
      }
      for (const input of [{}, { selection: { package: "PKG-0000d1" } }]) {
        const { root } = await copy({
          name: "lines",
          fixture: EXPORT,
          root: "system",
          input,
          expect: "output",
        });
        const core = await viaCore(root, entry, input);
        const expected = [...jsonLines((core as { output: unknown }).output, spec)].join("");
        const items = ((core as { output: Record<string, unknown[]> }).output[spec.items] ?? []).length;
        expect([input, expected.split("\n").length - 1]).toEqual([input, items]);
        const stdout = new Sink();
        const stderr = new Sink();
        const argv = [...argvFor(entry, input, runtime.contracts.schemas), "--jsonl", "--workspace", root];
        const code = await runCli({ argv, cwd: root, stdin: Readable.from([]), stdout, stderr, runtime });
        expect([input, code, stderr.text, stdout.text]).toEqual([input, EXIT.ok, "", expected]);
        const api = await apiText(root, entry.name, input, "application/x-ndjson");
        expect([input, api]).toEqual([
          input,
          { type: "application/x-ndjson; charset=utf-8", text: expected },
        ]);
      }
    }
  });
});

/** The system requirement of SR-004/one-repository and its file. */
const WIND = "e8df96ea-a168-4d90-8d65-6328cee88fb3";
const WIND_FILE = "requirements/SR-6328cee88fb3.md";

/** Calls at the same time, as many as an MCP client sends in one turn (#686). */
const PARALLEL_CALLS = 8;

/** A copy of SR-004/one-repository with `count` new needs, created one after the other; their IDs. */
const withNeeds = async (count: number): Promise<{ readonly root: string; readonly needs: string[] }> => {
  const { root } = await copy({ name: "parallel", input: {}, expect: "output" });
  const workspace = new Workspace(root);
  const needs: string[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const created = (await runtime.invoke(
        "element.create",
        { type: "need", title: `Need ${String(i)}` },
        { workspace },
      )) as {
        element: { id: string };
      };
      needs.push(created.element.id);
    }
  } finally {
    await workspace.close();
  }
  return { root, needs };
};

describe("cross-access: write calls at the same time (SR-166)", { timeout: TEST_TIMEOUT }, () => {
  it("[SR-166/AK1] the API, the MCP server and the app keep every relation that eight relation.add calls at once report", async () => {
    // The API: eight requests at once.
    {
      const { root, needs } = await withNeeds(PARALLEL_CALLS);
      const workspace = new Workspace(root);
      const server = await startApiServer({ workspace, runtime, cacheFolder: cache });
      try {
        const { token } = JSON.parse(await fs.readFile(server.endpointFile, "utf8")) as { token: string };
        const statuses = await Promise.all(
          needs.map(
            (target) =>
              new Promise<number | undefined>((resolve, reject) => {
                const req = http.request(
                  {
                    host: "127.0.0.1",
                    port: server.port,
                    method: "POST",
                    path: "/v1/commands/relation.add",
                    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
                  },
                  (res) => {
                    res.resume();
                    res.on("end", () => {
                      resolve(res.statusCode);
                    });
                  },
                );
                req.on("error", reject);
                req.end(JSON.stringify({ source: WIND, kind: "derives-from", target }));
              }),
          ),
        );
        expect(statuses).toEqual(needs.map(() => 200));
      } finally {
        await server.close();
        await workspace.close();
      }
      const file = await fs.readFile(path.join(root, WIND_FILE), "utf8");
      expect(needs.filter((id) => !file.includes(id))).toEqual([]);
    }
    // The MCP server: eight tool calls at once.
    {
      const { root, needs } = await withNeeds(PARALLEL_CALLS);
      const workspace = new Workspace(root);
      const toServer = new PassThrough();
      const toClient = new PassThrough();
      const served = serveMcp({
        runtime,
        workspace,
        input: toServer,
        output: { write: (t) => toClient.write(t) },
      });
      const client = new Client({ name: "cross-access", version: "1" });
      try {
        await client.connect(new LineTransport(toClient, { write: (t) => toServer.write(t) }));
        const results = await Promise.all(
          needs.map((target) =>
            client.callTool({
              name: toolName("relation.add"),
              arguments: { source: WIND, kind: "derives-from", target },
            }),
          ),
        );
        expect(results.map((result) => result.isError === true)).toEqual(needs.map(() => false));
      } finally {
        toServer.end();
        await served;
        await client.close();
        await workspace.close();
      }
      const file = await fs.readFile(path.join(root, WIND_FILE), "utf8");
      expect(needs.filter((id) => !file.includes(id))).toEqual([]);
    }
    // The app: eight calls at once through its bridge.
    {
      const { root, needs } = await withNeeds(PARALLEL_CALLS);
      const app = connectApp(new Workspace(root));
      try {
        const results = await Promise.all(
          needs.map((target) =>
            app.bridge.invoke("relation.add", { source: WIND, kind: "derives-from", target }),
          ),
        );
        expect(results.map((result) => result.ok)).toEqual(needs.map(() => true));
      } finally {
        await app.close();
      }
      const file = await fs.readFile(path.join(root, WIND_FILE), "utf8");
      expect(needs.filter((id) => !file.includes(id))).toEqual([]);
    }
  });
});
