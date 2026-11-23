// Cross-access test (ADR-0002 rule 8, ADR-0011, SR-080): every catalog command runs through core `invoke`,
// the CLI, the local API and the MCP server on the same fixture workspace, and all four give the same
// result: the same output or the same error object, and the same files on disk afterwards. New catalog
// commands join automatically with a default scenario (input `{}`); when a command is implemented, add its
// explicit scenarios in a module of its own, scenarios/<group>/<command>.ts (#527). Fixtures that more than
// one command uses are in fixtures.ts.
//
// This module is the harness. Vitest runs one test file in one worker, so the commands are split over the
// files commands-<part>.test.ts (`PARTS`), which run at the same time (#2440); a command whose group no part
// names runs in commands-other.test.ts, so a new command or group needs no change here.
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { startApiServer } from "@reqseq/api";
import type { CatalogEntry, CommandName, CommandRuntime } from "@reqseq/core";
import {
  CommandError,
  RECENT_WORKSPACES_FILE,
  Workspace,
  createCommandRuntime,
  jsonChunks,
  recentWorkspacesFolder,
  rememberWorkspace,
} from "@reqseq/core";
import { LineTransport, serveMcp, toolName } from "@reqseq/mcp";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, expect, vi } from "vitest";
import { stringify } from "yaml";
import { EXIT, argvFor, runCli } from "../../src/index.js";
import { YAML_OPTIONS, yamlPieces } from "../../src/render.js";
import { ONE_REPOSITORY } from "./fixtures.js";
import type { Copy, Outcome, Result, Scenario } from "./scenario.js";
import { SCENARIOS, TEMPLATE_SETUPS } from "./scenario.js";

export { SCENARIOS };

/** The product catalog and implementations; outputs are checked against the catalog (vitest.config.ts). */
export const runtime = createCommandRuntime();

/** Vite's `import.meta.glob`, which Vitest compiles to static imports; this package has no Vite types. */
interface GlobImportMeta {
  glob(pattern: string, options: { readonly eager: true }): Record<string, unknown>;
}
// Each module scenarios/<group>/<command>.ts registers the explicit scenarios of one command with
// `scenariosOf` (and the setup of its own fixtures with `templateSetup`). The glob finds them, so a new
// command adds a file and edits no shared one (#527); as the imports are static, `vitest related` finds the
// test files from a scenario module through this one. trace-check reads the tags of the same files, exactly
// one folder deep. Vite turns `Object.keys(import.meta.glob(...))` into the keys alone, without importing
// the modules, so the glob gets a variable of its own.
const loaded = (import.meta as unknown as GlobImportMeta).glob("./scenarios/*/*.ts", {
  eager: true,
});
/** The scenario modules, as `./scenarios/<group>/<command>.ts`. */
export const SCENARIO_MODULES = Object.keys(loaded);

/**
 * The command groups and single commands of each test file commands-<part>.test.ts but
 * commands-other.test.ts, which runs every other command. Chosen so that the files take about the same time
 * (#2440).
 */
export const PARTS: Readonly<Record<string, readonly string[]>> = {
  element: ["element", "relation"],
  html: ["html", "filter", "hint", "element.search"],
  baseline: ["baseline", "evidence"],
  trace: ["trace", "workspace", "reqif", "variant", "tool", "element.list"],
};

/** The part that names a group or command, else undefined. */
const partNaming = (name: string): string | undefined =>
  Object.entries(PARTS).find(([, names]) => names.includes(name))?.[0];

/** The part that runs a command: the part that names it, else the one that names its group, else `other`. */
export const partOf = (name: string): string =>
  partNaming(name) ?? partNaming(name.split(".")[0] ?? "") ?? "other";

/** The part of the test file at `url`, commands-<part>.test.ts. */
export const partOfFile = (url: string): string => {
  const part = /^commands-(.+)\.test\.ts$/.exec(path.basename(fileURLToPath(url)))?.[1];
  if (part === undefined || (part !== "other" && !(part in PARTS))) {
    throw new Error(`${url} is no file of a part`);
  }
  return part;
};

