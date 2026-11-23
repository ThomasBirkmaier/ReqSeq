// Cross-access test (SR-080) of the commands of every group that no other part names (harness.ts, `PARTS`),
// and the checks that span the whole catalog: every command on every access, JSON Lines, the text output,
// the answer in the text output, write calls at the same time, an internal error, and the split itself.
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { startApiServer } from "@reqseq/api";
import type { CommandName, CommandRuntime } from "@reqseq/core";
import { Workspace, createCommandRuntime, defineTestCommand, jsonLines, loadContracts } from "@reqseq/core";
import { LineTransport, serveMcp, toolName } from "@reqseq/mcp";
import { Client } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { EXIT, argvFor, runCli } from "../../src/index.js";
import { outcomeExitCode, renderProblem } from "../../src/render.js";
import { EXPORT } from "./fixtures.js";
import type { Result } from "./scenario.js";
import {
  DEFAULT,
  MARK_OPENED,
  PARTS,
  SCENARIOS,
  SCENARIO_MODULES,
  Sink,
  TEST_TIMEOUT,
  apiCache,
  answerScenario,
  casesOf,
  copy,
  expectSameAnswer,
  expectSameResult,
  maskNewElement,
  partOf,
  partOfFile,
  runtime,
  useFixtures,
  viaApi,
  viaCli,
  viaCore,
  viaMcp,
} from "./harness.js";

/** Vite's `import.meta.glob`, which Vitest compiles to static imports; this package has no Vite types. */
interface GlobImportMeta {
  glob(pattern: string): Record<string, unknown>;
}

/** The commands with a text output (SR-151). */
const TEXT_COMMANDS = runtime.contracts.commands.filter((e) => e.textOutput !== undefined);

const { scenarios, answers } = casesOf(partOfFile(import.meta.url));
// Besides the commands of this part, the tests below copy the answer scenario of every command (SR-224 AK2), the
// output scenarios of the commands with a text output (SR-151) and the data export fixture (#319).
useFixtures([
  ...scenarios.map(({ scenario }) => scenario),
  ...runtime.contracts.commands.map(({ name }) => answerScenario(name)),
  ...TEXT_COMMANDS.flatMap(({ name }) => SCENARIOS.get(name as CommandName) ?? []),
  { ...DEFAULT, fixture: EXPORT },
]);

describe("cross-access: same result through core, CLI, API and MCP", { timeout: TEST_TIMEOUT }, () => {
  for (const { entry, scenario } of scenarios) {
    it(`${scenario.tag ?? "[SR-080/AK-bb1t]"}${entry.name === MARK_OPENED ? "" : " [SR-250/AK-vp6h]"} ${entry.name}, ${scenario.name}`, () =>
      expectSameResult(entry, scenario));
  }

  it("has scenarios only for catalog commands", () => {
    const names = new Set(runtime.contracts.commands.map((e) => e.name));
    expect([...SCENARIOS.keys()].filter((name) => !names.has(name))).toEqual([]);
    // Each module registers the command its path names, so none is loaded without scenarios.
    const byPath = SCENARIO_MODULES.map((file) =>
      file.replace(/^\.\/scenarios\/([^/]+)\/([^/]+)\.ts$/, "$1.$2"),
    );
    expect([...SCENARIOS.keys()].sort()).toEqual(byPath.sort());
  });

  it("runs every catalog command in exactly one test file (#2440)", () => {
    // `partOf` gives each command one part; each part has its file, and each file runs the part its name
    // names (`partOfFile`), so no command falls between the files.
    const files = Object.keys((import.meta as unknown as GlobImportMeta).glob("./commands-*.test.ts")).map(
      (file) => /^\.\/commands-(.+)\.test\.ts$/.exec(file)?.[1],
    );
    // The glob leaves out the file it is in.
    expect([...new Set([...files, partOfFile(import.meta.url)])].sort()).toEqual(
      [...Object.keys(PARTS), "other"].sort(),
    );
    // A part names only groups and commands of the catalog, each in one part, and runs at least one command.
    const names = new Set(runtime.contracts.commands.flatMap(({ name }) => [name, name.split(".")[0]]));
    const named = Object.values(PARTS).flat();
    expect(named.filter((name) => !names.has(name))).toEqual([]);
    expect(named.length).toBe(new Set(named).size);
    const parts = new Set(runtime.contracts.commands.map(({ name }) => partOf(name)));
    expect([...Object.keys(PARTS), "other"].filter((part) => !parts.has(part))).toEqual([]);
  });
});

describe("cross-access: the answer (SR-224 AK1)", { timeout: TEST_TIMEOUT }, () => {
  for (const entry of answers) {
    it(`[SR-224/AK-cw40] ${entry.name} gives the same answer through core, the CLI, the API and MCP`, () =>
      expectSameAnswer(entry));
  }
});

