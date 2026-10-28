import { getCommandRuntime } from "@logreq/core";
import { describe, expect, it, vi } from "vitest";
import type { CommandListing } from "../shared/protocol.js";
import type { ActionContext, Choice, Prompt } from "./actions.js";
import { ACTIONS, commandPrompt } from "./actions.js";
import type { BufferAction, Buffers } from "./buffers.js";
import { elementBuffer, listBuffer, neighbourhoodBuffer, overviewBuffer, resultBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { CatalogContext } from "./catalog-commands.js";
import { catalogItems, contextField, fits } from "./catalog-commands.js";
import { rank } from "./fuzzy.js";
import { rankByUse } from "./usage.js";
import { CREATE_METAMODEL } from "./create-test-data.js";

const runtime = getCommandRuntime();
/** The catalog as the bridge lists it (`commands()`), with what this version implements. */
const CATALOG: readonly CommandListing[] = runtime.contracts.commands.map((entry) => ({
  ...entry,
  implemented: runtime.commands.has(entry.name),
}));

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type Answer = unknown;

/** A context over `buffers` whose commands answer with `answers[name](input)`; an Error is a failure. */
const setup = (
  buffers: Buffers,
  answers: Record<string, (input: Record<string, unknown>) => Answer> = {},
) => {
  const asked: Prompt[] = [];
  const echoed: string[] = [];
  const dispatched: BufferAction[] = [];
  let reopened = 0;
  let revision = 3;
  const call = vi.fn((name: string, input: Record<string, unknown>) => {
    const output = answers[name]?.(input);
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, code: output.name, message: output.message }
        : { ok: true, output },
    );
  });
  const context: CatalogContext = {
    workspace: true,
    buffers,
    mac: false,
    theme: { shown: () => "light", chosen: () => false, toggle: () => "dark", follow: () => undefined },
    call: call as unknown as Call,
    dispatch: (action) => dispatched.push(action),
    ask: (prompt) => asked.push(prompt),
    echo: (message) => echoed.push(message),
    modified: false,
    closeArmed: () => false,
    armClose: () => undefined,
    discard: () => undefined,
    drafted: () => false,
    opened: [],
    leaveEditor: () => undefined,
    revision: () => revision,
    reopen: () => {
      reopened += 1;
    },
  };
  return {
    context,
    asked,
    echoed,
    dispatched,
    call,
    reopened: () => reopened,
    changed: () => {
      revision += 1;
    },
  };
};

const command = (name: string): CommandListing => {
  const found = CATALOG.find((entry) => entry.name === name);
  if (found === undefined) {
    throw new Error(`no command ${name}`);
  }
  return found;
};

const item = (items: readonly Choice[], name: string): Choice => {
  const found = items.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`no item ${name} in ${items.map((candidate) => candidate.name).join(", ")}`);
  }
  return found;
};

/** The last prompt asked, filled with the parts that came later (`fill`), as the minibuffer shows it. */
const last = async (asked: readonly Prompt[]): Promise<Prompt> => {
  await flush();
  const prompt = asked.at(-1);
  if (prompt === undefined) {
    throw new Error("nothing asked");
  }
  return prompt.fill === undefined ? prompt : { ...prompt, ...(await prompt.fill) };
};

const start = (context: ActionContext & CatalogContext, name: string, more = false): void => {
  const choice = item(catalogItems(context, CATALOG, ACTIONS), command(name).title);
  (more ? choice.more : choice.run)?.();
};

const OPTIONS = {
  kinds: [
    { kind: "derives-from", name: "derives from", targetTypes: ["need"] },
    { kind: "refines", name: "refines", targetTypes: ["need"] },
  ],
};

const hit = (n: number) => ({
  id: `uuid-${String(n)}`,
  shortId: `SR-00000${String(n)}`,
  type: "need",
  title: `Title ${String(n)}`,
  repository: "spec",
  file: `f${String(n)}.md`,
  terms: ["tit"],
  fields: ["title"],
});

