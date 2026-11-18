// `readOutputElements` of a command's context (invoke.ts, `outputElementsReader`, #1873): the inner read
// command of `selection.output` runs as `invoke` runs a command, with a test catalog. What element.list
// makes of it with the product commands: commands/element/list-output.test.ts.
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { OutputElements } from "../catalog.js";
import { CommandError, defineTestCommand } from "../catalog.js";
import { loadContracts } from "./contracts.js";
import type { CommandRuntimeOptions } from "./invoke.js";
import { MAX_OUTPUT_DEPTH, createCommandRuntime } from "./invoke.js";
import { Workspace } from "./workspace.js";

const LIST = {
  type: "array",
  items: { type: "object", properties: { id: { type: "string" } } },
  "x-elements": "answer",
};
const outputFields = [{ path: "elements", elements: "answer" }];

const entry = (name: string, effect: string, input: object, output: object, fields?: object): object => ({
  name,
  title: "Test command",
  summary: "Test only.",
  effect,
  ...(effect === "read" ? {} : { whileReadOnly: "allow", whileReadOnlyReason: "Test only." }),
  stage: 1,
  implements: ["SR-224"],
  arguments: [],
  input,
  output,
  ...(fields === undefined ? {} : { outputFields: fields }),
});

const testCatalog = {
  "reqseq-catalog": 1,
  commands: [
    entry(
      "test.outer",
      "read",
      { type: "object", properties: { command: { type: "string" }, input: {} } },
      { type: "object" },
    ),
    entry(
      "test.found",
      "read",
      {
        type: "object",
        properties: {
          files: { type: "array", items: { $ref: "../common.schema.json#/$defs/localPath" } },
          limit: { type: "integer", minimum: 1, maximum: 5, default: 2 },
          nest: { type: "integer", minimum: 0 },
          fail: { enum: [true, "bare", "error"] },
        },
        additionalProperties: false,
      },
      { type: "object", properties: { elements: LIST } },
      outputFields,
    ),
    entry(
      "test.write",
      "write-files",
      { type: "object" },
      { type: "object", properties: { elements: LIST } },
      outputFields,
    ),
    entry("test.plain", "read", { type: "object" }, { type: "object" }),
  ],
};

interface FoundInput {
  readonly files?: readonly string[];
  readonly limit: number;
  readonly nest?: number;
  readonly fail?: true | "bare" | "error";
}

/** What each run of test.found got: its input, the home of its paths and whether `/` passed its path check. */
const runs: { input: FoundInput; home: string | undefined; open: boolean; aborted: boolean }[] = [];
const record = (id: string): { id: string; repository: string } => ({ id, repository: "system" });

const found = defineTestCommand<FoundInput, unknown>({
  name: "test.found",
  run: () => Promise.resolve({ elements: [] }),
  outputElements: async (ctx, input): Promise<OutputElements> => {
    const open = await ctx.localPaths.check([{ field: "derived", path: "/" }]).then(
      () => true,
      () => false,
    );
    runs.push({ input, home: ctx.localPaths.home, open, aborted: ctx.signal.aborted });
    if (input.fail === "bare") {
      throw new CommandError("element.not-found", "No element there");
    }
    if (input.fail === "error") {
      throw new RangeError("boom");
    }
    if (input.fail === true) {
      throw new CommandError("element.not-found", "files[0]: no element there", { fields: ["files[0]"] });
    }
    if (input.nest !== undefined && input.nest > 0) {
      return ctx.readOutputElements("test.found", { nest: input.nest - 1 });
    }
    return { elements: [record("a"), record("b")], incomplete: true };
  },
});

const outer = defineTestCommand<{ readonly command: string; readonly input: unknown }, unknown>({
  name: "test.outer",
  run: async (ctx, input) => {
    const { elements, incomplete } = await ctx.readOutputElements(input.command, input.input);
    return { ids: elements.map((e) => e.id), incomplete };
  },
});