describe("every catalog command on every access", { timeout: TEST_TIMEOUT }, () => {
  it("[SR-080/AK-wxtg] is a CLI subcommand, an API route and, once implemented, an MCP tool", async () => {
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
    // MCP lists only the implemented commands (ThomasBirkmaier/ReqSeq-archive#303): an agent puts the whole list into its context. A call to
    // one that is not listed still gives command.not-implemented, as every access (the default scenario of each command).
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(names.filter((n) => runtime.commands.has(n)).map(toolName));
    toServer.end();
    await served;
    await client.close();
    const server = await startApiServer({ workspace, runtime, cacheFolder: apiCache() });
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

  it("[SR-080/AK-wxtg] has no top-level CLI command outside the catalog but those that start a server", async () => {
    // Starting an access, the web UI or the documentation service is no function (SR-080 AK1): `serve` (`api`,
    // `docs`), `mcp` and `ui` (SR-247) are the only CLI commands without a catalog entry, besides commander's
    // `help`.
    const stdout = new Sink();
    const code = await runCli({
      argv: ["--help"],
      cwd: os.tmpdir(),
      stdin: Readable.from([]),
      stdout,
      stderr: new Sink(),
      runtime,
    });
    expect(code).toBe(EXIT.ok);
    const listed = (stdout.text.split("\nCommands:\n")[1] ?? "")
      .split("\n")
      .flatMap((line) => /^ {2}([a-z][\w-]*)/.exec(line)?.[1] ?? []);
    const groups = new Set(runtime.contracts.commands.map((entry) => argvFor(entry, {})[0] ?? ""));
    expect(listed.filter((name) => !groups.has(name))).toEqual(["serve", "mcp", "ui", "help"]);
    expect([...groups].filter((group) => !listed.includes(group))).toEqual([]);
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
  const server = await startApiServer({ workspace, runtime, cacheFolder: apiCache() });
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
  it("[SR-061/AK-h1db] the CLI with --jsonl and the API with application/x-ndjson give the same lines, those of the core output", async () => {
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

describe("cross-access: text output (SR-151)", { timeout: TEST_TIMEOUT }, () => {
  it("[SR-151/AK-c801] the CLI without options prints exactly the text of core, API and MCP, and the problems only on stderr, after the answer of an output with more than the text", async () => {
    const texts = runtime.contracts.commands.filter((e) => e.textOutput !== undefined);
    expect(texts.map((e) => e.name).sort()).toEqual(["metamodel.mermaid", "tool.guide", "trace.mermaid"]);
    for (const entry of texts) {
      const field = entry.textOutput ?? "";
      for (const scenario of (SCENARIOS.get(entry.name as CommandName) ?? []).filter(
        (each) => each.expect === "output",
      )) {
        const { root } = await copy(scenario);
        const core = (await viaCore(root, entry, scenario.input)) as { output: Record<string, unknown> };
        const text = core.output[field];
        // tool.guide has no problems (SR-229): the guide itself names why it lacks facts.
        const problems = ((core.output["problems"] ?? []) as unknown[]).map((problem) =>
          renderProblem(problem),
        );
        const stdout = new Sink();
        const stderr = new Sink();
        const argv = [...argvFor(entry, scenario.input, runtime.contracts.schemas), "--workspace", root];
        const code = await runCli({ argv, cwd: root, stdin: Readable.from([]), stdout, stderr, runtime });
        // An output with more than the text, such as the places of the skill file (SR-229 AK8), also gives its
        // answer on stderr, first: the answer of core on the copy as the CLI finds it, after core wrote there.
        const more = Object.keys(core.output).some((key) => ![field, "answer", "problems"].includes(key));
        const answer = more
          ? `${String(((await viaCore(root, entry, scenario.input)) as { output: Record<string, unknown> }).output["answer"])}\n`
          : "";
        expect([scenario.name, code, stdout.text, stderr.text]).toEqual([
          scenario.name,
          outcomeExitCode(core.output),
          text,
          `${answer}${problems.join("")}`,
        ]);
        for (const outcome of [
          await viaApi(root, entry, scenario.input, apiCache()),
          await viaMcp(root, entry, scenario.input),
        ]) {
          expect([scenario.name, (outcome as { output: Record<string, unknown> }).output[field]]).toEqual([
            scenario.name,
            text,
          ]);
        }
      }
    }
  });
});

describe("cross-access: the answer in the text output (SR-224 AK2)", { timeout: TEST_TIMEOUT }, () => {
  it("[SR-224/AK-tjmm] the CLI without options prints the answer of core as its first line, except for a format", async () => {
    let shown = 0;
    for (const entry of runtime.contracts.commands) {
      const scenario = answerScenario(entry.name);
      const { top, root } = await copy(scenario);
      await scenario.prepare?.({ top, root });
      // The output core gave this very call, so a new element's random UUID is the same on both sides.
      const outputs: unknown[] = [];
      const recording: CommandRuntime = {
        ...runtime,
        invoke: async (name, input, context) => {
          const output = await runtime.invoke(name, input, context);
          outputs.push(output);
          return output;
        },
      };
      const stdout = new Sink();
      const stderr = new Sink();
      const argv = [...argvFor(entry, { ...scenario.input }, runtime.contracts.schemas), "--workspace", root];
      await runCli({ argv, cwd: root, stdin: Readable.from([]), stdout, stderr, runtime: recording });
      const [output] = outputs as Readonly<Record<string, unknown>>[];
      if (output === undefined) {
        continue;
      }
      const answer = output["answer"];
      expect([entry.name, typeof answer]).toEqual([entry.name, "string"]);
      if (entry.textOutput === undefined) {
        expect([entry.name, stdout.text.split("\n")[0]]).toEqual([entry.name, answer]);
      } else {
        // A format such as Mermaid stays the text alone (SR-151 AK4).
        expect([entry.name, stdout.text]).toEqual([entry.name, output[entry.textOutput]]);
        expect(stdout.text).not.toContain(String(answer));
      }
      shown++;
    }
    expect(shown).toBe(runtime.contracts.commands.length);
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
  it("[SR-166/AK-p44g] the API and the MCP server keep every relation that eight relation.add calls at once report", async () => {
    // The API: eight requests at once.
    {
      const { root, needs } = await withNeeds(PARALLEL_CALLS);
      const workspace = new Workspace(root);
      const server = await startApiServer({ workspace, runtime, cacheFolder: apiCache() });
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
  });
});

/** A runtime with one test command that fails with an error that is no CommandError, as `fs` throws it. */
const crashing = createCommandRuntime({
  contracts: loadContracts({
    catalog: {
      "reqseq-catalog": 1,
      commands: [
        {
          name: "test.crash",
          title: "Test command",
          summary: "Fails with a file system error (test only).",
          effect: "read",
          stage: 1,
          implements: ["SR-080"],
          arguments: [],
          input: { type: "object", additionalProperties: false },
          output: { type: "object" },
        },
        // The MCP server takes its instructions from tool.guide before it serves (SR-229).
        {
          name: "tool.guide",
          title: "Agent guide",
          summary: "The guide for an agent (test only).",
          effect: "read",
          stage: 1,
          implements: ["SR-229"],
          arguments: [],
          input: { type: "object" },
          output: { type: "object" },
        },
      ],
    },
  }),
  commands: [
    defineTestCommand({ name: "tool.guide", run: () => Promise.resolve({ guide: "Test guide" }) }),
    defineTestCommand<Record<string, never>, unknown>({
      name: "test.crash",
      run: (ctx) => {
        const missing = path.join(ctx.workspace.root, "gone", "file.yaml");
        return Promise.reject(
          Object.assign(new Error(`ENOENT: no such file or directory, open '${missing}'\n    at open`), {
            code: "ENOENT",
            path: missing,
          }),
        );
      },
    }),
  ],
});

describe("cross-access: the cause of an internal error (#1794)", { timeout: TEST_TIMEOUT }, () => {
  it("is the same error object through core, CLI, API and MCP, without absolute paths", async () => {
    const { root } = await copy(DEFAULT);
    const [entry] = crashing.contracts.commands;
    if (entry === undefined) {
      throw new Error("no test command");
    }
    const outcomes = {
      core: await viaCore(root, entry, {}, crashing),
      cli: await viaCli(root, entry, {}, crashing),
      api: await viaApi(root, entry, {}, apiCache(), crashing),
      mcp: await viaMcp(root, entry, {}, crashing),
    };
    const error = {
      code: "internal",
      message: "Internal error in test.crash",
      details: {
        command: "test.crash",
        cause: {
          name: "Error",
          code: "ENOENT",
          message: "ENOENT: no such file or directory, open '<workspace>/gone/file.yaml'",
        },
      },
    };
    expect(outcomes).toEqual({
      core: { error },
      cli: { error },
      api: { error },
      mcp: { error },
    });
  });
});

describe("cross-access: masking a new element (#1654)", () => {
  it("masks the tails of a short ID and a file name, not the same digits in the text of a file", () => {
    const id = "12345678-1234-4123-8123-abcdef011040";
    const namespace = "http://www.omg.org/spec/ReqIF/20110401/reqif.xsd";
    const result: Result = {
      outcome: { output: { created: [{ id, shortId: "SR-011040" }] } },
      files: { "SR/SR-abcdef011040.md": `id: ${id}\n`, "in/all.reqif": `<REQ-IF xmlns="${namespace}"/>` },
      changed: ["SR/SR-abcdef011040.md"],
    };
    expect(maskNewElement(result)).toEqual({
      outcome: { output: { created: [{ id: "<id0>", shortId: "SR-<tail6-0>" }] } },
      files: { "SR/SR-<tail12-0>.md": "id: <id0>\n", "in/all.reqif": `<REQ-IF xmlns="${namespace}"/>` },
      changed: ["SR/SR-<tail12-0>.md"],
    });
  });
});