describe("catalog commands in the command prompt", () => {
  const list = listBuffer("type: need", { where: { type: ["need"] } });
  const shown = elementBuffer("uuid-1", "spec", "SR-1 Title 1");

  it("offers every implemented read command by its title, or the action that covers it", () => {
    const { context } = setup([list]);
    const offered = new Set(
      commandPrompt(context, undefined, catalogItems(context, CATALOG, ACTIONS)).items.map((i) => i.name),
    );
    const reachable = (entry: CommandListing): boolean =>
      offered.has(entry.title) ||
      ACTIONS.some((action) => action.title === entry.title || action.covers?.includes(entry.name) === true);
    const reads = CATALOG.filter((entry) => entry.implemented && entry.effect === "read");
    expect(reads.length).toBeGreaterThan(10);
    expect(reads.filter((entry) => !reachable(entry)).map((entry) => entry.name)).toEqual([]);
    // Covered commands are not listed twice, write commands and the unimplemented ones not yet.
    expect(offered.has("Get element")).toBe(false);
    expect(offered.has("Create relation")).toBe(false);
    expect(offered.has("Show baseline")).toBe(false);
    expect(offered.has("Show relation options")).toBe(true);
  });

  it("lists trace.graph only as the action that opens the graph buffer, whatever its title", () => {
    const { context } = setup([list]);
    expect(catalogItems(context, [{ ...command("trace.graph"), title: "Graph it" }], ACTIONS)).toEqual([]);
    expect(catalogItems(context, [{ ...command("trace.graph"), title: "Graph it" }], [])).toHaveLength(1);
  });

  it("gives no two equal names in the prompt", () => {
    const { context } = setup([shown]);
    const names = commandPrompt(context, undefined, catalogItems(context, CATALOG, ACTIONS)).items.map(
      (i) => i.name,
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("[SR-108/AK1] finds a catalog command by its initials and with one slip among the first three", () => {
    const { context } = setup([list]);
    const items = commandPrompt(context, undefined, catalogItems(context, CATALOG, ACTIONS)).items;
    const top = (query: string): string[] =>
      rank(items, (i) => i.name, query)
        .slice(0, 3)
        .map(({ item: i }) => i.name);
    expect(top("sro")).toContain("Show relation options");
    expect(top("lh")).toContain("List hints");
    expect(top("chek workspace")).toContain("Check workspace");
    expect(top("shwo trace chain")).toContain("Show trace chain");
  });

  it("offers a command that needs the shown list's selection only on a list, and fills it in", async () => {
    const needs = {
      ...command("element.facets"),
      input: { ...command("element.facets").input, required: ["selection"] },
    };
    expect(catalogItems(setup([shown]).context, [needs], [])).toEqual([]);
    const { context, dispatched, call } = setup([list], { "element.facets": () => ({ total: 1 }) });
    const [only] = catalogItems(context, [needs], []);
    only?.run();
    await flush();
    expect(call).toHaveBeenCalledWith("element.facets", { selection: { where: { type: ["need"] } } });
    expect(dispatched).toEqual([
      {
        type: "open",
        buffer: resultBuffer(
          "element.facets",
          { selection: { where: { type: ["need"] } } },
          "Show facets",
          { total: 1 },
          3,
        ),
      },
    ]);
  });

  it("runs a command without required arguments at once and shows its output in a result buffer", async () => {
    const { context, dispatched, asked } = setup([shown], { "filter.list": () => ({ filters: [] }) });
    start(context, "filter.list");
    await flush();
    expect(asked).toEqual([]);
    expect(dispatched).toEqual([
      { type: "open", buffer: resultBuffer("filter.list", {}, "List saved filters", { filters: [] }, 3) },
    ]);
    // A selection that is not required is left out where no list is shown.
    start(context, "element.facets");
    await flush();
    expect(dispatched.at(-1)).toMatchObject({ buffer: { command: "element.facets", input: {} } });
  });

  it("asks an element with the shown element first, then the kinds relation.options allows from it", async () => {
    const { context, asked, dispatched, call } = setup([shown], {
      "relation.options": () => OPTIONS,
    });
    start(context, "relation.options");
    const ref = await last(asked);
    expect(ref.label).toBe("Show relation options · ref:");
    expect(ref.items.map((i) => i.name)).toEqual(["SR-1 Title 1"]);
    ref.items[0]?.run();
    await flush();
    // ref was the last required argument: Enter runs the command.
    expect(call).toHaveBeenLastCalledWith("relation.options", { ref: "uuid-1" });
    expect(dispatched.at(-1)).toMatchObject({ type: "open", buffer: { name: "Show relation options SR-1" } });
  });

  it("offers the optional arguments on Ctrl/Cmd+Enter, Run first, and their candidates from core", async () => {
    const { context, asked, call } = setup([neighbourhoodBuffer("uuid-1", "spec", "SR-1 Title 1")], {
      "relation.options": () => OPTIONS,
    });
    start(context, "relation.options");
    const ref = await last(asked);
    ref.items[0]?.more?.();
    const more = await last(asked);
    expect(more.label).toBe("Show relation options SR-1 · more arguments:");
    expect(more.items.map((i) => i.name)).toEqual(["Run", "kind"]);
    item(more.items, "kind").run();
    const kind = await last(asked);
    expect(call).toHaveBeenLastCalledWith("relation.options", { ref: "uuid-1" });
    expect(kind.label).toBe("Show relation options SR-1 · kind:");
    expect(kind.items.map((i) => i.name)).toEqual(["derives from", "refines"]);
    item(kind.items, "refines").run();
    // Still in "more": the prompt offers what is left, and Run runs it.
    const again = await last(asked);
    expect(again.items.map((i) => i.name)).toEqual(["Run"]);
    again.items[0]?.more?.();
    await flush();
    expect(call).toHaveBeenLastCalledWith("relation.options", { ref: "uuid-1", kind: "refines" });
  });

  it("puts the selected row of the shown list first for an element argument", async () => {
    const row = elementBuffer("uuid-7", "spec", "SR-7 Title 7");
    const { context, asked, call } = setup([list], { "trace.affected": () => ({ elements: [], total: 0 }) });
    start({ ...context, row }, "trace.affected");
    const ref = await last(asked);
    expect(ref.items.map((i) => i.name)).toEqual(["SR-7 Title 7"]);
    ref.items[0]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("trace.affected", { ref: "uuid-7" });
    // The shown element wins over a row.
    const shownToo = setup([shown]);
    start({ ...shownToo.context, row }, "trace.affected");
    expect((await last(shownToo.asked)).items.map((i) => i.name)).toEqual(["SR-1 Title 1"]);
  });

  it("opens the prompt of an argument at once with its label and fills its candidates when they arrive", async () => {
    const { context, asked } = setup([shown], { "relation.options": () => OPTIONS });
    start(context, "relation.options");
    // Before any answer: the prompt is there, with its label and no candidates yet.
    expect(asked.at(-1)?.label).toBe("Show relation options · ref:");
    expect(asked.at(-1)?.items).toEqual([]);
    expect((await asked.at(-1)?.fill)?.items?.map((i) => i.name)).toEqual(["SR-1 Title 1"]);
  });

  it("gives a result buffer the revision when the command runs, not when its prompt opened", async () => {
    const { context, asked, dispatched, changed } = setup([shown], {
      "relation.options": () => OPTIONS,
    });
    start(context, "relation.options");
    const ref = await last(asked);
    changed();
    ref.items[0]?.run();
    await flush();
    expect(dispatched.at(-1)).toMatchObject({ type: "open", buffer: { revision: 4 } });
  });

  it("gives a result buffer the revision the command read, when the workspace changes while it runs", async () => {
    let during = (): void => undefined;
    const { context, asked, dispatched, changed } = setup([shown], {
      "relation.options": () => {
        during();
        return OPTIONS;
      },
    });
    during = changed;
    start(context, "relation.options");
    const ref = await last(asked);
    ref.items[0]?.run();
    await flush();
    expect(dispatched.at(-1)).toMatchObject({ type: "open", buffer: { revision: 3 } });
  });

  it("finds elements for an element argument and takes the one chosen", async () => {
    const { context, asked, call } = setup([list], {
      "element.search": () => ({ hits: [hit(4)], total: 1 }),
      "trace.affected": () => ({ elements: [], total: 0 }),
    });
    start(context, "trace.affected");
    const ref = await last(asked);
    // No row of the list has loaded, so nothing comes first.
    expect(ref.items).toEqual([]);
    const found = await ref.find?.("tit");
    expect(found?.map((i) => i.name)).toEqual(["SR-000004 Title 4"]);
    found?.[0]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("trace.affected", { ref: "uuid-4" });
    // Ctrl/Cmd+Enter on a hit: taken, then the optional arguments.
    (await ref.find?.("tit"))?.[0]?.more?.();
    expect((await last(asked)).label).toBe("Show affected elements SR-000004 · more arguments:");
  });

  it("takes values of a list argument one per Enter and ends it with Enter on an empty input", async () => {
    const { context, asked, call } = setup([shown], {
      "element.search": () => ({ hits: [hit(2)], total: 1 }),
      "trace.related": () => ({ elements: [], total: 0 }),
    });
    start(context, "trace.related");
    const first = await last(asked);
    expect(first.empty).toBeUndefined();
    first.items[0]?.run();
    const second = await last(asked);
    expect(second.label).toBe("Show related elements SR-1 · refs:");
    (await second.find?.("t"))?.[0]?.run();
    const third = await last(asked);
    third.empty?.(false);
    const direction = await last(asked);
    expect(direction.label).toBe("Show related elements SR-1 SR-000002 · direction:");
    // Back: SR-000002 is taken back, and refs takes values again with SR-1 kept.
    direction.back?.();
    const refs = await last(asked);
    expect(refs.label).toBe("Show related elements SR-1 · refs:");
    expect(refs.empty).toBeDefined();
    expect(direction.items.map((i) => i.name)).toEqual(["children", "parents"]);
    item(direction.items, "parents").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("trace.related", {
      refs: ["uuid-1", "uuid-2"],
      direction: "parents",
    });
  });

  it("ends a list argument with Ctrl/Cmd+Enter on an empty input and offers the optional arguments", async () => {
    const { context, asked, call } = setup([shown], {
      "trace.related": () => ({ elements: [], total: 0 }),
    });
    start(context, "trace.related");
    (await last(asked)).items[0]?.run();
    (await last(asked)).empty?.(true);
    const direction = await last(asked);
    expect(direction.label).toBe("Show related elements SR-1 · direction:");
    item(direction.items, "parents").run();
    expect((await last(asked)).label).toBe("Show related elements SR-1 parents · more arguments:");
    expect(call).not.toHaveBeenCalledWith("trace.related", expect.anything());
  });

  it("goes back one argument on Backspace, and before the first to the command prompt", async () => {
    const { context, asked, reopened } = setup([shown], { "trace.related": () => ({ elements: [] }) });
    start(context, "trace.related");
    const first = await last(asked);
    first.back?.();
    expect(reopened()).toBe(1);
    first.items[0]?.run();
    const second = await last(asked);
    second.empty?.(false);
    const direction = await last(asked);
    direction.back?.();
    // Back in the list argument: its last value is taken back, and it takes values again.
    const again = await last(asked);
    expect(again.label).toBe("Show related elements · refs:");
    expect(again.empty).toBeUndefined();
    item(direction.items, "children").more?.();
    const more = await last(asked);
    more.back?.();
    expect((await last(asked)).label).toBe("Show related elements SR-1 · direction:");
  });

  it("keeps the prompt on the argument core refused, with core's message", async () => {
    const invalid = Object.assign(new Error("Invalid input for trace.chain: maxDepth must be >= 0"), {
      name: "input.invalid",
    });
    const { context, asked, echoed } = setup([shown], { "trace.chain": () => invalid });
    start(context, "trace.chain", true);
    (await last(asked)).items[0]?.run();
    const more = await last(asked);
    item(more.items, "maxDepth").run();
    const depth = await last(asked);
    expect(depth.items).toEqual([]);
    depth.text?.("-1");
    item((await last(asked)).items, "Run").run();
    const again = await last(asked);
    expect(again.label).toBe(
      "Invalid input for trace.chain: maxDepth must be >= 0 · Show trace chain SR-1 · maxDepth:",
    );
    expect(echoed).toEqual([]);
  });

  it("says why a command failed in the minibuffer, and why a source failed in the prompt's label", async () => {
    const { context, asked, echoed } = setup([shown], {
      "workspace.status": () => new Error("No workspace"),
      "element.get": () => new Error("Gone"),
    });
    start(context, "workspace.status");
    await flush();
    expect(echoed).toEqual(["No workspace"]);
    const get = { ...command("element.get"), title: "Read it" };
    catalogItems(context, [get], [])[0]?.more?.();
    item((await last(asked)).items, "SR-1 Title 1").run();
    item((await last(asked)).items, "repository").run();
    const repository = await last(asked);
    expect(repository.label).toBe("No workspace · Read it SR-1 · repository:");
    expect(repository.items).toEqual([]);
    expect(echoed).toEqual(["No workspace"]);
  });

  /** The answers of a workspace with one repository, one type and one relation kind. */
  const sources = () =>
    setup([shown], {
      "workspace.status": () => ({ repositories: [{ name: "spec", available: true }] }),
      "metamodel.get": () => ({
        types: [{ key: "need", name: "Need" }],
        relations: [{ key: "refines", name: "Refines" }],
      }),
      "element.get": () => ({ element: hit(1) }),
    });

  /** Takes the candidate `name` of the last prompt (the first without a name), with Ctrl/Cmd+Enter when `more`. */
  const pick = async (asked: readonly Prompt[], name?: string, more = false): Promise<void> => {
    const prompt = await last(asked);
    const found = name === undefined ? prompt.items[0] : item(prompt.items, name);
    const run = more ? found?.more : found?.run;
    if (run === undefined) {
      throw new Error(`nothing to take in ${prompt.label}`);
    }
    run();
  };

  /** Types `text` into the last prompt, with Ctrl/Cmd+Enter when `more`. */
  const answer = async (asked: readonly Prompt[], text: string, more = false): Promise<void> => {
    const prompt = await last(asked);
    const run = more ? prompt.more : prompt.text;
    if (run === undefined) {
      throw new Error(`no text in ${prompt.label}`);
    }
    run(text);
  };

  const names = async (asked: readonly Prompt[]): Promise<string[]> =>
    (await last(asked)).items.map((candidate) => candidate.name);

  it("takes yes or no, the repositories of the workspace and typed text", async () => {
    const { context, asked, call } = sources();
    catalogItems(context, [{ ...command("element.get"), title: "Read it" }], [])[0]?.more?.();
    await pick(asked);
    await pick(asked, "repository");
    expect(await names(asked)).toEqual(["spec"]);
    await pick(asked, "spec", true);
    await pick(asked, "versionDate");
    expect(await names(asked)).toEqual(["yes", "no"]);
    await pick(asked, "yes", true);
    await pick(asked, "view");
    await answer(asked, "brief", true);
    await pick(asked, "Run");
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.get", {
      ref: "uuid-1",
      repository: "spec",
      versionDate: true,
      view: "brief",
    });
    catalogItems(context, [{ ...command("hint.list"), title: "Hints" }], [])[0]?.more?.();
    await pick(asked, "type");
    expect(await names(asked)).toEqual(["Need"]);
  });

  const numbers = {
    ...command("element.facets"),
    title: "Numbers",
    arguments: [
      { field: "maxValues", complete: "number" as const },
      { field: "data", complete: "json" as const },
      { field: "kinds", complete: "relationKind" as const },
      { field: "status", complete: "status" as const },
      { field: "meanings", complete: "choice" as const },
      { field: "none", complete: "choice" as const },
    ],
    input: {
      type: "object",
      properties: { meanings: { type: "array", items: { enum: ["derivation", "package"] } } },
      required: ["maxValues", "data", "kinds", "status"],
    },
  };

  it("types numbers and JSON and leaves any other text to core; relation kinds of the metamodel without an element", async () => {
    const { context, asked, call } = sources();
    catalogItems(context, [numbers], [])[0]?.run();
    await answer(asked, "30");
    await answer(asked, '{"a":1}');
    expect(await names(asked)).toEqual(["Refines"]);
    await pick(asked);
    await answer(asked, "draft");
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.facets", {
      maxValues: 30,
      data: { a: 1 },
      kinds: "refines",
      status: "draft",
    });
    catalogItems(context, [numbers], [])[0]?.run();
    await answer(asked, "many");
    await answer(asked, "{a");
    await pick(asked);
    await answer(asked, "");
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.facets", {
      maxValues: "many",
      data: "{a",
      kinds: "refines",
      status: "",
    });
  });

  it("offers the inline enum of a choice, also of a list field", async () => {
    const { context, asked } = sources();
    catalogItems(context, [numbers], [])[0]?.more?.();
    await answer(asked, "1");
    await answer(asked, "1");
    await pick(asked);
    await answer(asked, "x");
    await pick(asked, "meanings");
    expect(await names(asked)).toEqual(["derivation", "package"]);
    await pick(asked, "derivation", true);
    await pick(asked, "none");
    expect(await names(asked)).toEqual([]);
  });

  it("reads the field a source depends on: `of`, else the nearest earlier field of a fitting source", () => {
    const args = [
      { field: "source", complete: "element" as const },
      { field: "kind", complete: "relationKind" as const },
      { field: "target", complete: "relationTarget" as const },
      { field: "other", complete: "relation" as const, of: "source" },
      { field: "text", complete: "text" as const },
    ];
    expect(contextField(args, 1)).toBe("source");
    expect(contextField(args, 2)).toBe("kind");
    expect(contextField(args, 3)).toBe("source");
    expect(contextField(args, 4)).toBeUndefined();
    expect(contextField(args, 0)).toBeUndefined();
    expect(contextField(args, 9)).toBeUndefined();
  });
});

