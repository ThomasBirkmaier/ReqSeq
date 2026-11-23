import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandContext } from "../catalog.js";
import { CommandError, defineTestCommand } from "../catalog.js";
import { commands as productCommands } from "../commands/index.js";
import { metamodelState } from "../metamodel/index.js";
import { loadContracts } from "./contracts.js";
import type { CommandRuntimeOptions } from "./invoke.js";
import { configureCommandRuntime, createCommandRuntime, getCommandRuntime, invoke } from "./invoke.js";
import { Workspace } from "./workspace.js";

// A test-only catalog entry; its schemas use refs into common.schema.json like the real catalog.
const testCatalog = {
  "reqseq-catalog": 1,
  commands: [
    {
      name: "test.echo",
      title: "Test command",
      summary: "Echo the input (test only).",
      effect: "read",
      stage: 1,
      implements: ["SR-080"],
      arguments: [],
      input: {
        type: "object",
        required: ["ref"],
        properties: {
          ref: { $ref: "../common.schema.json#/$defs/elementRef" },
          limit: { type: "integer", minimum: 1, default: 10 },
          output: { description: "Return this instead of the echo." },
          fail: { enum: ["command-error", "error", "string", "abort"] },
        },
        additionalProperties: false,
      },
      output: {
        type: "object",
        required: ["ref", "limit"],
        properties: {
          ref: { $ref: "../common.schema.json#/$defs/elementRef" },
          limit: { type: "integer" },
          root: { type: "string" },
          aborted: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "test.paths",
      title: "Test command",
      summary: "Takes local paths (test only).",
      effect: "read",
      stage: 1,
      implements: ["SR-142"],
      arguments: [],
      input: {
        type: "object",
        properties: {
          file: { $ref: "../common.schema.json#/$defs/localPath" },
          files: { type: "array", items: { $ref: "../common.schema.json#/$defs/localPath" } },
        },
        additionalProperties: false,
      },
      output: { type: "object" },
    },
    {
      name: "test.unimplemented",
      title: "Test command",
      summary: "Has no implementation (test only).",
      effect: "read",
      stage: 2,
      implements: ["SR-080"],
      arguments: [],
      input: { type: "object" },
      output: { type: "object" },
    },
  ],
};

interface EchoInput {
  readonly ref: string;
  readonly limit: number;
  readonly output?: unknown;
  readonly fail?: "command-error" | "error" | "string" | "abort";
}

const nonError: unknown = "plain string";
const seen: { ctx?: CommandContext; input?: EchoInput } = {};
// Test-only commands are not in the generated CommandTypes: defineTestCommand takes their types.
const echo = defineTestCommand<EchoInput, unknown>({
  name: "test.echo",
  run: (ctx, input) => {
    seen.ctx = ctx;
    seen.input = input;
    if (input.fail === "command-error") {
      return Promise.reject(new CommandError("element.not-found", "No element " + input.ref));
    }
    if (input.fail === "error") {
      return Promise.reject(new RangeError(`boom in ${path.join(ctx.workspace.root, "x.md")}\nsecond line`));
    }
    if (input.fail === "abort") {
      return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
    }
    if (input.fail === "string") {
      // A synchronous throw of something that is not an Error must map to `internal` too.
      throw nonError;
    }
    return Promise.resolve(
      input.output ?? {
        ref: input.ref,
        limit: input.limit,
        root: ctx.workspace.root,
        aborted: ctx.signal.aborted,
      },
    );
  },
});

// Records each run and whether the context takes a path outside the repositories.
const pathRuns: { open: boolean }[] = [];
// The inputs the command got, after `invoke` took them in (the app's `~`, SR-143).
const pathInputs: unknown[] = [];
const paths = defineTestCommand<{ readonly file?: string }, unknown>({
  name: "test.paths",
  run: async (ctx, input) => {
    pathInputs.push({ input, home: ctx.localPaths.home });
    const open = await ctx.localPaths.check([{ field: "derived", path: "/" }]).then(
      () => true,
      () => false,
    );
    pathRuns.push({ open });
    return {};
  },
});

const contracts = loadContracts({ catalog: testCatalog });
const runtime = (options: CommandRuntimeOptions = {}): ReturnType<typeof createCommandRuntime> =>
  createCommandRuntime({ contracts, commands: [echo], validateOutput: true, ...options });
const workspace = new Workspace("/w");
const ctx = { workspace };

const rejection = async (promise: Promise<unknown>): Promise<CommandError> => {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

describe("createCommandRuntime", () => {
  it("registers implementations by catalog name", () => {
    const rt = runtime();
    expect([...rt.commands.keys()]).toEqual(["test.echo"]);
    expect(rt.contracts).toBe(contracts);
  });

  it("refuses an implementation without catalog entry", () => {
    const stray = defineTestCommand({ name: "test.stray", run: () => Promise.resolve({}) });
    expect(() => runtime({ commands: [stray] })).toThrow(
      "command test.stray has no entry in the catalog, schemas/commands/test.stray.json",
    );
  });

  it("refuses a name registered twice", () => {
    expect(() => runtime({ commands: [echo, echo] })).toThrow("command test.echo is registered twice");
  });

  it("uses the product commands and the repository catalog by default", () => {
    const rt = createCommandRuntime();
    expect(rt.contracts.entry("workspace.status")).toBeDefined();
    expect([...rt.commands.keys()]).toEqual(productCommands.map((c) => c.name));
  });
});

describe("invoke", () => {
  it("runs the command with validated input, defaults and context", async () => {
    const out = await runtime().invoke("test.echo", { ref: "SR-825b7146fb54" }, ctx);
    expect(out).toEqual({ ref: "SR-825b7146fb54", limit: 10, root: workspace.root, aborted: false });
    expect(seen.ctx?.workspace).toBe(workspace);
  });

  it("does not change the caller's input when filling defaults", async () => {
    const input = { ref: "SR-825b7146fb54" };
    await runtime().invoke("test.echo", input, ctx);
    expect(input).toEqual({ ref: "SR-825b7146fb54" });
    expect(seen.input).not.toBe(input);
  });

  it("passes the caller's abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const out = await runtime().invoke(
      "test.echo",
      { ref: "SR-825b7146fb54" },
      { workspace, signal: controller.signal },
    );
    expect(out).toMatchObject({ aborted: true });
    expect(seen.ctx?.signal).toBe(controller.signal);
  });

  it("rejects catalog commands without implementation with command.not-implemented", async () => {
    const err = await rejection(runtime().invoke("test.unimplemented", {}, ctx));
    expect(err.toJSON()).toEqual({
      code: "command.not-implemented",
      message: "Command test.unimplemented is not implemented yet",
      details: { command: "test.unimplemented" },
    });
  });

  it("rejects names that are not in the catalog with input.invalid", async () => {
    const err = await rejection(runtime().invoke("no.such", {}, ctx));
    expect(err.toJSON()).toEqual({
      code: "input.invalid",
      message: "Unknown command: no.such",
      details: { command: "no.such" },
    });
  });

  it("rejects input that does not match the schema, before run", async () => {
    const run = vi.spyOn(echo, "run");
    try {
      const err = await rejection(runtime().invoke("test.echo", { ref: " nope", limit: 0, extra: 1 }, ctx));
      expect(err.code).toBe("input.invalid");
      expect(err.message).toMatch(/^Invalid input for test\.echo: /);
      expect(err.details).toMatchObject({ command: "test.echo" });
      const errors = (err.details as { errors: { path: string; keyword: string }[] }).errors;
      expect(errors.map((e) => `${e.path} ${e.keyword}`)).toEqual(
        expect.arrayContaining([" additionalProperties", "/limit minimum", "/ref pattern"]),
      );
      // Readable, the field named by its input name, no regular expression, no "(root)" (ThomasBirkmaier/ReqSeq-archive#309).
      expect(err.message).not.toMatch(/\(root\)|\^|\$"/);
      expect(err.message).toContain("extra is not an input of this command");
      expect(run).not.toHaveBeenCalled();
    } finally {
      run.mockRestore();
    }
  });

  it("rejects input that is not plain data", async () => {
    const err = await rejection(runtime().invoke("test.echo", { ref: () => 1 }, ctx));
    expect(err.toJSON()).toEqual({
      code: "input.invalid",
      message: "Input of test.echo is not plain JSON data",
      details: { command: "test.echo" },
    });
    expect(err.cause).toBeInstanceOf(Error);
  });

  it("passes a CommandError of the command through unchanged", async () => {
    const err = await rejection(
      runtime().invoke("test.echo", { ref: "SR-825b7146fb54", fail: "command-error" }, ctx),
    );
    expect(err.toJSON()).toEqual({ code: "element.not-found", message: "No element SR-825b7146fb54" });
  });

  it("maps any other failure to internal", async () => {
    const err = await rejection(
      runtime().invoke("test.echo", { ref: "SR-825b7146fb54", fail: "error" }, ctx),
    );
    expect(err.toJSON()).toEqual({
      code: "internal",
      message: "Internal error in test.echo",
      details: { command: "test.echo", cause: { name: "RangeError", message: "boom in <workspace>/x.md" } },
    });
    expect(err.cause).toBeInstanceOf(Error);
    const plain = await rejection(
      runtime().invoke("test.echo", { ref: "SR-825b7146fb54", fail: "string" }, ctx),
    );
    expect(plain.toJSON()).toEqual({
      code: "internal",
      message: "Internal error in test.echo",
      details: { command: "test.echo", cause: { name: "string" } },
    });
    expect(plain.cause).toBe("plain string");
  });

  it("names the cause of an internal error with the workspace root in its real form too (#1794)", async () => {
    const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "reqseq-invoke-cause-"));
    onTestFinished(() => fs.promises.rm(base, { recursive: true, force: true }));
    await fs.promises.mkdir(path.join(base, "target"));
    const given = path.join(base, "link");
    await fs.promises.symlink(path.join(base, "target"), given, "junction");
    const real = await fs.promises.realpath(given);
    const missing = path.join(real, "requirements", "SR-1.md");
    const crash = defineTestCommand<EchoInput, unknown>({
      name: "test.echo",
      run: () =>
        Promise.reject(
          Object.assign(new Error(`ENOENT: no such file or directory, open '${missing}'\n    at stack`), {
            code: "ENOENT",
            path: missing,
          }),
        ),
    });
    const linked = new Workspace(given);
    onTestFinished(() => linked.close());
    const err = await rejection(
      createCommandRuntime({ contracts, commands: [crash] }).invoke(
        "test.echo",
        { ref: "SR-825b7146fb54" },
        { workspace: linked },
      ),
    );
    expect(err.details).toEqual({
      command: "test.echo",
      cause: {
        name: "Error",
        code: "ENOENT",
        message: "ENOENT: no such file or directory, open '<workspace>/requirements/SR-1.md'",
      },
    });
  });

  it("maps an abort to internal with details.aborted", async () => {
    const err = await rejection(
      runtime().invoke("test.echo", { ref: "SR-825b7146fb54", fail: "abort" }, ctx),
    );
    expect(err.toJSON()).toEqual({
      code: "internal",
      message: "test.echo was aborted",
      details: { command: "test.echo", aborted: true },
    });
    expect(err.cause).toBeInstanceOf(DOMException);
    const controller = new AbortController();
    controller.abort();
    const afterAbort = await rejection(
      runtime().invoke(
        "test.echo",
        { ref: "SR-825b7146fb54", fail: "error" },
        { workspace, signal: controller.signal },
      ),
    );
    expect(afterAbort.details).toEqual({ command: "test.echo", aborted: true });
  });

  it("rejects output that does not match the schema when output validation is on", async () => {
    const input = { ref: "SR-825b7146fb54", output: { ref: "SR-825b7146fb54" } };
    const err = await rejection(runtime().invoke("test.echo", input, ctx));
    expect(err.code).toBe("internal");
    expect(err.message).toBe(
      "Output of test.echo does not match its schema: (root) must have required property 'limit'",
    );
    await expect(runtime({ validateOutput: false }).invoke("test.echo", input, ctx)).resolves.toEqual({
      ref: "SR-825b7146fb54",
    });
  });

  it("validates output by default when REQSEQ_VALIDATE_OUTPUT=1", async () => {
    const input = { ref: "SR-825b7146fb54", output: {} };
    vi.stubEnv("REQSEQ_VALIDATE_OUTPUT", "1");
    try {
      const on = createCommandRuntime({ contracts, commands: [echo] });
      expect((await rejection(on.invoke("test.echo", input, ctx))).code).toBe("internal");
      vi.stubEnv("REQSEQ_VALIDATE_OUTPUT", "");
      const off = createCommandRuntime({ contracts, commands: [echo] });
      await expect(off.invoke("test.echo", input, ctx)).resolves.toEqual({});
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("invoke (product runtime)", () => {
  it("is set up for output validation in tests", () => {
    expect(process.env["REQSEQ_VALIDATE_OUTPUT"]).toBe("1");
  });

  it("shares one runtime per process that adapters can configure", async () => {
    const product = getCommandRuntime();
    expect(getCommandRuntime()).toBe(product);
    expect(product.contracts.commands.length).toBeGreaterThan(0);
    try {
      const configured = configureCommandRuntime({ contracts, commands: [echo] });
      expect(getCommandRuntime()).toBe(configured);
      await expect(invoke("test.echo", { ref: "SR-825b7146fb54" }, ctx)).resolves.toMatchObject({
        limit: 10,
      });
      expect(configureCommandRuntime().commands.size).toBe(productCommands.length);
    } finally {
      configureCommandRuntime();
    }
  });

  it("runs a write-files command as a write of the workspace, which the watcher waits for (#432)", async () => {
    const ws = new Workspace("/nowhere");
    const run = vi.spyOn(ws, "runCommand");
    const rt = createCommandRuntime();
    // Both fail inside the command (no workspace there); what counts is how they ran.
    await rejection(rt.invoke("element.create", { type: "need", title: "T" }, { workspace: ws }));
    await rejection(rt.invoke("element.list", {}, { workspace: ws }));
    expect(run.mock.calls.map(([, options]) => options)).toEqual([{ writes: true }, { writes: false }]);
  });

  it("runs on a fixture workspace through the product runtime, created once", async () => {
    const fixture = await createFixtureWorkspace({
      files: { "reqseq-workspace.yaml": "reqseq-workspace: 1\n" },
      git: true,
    });
    onTestFinished(() => fixture.cleanup());
    const ws = new Workspace(fixture.root);
    expect(fs.existsSync(fixture.path("reqseq-workspace.yaml"))).toBe(true);
    // Every command of the product catalog is implemented (reqif.export was the last, SR-052), so
    // the product runtime is shown by its input check; command.not-implemented by the test catalog.
    const err = await rejection(invoke("reqif.export", {}, { workspace: ws }));
    expect(err.code).toBe("input.invalid");
    // The default runtime is created once and reused.
    expect((await rejection(invoke("reqif.export", {}, { workspace: ws }))).code).toBe("input.invalid");
  });
});

describe("local paths by access (SR-142)", () => {
  it("runs no command whose API or MCP input names a path outside the repositories, and confines derived paths", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-004/three-repositories" });
    onTestFinished(() => ws.cleanup());
    const root = new Workspace(ws.path("system"));
    onTestFinished(() => root.close());
    const rt = runtime({ commands: [paths] });
    const outside = { file: "requirements", files: ["../product", ws.path("outside.xml")] };
    pathRuns.length = 0;
    for (const access of ["api", "mcp"] as const) {
      const error = await rejection(rt.invoke("test.paths", outside, { workspace: root, access }));
      expect([error.code, error.details?.["fields"], error.details?.["reason"]]).toEqual([
        "input.invalid",
        ["files[1]"],
        "outside-repositories",
      ]);
      await rt.invoke(
        "test.paths",
        { file: "requirements", files: ["../sensor/x"] },
        { workspace: root, access },
      );
    }
    expect(pathRuns).toEqual([{ open: false }, { open: false }]);
    for (const access of ["cli", "app", undefined] as const) {
      await rt.invoke("test.paths", outside, {
        workspace: root,
        ...(access === undefined ? {} : { access }),
      });
    }
    expect(pathRuns.slice(2)).toEqual([{ open: true }, { open: true }, { open: true }]);
  });

  it("confines the web UI like the API, except for listing folders and creating a workspace (ADR-0020)", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-004/three-repositories" });
    onTestFinished(() => ws.cleanup());
    const root = new Workspace(ws.path("system"));
    onTestFinished(() => root.close());
    const outside = { file: "requirements", files: [ws.path("outside.xml")] };
    const error = await rejection(
      runtime({ commands: [paths] }).invoke("test.paths", outside, { workspace: root, access: "ui" }),
    );
    expect([error.code, error.details?.["reason"]]).toEqual(["input.invalid", "outside-repositories"]);
    expect(error.message).toContain("Through the web UI ReqSeq accepts only local paths");
    expect(error.message).not.toMatch(/API|MCP|command line/u);
    const product = createCommandRuntime({ commands: productCommands });
    const created = ws.path("created");
    for (const access of ["api", "ui"] as const) {
      const call = product.invoke(
        "workspace.init",
        { path: created, name: "Created" },
        { workspace: root, access },
      );
      if (access === "api") {
        expect((await rejection(call)).details?.["reason"]).toBe("outside-repositories");
      } else {
        expect(await call).toMatchObject({
          answer: expect.stringMatching(/^Created workspace Created/) as unknown,
        });
      }
    }
    expect(fs.existsSync(path.join(created, "reqseq-workspace.yaml"))).toBe(true);
  });

  it("takes ~ at the start of a local path for the home folder only in the app (SR-143)", async () => {
    vi.stubEnv("HOME", "/home/someone");
    vi.stubEnv("USERPROFILE", "/home/someone");
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const rt = runtime({ commands: [paths] });
    const input = { file: "~/out.reqif", files: ["~", "a~/b", "~x/c"] };
    pathInputs.length = 0;
    for (const access of ["app", "cli"] as const) {
      await rt.invoke("test.paths", input, { workspace, access });
    }
    const home = os.homedir();
    expect(pathInputs).toEqual([
      {
        input: { file: path.join(home, "out.reqif"), files: [home, "a~/b", "~x/c"] },
        home,
      },
      { input, home: undefined },
    ]);
    // The caller's object stays as it was.
    expect(input.file).toBe("~/out.reqif");
  });
});

describe("the names of an answer (SR-224 AK1)", () => {
  it("names a type by its name in the metamodel the command left, else by its key", async () => {
    const fixture = await createFixtureWorkspace({ fixture: "SR-001/two-elements" });
    onTestFinished(() => fixture.cleanup());
    const ws = new Workspace(fixture.root);
    onTestFinished(() => ws.close());
    const named = defineTestCommand<Record<string, never>, Record<string, never>>({
      name: "test.paths",
      answer: (_output, _input, names) =>
        `${names.type("system-requirement")} and ${names.type("no-such-type")}.`,
      run: () => Promise.resolve({}),
    });
    const rt = runtime({ commands: [named] });
    // No command read the metamodel yet: nothing is read for the answer.
    expect(await rt.invoke("test.paths", {}, { workspace: ws })).toEqual({
      answer: "system-requirement and no-such-type.",
    });
    await ws.get(metamodelState);
    expect(await rt.invoke("test.paths", {}, { workspace: ws })).toEqual({
      answer: "System Requirement and no-such-type.",
    });
    // A metamodel that failed meanwhile names the type by its key; the command still succeeds.
    vi.spyOn(ws, "peek").mockReturnValue(Promise.reject(new Error("reset")));
    expect(await rt.invoke("test.paths", {}, { workspace: ws })).toEqual({
      answer: "system-requirement and no-such-type.",
    });
  });
});

describe("next steps while the workspace is read-only (SR-226)", () => {
  const entry = (name: string, extra: object): object => ({
    name,
    title: "Test command",
    summary: "Next steps (test only).",
    stage: 1,
    implements: ["SR-226"],
    arguments: [],
    input: { type: "object" },
    ...extra,
  });
  // `next` is optional here: the filter follows the items of the field, not whether it is required.
  const stepsCatalog = {
    "reqseq-catalog": 1,
    commands: [
      entry("test.steps", {
        effect: "read",
        input: { type: "object", properties: { none: { type: "boolean" } }, additionalProperties: false },
        output: {
          type: "object",
          properties: { next: { type: "array", items: { $ref: "../common.schema.json#/$defs/nextStep" } } },
          additionalProperties: false,
        },
      }),
      entry("test.write", {
        effect: "write-files",
        whileReadOnly: "refuse",
        whileReadOnlyReason: "Writes (test only).",
        output: { type: "object" },
      }),
    ],
  };
  const WRITE = { command: "test.write", input: {}, open: [] };
  const READ = { command: "test.steps", input: {}, open: [] };
  const steps = defineTestCommand<{ readonly none?: boolean }, unknown>({
    name: "test.steps",
    run: (_ctx, input) => Promise.resolve(input.none === true ? {} : { next: [WRITE, READ] }),
  });
  const write = defineTestCommand<object, unknown>({ name: "test.write", run: () => Promise.resolve({}) });

  it("[SR-226/AK-t0mt] leaves out a refused step of an optional next list, and an output without next as it is", async () => {
    const fixture = await createFixtureWorkspace({
      files: {
        "reqseq-workspace.yaml":
          'reqseq-workspace: 1\nname: W\nrepositories:\n  - { name: main, url: "", main: true }\n' +
          "metamodel: { repository: main, path: metamodel }\n",
        "metamodel/broken.yaml": "reqseq-metamodel: 1\nstatuses:\n  - key: draft\n    name: [Draft\n",
      },
      git: true,
    });
    onTestFinished(() => fixture.cleanup());
    const ws = new Workspace(fixture.root);
    onTestFinished(() => ws.close());
    const rt = createCommandRuntime({
      contracts: loadContracts({ catalog: stepsCatalog }),
      commands: [steps, write],
      validateOutput: true,
    });
    expect(await rt.invoke("test.steps", {}, { workspace: ws })).toMatchObject({ next: [READ] });
    expect(await rt.invoke("test.steps", { none: true }, { workspace: ws })).not.toHaveProperty("next");
  });
});
