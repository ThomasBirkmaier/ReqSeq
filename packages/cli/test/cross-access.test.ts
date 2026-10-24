// Cross-access test (ADR-0002 rule 8, ADR-0011, SR-080): every catalog command runs through core `invoke`,
// the CLI, the local API and the MCP server on the same fixture workspace, and all four give the same
// result: the same output or the same error object, and the same files on disk afterwards. New catalog
// commands join automatically with a default scenario (input `{}`); add explicit scenarios below when a
// command is implemented.
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { startApiServer } from "@logreq/api";
import type { CatalogEntry, CommandName } from "@logreq/core";
import { CommandError, Workspace, createCommandRuntime } from "@logreq/core";
import { LineTransport, serveMcp, toolName } from "@logreq/mcp";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXIT, argvFor, runCli } from "../src/index.js";

/** The product catalog and implementations; outputs are checked against the catalog (vitest.config.ts). */
const runtime = createCommandRuntime();

interface Scenario {
  readonly name: string;
  /** The fixture workspace; default: SR-004/one-repository as one Git repository. */
  readonly fixture?: FixtureOptions;
  /** Folder of the workspace inside the fixture; default its root. */
  readonly root?: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** What core gives; guards against a scenario that only ever compares the same error. */
  readonly expect: "output" | "error";
  /**
   * The output names a new element with a random UUID: its UUID, the 12 and 6 digit tails (file name,
   * short ID) and its version are replaced by placeholders in the outcome and the files before comparing.
   */
  readonly newElement?: boolean;
}

const ONE_REPOSITORY: FixtureOptions = { fixture: "SR-004/one-repository", git: true };

/** Explicit scenarios per command, in addition to the default one with input `{}`. */
const SCENARIOS: Partial<Record<CommandName, readonly Scenario[]>> = {
  "element.create": [
    {
      name: "new element in a new folder",
      input: {
        type: "system-requirement",
        title: "Show gusts",
        text: "The station shows gusts.\n",
        folder: "requirements/new",
        properties: {
          "requirement-type": "functional",
          "acceptance-criteria": ["Given a gust, then it is shown."],
        },
      },
      expect: "output",
      newElement: true,
    },
    { name: "unknown type", input: { type: "nope", title: "x" }, expect: "error" },
  ],
  "element.setStatus": [
    { name: "approve one element", input: { refs: ["SR-e88fb3"], status: "approved" }, expect: "output" },
    {
      name: "status not in the metamodel",
      input: { refs: ["SR-e88fb3"], status: "released" },
      expect: "error",
    },
  ],
  "element.update": [
    {
      name: "rename and set a property",
      input: {
        ref: "SR-e88fb3",
        title: "Show the wind speed",
        text: "New text.\n",
        set: { rationale: "Pilots" },
      },
      expect: "output",
    },
    { name: "unknown reference", input: { ref: "SR-ffffff", title: "x" }, expect: "error" },
  ],
  // `path` is a localPath: the CLI makes it absolute from its current folder (the root here), API and MCP
  // take it relative to the root, so all four write into the same folder of their copy.
  "workspace.init": [
    {
      name: "new folder",
      fixture: { files: { "new/.keep": "" } },
      input: { path: "new", name: "New" },
      expect: "output",
    },
    {
      name: "root of call",
      fixture: { files: { ".keep": "" } },
      input: { path: ".", name: "New" },
      expect: "output",
    },
    { name: "existing workspace", input: { path: ".", name: "Again" }, expect: "error" },
  ],
  "workspace.status": [
    { name: "one repository", input: {}, expect: "output" },
    {
      name: "three repositories, one missing",
      fixture: { fixture: "SR-004/three-repositories", git: ["system", "product"], files: {} },
      root: "system",
      input: {},
      expect: "output",
    },
    {
      name: "metamodel missing (read-only)",
      fixture: {
        files: {
          "logreq-workspace.yaml":
            "logreq-workspace: 1\nname: No model\nrepositories:\n" +
            '  - { name: main, url: "git@example.com:main.git", main: true }\n' +
            "metamodel: { repository: main, path: model }\n",
        },
        git: true,
      },
      input: {},
      expect: "output",
    },
    { name: "unknown input field", input: { extra: 1 }, expect: "error" },
  ],
};

type Outcome = { readonly output: unknown } | { readonly error: unknown };

const errorOf = (error: unknown): unknown => (error instanceof CommandError ? error.toJSON() : error);