/** The catalog commands of a part, in catalog order. */
export const commandsOf = (part: string): readonly CatalogEntry[] =>
  runtime.contracts.commands.filter((entry) => partOf(entry.name) === part);

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

export const viaCore = async (
  root: string,
  entry: CatalogEntry,
  input: object,
  rt: CommandRuntime = runtime,
): Promise<Outcome> => {
  const workspace = new Workspace(root);
  try {
    const output = await rt.invoke(entry.name, input, { workspace });
    expectWholeText(entry.name, output);
    return { output };
  } catch (error) {
    return { error: errorOf(error) };
  } finally {
    await workspace.close();
  }
};

export class Sink {
  text = "";
  write(text: string): boolean {
    this.text += text;
    return true;
  }
}

export const viaCli = async (
  root: string,
  entry: CatalogEntry,
  input: Record<string, unknown>,
  rt: CommandRuntime = runtime,
): Promise<Outcome> => {
  const stdout = new Sink();
  const stderr = new Sink();
  const argv = [...argvFor(entry, input, rt.contracts.schemas), "--json", "--workspace", root];
  const code = await runCli({ argv, cwd: root, stdin: Readable.from([]), stdout, stderr, runtime: rt });
  return code === EXIT.ok || code === EXIT.findings
    ? { output: JSON.parse(stdout.text) as unknown }
    : { error: JSON.parse(stderr.text) as unknown };
};

