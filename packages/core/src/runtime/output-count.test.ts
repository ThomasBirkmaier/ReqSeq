// `readOutputElements` with a number of the output (`selection.output.count`, SR-224 AK4, #1915): the check of
// the count against the catalog and the two ways it is resolved (output-count.ts), with a test catalog on
// fixtures/SR-061/export (UUIDs `61061061-0000-4000-8000-0000000000xx`). What element.list makes of the
// product commands: commands/element/list-count.test.ts.
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { OutputCount, OutputElements } from "../catalog.js";
import { CommandError, defineTestCommand, matchesKey } from "../catalog.js";
import { loadContracts } from "./contracts.js";
import type { CommandRuntimeOptions } from "./invoke.js";
import { createCommandRuntime } from "./invoke.js";
import { Workspace } from "./workspace.js";

const U = (tail: string): string => `61061061-0000-4000-8000-0000000000${tail}`;
const UUIDS = { type: "array", items: { $ref: "../common.schema.json#/$defs/uuid" } };

const entry = (name: string, output: object, fields: object[]): object => ({
  name,
  title: "Test command",
  summary: "Test only.",
  effect: "read",
  stage: 1,
  implements: ["SR-224"],
  arguments: [],
  input: { type: "object", properties: { fail: { type: "boolean" } }, additionalProperties: false },
  output,
  outputFields: fields,
});

const testCatalog = {
  "reqseq-catalog": 1,
  commands: [
    {
      ...entry("test.outer", { type: "object" }, []),
      input: { type: "object", properties: { command: { type: "string" }, input: {}, count: {} } },
    },
    entry("test.counts", { type: "object", properties: { elements: UUIDS } }, [
      { path: "elements", elements: "answer" },
      { path: "total", elements: ["elements"], keys: [] },
      { path: "levels[].ids", elements: true },
      { path: "levels[].n", elements: ["levels[].ids", "levels[].more"], keys: [["type"]] },
      { path: "picked", elements: "selection", keys: [] },
      { path: "rows[].n", elements: "selection", keys: [["id", "repository"]] },
      { path: "rows[].id" },
      { path: "plain", elements: "selection" },
    ]),
    entry("test.unanswered", { type: "object" }, [{ path: "picked", elements: "selection", keys: [] }]),
  ],
};

/** The counts test.counts was asked for. */
const asked: OutputCount[] = [];

const countedElements = (
  _ctx: unknown,
  input: { readonly fail?: boolean },
  count: OutputCount,
): Promise<OutputElements> => {
  if (input.fail === true) {
    throw new CommandError("element.not-found", "No element there");
  }
  asked.push(count);
  return Promise.resolve({
    elements: [{ id: U("b3"), repository: "system" }],
    incomplete: true,
    view: { kind: "core" },
  });
};

const counts = defineTestCommand<{ readonly fail?: boolean }, unknown>({
  name: "test.counts",
  run: () => Promise.resolve({ incomplete: false }),
  outputElements: () =>
    Promise.resolve({ elements: [{ id: U("a1"), repository: "system" }], incomplete: false }),
  countedElements,
});

const unanswered = defineTestCommand<unknown, unknown>({
  name: "test.unanswered",
  run: () => Promise.resolve({}),
});

const outer = defineTestCommand<
  { readonly command: string; readonly input: unknown; readonly count?: OutputCount },
  unknown
>({
  name: "test.outer",
  run: async (ctx, input) => {
    const { elements, incomplete, view } = await ctx.readOutputElements(
      input.command,
      input.input,
      input.count,
    );
    return { ids: elements.map((e) => `${e.repository} ${e.id.slice(-2)}`).sort(), incomplete, view };
  },
});

const contracts = loadContracts({ catalog: testCatalog });
const runtime = (options: CommandRuntimeOptions = {}): ReturnType<typeof createCommandRuntime> =>
  createCommandRuntime({ contracts, commands: [outer, counts, unanswered], ...options });

const open = async (): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-061/export" });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return workspace;
};

const failure = async (promise: Promise<unknown>): Promise<CommandError> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