const viaCore = async (root: string, entry: CatalogEntry, input: object): Promise<Outcome> => {
  const workspace = new Workspace(root);
  try {
    return { output: await runtime.invoke(entry.name, input, { workspace }) };
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

/** Every fixture a scenario uses. Each is built once, because building one spawns `git` several times. */
const FIXTURES: readonly FixtureOptions[] = [
  ONE_REPOSITORY,
  ...Object.values(SCENARIOS).flatMap((list) =>
    list.flatMap((s) => (s.fixture === undefined ? [] : [s.fixture])),
  ),
];
const templates = new Map<FixtureOptions, FixtureWorkspace>();
const copies: string[] = [];
let cache: string;

// Building the templates spawns `git` four times per repository. On Windows runners that can take seconds.
beforeAll(async () => {
  cache = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-cross-access-"));
  for (const options of FIXTURES) {
    templates.set(options, await createFixtureWorkspace(options));
  }
}, 120_000);

afterAll(async () => {
  await Promise.all([...templates.values()].map((f) => f.cleanup()));
  templates.clear();
  await Promise.all(
    [cache, ...copies.splice(0)].map((folder) =>
      fs.rm(folder, { recursive: true, force: true, maxRetries: 3 }),
    ),
  );
});

/** The sample hooks of `git init`: half the files of a fixture, and no Git command of LogReq runs hooks. */
const isSampleHooks = (source: string): boolean =>
  path.basename(source) === "hooks" && path.basename(path.dirname(source)) === ".git";

/** A copy of a fixture: its top folder, and the workspace root in it. */
interface Copy {
  readonly top: string;
  readonly root: string;
}

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
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-cross-access-copy-")));
  copies.push(base);
  const top = path.join(base, "workspace");
  await fs.cp(template.root, top, { recursive: true, filter: (source) => !isSampleHooks(source) });
  return { top, root: scenario.root === undefined ? top : path.join(top, ...scenario.root.split("/")) };
};

/**
 * A test runs one command through all four accesses. A write command gets four copies. Each access may
 * read Git through a child process. On Linux and macOS a test takes well under a second. Process starts on
 * Windows runners vary from 0.1 s to more than 1 s, so the default limit of 5 s is too tight there. This
 * limit only catches a hang.
 */
const TEST_TIMEOUT = 30_000;

const ACCESSES = ["core", "cli", "api", "mcp"] as const;

/** The result of one access: its outcome, and the files of its copy afterwards. */
interface Result {
  readonly outcome: Outcome;
  readonly files: Record<string, string>;
}

/**
 * Run a scenario through all four accesses. A write command gets a fresh copy per access, so each one starts
 * from the same files. A read command, and a command without an implementation (it cannot write), share one
 * copy. Either way, the files of the copy are compared after each access.
 */
const runAll = async (entry: CatalogEntry, scenario: Scenario): Promise<Record<string, Result>> => {
  const unchanging = entry.effect === "read" || !runtime.commands.has(entry.name);
  const shared = unchanging ? await copy(scenario) : undefined;
  // The files of the untouched template: a read changes none of them, not even the same way on every access.
  const untouched = shared === undefined ? undefined : normalized(await filesOf(shared.top), shared.top);
  const results: Record<string, Result> = {};
  for (const access of ACCESSES) {
    const { top, root } = shared ?? (await copy(scenario));
    const input = { ...scenario.input };
    const outcome =
      access === "core"
        ? await viaCore(root, entry, input)
        : access === "cli"
          ? await viaCli(root, entry, input)
          : access === "api"
            ? await viaApi(root, entry, input, cache)
            : await viaMcp(root, entry, input);
    const result = normalized({ outcome, files: await filesOf(top) }, top) as Result;
    if (untouched !== undefined) {
      expect([access, result.files]).toEqual([access, untouched]);
    }
    results[access] = scenario.newElement === true ? maskNewElement(result) : result;
  }
  return results;
};

/** The id of the new element in `result` replaced everywhere by placeholders (see `Scenario.newElement`). */
const maskNewElement = (result: Result): Result => {
  const element = (result.outcome as { output?: { element?: { id?: string; version?: string } } }).output
    ?.element;
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

describe("cross-access: same result through core, CLI, API and MCP", { timeout: TEST_TIMEOUT }, () => {
  for (const entry of runtime.contracts.commands) {
    const explicit = SCENARIOS[entry.name as CommandName] ?? [];
    for (const scenario of [DEFAULT, ...explicit]) {
      it(`[SR-080/AK2] ${entry.name}, ${scenario.name}`, async () => {
        const results = await runAll(entry, scenario);
        const core = results["core"];
        if (scenario !== DEFAULT) {
          expect(Object.keys(core?.outcome ?? {})).toEqual([scenario.expect]);
        }
        expect(Object.keys(core?.files ?? {}).length).toBeGreaterThan(0);
        expect(results).toEqual({ core, cli: core, api: core, mcp: core });
      });
    }
  }

  it("has scenarios only for catalog commands", () => {
    const names = new Set(runtime.contracts.commands.map((e) => e.name));
    expect(Object.keys(SCENARIOS).filter((name) => !names.has(name))).toEqual([]);
  });
});

describe("every catalog command on every access", { timeout: TEST_TIMEOUT }, () => {
  it("[SR-080/AK1] is a CLI subcommand, an API route and an MCP tool (the app follows in stage 3)", async () => {
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
        expect.stringContaining(`Usage: logreq ${group} ${action} `),
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
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(names.map(toolName));
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
    await workspace.close();
  });
});
