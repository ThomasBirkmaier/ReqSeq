import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { CommandRuntime } from "@logreq/core";
import {
  PRODUCT_VERSION,
  CommandError,
  createCommandRuntime,
  defineTestCommand,
  defineWorkspaceState,
  loadContracts,
} from "@logreq/core";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { RunCliOptions } from "./main.js";
import { argvFor } from "./argv.js";
import { EXIT, exitCodeFor, runCli, writePieces } from "./main.js";
import { YAML_OPTIONS } from "./render.js";
import { stringify } from "yaml";

// Test-only catalog: every field form the CLI knows, findings, errors and an unimplemented command.
const entry = (name: string, input: Record<string, unknown>, summary = `Test command ${name}.`) => ({
  name,
  title: "Test command",
  summary,
  effect: "read",
  stage: 1,
  implements: ["SR-080"],
  arguments: [],
  input: { type: "object", additionalProperties: false, ...input },
  output: { type: "object" },
});

const catalog = {
  "logreq-catalog": 1,
  commands: [
    entry("test.echo", {
      properties: {
        ref: { $ref: "../common.schema.json#/$defs/elementRef", description: "Element to echo." },
        name: { type: "string" },
        count: { type: "integer", minimum: 0 },
        verbose: { type: "boolean" },
        version: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        checks: { type: "array", items: { type: "boolean" } },
        level: { enum: ["low", "high"], default: "low" },
        selection: { $ref: "../common.schema.json#/$defs/selection" },
        file: { $ref: "../common.schema.json#/$defs/localPath" },
        note: { type: ["string", "null"] },
      },
      required: ["ref", "name"],
    }),
    entry("test.findings", { properties: { mode: { enum: ["clean", "warning", "error", "failed"] } } }),
    entry("test.fail", { properties: { code: { type: "string" } }, required: ["code"] }),
    entry("test.root", { properties: {} }),
    entry("test.closeFails", { properties: { fail: { type: "boolean" } } }),
    entry("test.wait", { properties: {} }),
    entry("test.large", { properties: {} }),
    entry("test.setStatus", { properties: {} }, "Planned, never implemented in this test."),
    entry("other.ping", { properties: {} }),
  ],
};

const failingState = defineWorkspaceState("fails-on-close", () => 1, {
  dispose: () => {
    throw new Error("dispose failed at /secret/path");
  },
});

const findings: Record<string, unknown> = {
  clean: { ok: true, problems: [] },
  warning: {
    ok: true,
    problems: [{ code: "file.yaml-warning", severity: "warning", message: "Größe", file: "a.md" }],
  },
  error: {
    ok: false,
    problems: [{ code: "file.invalid-yaml", severity: "error", message: "bad", file: "b.md", line: 2 }],
  },
  failed: { ok: false, problems: [] },
};

/** About 3 MB of JSON (#277): more than one chunk. */
const LARGE = {
  items: Array.from({ length: 30_000 }, (_, n) => ({ n, text: `Größe ${"x".repeat(60)}`, tags: ["a"] })),
};

const testCommands = [
  defineTestCommand({ name: "test.large", run: () => Promise.resolve(LARGE) }),
  defineTestCommand({
    name: "test.echo",
    run: (_ctx, input: Record<string, unknown>) => Promise.resolve({ input }),
  }),
  defineTestCommand({
    name: "test.findings",
    run: (_ctx, input: { mode?: string }) => Promise.resolve(findings[input.mode ?? "clean"]),
  }),
  defineTestCommand({
    name: "test.fail",
    run: (_ctx, input: { code: string }) => {
      if (input.code === "crash") {
        throw new Error("crash with /secret/path");
      }
      throw new CommandError(input.code as "element.not-found", `Failed with ${input.code}`, {
        code: input.code,
      });
    },
  }),
  defineTestCommand({ name: "test.root", run: (ctx) => Promise.resolve({ root: ctx.workspace.root }) }),
  defineTestCommand({
    name: "test.closeFails",
    run: (ctx, input: { fail?: boolean }) => {
      const state = ctx.workspace.get(failingState);
      return input.fail === true
        ? Promise.reject(new CommandError("element.read-only", "The command's own error"))
        : Promise.resolve({ state });
    },
  }),
  defineTestCommand({
    name: "test.wait",
    // Called with an aborted signal only: stops at once, like a command checking its signal.
    run: (ctx) => {
      ctx.signal.throwIfAborted();
      return Promise.resolve({});
    },
  }),
  defineTestCommand({ name: "other.ping", run: () => Promise.resolve({}) }),
];