describe("the commands that fit the shown view", () => {
  const list = listBuffer("type: need", { where: { type: ["need"] } });
  const shown = elementBuffer("uuid-1", "spec", "SR-1 Title 1");
  const around = neighbourhoodBuffer("uuid-1", "spec", "SR-1 Title 1");
  /** The command prompt with nothing typed and nothing used, as the minibuffer orders it. */
  const prompt = (buffers: Buffers): Choice[] => {
    const { context } = setup(buffers);
    const { items } = commandPrompt(context, undefined, catalogItems(context, CATALOG, ACTIONS));
    return rankByUse(items, (choice) => choice.name, "", undefined).map(({ item: choice }) => choice);
  };

  it("[SR-133/AK1] fits a command with a required element argument to a shown element, one with the selection to a list", () => {
    const fitting = (buffers: Buffers, name: string): boolean => fits(setup(buffers).context, command(name));
    for (const buffers of [[shown], [around]]) {
      expect(fitting(buffers, "trace.chain")).toBe(true);
      expect(fitting(buffers, "relation.options")).toBe(true);
      // An element argument that is not required, the selection, or no argument: the view gives nothing.
      expect(fitting(buffers, "hint.list")).toBe(false);
      expect(fitting(buffers, "element.facets")).toBe(false);
      expect(fitting(buffers, "baseline.list")).toBe(false);
    }
    expect(fitting([list], "element.facets")).toBe(true);
    expect(fitting([list], "evidence.coverage")).toBe(true);
    expect(fitting([list], "trace.chain")).toBe(false);
    expect(fitting([list], "workspace.status")).toBe(false);
    expect(fitting([overviewBuffer()], "trace.chain")).toBe(false);
    expect(fitting([], "element.facets")).toBe(false);
  });

  it("[SR-133/AK1] shows the actions and the fitting commands above the others when nothing is typed", () => {
    for (const buffers of [[shown], [list], [overviewBuffer()]]) {
      const items = prompt(buffers);
      const below = items.findIndex((choice) => choice.fits !== true);
      // The fitting ones come first, all of them: none is below the first that does not fit.
      expect(below).toBeGreaterThan(0);
      expect(items.slice(below).filter((choice) => choice.fits === true)).toEqual([]);
      // Every action shown fits; the others are catalog commands, still in the prompt.
      expect(items.slice(below).every((choice) => choice.id.startsWith("command:"))).toBe(true);
    }
    /** The `wanted` names in the order the prompt shows them; a name that is missing fails the check. */
    const order = (buffers: Buffers, wanted: readonly string[]): string[] =>
      prompt(buffers)
        .map((choice) => choice.name)
        .filter((name) => wanted.includes(name));
    // In the catalog "Show workspace status" comes first; in an element it is below the element's commands.
    expect(
      order(
        [shown],
        ["Show relation options", "Show trace chain", "Show workspace status", "Check workspace"],
      ),
    ).toEqual(["Show relation options", "Show trace chain", "Show workspace status", "Check workspace"]);
    expect(order([list], ["Show trace chain", "Show facets"])).toEqual(["Show facets", "Show trace chain"]);
  });
});

