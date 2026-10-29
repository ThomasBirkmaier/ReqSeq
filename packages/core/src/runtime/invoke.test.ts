import fs from "node:fs";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandContext } from "../catalog.js";
import { CommandError, defineTestCommand } from "../catalog.js";
import { commands as productCommands } from "../commands/index.js";
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
      return Promise.reject(new Error("boom"));
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
      "command test.stray has no entry in schemas/commands/catalog.json",
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
      // Readable, the field named by its input name, no regular expression, no "(root)" (#309).
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
      details: { command: "test.echo" },
    });
    expect(err.cause).toBeInstanceOf(Error);
    const plain = await rejection(
      runtime().invoke("test.echo", { ref: "SR-825b7146fb54", fail: "string" }, ctx),
    );
    expect(plain.message).toBe("Internal error in test.echo");
    expect(plain.cause).toBe("plain string");
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

  it("runs on a fixture workspace and reports catalog commands without implementation", async () => {
    const fixture = await createFixtureWorkspace({
      files: { "logreq-workspace.yaml": "logreq-workspace: 1\n" },
      git: true,
    });
    onTestFinished(() => fixture.cleanup());
    const ws = new Workspace(fixture.root);
    expect(fs.existsSync(fixture.path("logreq-workspace.yaml"))).toBe(true);
    // baseline.list is a stage 5 command: in the catalog, not implemented yet.
    const err = await rejection(invoke("baseline.list", {}, { workspace: ws }));
    expect(err.toJSON()).toEqual({
      code: "command.not-implemented",
      message: "Command baseline.list is not implemented yet",
      details: { command: "baseline.list" },
    });
    // The default runtime is created once and reused.
    expect((await rejection(invoke("baseline.list", {}, { workspace: ws }))).code).toBe(
      "command.not-implemented",
    );
  });
});