const runtime = createCommandRuntime({
  contracts: loadContracts({ catalog }),
  commands: testCommands,
  validateOutput: true,
});

class Sink {
  text = "";
  write(text: string): boolean {
    this.text += text;
    return true;
  }
}

interface Result {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

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

const fixtures: FixtureWorkspace[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((f) => f.cleanup()));
});

const fixture = async (files: Record<string, string> = {}): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({ files });
  fixtures.push(ws);
  return ws;
};

/** Run with the test runtime, or with the runtime of the process when `processRuntime` is set. */
const run = async (
  argv: string[],
  options: Partial<RunCliOptions> & { readonly processRuntime?: boolean } = {},
): Promise<Result> => {
  const stdout = new Sink();
  const stderr = new Sink();
  const { processRuntime = false, ...rest } = options;
  const base = { argv, cwd: options.cwd ?? (await fixture()).root, stdin: Readable.from([]), stdout, stderr };
  const code = await runCli(processRuntime ? { ...base, ...rest } : { ...base, runtime, ...rest });
  return { code, stdout: stdout.text, stderr: stderr.text };
};

const ref = "SR-46fb54";

describe("logreq help and version", () => {
  it("prints the product version", async () => {
    const result = await run(["--version"]);
    expect(result).toEqual({ code: EXIT.ok, stdout: `${PRODUCT_VERSION}\n`, stderr: "" });
  });

  it("lists the groups of the catalog", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("Usage: logreq [options] [command]");
    expect(result.stdout).toMatch(/test <action> \[options\]\s+test commands/);
    expect(result.stdout).toMatch(/other <action> \[options\]\s+other commands/);
  });

  it("lists the commands of a group in kebab-case, unimplemented ones marked", async () => {
    const result = await run(["test", "--help"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toMatch(/echo <ref> <name> \[options\]\s+Test command test\.echo\.\n/);
    expect(result.stdout).toMatch(/close-fails \[options\]/);
    expect(result.stdout).toContain("set-status [options]");
    expect(result.stdout).toMatch(/Planned, never implemented in this test\. \(not\s+implemented yet\)/);
  });

  it("shows the arguments and options of a command", async () => {
    const result = await run(["test", "echo", "--help"]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toContain("Usage: logreq test echo <ref> <name> [options]");
    expect(result.stdout).toMatch(/ref\s+Element to echo\./);
    expect(result.stdout).toMatch(/--count <number>/);
    expect(result.stdout).toMatch(/--verbose\s/);
    expect(result.stdout).toMatch(/--no-verbose\s+set verbose to false/);
    expect(result.stdout).toMatch(/--tags <value>\s+repeatable/);
    expect(result.stdout).toMatch(/--level <value>\s+one of: low, high; default: "low"/);
    expect(result.stdout).toMatch(/--note <value>\s+null only via --input/);
    expect(result.stdout).toMatch(/--input <json\|@file\|->/);
    expect(result.stdout).toMatch(/--workspace <path>/);
    expect(result.stdout).toMatch(/--json\s/);
    expect(result.stdout).toContain("Only via --input: selection");
    const plain = await run(["test", "root", "--help"]);
    expect(plain.stdout).not.toContain("Only via --input");
  });

  it("treats a missing or unknown command or option as usage error", async () => {
    for (const argv of [
      [],
      ["test"],
      ["nope"],
      ["test", "nope"],
      ["test", "root", "--nope"],
      ["test", "root", "x"],
    ]) {
      const result = await run(argv);
      expect(result.code, argv.join(" ")).toBe(EXIT.usage);
      expect(result.stdout, argv.join(" ")).toBe("");
      expect(result.stderr, argv.join(" ")).not.toBe("");
    }
  });

  it("takes program options only before the command", async () => {
    expect((await run(["--json", "test", "root"])).code).toBe(EXIT.usage);
  });
});

describe("logreq <group> <action>", () => {
  it("passes positional arguments and flags as command input", async () => {
    const result = await run([
      "test",
      "echo",
      ref,
      "Größe 測試",
      "--count",
      "3",
      "--verbose",
      "--tags",
      "a",
      "--tags",
      "b",
      "--version",
      "n1:0123456789abcdef",
      "--level",
      "high",
      "--json",
    ]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(EXIT.ok);
    expect(JSON.parse(result.stdout)).toEqual({
      input: {
        ref,
        name: "Größe 測試",
        count: 3,
        verbose: true,
        version: "n1:0123456789abcdef",
        tags: ["a", "b"],
        level: "high",
      },
    });
  });

  it("passes its access to core, which records no command-line call (SR-117, #481)", async () => {
    const spy = vi.spyOn(runtime, "invoke");
    try {
      await run(["test", "echo", ref, "n", "--json"]);
      expect(spy.mock.calls.at(-1)?.[2]).toMatchObject({ access: "cli" });
    } finally {
      spy.mockRestore();
    }
  });

  it("fills defaults and false booleans through core", async () => {
    const result = await run(["test", "echo", ref, "n", "--no-verbose", "--json"]);
    expect(JSON.parse(result.stdout)).toEqual({ input: { ref, name: "n", verbose: false, level: "low" } });
  });

  it("takes complex fields from --input; positional values fill the fields it does not give", async () => {
    const ws = await fixture({
      "in.json": JSON.stringify({ ref: "SR-111111", selection: { ids: [ref] }, count: 1 }),
    });
    const result = await run(
      ["test", "echo", "from argument", "--count", "2", "--input", "@in.json", "--json"],
      {
        cwd: ws.root,
      },
    );
    expect(JSON.parse(result.stdout)).toEqual({
      input: { ref: "SR-111111", name: "from argument", selection: { ids: [ref] }, count: 2, level: "low" },
    });
    const stdin = await run(["test", "echo", "--input", "-", "--json"], {
      stdin: Readable.from([JSON.stringify({ ref, name: "from stdin" })]),
    });
    expect(JSON.parse(stdin.stdout)).toEqual({ input: { ref, name: "from stdin", level: "low" } });
  });

  it("renders the output for people by default", async () => {
    const result = await run(["test", "echo", ref, "n"]);
    expect(result).toEqual({
      code: EXIT.ok,
      stdout: `input:\n  ref: ${ref}\n  name: n\n  level: low\n`,
      stderr: "",
    });
  });

  it("prints the whole output as YAML with --yaml, and refuses --yaml with --json", async () => {
    const yaml = await run(["test", "findings", "--mode", "warning", "--yaml"]);
    expect(yaml).toEqual({
      code: EXIT.ok,
      stdout: "ok: true\nwarning  file.yaml-warning  a.md  Größe\n",
      stderr: "",
    });
    const both = await run(["test", "findings", "--yaml", "--json"]);
    expect(both.code).toBe(EXIT.usage);
    expect(JSON.parse(both.stderr)).toMatchObject({ code: "input.invalid" });
  });

  it("takes a positional field as a flag too, and fills the other positional fields with the arguments (#310)", async () => {
    const help = await run(["test", "echo", "--help"]);
    expect(help.stdout).toMatch(/--name <value>\s+instead of the argument <name>/);
    const flagged = await run(["test", "echo", ref, "--name", "from flag", "--json"]);
    expect(JSON.parse(flagged.stdout)).toEqual({ input: { ref, name: "from flag", level: "low" } });
    const first = await run(["test", "echo", "--ref", ref, "second", "--json"]);
    expect(JSON.parse(first.stdout)).toEqual({ input: { ref, name: "second", level: "low" } });
  });

  it("exits 0 without error findings and 1 with them or with ok: false", async () => {
    const clean = await run(["test", "findings", "--mode", "clean"]);
    expect(clean).toEqual({ code: EXIT.ok, stdout: "ok: true\nNo problems.\n", stderr: "" });
    const warning = await run(["test", "findings", "--mode", "warning"]);
    expect(warning).toEqual({
      code: EXIT.ok,
      stdout: "ok: true\nwarning  file.yaml-warning  a.md  Größe\n",
      stderr: "",
    });
    const error = await run(["test", "findings", "--mode", "error"]);
    expect(error).toEqual({
      code: EXIT.findings,
      stdout: "ok: false\nerror  file.invalid-yaml  b.md:2  bad\n",
      stderr: "",
    });
    const failed = await run(["test", "findings", "--mode", "failed", "--json"]);
    expect(failed.code).toBe(EXIT.findings);
    expect(JSON.parse(failed.stdout)).toEqual({ ok: false, problems: [] });
  });

  it("maps invalid input to exit code 2 with the error on stderr", async () => {
    const missing = await run(["test", "echo", ref]);
    expect(missing.code).toBe(EXIT.usage);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toBe("error input.invalid: Invalid input for test.echo: <name> is required\n");
    const json = await run(["test", "echo", " not a ref", "n", "--count", "x", "--json"]);
    expect(json.code).toBe(EXIT.usage);
    const error = JSON.parse(json.stderr) as { code: string; details: { errors: { path: string }[] } };
    expect(error.code).toBe("input.invalid");
    expect(error.details.errors.map((e) => e.path)).toEqual(expect.arrayContaining(["/ref", "/count"]));
    const badInput = await run(["test", "echo", "--input", "{", "--json"]);
    expect(badInput.code).toBe(EXIT.usage);
    expect(JSON.parse(badInput.stderr)).toEqual({
      code: "input.invalid",
      message:
        "Input from --input is not valid JSON (if the shell removed the quotes, as PowerShell and cmd.exe do, use --input @file or --input -)",
    });
  });

  it("names each field of an invalid input as it is typed: <argument>, --flag, or its input name (#309)", async () => {
    const human = await run(["test", "echo", " SR-036", "--count", "-1", "--level", "mid"]);
    expect(human.code).toBe(EXIT.usage);
    expect(human.stderr).toBe(
      "error input.invalid: Invalid input for test.echo: " +
        "<name> is required; " +
        '<ref> " SR-036" is not a reference to an element (a UUID, a short ID such as SR-3c90b0 or an identifier such as SR-036; at most 256 characters, without control characters or spaces at either end); ' +
        '--count must be >= 0, not -1; --level "mid" is not one of: low, high\n',
    );
    expect(human.stderr).not.toMatch(/\(root\)|\^\[/);
    // A field only --input carries keeps its input name; a field of a list item keeps its index.
    const nested = await run([
      "test",
      "echo",
      ref,
      "n",
      "--tags",
      "a",
      "--input",
      '{"selection":{"ids":[" x"]}}',
    ]);
    expect(nested.stderr).toBe(
      "error input.invalid: Invalid input for test.echo: " +
        'selection.ids[0] " x" is not a reference to an element (a UUID, a short ID such as SR-3c90b0 or an identifier such as SR-036; at most 256 characters, without control characters or spaces at either end)\n',
    );
    const item = await run(["test", "echo", ref, "n", "--input", '{"tags":[1]}']);
    expect(item.stderr).toBe(
      "error input.invalid: Invalid input for test.echo: --tags[0] must be text, not 1\n",
    );
    // Rebuilt, never replaced: `$&`, `$$` and `$'` in a value stay as typed.
    const dollars = await run(["test", "echo", "a$&b$$c$'d ", "n"]);
    expect(dollars.stderr).toBe(
      "error input.invalid: Invalid input for test.echo: " +
        `<ref> "a$&b$$c$'d " is not a reference to an element (a UUID, a short ID such as SR-3c90b0 or an identifier such as SR-036; at most 256 characters, without control characters or spaces at either end)\n`,
    );
    // --json gives core's error object unchanged.
    const json = await run(["test", "echo", ref, "--json"]);
    expect(JSON.parse(json.stderr)).toMatchObject({
      code: "input.invalid",
      message: "Invalid input for test.echo: name is required",
      details: { errors: [{ path: "", field: "name", keyword: "required", message: "name is required" }] },
    });
  });

  it("maps every error class except internal to exit code 2", async () => {
    for (const code of ["element.not-found", "ref.ambiguous", "workspace.read-only", "git.unavailable"]) {
      const result = await run(["test", "fail", code]);
      expect(result.code, code).toBe(EXIT.usage);
      expect(result.stderr).toBe(`error ${code}: Failed with ${code}\n`);
    }
  });

  it("maps internal errors to exit code 3 without their original text", async () => {
    const human = await run(["test", "fail", "crash"]);
    expect(human).toEqual({
      code: EXIT.internal,
      stdout: "",
      stderr: "error internal: Internal error in test.fail\n",
    });
    const json = await run(["test", "fail", "crash", "--json"]);
    expect(JSON.parse(json.stderr)).toEqual({
      code: "internal",
      message: "Internal error in test.fail",
      details: { command: "test.fail" },
    });
    const closing = await run(["test", "close-fails"]);
    expect(closing.code).toBe(EXIT.internal);
    expect(closing.stderr).toBe("error internal: Internal error in the command line\n");
    expect(closing.stderr).not.toContain("secret");
  });

  it("reports a command of the catalog without implementation as command.not-implemented, exit 2", async () => {
    const result = await run(["test", "set-status"]);
    expect(result).toEqual({
      code: EXIT.usage,
      stdout: "",
      stderr: "error command.not-implemented: Command test.setStatus is not implemented yet\n",
    });
  });

  it("treats anything but a CommandError from the runtime as internal", async () => {
    const broken: CommandRuntime = { ...runtime, invoke: () => Promise.reject(new Error("boom /secret")) };
    const result = await run(["other", "ping"], { runtime: broken });
    expect(result).toEqual({
      code: EXIT.internal,
      stdout: "",
      stderr: "error internal: Internal error in the command line\n",
    });
  });

  it("exits 3 when the output cannot be written, even without stderr", async () => {
    const throwing = {
      write: (): never => {
        throw new Error("EPIPE /secret");
      },
    };
    const stderr = new Sink();
    const code = await runCli({
      argv: ["other", "ping"],
      cwd: (await fixture()).root,
      stdin: Readable.from([]),
      stdout: throwing,
      stderr,
      runtime,
    });
    expect(code).toBe(EXIT.internal);
    expect(stderr.text).toBe("error internal: Internal error in the command line\n");
    const silent = await runCli({
      argv: ["other", "ping"],
      cwd: (await fixture()).root,
      stdin: Readable.from([]),
      stdout: throwing,
      stderr: throwing,
      runtime,
    });
    expect(silent).toBe(EXIT.internal);
  });

  it("uses the runtime of the process by default", async () => {
    const help = await run(["--help"], { processRuntime: true });
    expect(help.stdout).toContain("workspace <action> [options]");
    // A stage 6 command: in the catalog, not implemented before that stage.
    const result = await run(["reqif", "export", "out.reqif"], { processRuntime: true });
    expect(result).toEqual({
      code: EXIT.usage,
      stdout: "",
      stderr: "error command.not-implemented: Command reqif.export is not implemented yet\n",
    });
  });

  it("never hides the command's own error behind a failing close", async () => {
    const result = await run(["test", "close-fails", "--fail"]);
    expect(result).toEqual({
      code: EXIT.usage,
      stdout: "",
      stderr: "error element.read-only: The command's own error\n",
    });
  });

  it("exits 130 when the call is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await run(["test", "wait"], { signal: controller.signal });
    expect(result).toEqual({
      code: EXIT.aborted,
      stdout: "",
      stderr: "error internal: test.wait was aborted\n",
    });
  });

  it("exits 130 whenever the signal is aborted when the command finishes", async () => {
    const controller = new AbortController();
    controller.abort();
    const failed = await run(["test", "close-fails", "--fail"], { signal: controller.signal });
    expect(failed).toEqual({
      code: EXIT.aborted,
      stdout: "",
      stderr: "error element.read-only: The command's own error\n",
    });
    const finished = await run(["other", "ping"], { signal: controller.signal });
    expect(finished.code).toBe(EXIT.aborted);
  });

  it("prints usage errors as an error object with --json", async () => {
    const result = await run(["test", "nope", "--json"]);
    expect(result.code).toBe(EXIT.usage);
    expect(JSON.parse(result.stderr)).toEqual({ code: "input.invalid", message: "unknown command 'nope'" });
    const option = await run(["test", "root", "--json", "--nope"]);
    expect(JSON.parse(option.stderr)).toEqual({ code: "input.invalid", message: "unknown option '--nope'" });
  });

  it("makes local path fields absolute against the current folder", async () => {
    const ws = await fixture({ "sub/.keep": "" });
    const result = await run(["test", "echo", ref, "n", "--file", "../results.xml", "--json"], {
      cwd: ws.path("sub"),
    });
    expect(JSON.parse(result.stdout)).toMatchObject({ input: { file: ws.path("results.xml") } });
  });

  it("gives back the input with argvFor", async () => {
    const echo = runtime.contracts.entry("test.echo");
    expect(echo).toBeDefined();
    if (echo === undefined) {
      return;
    }
    const ws = await fixture();
    const inputs: Record<string, unknown>[] = [
      {
        ref,
        name: "plain",
        count: 3,
        verbose: false,
        tags: ["a", "b"],
        checks: [true, false],
        file: ws.path("f.xml"),
      },
      { ref, name: "-starts with a dash", verbose: true, count: 0, selection: { ids: [ref] } },
      { ref, name: "empty list", tags: [], level: "low" },
      { ref, name: "n", version: "n1:0123456789abcdef" },
    ];
    for (const input of inputs) {
      const argv = argvFor(echo, input, runtime.contracts.schemas);
      const result = await run([...argv, "--json"], { cwd: ws.root });
      expect(result.stderr, argv.join(" ")).toBe("");
      expect(JSON.parse(result.stdout), argv.join(" ")).toEqual({ input: { level: "low", ...input } });
    }
    expect(argvFor(echo, { ref, name: "x", count: 2, tags: ["a"] })).toEqual([
      "test",
      "echo",
      ref,
      "x",
      "--count",
      "2",
      "--tags",
      "a",
    ]);
    const odd = { ref: 5, name: "x", tags: ["ok", 3], count: -1, verbose: "yes" };
    expect(argvFor(echo, odd)).toEqual(["test", "echo", "--input", JSON.stringify(odd)]);
    expect(argvFor(echo, { ref, name: "y", tags: "single" })).toEqual([
      "test",
      "echo",
      ref,
      "y",
      "--input",
      '{"tags":"single"}',
    ]);
  });

  it("maps error codes by code first, then by class", () => {
    const error = new CommandError("file.faulty", "faulty");
    expect(exitCodeFor(error)).toBe(EXIT.usage);
    expect(exitCodeFor(error, { "file.faulty": EXIT.findings })).toBe(EXIT.findings);
    expect(exitCodeFor(new CommandError("internal", "x"))).toBe(EXIT.internal);
    expect(exitCodeFor(new CommandError("internal", "x", { aborted: true }))).toBe(EXIT.aborted);
  });

  it("[SR-092/AK2] ends with exit code 4 of its own for a commit that is not available locally", () => {
    expect(exitCodeFor(new CommandError("git.commit-not-found", "no commit"))).toBe(4);
    expect(EXIT.commitNotFound).toBe(4);
    // Every other code keeps the exit code of its class.
    expect(exitCodeFor(new CommandError("git.unavailable", "no git"))).toBe(EXIT.usage);
  });
});

describe("workspace discovery", () => {
  it("finds the nearest folder upwards with logreq-workspace.yaml", async () => {
    const ws = await fixture({ "logreq-workspace.yaml": "logreq-workspace: 1\n", "product/deep/x.md": "x" });
    const result = await run(["test", "root", "--json"], { cwd: ws.path("product/deep") });
    expect(JSON.parse(result.stdout)).toEqual({ root: ws.root });
  });

  it("takes --workspace relative to the current folder", async () => {
    const ws = await fixture({ "logreq-workspace.yaml": "logreq-workspace: 1\n", "other/x.md": "x" });
    const result = await run(["test", "root", "--workspace", "other", "--json"], { cwd: ws.root });
    expect(JSON.parse(result.stdout)).toEqual({ root: ws.path("other") });
    const absolute = await run(["test", "root", "--workspace", ws.root, "--json"], {
      cwd: path.parse(ws.root).root,
    });
    expect(JSON.parse(absolute.stdout)).toEqual({ root: ws.root });
  });

  it("falls back to the current folder (workspace init)", async () => {
    const ws = await fixture({ "empty/.keep": "" });
    const result = await run(["test", "root", "--json"], { cwd: ws.path("empty") });
    expect(JSON.parse(result.stdout)).toEqual({ root: ws.path("empty") });
  });
});

describe("large outputs in pieces with back-pressure (#277)", () => {
  /** A sink that pushes back on every second write; `drained` runs `onDrain` and resolves its answer. */
  class SlowSink {
    readonly pieces: string[] = [];
    private readonly onDrain: () => boolean;
    constructor(onDrain: () => boolean = () => true) {
      this.onDrain = onDrain;
    }
    write(text: string): boolean {
      this.pieces.push(text);
      return this.pieces.length % 2 === 1;
    }
    drained(): Promise<boolean> {
      return new Promise((resolve) =>
        setTimeout(() => {
          resolve(this.onDrain());
        }, 1),
      );
    }
  }

  it("writes --json and --yaml in pieces, byte for byte the whole text, waiting for the sink", async () => {
    const json = new SlowSink();
    expect(await run(["test", "large", "--json"], { stdout: json })).toMatchObject({ code: EXIT.ok });
    expect(json.pieces.length).toBeGreaterThan(2);
    expect(json.pieces.join("")).toBe(`${JSON.stringify(LARGE, null, 2)}\n`);
    const yaml = new SlowSink();
    expect(await run(["test", "large", "--yaml"], { stdout: yaml })).toMatchObject({ code: EXIT.ok });
    expect(yaml.pieces.length).toBeGreaterThan(2);
    expect(yaml.pieces.join("")).toBe(stringify(LARGE, YAML_OPTIONS));
  });

  it("stops writing when the sink is closed (EPIPE), keeping the exit code", async () => {
    const closed = new SlowSink(() => false);
    expect(await run(["test", "large", "--json"], { stdout: closed })).toMatchObject({ code: EXIT.ok });
    expect(closed.pieces).toHaveLength(2);
  });

  it("stops writing on Ctrl-C while a large output is written, with exit code 130", async () => {
    const controller = new AbortController();
    const sink = new SlowSink(() => {
      controller.abort();
      return true;
    });
    const result = await run(["test", "large", "--json"], { stdout: sink, signal: controller.signal });
    expect(result.code).toBe(EXIT.aborted);
    expect(sink.pieces).toHaveLength(2);
  });

  it("writes to a sink without drained as fast as it takes", async () => {
    const pieces: string[] = [];
    await writePieces({ write: (text) => (pieces.push(text), false) }, ["a", "b", "c"]);
    expect(pieces).toEqual(["a", "b", "c"]);
  });
});