describe('"Create element": the required properties asked in the command line (SR-064)', () => {
  /** What core gives for a new element: the element of the input, with a hint for each `hints` key. */
  const created =
    (hints: readonly string[] = []) =>
    (input: Record<string, unknown>) => ({
      element: {
        id: "uuid-9",
        type: input["type"],
        repository: "spec",
        file: "report/REP-000009.md",
        shortId: "REP-000009",
        title: input["title"],
        properties: {},
        relations: [],
        text: "",
      },
      files: ["report/REP-000009.md"],
      problems: hints.map((key) => ({
        code: "element.missing-required",
        severity: "warning",
        message: `Required property ${key} has no value`,
      })),
    });

  const creating = (answers: Record<string, (input: Record<string, unknown>) => Answer> = {}) =>
    setup([overviewBuffer()], {
      "metamodel.get": () => CREATE_METAMODEL,
      "element.create": created(),
      "element.search": () => ({ hits: [hit(4)], total: 1 }),
      ...answers,
    });

  /** Starts "Create element" and answers the type and the title; resolves the prompt asked next. */
  const typeAndTitle = async (
    { context, asked }: ReturnType<typeof setup>,
    type: string,
    title: string,
  ): Promise<Prompt> => {
    start(context, "element.create");
    item((await last(asked)).items, type).run();
    (await last(asked)).text?.(title);
    return last(asked);
  };

  it("[SR-064/AK1] is in the command prompt once, by the title of element.create, and asks the type among the types that can have elements", async () => {
    const running = creating();
    const { context, asked, call } = running;
    const names = commandPrompt(context, undefined, catalogItems(context, CATALOG, ACTIONS)).items.map(
      (i) => i.name,
    );
    expect(names.filter((name) => name === "Create element")).toHaveLength(1);
    // The other write commands are not offered yet (#85 PR 5b).
    expect(names).not.toContain("Update element");
    start(context, "element.create");
    const type = await last(asked);
    expect(type.label).toBe("Create element · type:");
    expect(call).toHaveBeenLastCalledWith("metamodel.get", {});
    // Not the abstract "Item"; in metamodel order, by name.
    expect(type.items.map((i) => i.name)).toEqual([
      "System Requirement",
      "Software Requirement",
      "Decision",
      "Package",
      "Report",
      "Note",
    ]);
  });

  it("[SR-064/AK1] asks, after the type and the title, only the required properties of the type, one after the other", async () => {
    const running = creating();
    const { asked, call } = running;
    const labels: string[] = [];
    let prompt = await typeAndTitle(running, "Report", "Wind gusts");
    // Each required property but the title, in the order of the type, and none of the optional ones.
    while (prompt.empty !== undefined) {
      labels.push(prompt.label);
      prompt.empty(false);
      if (call.mock.lastCall?.[0] === "element.create") {
        break;
      }
      prompt = await last(asked);
    }
    expect(labels).toEqual([
      "Create element Report Wind gusts · severity:",
      "Create element Report Wind gusts · packages:",
      "Create element Report Wind gusts · component:",
    ]);
    // A type whose only required property is the title asks nothing more and creates the element.
    const decision = creating();
    start(decision.context, "element.create");
    item((await last(decision.asked)).items, "Decision").run();
    (await last(decision.asked)).text?.("Use wind");
    await flush();
    expect(decision.call).toHaveBeenLastCalledWith("element.create", { type: "decision", title: "Use wind" });
    // With Ctrl/Cmd+Enter on the title its optional arguments follow, never `properties`.
    const more = creating();
    start(more.context, "element.create");
    item((await last(more.asked)).items, "Decision").run();
    (await last(more.asked)).more?.("Use wind");
    expect((await last(more.asked)).items.map((i) => i.name)).toEqual([
      "Run",
      "text",
      "repository",
      "folder",
    ]);
  });

  it("[SR-064/AK2] creates the element with every required property left empty, opens it, and says how many hints core gave", async () => {
    const running = creating({ "element.create": created(["severity", "packages", "component"]) });
    const { asked, call, dispatched, echoed } = running;
    let prompt = await typeAndTitle(running, "Report", "Wind gusts");
    for (let at = 0; at < 3; at += 1) {
      prompt.empty?.(false);
      prompt = await last(asked);
    }
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.create", { type: "report", title: "Wind gusts" });
    expect(dispatched.at(-1)).toEqual({
      type: "open",
      buffer: elementBuffer("uuid-9", "spec", "REP-000009 Wind gusts"),
    });
    expect(echoed.at(-1)).toBe("Created REP-000009 Wind gusts · 3 hints");
  });

  it("[SR-064/AK2] creates the element with an empty title too, when the title is left empty", async () => {
    const running = creating({ "element.create": created(["title"]) });
    const { context, asked, call, echoed } = running;
    start(context, "element.create");
    item((await last(asked)).items, "Decision").run();
    (await last(asked)).text?.("");
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.create", { type: "decision", title: "" });
    expect(echoed.at(-1)).toBe("Created REP-000009 · 1 hint");
  });

  it("takes a text, the targets found among the target types and the choices of the metamodel, a list one value per Enter", async () => {
    const running = creating();
    const { asked, call } = running;
    const severity = await typeAndTitle(running, "Report", "Wind gusts");
    expect(severity.items).toEqual([]);
    severity.text?.("3");
    const packages = await last(asked);
    expect(packages.label).toBe("Create element Report Wind gusts 3 · packages:");
    const found = await packages.find?.("pkg");
    expect(call).toHaveBeenLastCalledWith("element.search", {
      query: "pkg",
      selection: { where: { type: ["package"] } },
      fields: ["id", "title"],
      limit: 20,
    });
    found?.[0]?.run();
    // A list: the same property takes more, Enter on an empty input ends it.
    const morePackages = await last(asked);
    expect(morePackages.label).toBe("Create element Report Wind gusts 3 SR-000004 · packages:");
    morePackages.empty?.(false);
    const component = await last(asked);
    expect(component.label).toBe("Create element Report Wind gusts 3 SR-000004 · component:");
    expect(component.items.map((i) => [i.name, i.hint])).toEqual([
      ["Display", "display"],
      ["Sensor", "sensor"],
    ]);
    item(component.items, "Sensor").run();
    // A choice taken is not offered again.
    const moreComponents = await last(asked);
    expect(moreComponents.items.map((i) => i.name)).toEqual(["Display"]);
    moreComponents.empty?.(false);
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.create", {
      type: "report",
      title: "Wind gusts",
      properties: {
        severity: 3,
        packages: [{ id: "uuid-4", repository: "spec" }],
        component: ["sensor"],
      },
    });
  });

  it("finds any element for a relation property without target types, and none for one that may point at no type", async () => {
    const running = creating();
    const { asked, call } = running;
    const related = await typeAndTitle(running, "Note", "On wind");
    await related.find?.("tit");
    expect(call).toHaveBeenLastCalledWith("element.search", {
      query: "tit",
      fields: ["id", "title"],
      limit: 20,
    });
    // Ctrl/Cmd+Enter on a found element: taken; the optional arguments follow the required properties.
    (await related.find?.("tit"))?.[0]?.more?.();
    const scope = await last(asked);
    expect(scope.label).toBe("Create element Note On wind SR-000004 · scope:");
    expect(scope.find).toBeUndefined();
    scope.empty?.(false);
    const more = await last(asked);
    expect(more.label).toBe("Create element Note On wind SR-000004 · more arguments:");
    // The other properties are added in the element buffer, not as `properties` here.
    expect(more.items.map((i) => i.name)).toEqual(["Run", "text", "repository", "folder"]);
    item(more.items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.create", {
      type: "note",
      title: "On wind",
      properties: { related: { id: "uuid-4", repository: "spec" } },
    });
  });

  it("offers the optional arguments after the required properties with Ctrl/Cmd+Enter on a property: on a text, an empty input and a choice", async () => {
    const running = creating();
    const { asked, call } = running;
    const severity = await typeAndTitle(running, "Report", "Wind gusts");
    severity.more?.("2");
    // The required properties not answered yet come first.
    const packages = await last(asked);
    expect(packages.label).toBe("Create element Report Wind gusts 2 · packages:");
    packages.empty?.(true);
    const component = await last(asked);
    // Ctrl/Cmd+Enter on a choice of a list: taken, and the list takes no more.
    item(component.items, "Display").more?.();
    const more = await last(asked);
    expect(more.label).toBe("Create element Report Wind gusts 2 Display · more arguments:");
    item(more.items, "text").run();
    (await last(asked)).text?.("Gusts above 20 m/s.");
    item((await last(asked)).items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.create", {
      type: "report",
      title: "Wind gusts",
      text: "Gusts above 20 m/s.",
      properties: { severity: 2, component: ["display"] },
    });
  });

  it("goes back one answer with Backspace in an empty input: a property value, a skipped property, then the title", async () => {
    const running = creating();
    const { asked } = running;
    const severity = await typeAndTitle(running, "Report", "Wind gusts");
    severity.text?.("3");
    (await (await last(asked)).find?.("pkg"))?.[0]?.run();
    (await (await last(asked)).find?.("pkg"))?.[0]?.run();
    const morePackages = await last(asked);
    expect(morePackages.label).toBe("Create element Report Wind gusts 3 SR-000004 SR-000004 · packages:");
    // The target given last goes; the list keeps the one before and takes values again.
    morePackages.back?.();
    const onePackage = await last(asked);
    expect(onePackage.label).toBe("Create element Report Wind gusts 3 SR-000004 · packages:");
    onePackage.back?.();
    const packages = await last(asked);
    expect(packages.label).toBe("Create element Report Wind gusts 3 · packages:");
    packages.empty?.(false);
    const component = await last(asked);
    expect(component.label).toBe("Create element Report Wind gusts 3 · component:");
    // The skipped list property is asked again, with no value.
    component.back?.();
    const again = await last(asked);
    expect(again.label).toBe("Create element Report Wind gusts 3 · packages:");
    again.back?.();
    expect((await last(asked)).label).toBe("Create element Report Wind gusts · severity:");
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe("Create element Report · title:");
  });

  it("asks a property again with core's message when core refuses the input, and says why it cannot create one otherwise", async () => {
    const refusal = Object.assign(new Error("properties.severity: must be a number"), {
      name: "input.invalid",
    });
    const refused = creating({ "element.create": () => refusal });
    let prompt = await typeAndTitle(refused, "Report", "Wind gusts");
    prompt.text?.("high");
    for (let at = 0; at < 2; at += 1) {
      prompt = await last(refused.asked);
      prompt.empty?.(false);
    }
    expect((await last(refused.asked)).label).toBe(
      "properties.severity: must be a number · Create element Report Wind gusts high · component:",
    );
    const readOnly = Object.assign(new Error("The workspace is read-only"), { name: "workspace.read-only" });
    const locked = creating({ "element.create": () => readOnly });
    start(locked.context, "element.create");
    item((await last(locked.asked)).items, "Decision").run();
    (await last(locked.asked)).text?.("Use wind");
    await flush();
    expect(locked.echoed.at(-1)).toBe("The workspace is read-only");
    expect(locked.dispatched).toEqual([]);
  });
});