describe("readOutputElements with a number of the output", () => {
  it("gives the answer for a number of it, and what countedElements gives for a number of lists or of the selection", async () => {
    const workspace = await open();
    const rt = runtime();
    const read = (command: string, count?: object): Promise<unknown> =>
      rt.invoke(
        "test.outer",
        { command, input: {}, ...(count === undefined ? {} : { count }) },
        { workspace },
      );
    expect(await read("test.counts", { field: "total" })).toEqual({ ids: ["system a1"], incomplete: false });
    asked.length = 0;
    expect(
      await read("test.counts", { field: "rows[].n", key: [{ id: "x", repository: "system" }] }),
    ).toEqual({
      ids: ["system b3"],
      incomplete: true,
      view: { kind: "core" },
    });
    // A number marked by the lists it counts gives the records the command counted, not the copies of its UUIDs.
    expect(await read("test.counts", { field: "levels[].n", key: [{ type: "a" }] })).toMatchObject({
      ids: ["system b3"],
    });
    expect(asked).toEqual([
      { field: "rows[].n", key: [{ id: "x", repository: "system" }] },
      { field: "levels[].n", key: [{ type: "a" }] },
    ]);
    // A number in no list may come without keys in the catalog.
    expect(await read("test.counts", { field: "plain" })).toMatchObject({ ids: ["system b3"] });
    // A command without an answer takes a count; without one it lists nothing.
    const bug = await failure(read("test.unanswered", { field: "picked" }));
    expect([bug.code, bug.details?.["cause"]]).toEqual([
      "internal",
      {
        name: "Error",
        message:
          'command test.unanswered has an output field marked x-elements "selection", but no countedElements',
      },
    ]);
    expect((await failure(read("test.unanswered"))).details?.["fields"]).toEqual([
      "selection.output.command",
    ]);
    const withHook = runtime({
      commands: [outer, counts, { ...unanswered, countedElements }],
    });
    expect(
      await withHook.invoke(
        "test.outer",
        { command: "test.unanswered", input: {}, count: { field: "picked" } },
        { workspace },
      ),
    ).toMatchObject({ ids: ["system b3"] });
    const inner = await failure(
      rt.invoke(
        "test.outer",
        { command: "test.counts", input: { fail: true }, count: { field: "picked" } },
        { workspace },
      ),
    );
    expect(inner.message).toBe("selection.output.input: No element there");
  });

  it("refuses a field the output has not, a field that counts no elements, and keys that do not fit its lists", async () => {
    const rt = runtime();
    const ctx = { workspace: new Workspace("/w") };
    const refused = async (count: object): Promise<unknown> =>
      (await failure(rt.invoke("test.outer", { command: "test.counts", input: {}, count }, ctx))).toJSON();
    expect(await refused({ field: "levels[].x" })).toEqual({
      code: "input.invalid",
      message: "selection.output.count.field: test.counts has no output field levels[].x",
      details: { command: "test.outer", fields: ["selection.output.count.field"] },
    });
    for (const field of ["elements", "levels[].ids", "rows[].id"]) {
      expect(await refused({ field })).toMatchObject({
        message: `selection.output.count.field: ${field} of test.counts is no number of elements; the catalog marks those in outputFields with elements`,
      });
    }
    expect(await refused({ field: "levels[].n" })).toEqual({
      code: "input.invalid",
      message:
        "selection.output.count.key: levels[].n is in 1 list; give one entry for each, outermost first",
      details: { command: "test.outer", fields: ["selection.output.count.key"] },
    });
    expect(await refused({ field: "total", key: [{}, {}] })).toMatchObject({
      message: "selection.output.count.key: total is in 0 lists; give one entry for each, outermost first",
    });
    expect(await refused({ field: "rows[].n", key: [{ id: "x", file: "f", value: 1 }] })).toMatchObject({
      message:
        "selection.output.count.key: entry 1 names file, value; an entry of that list is named by id, repository",
    });
  });

  it("matches an entry by its key fields, compared by type", () => {
    expect(matchesKey({ k: 1, v: "x" }, { k: 1 }, ["k"])).toBe(true);
    expect(matchesKey({ k: "1" }, { k: 1 }, ["k"])).toBe(false);
    expect(matchesKey({ k: 1 }, {}, [])).toBe(true);
    expect(matchesKey("x", {}, [])).toBe(false);
  });
});