export const viaApi = async (
  root: string,
  entry: CatalogEntry,
  input: object,
  cache: string,
  rt: CommandRuntime = runtime,
): Promise<Outcome> => {
  const workspace = new Workspace(root);
  const server = await startApiServer({ workspace, runtime: rt, cacheFolder: cache });
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

export const viaMcp = async (
  root: string,
  entry: CatalogEntry,
  input: Record<string, unknown>,
  rt: CommandRuntime = runtime,
): Promise<Outcome> => {
  const workspace = new Workspace(root);
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const served = serveMcp({
    runtime: rt,
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

/** The files that differ between two snapshots of a copy, except the tool's own under any `.reqseq/` folder. */
const changedBetween = (before: Record<string, string>, after: Record<string, string>): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((file) => !file.split("/").includes(".reqseq") && before[file] !== after[file])
    .sort();

const templates = new Map<FixtureOptions, FixtureWorkspace>();
const copies: string[] = [];
let cache = "";

/** The cache folder of the API servers of this test file. */
export const apiCache = (): string => cache;

/** The only command that changes the list of recent workspaces (SR-250 AK4). */
export const MARK_OPENED = "workspace.markOpened";

/** The text of the list of recent workspaces of this process, undefined when there is none. */
const listText = async (): Promise<string | undefined> =>
  fs.readFile(path.join(recentWorkspacesFolder(), RECENT_WORKSPACES_FILE), "utf8").catch(() => undefined);

/**
 * Templates built at the same time. Each one waits mostly for `git` to start; one after the other, the 70 of
 * them took over 120 s on a loaded windows-2025 runner (#423).
 */
const BUILD_CONCURRENCY = 8;

/**
 * Registers the hooks of a test file whose tests copy the fixtures of `scenarios`: the OS cache folder and a
 * template per fixture before the tests, their removal after them.
 */
export const useFixtures = (scenarios: Iterable<Scenario>): void => {
  // Every fixture of the file's scenarios, each once: building one spawns `git` several times, and many
  // scenarios share a fixture (a list with repeats built over a hundred, which ran past the hook timeout on
  // Windows, #304).
  const fixtures: readonly FixtureOptions[] = [
    ...new Set([
      ONE_REPOSITORY,
      ...[...scenarios].flatMap((s) => (s.fixture === undefined ? [] : [s.fixture])),
    ]),
  ];

  // Building the templates spawns `git` three times per repository. On Windows runners that can take seconds.
  // The OS cache folder (the model cache of every CLI command, SR-082) lies in a temporary folder on every OS.
  // The list of recent workspaces lies there too, with one entry from the start, so a command that
  // replaced or created it would be seen (SR-250 AK4, `listText`).
  let cacheHome = "";
  beforeAll(async () => {
    cacheHome = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-cache-home-"));
    for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
      vi.stubEnv(name, cacheHome);
    }
    await rememberWorkspace(path.join(cacheHome, "opened-before"), {
      now: new Date(Date.UTC(2026, 9, 27, 9)),
    });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await fs.rm(cacheHome, { recursive: true, force: true });
  });

  beforeAll(async () => {
    cache = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-cross-access-"));
    const queue = fixtures.values();
    const worker = async (): Promise<void> => {
      for (const options of queue) {
        const template = await createFixtureWorkspace(options);
        templates.set(options, template);
        await TEMPLATE_SETUPS.get(options)?.(template);
      }
    };
    await Promise.all(Array.from({ length: BUILD_CONCURRENCY }, worker));
  }, 120_000);

  // Removes the templates and the copies the tests left, after the removals `release` started. With all
  // copies left to this hook, about 1,900 Git work trees, it ran past 120 s on Windows (#304, #1862).
  afterAll(async () => {
    await Promise.all(releasing.splice(0));
    await Promise.all([...templates.values()].map((f) => f.cleanup()));
    templates.clear();
    await Promise.all(
      [cache, ...copies.splice(0)].map((folder) =>
        fs.rm(folder, { recursive: true, force: true, maxRetries: 3 }),
      ),
    );
  }, 120_000);
};

/**
 * A fresh copy of the scenario's fixture, Git repositories included. Copying the files is much cheaper
 * than building the fixture again with `git`. The copy has the same commits, so every access starts from
 * the same state.
 */
export const copy = async (scenario: Scenario): Promise<Copy> => {
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

/** The removals `release` started; `afterAll` waits for them. */
const releasing: Promise<void>[] = [];

/**
 * Starts removing a copy made by `copy` that no access needs any more, while the tests go on, so neither a
 * test nor the `afterAll` hook waits for it (#1862). A removal that fails (EBUSY or EPERM on Windows) leaves
 * the copy to `afterAll`.
 */
const release = ({ top }: Copy): void => {
  const base = path.dirname(top);
  releasing.push(
    fs.rm(base, { recursive: true, force: true, maxRetries: 3 }).then(
      () => {
        const index = copies.indexOf(base);
        if (index >= 0) {
          copies.splice(index, 1);
        }
      },
      () => undefined,
    ),
  );
};

/** The folders of a copy except Git's, as paths relative to the copy: an empty one is no file of `filesOf`. */
const foldersOf = async (top: string): Promise<string[]> =>
  (await fs.readdir(top, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => path.relative(top, path.join(e.parentPath, e.name)))
    .filter((relative) => !relative.split(path.sep).includes(".git"))
    .sort();

/**
 * A test runs one command through all four accesses. A write command gets up to four copies. Each access may
 * read Git through a child process. On Linux and macOS a test takes well under a second. Process starts on
 * Windows runners vary from 0.1 s to more than 1 s, so the default limit of 5 s is too tight there. This
 * limit only catches a hang. On the Windows runner of CI it is 60 s, as for every other test there
 * (vitest.config.ts, #701): a stall of 30 s timed out one test here in 158 Windows runs (#720).
 */
export const TEST_TIMEOUT = process.platform === "win32" && process.env["CI"] === "true" ? 60_000 : 30_000;

const ACCESSES = ["core", "cli", "api", "mcp"] as const;

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
 * Commands whose output says whether the copy has a usable cache folder (`recorded`, SR-228). Here only
 * the CLI opens the copy with its cache folder (as `reqseq` does), the other accesses without one, so
 * `recorded` is checked per access and then replaced, with the answer that says it, and the rest is compared. The same command with the
 * cache folder on every access, where an MCP session is itself a connection: agent-connections.test.ts.
 */
export const CACHE_FOLDER_STATE: ReadonlySet<string> = new Set(["workspace.agents"]);

/** `outcome` with its `recorded` replaced, after checking it is true for the CLI alone. */
const withoutRecorded = (access: string, outcome: Outcome): Outcome => {
  if (!("output" in outcome)) {
    return outcome;
  }
  const { recorded, ...rest } = outcome.output as { recorded?: unknown };
  expect([access, recorded]).toEqual([access, access === "cli"]);
  return { output: { ...rest, answer: "<answer>", recorded: "<recorded>" } };
};

/**
 * `outcome` of workspace.markOpened with its `opened` replaced, after checking it lies within the call
 * (ms): the time of the mark (SR-250 AK1).
 */
const withoutOpened = (access: string, outcome: Outcome, start: number, end: number): Outcome => {
  if (!("output" in outcome)) {
    return outcome;
  }
  const { opened, ...rest } = outcome.output as { opened?: unknown };
  const time = Date.parse(String(opened));
  expect([access, time >= start && time <= end]).toEqual([access, true]);
  return { output: { ...rest, opened: "<opened>" } };
};

/**
 * `called` of command `name` with what differs by call or access replaced (`GENERATED_AT_TOP`,
 * `CACHE_FOLDER_STATE`, `MARK_OPENED`).
 */
const comparable = (access: string, name: string, called: Outcome, start: number, end: number): Outcome =>
  GENERATED_AT_TOP.has(name)
    ? withoutGenerated(access, called, start, end)
    : CACHE_FOLDER_STATE.has(name)
      ? withoutRecorded(access, called)
      : name === MARK_OPENED
        ? withoutOpened(access, called, start, end)
        : called;

/**
 * `result` of baseline.create with the date of the baseline (output and file) replaced by `<date>`, after
 * checking it lies between `start` and `end` (ms); an error is left as it is.
 */
const withoutDate = (access: string, name: string, result: Result, start: number, end: number): Result => {
  if (name !== "baseline.create") {
    // baseline.changes and baseline.prepare name the date of a baseline file, written before the call.
    return result;
  }
  const date = (result.outcome as { output?: { baseline?: { date?: string } } }).output?.baseline?.date;
  if (date === undefined) {
    return result;
  }
  const time = Date.parse(date);
  expect([access, time >= Math.floor(start / 1000) * 1000 && time <= end]).toEqual([access, true]);
  return JSON.parse(JSON.stringify(result).split(date).join("<date>")) as Result;
};

/** The outcome of `entry` with `input` on the workspace at `root` through `access`. */
const via = (
  access: (typeof ACCESSES)[number],
  root: string,
  entry: CatalogEntry,
  input: Record<string, unknown>,
): Promise<Outcome> =>
  access === "core"
    ? viaCore(root, entry, input)
    : access === "cli"
      ? viaCli(root, entry, input)
      : access === "api"
        ? viaApi(root, entry, input, cache)
        : viaMcp(root, entry, input);

/** A fresh copy of the scenario's fixture, prepared. */
const preparedCopy = async (scenario: Scenario): Promise<Copy> => {
  const made = await copy(scenario);
  await scenario.prepare?.(made);
  return made;
};

/**
 * Run a scenario through all four accesses. A write command gets a fresh copy per access, so each one starts
 * from the same files; an access that left its copy as it found it (an error, mostly) hands it to the next
 * one, when the scenario has no `prepare` (it may not be repeatable on the same copy). A read command, and a
 * command without an implementation (it cannot write), share one copy. Either way, the files of the copy
 * are compared after each access. Each copy is removed once no access needs it (#1862).
 */
const runAll = async (
  entry: CatalogEntry,
  scenario: Scenario,
  accesses: readonly (typeof ACCESSES)[number][],
): Promise<Record<string, Result>> => {
  const unchanging = entry.effect === "read" || !runtime.commands.has(entry.name);
  const shared = unchanging ? await preparedCopy(scenario) : undefined;
  // The files of the prepared template: a read changes none of them, not even the same way on every access.
  const untouched = shared === undefined ? undefined : normalized(await filesOf(shared.top), shared.top);
  const results: Record<string, Result> = {};
  // The copy of the running access, and one the last access left unchanged; both released at the end.
  let current: Copy | undefined;
  let unchanged: Copy | undefined;
  try {
    for (const access of accesses) {
      results[access] = await runAccess(access);
    }
  } finally {
    for (const each of new Set([shared, current, unchanged])) {
      if (each !== undefined) {
        release(each);
      }
    }
  }
  return results;

  async function runAccess(access: (typeof ACCESSES)[number]): Promise<Result> {
    const made = shared ?? unchanged ?? (await copy(scenario));
    current = shared === undefined ? made : undefined;
    unchanged = undefined;
    const { top, root } = made;
    await scenario.prepare?.({ top, root });
    const before = await filesOf(top);
    const foldersBefore = shared === undefined ? await foldersOf(top) : [];
    const input = { ...scenario.input };
    const list = await listText();
    const start = Date.now();
    const called = await via(access, root, entry, input);
    const end = Date.now();
    if (entry.name !== MARK_OPENED) {
      expect([access, entry.name, await listText()]).toEqual([access, entry.name, list]);
    }
    await scenario.after?.(made, access);
    const outcome = comparable(access, entry.name, called, start, end);
    // A data file of data.store holds no time of the call (#319): its bytes are compared as they are.
    const files = await filesOf(top);
    const changed = changedBetween(before, files);
    const result = withoutDate(
      access,
      entry.name,
      normalized({ outcome, files, changed }, top) as Result,
      start,
      end,
    );
    if (untouched !== undefined) {
      expect([access, result.files]).toEqual([access, untouched]);
    }
    if (shared === undefined) {
      const same =
        scenario.prepare === undefined &&
        JSON.stringify(files) === JSON.stringify(before) &&
        JSON.stringify(await foldersOf(top)) === JSON.stringify(foldersBefore);
      current = undefined;
      if (same) {
        unchanged = made;
      } else {
        release(made);
      }
    }
    const masked = masks(result, scenario.masks ?? []);
    const named = scenario.newElement === true ? maskNewElement(masked) : masked;
    // Sorted again: the order of new files followed their random UUIDs before the mask.
    return { ...named, changed: [...named.changed].sort() };
  }
};

/** `result` with each match of `patterns` replaced by `<masked>` (see `Scenario.masks`). */
const masks = (result: Result, patterns: readonly RegExp[]): Result =>
  patterns.length === 0
    ? result
    : (JSON.parse(
        patterns.reduce((text, pattern) => text.replace(pattern, "<masked>"), JSON.stringify(result)),
      ) as Result);

/** The id of the new element in `result` replaced everywhere by placeholders (see `Scenario.newElement`). */
export const maskNewElement = (result: Result): Result => {
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
      text = maskTail(
        maskTail(text.split(id).join(`<id${String(index)}>`), tail.slice(-12), `<tail12-${String(index)}>`),
        tail.slice(-6),
        `<tail6-${String(index)}>`,
      );
    }
    return JSON.parse(text) as Result;
  }
  const element = output?.element;
  if (element?.id === undefined || element.version === undefined) {
    return result;
  }
  const digits = element.id.replaceAll("-", "");
  const text = JSON.stringify(result).split(element.id).join("<id>").split(element.version).join("<version>");
  return JSON.parse(
    maskTail(maskTail(text, digits.slice(-12), "<tail12>"), digits.slice(-6), "<tail6>"),
  ) as Result;
};

/**
 * `text` with `tail` replaced by `placeholder` where it ends a short ID or a file name: after a dash and not
 * followed by another hex digit (`SR-<tail>`, D-017, D-056). The same digits elsewhere, such as in the text of an
 * imported file, stay (#1654).
 */
const maskTail = (text: string, tail: string, placeholder: string): string =>
  text.replace(new RegExp(`(?<=-)${tail}(?![0-9a-f])`, "g"), placeholder);

export const DEFAULT: Scenario = { name: "default input {}", input: {}, expect: "output" };

/**
 * The scenario that shows the answer of a command (SR-224): its first explicit one that gives an
 * output, else the default one.
 */
export const answerScenario = (name: string): Scenario =>
  (SCENARIOS.get(name as CommandName) ?? []).find((s) => s.expect === "output") ?? DEFAULT;

/** Words that name a time relative to reading the sentence, which an answer never has (SR-224 AK1). */
const RELATIVE_TIME =
  /\b(now|today|yesterday|tomorrow|ago|recently|currently|just|soon|still|yet|anymore|meanwhile)\b/i;

/** The answer of an outcome; undefined for an error. */
const answerOf = (outcome: Outcome | undefined): unknown =>
  outcome !== undefined && "output" in outcome
    ? (outcome.output as Readonly<Record<string, unknown>>)["answer"]
    : undefined;

/**
 * The tests of the file of a part: each command of the part with its default and explicit scenarios, and the
 * commands whose answer it checks, all but `CACHE_FOLDER_STATE` (their answer says `recorded`, which differs
 * here by access: agent-connections.test.ts).
 */
export const casesOf = (
  part: string,
): {
  readonly scenarios: readonly { readonly entry: CatalogEntry; readonly scenario: Scenario }[];
  readonly answers: readonly CatalogEntry[];
} => {
  const commands = commandsOf(part);
  return {
    scenarios: commands.flatMap((entry) =>
      [DEFAULT, ...(SCENARIOS.get(entry.name as CommandName) ?? [])].map((scenario) => ({ entry, scenario })),
    ),
    answers: commands.filter(({ name }) => !CACHE_FOLDER_STATE.has(name)),
  };
};

/**
 * Runs a scenario through all four accesses and expects the same result. Every call but those of
 * workspace.markOpened also shows that the list of recent workspaces stays as it is (`runAccess`, SR-250 AK4).
 */
export const expectSameResult = async (entry: CatalogEntry, scenario: Scenario): Promise<void> => {
  const results = await runAll(entry, scenario, ACCESSES);
  const core = results["core"];
  if (scenario !== DEFAULT) {
    expect(Object.keys(core?.outcome ?? {})).toEqual([scenario.expect]);
  }
  expect(Object.keys(core?.files ?? {}).length).toBeGreaterThan(0);
  expect(results).toEqual({ core, cli: core, api: core, mcp: core });
  scenario.check?.(results);
};

/** Runs the answer scenario of a command through all four accesses and expects the same answer (SR-224 AK1). */
export const expectSameAnswer = async (entry: CatalogEntry): Promise<void> => {
  const results = await runAll(entry, answerScenario(entry.name), ACCESSES);
  const core = results["core"]?.outcome;
  // One English sentence first in the output, the same characters through every access.
  const answer = answerOf(core);
  expect(Object.keys((core as { output?: object } | undefined)?.output ?? {})[0]).toBe("answer");
  expect([answer, typeof answer === "string" && /^\S[^\n\r]*\.$/.test(answer)]).toEqual([answer, true]);
  expect(String(answer)).not.toMatch(RELATIVE_TIME);
  expect(["cli", "api", "mcp"].map((access) => answerOf(results[access]?.outcome))).toEqual([
    answer,
    answer,
    answer,
  ]);
};