const write = defineTestCommand<unknown, unknown>({
  name: "test.write",
  run: () => Promise.resolve({ elements: [] }),
  outputElements: () => Promise.resolve({ elements: [], incomplete: false }),
});
const plain = defineTestCommand<unknown, unknown>({ name: "test.plain", run: () => Promise.resolve({}) });

const contracts = loadContracts({ catalog: testCatalog });
const runtime = (options: CommandRuntimeOptions = {}): ReturnType<typeof createCommandRuntime> =>
  createCommandRuntime({ contracts, commands: [outer, found, write, plain], ...options });

const failure = async (promise: Promise<unknown>): Promise<CommandError> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

describe("readOutputElements", () => {
  it("runs the inner command with its input checked and its defaults, and gives its elements", async () => {
    const rt = runtime();
    runs.length = 0;
    const out = await rt.invoke(
      "test.outer",
      { command: "test.found", input: { limit: 4 } },
      { workspace: new Workspace("/w") },
    );
    expect(out).toEqual({ ids: ["a", "b"], incomplete: true });
    expect(runs).toEqual([{ input: { limit: 4 }, home: undefined, open: true, aborted: false }]);
    await rt.invoke("test.outer", { command: "test.found", input: {} }, { workspace: new Workspace("/w") });
    expect(runs[1]?.input).toEqual({ limit: 2 });
  });

  it("names the inner input's fields under selection.output.input and keeps the code of the inner errors", async () => {
    const rt = runtime();
    const ctx = { workspace: new Workspace("/w") };
    const invalid = await failure(
      rt.invoke("test.outer", { command: "test.found", input: { limit: 9, other: 1 } }, ctx),
    );
    expect(invalid.code).toBe("input.invalid");
    expect(invalid.message).toBe(
      "Invalid input for test.found: selection.output.input.other is not an input of this command (known: files, limit, nest, fail); selection.output.input.limit must be <= 5, not 9",
    );
    const fields = (invalid.details?.["errors"] as { field: string; path: string }[]).map((e) => [
      e.field,
      e.path,
    ]);
    expect(fields).toEqual([
      ["selection.output.input.other", "/selection/output/input"],
      ["selection.output.input.limit", "/selection/output/input/limit"],
    ]);
    const whole = await failure(rt.invoke("test.outer", { command: "test.found", input: [] }, ctx));
    expect(whole.message).toBe(
      "Invalid input for test.found: selection.output.input must be an object, not a list",
    );
    const inner = await failure(
      rt.invoke("test.outer", { command: "test.found", input: { fail: true } }, ctx),
    );
    expect(inner.toJSON()).toEqual({
      code: "element.not-found",
      message: "selection.output.input.files[0]: no element there",
      details: { fields: ["selection.output.input.files[0]"] },
    });
  });

  it("names an inner error without details under selection.output.input, and gives a bug as internal", async () => {
    const rt = runtime();
    const ctx = { workspace: new Workspace("/w") };
    const bare = await failure(
      rt.invoke("test.outer", { command: "test.found", input: { fail: "bare" } }, ctx),
    );
    expect(bare.toJSON()).toEqual({
      code: "element.not-found",
      message: "selection.output.input: No element there",
    });
    const bug = await failure(
      rt.invoke("test.outer", { command: "test.found", input: { fail: "error" } }, ctx),
    );
    expect([bug.code, bug.message]).toEqual(["internal", "Internal error in test.outer"]);
  });

  it("refuses an unknown command, a write command, a command without output elements and deep nesting", async () => {
    const rt = runtime();
    const ctx = { workspace: new Workspace("/w") };
    const messages = [];
    for (const command of ["test.none", "test.write", "test.plain"]) {
      const error = await failure(rt.invoke("test.outer", { command, input: {} }, ctx));
      expect([error.code, error.details]).toEqual([
        "input.invalid",
        { fields: ["selection.output.command"] },
      ]);
      messages.push(error.message);
    }
    expect(messages).toEqual([
      'selection.output.command: "test.none" is no command of the catalog',
      "selection.output.command: test.write writes files; selection.output runs read commands only",
      'selection.output.command: test.plain gives no elements as its result (no output field is marked x-elements "answer")',
    ]);
    // The outer call reads at depth 0: MAX_OUTPUT_DEPTH reads in all.
    const deepest = { command: "test.found", input: { nest: MAX_OUTPUT_DEPTH - 1 } };
    expect(await rt.invoke("test.outer", deepest, ctx)).toEqual({ ids: ["a", "b"], incomplete: true });
    const deeper = await failure(
      rt.invoke("test.outer", { command: "test.found", input: { nest: MAX_OUTPUT_DEPTH } }, ctx),
    );
    // Each level names the field under the one around it.
    expect(deeper.message).toBe(
      `${"selection.output.input.".repeat(MAX_OUTPUT_DEPTH)}selection.output: at most 4 output selections may be nested in each other`,
    );
  });

  it("gives internal for a command with output elements but no outputElements, and refuses one not implemented", async () => {
    const bare = defineTestCommand<unknown, unknown>({ name: "test.found", run: () => Promise.resolve({}) });
    const ctx = { workspace: new Workspace("/w") };
    const bug = await failure(
      runtime({ commands: [outer, bare] }).invoke("test.outer", { command: "test.found", input: {} }, ctx),
    );
    expect([bug.code, bug.details?.["cause"]]).toEqual([
      "internal",
      {
        name: "Error",
        message: 'command test.found has an output field marked x-elements "answer", but no outputElements',
      },
    ]);
    const missing = await failure(
      runtime({ commands: [outer] }).invoke("test.outer", { command: "test.found", input: {} }, ctx),
    );
    expect(missing.code).toBe("command.not-implemented");
  });

  it("gives the inner command the local path rule of the call's access (SR-142, SR-143)", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-004/three-repositories" });
    onTestFinished(() => ws.cleanup());
    const root = new Workspace(ws.path("system"));
    onTestFinished(() => root.close());
    const rt = runtime();
    const outside = { command: "test.found", input: { files: ["requirements", ws.path("outside.xml")] } };
    runs.length = 0;
    for (const access of ["api", "mcp"] as const) {
      const error = await failure(rt.invoke("test.outer", outside, { workspace: root, access }));
      expect([error.code, error.details?.["fields"], error.details?.["reason"]]).toEqual([
        "input.invalid",
        ["selection.output.input.files[1]"],
        "outside-repositories",
      ]);
      await rt.invoke(
        "test.outer",
        { command: "test.found", input: { files: ["requirements"] } },
        { workspace: root, access },
      );
    }
    // Refused before it ran; the runs it had could not leave the repositories either.
    expect(runs.map((r) => r.open)).toEqual([false, false]);
    vi.stubEnv("HOME", "/home/someone");
    vi.stubEnv("USERPROFILE", "/home/someone");
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    for (const access of ["app", "cli"] as const) {
      await rt.invoke(
        "test.outer",
        { command: "test.found", input: { files: ["~/in.reqif"] } },
        { workspace: root, access },
      );
    }
    const home = os.homedir();
    expect(runs.slice(2).map(({ input, home: shownHome, open }) => [input.files, shownHome, open])).toEqual([
      [[path.join(home, "in.reqif")], home, true],
      [["~/in.reqif"], undefined, true],
    ]);
  });

  it("stops before the inner command runs when the call's signal is aborted", async () => {
    const rt = runtime();
    const controller = new AbortController();
    const aborting = defineTestCommand<{ readonly command: string; readonly input: unknown }, unknown>({
      name: "test.outer",
      run: async (ctx, input) => {
        controller.abort();
        return ctx.readOutputElements(input.command, input.input);
      },
    });
    runs.length = 0;
    const error = await failure(
      runtime({ commands: [aborting, found, write, plain] }).invoke(
        "test.outer",
        { command: "test.found", input: {} },
        { workspace: new Workspace("/w"), signal: controller.signal },
      ),
    );
    expect([error.code, error.details?.["aborted"]]).toEqual(["internal", true]);
    expect(runs).toEqual([]);
    expect(rt.commands.has("test.found")).toBe(true);
  });
});
