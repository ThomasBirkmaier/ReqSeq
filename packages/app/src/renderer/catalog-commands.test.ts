import { getCommandRuntime } from "@reqseq/core";
import { describe, expect, it, vi } from "vitest";
import type { CommandListing } from "../shared/protocol.js";
import type { ActionContext, Choice, Prompt } from "./actions.js";
import { ACTIONS, commandPrompt } from "./actions.js";
import type { BufferAction, Buffers } from "./buffers.js";
import { elementBuffer, listBuffer, neighbourhoodBuffer, overviewBuffer, resultBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { CatalogContext } from "./catalog-commands.js";
import { PREFIX_BINDINGS } from "./bindings.js";
import { catalogItems, contextField, fits, refusedOf } from "./catalog-commands.js";
import { rank } from "./fuzzy.js";
import { rankByUse } from "./usage.js";
import { CREATE_METAMODEL } from "./create-test-data.js";
import { FIXTURE_METAMODEL } from "./metamodel-test-data.js";

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
        ? {
            ok: false,
            code: output.name,
            message: output.message,
            ...("details" in output ? { details: output.details } : {}),
          }
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

/** A refusal of core with `details`, as the bridge gives it (`input.invalid`). */
const refusedWith = (message: string, details: Record<string, unknown>): Error =>
  Object.assign(new Error(message), { name: "input.invalid", details });

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
    // Covered commands are not listed twice, the unimplemented ones not yet.
    expect(offered.has("Get element")).toBe(false);
    expect(offered.has("Update element")).toBe(false);
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

  it("[SR-109/AK2] shows nothing next to a catalog command without a key", () => {
    const bound = new Set(PREFIX_BINDINGS.map((binding) => binding.id));
    for (const buffers of [[list], [shown]]) {
      const { context } = setup(buffers);
      const items = catalogItems(context, CATALOG, ACTIONS).filter((i) => !bound.has(i.id));
      expect(items.length).toBeGreaterThan(0);
      expect(items.filter((i) => i.hint !== undefined)).toEqual([]);
      // Listed in the prompt after the actions, still without one.
      const prompt = commandPrompt(context, undefined, catalogItems(context, CATALOG, ACTIONS)).items;
      expect(
        prompt.filter((i) => i.id.startsWith("command:") && !bound.has(i.id) && i.hint !== undefined),
      ).toEqual([]);
    }
  });

  it("[SR-121/AK3] gives Create element its fixed shortcut in the prompt, and no other catalog command one", () => {
    for (const buffers of [[list], [shown]]) {
      for (const mac of [false, true]) {
        const { context } = setup(buffers);
        const items = commandPrompt(
          { ...context, mac },
          undefined,
          catalogItems({ ...context, mac }, CATALOG, ACTIONS),
        ).items.filter((i) => i.id.startsWith("command:"));
        expect(items.find((i) => i.name === "Create element")?.hint).toBe(mac ? "⌘K E" : "Ctrl+K E");
        // Only the commands with a letter after the prefix have a hint, and it is that letter.
        expect(
          items
            .filter((i) => i.hint !== undefined)
            .map((i) => i.id)
            .sort(),
        ).toEqual(
          PREFIX_BINDINGS.filter((binding) => binding.id.startsWith("command:"))
            .map((binding) => binding.id)
            .sort(),
        );
      }
    }
  });

  it("[SR-121/AK3] gives Create relation, Set status and Confirm hints their fixed shortcut", () => {
    for (const mac of [false, true]) {
      const { context } = setup([shown]);
      const items = catalogItems({ ...context, mac }, CATALOG, ACTIONS);
      const hintOf = (title: string): string | undefined => items.find((i) => i.name === title)?.hint;
      const prefix = mac ? "⌘K" : "Ctrl+K";
      expect(hintOf("Create relation")).toBe(`${prefix} R`);
      expect(hintOf("Set status")).toBe(`${prefix} T`);
      expect(hintOf("Confirm hints")).toBe(`${prefix} H`);
    }
  });

  it("[SR-121/AK3] offers no write command with a letter in a read-only workspace, so the letter is not shown", () => {
    const { context } = setup([shown]);
    const ids = new Set(catalogItems({ ...context, readOnly: true }, CATALOG, ACTIONS).map((i) => i.id));
    for (const binding of PREFIX_BINDINGS.filter((row) => row.id.startsWith("command:"))) {
      expect(ids.has(binding.id)).toBe(false);
    }
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

  it("[SR-108/AK4] finds elements by element.search for an element argument, and takes the one chosen", async () => {
    const { context, asked, call } = setup([list], {
      "element.search": () => ({ hits: [hit(4)], total: 1 }),
      "trace.affected": () => ({ elements: [], total: 0 }),
    });
    start(context, "trace.affected");
    const ref = await last(asked);
    // No row of the list has loaded, so nothing comes first.
    expect(ref.items).toEqual([]);
    const found = await ref.find?.("tit");
    expect(call).toHaveBeenLastCalledWith("element.search", expect.objectContaining({ query: "tit" }));
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

  it("reads the refused argument from core's details: a schema violation's field, else a property's key", () => {
    const violation = (field: string) => ({ errors: [{ field, message: `${field}: wrong` }] });
    expect(refusedOf(violation("maxDepth"))).toEqual({ field: "maxDepth" });
    expect(refusedOf(violation("refs[1]"))).toEqual({ field: "refs", index: 1 });
    expect(refusedOf(violation("properties.severity"))).toEqual({
      field: "properties",
      property: "severity",
    });
    expect(refusedOf(violation("properties.component[2]"))).toEqual({
      field: "properties",
      property: "component",
      index: 2,
    });
    // A field that is not a property's key stays the field; the input as a whole names nothing.
    expect(refusedOf(violation("selection.where"))).toEqual({ field: "selection" });
    expect(refusedOf(violation(""))).toBeUndefined();
    expect(refusedOf({ errors: [{ message: "no field" }] })).toBeUndefined();
    expect(refusedOf({ errors: ["not an object"] })).toBeUndefined();
    expect(refusedOf({ errors: [] })).toBeUndefined();
    // A value refused while the input is written (`withChoiceKeys`): the property and the value.
    expect(refusedOf({ key: "component", value: "dsp", reason: "unknown-choice" })).toEqual({
      field: "properties",
      property: "component",
      value: "dsp",
    });
    expect(refusedOf({ key: "component" })).toEqual({ field: "properties", property: "component" });
    expect(refusedOf({ repository: "spec", reason: "read-only" })).toBeUndefined();
    expect(refusedOf(undefined)).toBeUndefined();
  });

  it("asks the argument a schema violation names again, not the one given last, and keeps the others", async () => {
    let refuse = true;
    const { context, asked, call, dispatched } = setup([shown], {
      "trace.chain": () =>
        refuse
          ? refusedWith("ref: is not a reference", { errors: [{ field: "ref", message: "ref: wrong" }] })
          : {},
    });
    start(context, "trace.chain", true);
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "maxDepth").run();
    (await last(asked)).text?.("2");
    item((await last(asked)).items, "Run").run();
    const again = await last(asked);
    expect(again.label).toBe("ref: is not a reference · Show trace chain 2 · ref:");
    refuse = false;
    again.items[0]?.run();
    // The new answer takes the place of the refused one, in the line and in the name of the result.
    const more = await last(asked);
    expect(more.label).toBe("Show trace chain SR-1 2 · more arguments:");
    item(more.items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith(
      "trace.chain",
      expect.objectContaining({ ref: "uuid-1", maxDepth: 2 }),
    );
    expect(dispatched.at(-1)).toMatchObject({ type: "open", buffer: { name: "Show trace chain SR-1 2" } });
  });

  it("asks the refused value of a list argument again by its place, and the list takes more values", async () => {
    const { context, asked, call } = setup([shown], {
      "element.search": (input) => ({ hits: [hit(input["query"] === "third" ? 3 : 2)], total: 1 }),
      "trace.related": (input) =>
        Array.isArray(input["refs"]) && input["refs"][0] === "uuid-1"
          ? refusedWith("refs[0]: is not a reference", {
              errors: [{ field: "refs[0]", message: "refs[0]: wrong" }],
            })
          : { elements: [], total: 0 },
    });
    start(context, "trace.related");
    (await last(asked)).items[0]?.run();
    (await (await last(asked)).find?.("t"))?.[0]?.run();
    (await last(asked)).empty?.(false);
    item((await last(asked)).items, "parents").run();
    const again = await last(asked);
    // SR-1 (refs[0]) is asked again, SR-000002 and the direction stay.
    expect(again.label).toBe("refs[0]: is not a reference · Show related elements SR-000002 parents · refs:");
    expect(again.empty).toBeDefined();
    // The new value takes the place of refs[0]; a value after it goes after the others.
    (await again.find?.("third"))?.[0]?.run();
    (await (await last(asked)).find?.("t"))?.[0]?.run();
    const more = await last(asked);
    expect(more.label).toBe("Show related elements SR-000003 SR-000002 SR-000002 parents · refs:");
    more.empty?.(false);
    await flush();
    expect(call).toHaveBeenLastCalledWith("trace.related", {
      refs: ["uuid-3", "uuid-2", "uuid-2"],
      direction: "parents",
    });
  });

  it("asks the argument given last again when core's details name nothing the prompt asked", async () => {
    const { context, asked } = setup([shown], {
      "trace.chain": () =>
        refusedWith("selection: wrong", { errors: [{ field: "selection", message: "selection: wrong" }] }),
    });
    start(context, "trace.chain", true);
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "maxDepth").run();
    (await last(asked)).text?.("2");
    item((await last(asked)).items, "Run").run();
    expect((await last(asked)).label).toBe("selection: wrong · Show trace chain SR-1 · maxDepth:");
  });

  it("drops with a refused value the values whose offer was read from it, and asks them again", async () => {
    let refuse = true;
    const { context, asked, call } = setup([shown], {
      "relation.options": (input) =>
        refuse && input["kind"] !== undefined
          ? refusedWith("ref: wrong", { errors: [{ field: "ref", message: "ref: wrong" }] })
          : OPTIONS,
    });
    start(context, "relation.options", true);
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "kind").run();
    item((await last(asked)).items, "refines").run();
    item((await last(asked)).items, "Run").run();
    const again = await last(asked);
    // `kind` was offered for the refused `ref`: it goes with it.
    expect(again.label).toBe("ref: wrong · Show relation options · ref:");
    refuse = false;
    again.items[0]?.run();
    const more = await last(asked);
    expect(more.items.map((i) => i.name)).toEqual(["Run", "kind"]);
    item(more.items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("relation.options", { ref: "uuid-1" });
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
      { field: "status", complete: "text" as const },
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
    // The element buffer updates an element ("Save element" covers it).
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
    expect(refused.call).toHaveBeenCalledTimes(2);
    refused.call.mockClear();
    // With the field in core's details, the property it names is asked again, not the one given last.
    const named = creating({
      "element.create": () =>
        refusedWith("properties.severity: must be a number", {
          errors: [{ field: "properties.severity", message: "properties.severity: must be a number" }],
        }),
    });
    prompt = await typeAndTitle(named, "Report", "Wind gusts");
    prompt.text?.("high");
    for (let at = 0; at < 2; at += 1) {
      prompt = await last(named.asked);
      prompt.empty?.(false);
    }
    expect((await last(named.asked)).label).toBe(
      "properties.severity: must be a number · Create element Report Wind gusts · severity:",
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

  it("asks again the property whose value core refused while writing it (details key), not the one given last", async () => {
    // Report with the choice `component` asked before the relation `packages`.
    const metamodel = {
      ...CREATE_METAMODEL,
      types: CREATE_METAMODEL.types.map((type) =>
        type.key === "report" ? { ...type, required: ["title", "component", "packages"] } : type,
      ),
    };
    let refuse = true;
    const running = creating({
      "metamodel.get": () => metamodel,
      "element.create": (input) =>
        refuse
          ? refusedWith("properties.component: Display is not a value of Component; the values are: …", {
              key: "component",
              value: "display",
              reason: "unknown-choice",
              allowed: ["sensor"],
            })
          : created()(input),
    });
    const { asked, call } = running;
    const component = await typeAndTitle(running, "Report", "Wind gusts");
    expect(component.label).toBe("Create element Report Wind gusts · component:");
    item(component.items, "Display").run();
    (await last(asked)).empty?.(false);
    const packages = await last(asked);
    expect(packages.label).toBe("Create element Report Wind gusts Display · packages:");
    (await packages.find?.("pkg"))?.[0]?.run();
    (await last(asked)).empty?.(false);
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.create", expect.objectContaining({ type: "report" }));
    // The refused `component` is asked again with core's message; the target of `packages` stays.
    const again = await last(asked);
    expect(again.label).toBe(
      "properties.component: Display is not a value of Component; the values are: … · Create element Report Wind gusts SR-000004 · component:",
    );
    refuse = false;
    item(again.items, "Sensor").run();
    const more = await last(asked);
    // The new value stands where the refused one stood, before the target of `packages`.
    expect(more.label).toBe("Create element Report Wind gusts Sensor SR-000004 · component:");
    more.empty?.(false);
    await flush();
    const input = call.mock.lastCall?.[1];
    expect(call.mock.lastCall?.[0]).toBe("element.create");
    expect(input?.["properties"]).toEqual(
      expect.objectContaining({
        component: ["sensor"],
        packages: [expect.objectContaining({ id: "uuid-4" })],
      }),
    );
  });

  it("asks the type again with its properties when core refuses the type", async () => {
    let refuse = true;
    const running = creating({
      "element.create": (input) =>
        refuse
          ? refusedWith("type: wrong", { errors: [{ field: "type", message: "type: wrong" }] })
          : created()(input),
    });
    const { asked } = running;
    const severity = await typeAndTitle(running, "Report", "Wind gusts");
    severity.text?.("3");
    for (let at = 0; at < 2; at += 1) {
      (await last(asked)).empty?.(false);
    }
    await flush();
    // The properties belong to the type: they go with it, the title stays.
    const type = await last(asked);
    expect(type.label).toBe("type: wrong · Create element Wind gusts · type:");
    refuse = false;
    item(type.items, "Decision").run();
    await flush();
    expect(running.call).toHaveBeenLastCalledWith("element.create", {
      type: "decision",
      title: "Wind gusts",
    });
  });
});

/** What `hint.list` gives for the shown element: one hint that can be confirmed, one that cannot. */
const HINTS = {
  hints: [
    { code: "relation.outdated", severity: "warning", message: "Relation Refines is outdated", hintId: "h1" },
    { code: "element.missing-required", severity: "warning", message: "Required property x has no value" },
  ],
  incomplete: false,
};

describe("write commands in the command prompt (SR-073 AK2, #85)", () => {
  const list = listBuffer("type: need", { where: { type: ["need"] } });
  const shown = elementBuffer("uuid-1", "spec", "SR-1 Title 1");
  const titles = (context: CatalogContext): string[] =>
    catalogItems(context, CATALOG, ACTIONS).map((choice) => choice.name);

  /** The implemented write commands of the catalog. */
  const writes = CATALOG.filter((entry) => entry.implemented && entry.effect !== "read");

  it("offers every implemented write command by its title, but element.update and element.addAttachment, which the element buffer does", () => {
    expect(writes.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["filter.save", "workspace.init", "relation.add", "hint.confirm"]),
    );
    // element.update is the element buffer's: "Save element" covers it.
    expect(ACTIONS.find((action) => action.title === "Save element")?.covers).toEqual(["element.update"]);
    // element.addAttachment too: "Insert image" puts its Markdown into the text (SR-097).
    expect(ACTIONS.find((action) => action.title === "Insert image")?.covers).toEqual([
      "element.addAttachment",
    ]);
    const { context } = setup([list]);
    const offered = titles(context);
    expect(writes.filter((entry) => !offered.includes(entry.title)).map((entry) => entry.name)).toEqual([
      "element.update",
      "element.addAttachment",
    ]);
  });

  it("asks every offered write command but hint.confirm for a required argument", () => {
    expect(
      writes
        .filter((entry) => entry.name !== "element.update")
        .filter((entry) => (entry.input as { required?: unknown }).required === undefined)
        .map((entry) => entry.name),
    ).toEqual(["hint.confirm"]);
  });

  it("offers no write command that a read-only workspace refuses, and still the read commands", () => {
    const { context } = setup([list]);
    const readOnly = titles({ ...context, readOnly: true });
    for (const entry of writes) {
      expect(readOnly.includes(entry.title)).toBe(
        entry.whileReadOnly !== "refuse" && entry.name !== "element.update",
      );
    }
    expect(readOnly).toContain("Initialise workspace");
    expect(readOnly).toContain("Show relation options");
    expect(titles({ ...context, readOnly: false })).toContain("Create relation");
  });

  it("offers only Initialise workspace while a folder without a workspace is open, and asks its path and name", async () => {
    const { context, asked, call, dispatched } = setup([], {
      "workspace.init": () => ({ root: "/station", files: ["logreq-workspace.yaml"] }),
    });
    const bare = { ...context, workspace: false };
    expect(titles(bare)).toEqual(["Initialise workspace"]);
    start(bare, "workspace.init");
    (await last(asked)).text?.(".");
    const name = await last(asked);
    expect(name.label).toBe("Initialise workspace . · name:");
    name.text?.("Station");
    await flush();
    expect(call).toHaveBeenLastCalledWith("workspace.init", { path: ".", name: "Station" });
    expect(dispatched.at(-1)).toMatchObject({ type: "open", buffer: { written: true } });
  });

  it("saves a filter by its name, with its condition typed as JSON", async () => {
    const { context, asked, call } = setup([list], {
      "filter.save": () => ({ files: ["filters/open.yaml"] }),
    });
    start(context, "filter.save");
    (await last(asked)).text?.("open");
    (await last(asked)).text?.('{"status":["draft"]}');
    await flush();
    expect(call).toHaveBeenLastCalledWith("filter.save", { name: "open", where: { status: ["draft"] } });
  });

  it("Confirm hints: Enter, Enter, Enter on a shown element confirms its hints, and the output is never asked again", async () => {
    const { context, asked, call, dispatched } = setup([shown], {
      "hint.confirm": () => ({ confirmed: ["h1"], files: ["f1.md"], problems: [] }),
      "hint.list": () => HINTS,
    });
    // Without a required argument it asks its first one, so it fits the shown element.
    expect(fits(context, command("hint.confirm"))).toBe(true);
    start(context, "hint.confirm");
    const ref = await last(asked);
    expect(ref.label).toBe("Confirm hints · ref:");
    expect(ref.empty).toBeUndefined();
    ref.items[0]?.run();
    // `hintIds` reads `ref`: asked next; Enter on an empty input skips it.
    const hintIds = await last(asked);
    expect(hintIds.label).toBe("Confirm hints SR-1 · hintIds:");
    hintIds.empty?.(false);
    await flush();
    expect(call).toHaveBeenLastCalledWith("hint.confirm", { ref: "uuid-1" });
    expect(dispatched.at(-1)).toMatchObject({
      type: "open",
      buffer: { kind: "result", name: "Confirm hints SR-1", written: true },
    });
  });

  it("takes the values of an optional argument read from a given one, and offers a skipped one again with Ctrl/Cmd+Enter", async () => {
    const { context, asked, call } = setup([shown], {
      "hint.confirm": () => ({ confirmed: [] }),
      "hint.list": () => HINTS,
    });
    start(context, "hint.confirm");
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "Relation Refines is outdated").run();
    const second = await last(asked);
    expect(second.label).toBe("Confirm hints SR-1 Relation Refines is outdated · hintIds:");
    // A hint taken is not offered again.
    expect(second.items).toEqual([]);
    second.empty?.(false);
    await flush();
    expect(call).toHaveBeenLastCalledWith("hint.confirm", { ref: "uuid-1", hintIds: ["h1"] });
    // Skipped with Ctrl/Cmd+Enter: the optional arguments follow, the skipped one among them.
    const again = setup([shown], { "hint.confirm": () => ({ confirmed: [] }), "hint.list": () => HINTS });
    start(again.context, "hint.confirm");
    (await last(again.asked)).items[0]?.run();
    (await last(again.asked)).empty?.(true);
    const more = await last(again.asked);
    expect(more.items.map((i) => i.name)).toEqual(["Run", "target", "kind", "hintIds"]);
    // Backspace on it asks the skipped one again.
    more.back?.();
    expect((await last(again.asked)).label).toBe("Confirm hints SR-1 · hintIds:");
  });

  it("asks no optional argument that reads one not given: Supersede element runs without successor and relation", async () => {
    const { context, asked, call } = setup([shown], {
      "element.supersede": () => ({ files: [] }),
      "element.get": () => ({ element: { ...hit(1), type: "requirement" } }),
      "metamodel.get": () => FIXTURE_METAMODEL,
    });
    start(context, "element.supersede");
    (await last(asked)).items[0]?.run();
    // Only the invalid statuses of the element's type.
    const status = await last(asked);
    expect(status.items.map((i) => i.name)).toEqual(["Retired"]);
    status.items[0]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.supersede", { ref: "uuid-1", status: "retired" });
  });

  it("saves every open buffer's input before a write command runs, and does not run it when one cannot be saved", async () => {
    const other = elementBuffer("uuid-2", "spec", "SR-2 Title 2");
    const saved: string[] = [];
    const running = setup([shown, other], {
      "hint.confirm": () => ({ confirmed: [] }),
      "hint.list": () => HINTS,
    });
    const context = {
      ...running.context,
      drafted: () => true,
      saveDraft: (key: string) => {
        saved.push(key);
        return Promise.resolve(true);
      },
    };
    start(context, "hint.confirm");
    (await last(running.asked)).items[0]?.run();
    (await last(running.asked)).empty?.(false);
    await flush();
    // The shown buffer last, as a workspace switch saves.
    expect(saved).toEqual([other.key, shown.key]);
    expect(running.call).toHaveBeenLastCalledWith("hint.confirm", { ref: "uuid-1" });
    // Input that cannot be saved stops the command before it is sent.
    const stopped = setup([shown, other], {
      "hint.confirm": () => ({ confirmed: [] }),
      "hint.list": () => HINTS,
    });
    const tried: string[] = [];
    const failing = {
      ...stopped.context,
      drafted: () => true,
      saveDraft: (key: string) => {
        tried.push(key);
        return Promise.resolve(key !== other.key);
      },
    };
    start(failing, "hint.confirm");
    (await last(stopped.asked)).items[0]?.run();
    (await last(stopped.asked)).empty?.(false);
    await flush();
    expect(stopped.call).not.toHaveBeenCalledWith("hint.confirm", expect.anything());
    // The first that cannot be saved stops the saving too.
    expect(tried).toEqual([other.key]);
    expect(stopped.echoed.at(-1)).toBe("SR-2 Title 2 could not be saved: Confirm hints did not run");
    // Without saveDraft nothing is saved, and the command runs; a read command saves nothing.
    const unsaving = setup([shown], {
      "hint.confirm": () => ({ confirmed: [] }),
      "hint.list": () => HINTS,
      "relation.options": () => OPTIONS,
    });
    const plain = { ...unsaving.context, drafted: () => true };
    start(plain, "hint.confirm");
    (await last(unsaving.asked)).items[0]?.run();
    (await last(unsaving.asked)).empty?.(false);
    await flush();
    expect(unsaving.call).toHaveBeenLastCalledWith("hint.confirm", { ref: "uuid-1" });
    const saveDraft = vi.fn(() => Promise.resolve(true));
    start({ ...unsaving.context, drafted: () => true, saveDraft }, "relation.options");
    (await last(unsaving.asked)).items[0]?.run();
    await flush();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(unsaving.call).toHaveBeenLastCalledWith("relation.options", { ref: "uuid-1" });
  });
});

describe("the arguments a command expects, completed with the values of the metamodel (SR-108 AK4)", () => {
  const list = listBuffer("type: need", { where: { type: ["need"] } });
  const shown = elementBuffer("uuid-1", "spec", "SR-1 Title 1");
  /** The element `element.get` gives: of `type`, with `relations`. */
  const element =
    (type: string, relations: readonly Record<string, unknown>[] = []) =>
    () => ({
      element: { ...hit(1), type, properties: {}, relations },
    });
  const failure = Object.assign(new Error("No such element"), { name: "ref.unknown" });

  it("[SR-108/AK4] completes the status of an element with the statuses its type allows", async () => {
    const { context, asked, call } = setup([shown], {
      "element.get": element("decision"),
      "metamodel.get": () => FIXTURE_METAMODEL,
      "element.setStatus": () => ({ files: [] }),
    });
    start(context, "element.setStatus");
    (await last(asked)).items[0]?.run();
    (await last(asked)).empty?.(false);
    const status = await last(asked);
    expect(status.label).toBe("Set status SR-1 · status:");
    // `refs` is a list: the statuses of its first element's type, by name; core checks the others.
    expect(call).toHaveBeenCalledWith("element.get", { ref: "uuid-1" });
    expect(status.items.map((i) => i.name)).toEqual(["Open", "Decided"]);
    item(status.items, "Decided").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.setStatus", { refs: ["uuid-1"], status: "decided" });
  });

  it("offers every status of the metamodel without an element, and says why an element cannot be read", async () => {
    const statusOf = {
      ...command("element.setStatus"),
      arguments: [{ field: "status", complete: "status" as const }],
    };
    const plain = setup([shown], { "metamodel.get": () => FIXTURE_METAMODEL });
    catalogItems(plain.context, [statusOf], [])[0]?.run();
    expect((await last(plain.asked)).items.map((i) => i.name)).toEqual([
      "Draft",
      "Approved",
      "Retired",
      "Open",
      "Decided",
    ]);
    const gone = setup([shown], { "element.get": () => failure, "metamodel.get": () => FIXTURE_METAMODEL });
    start(gone.context, "element.setStatus");
    (await last(gone.asked)).items[0]?.run();
    (await last(gone.asked)).empty?.(false);
    expect((await last(gone.asked)).label).toBe("No such element · Set status SR-1 · status:");
  });

  it("[SR-108/AK4] completes the property of a bulk update with the properties of the metamodel, and its value with the values the metamodel fixes for it", async () => {
    const { context, asked, call } = setup([list], {
      "metamodel.get": () => FIXTURE_METAMODEL,
      "element.search": () => ({ hits: [hit(5)], total: 1 }),
      "element.bulkUpdate": () => ({ total: 0, changes: [] }),
    });
    catalogItems(context, CATALOG, ACTIONS)
      .find((choice) => choice.name === "Bulk update elements")
      ?.run();
    const property = await last(asked);
    expect(property.label).toBe("Bulk update elements · property:");
    // Every property of the metamodel but the title, which a bulk update refuses.
    expect(property.items.map((i) => i.name)).toEqual(["Rationale", "Component", "Package", "Severity"]);
    item(property.items, "Component").run();
    item((await last(asked)).items, "set").run();
    const value = await last(asked);
    expect(value.label).toBe("Bulk update elements Component set · value:");
    expect(value.items.map((i) => i.name)).toEqual(["Display", "Sensor"]);
    item(value.items, "Sensor").run();
    await flush();
    // No `confirm`: core shows what it would change and writes nothing.
    expect(call).toHaveBeenLastCalledWith("element.bulkUpdate", {
      selection: { where: { type: ["need"] } },
      property: "component",
      operation: "set",
      value: "sensor",
    });
    // A relation property's value: only elements of its target types; a text kind: typed text.
    start(context, "element.bulkUpdate");
    item((await last(asked)).items, "Package").run();
    item((await last(asked)).items, "add").run();
    const target = await last(asked);
    expect(target.items).toEqual([]);
    const packages = await target.find?.("pkg");
    expect(call).toHaveBeenLastCalledWith("element.search", {
      query: "pkg",
      selection: { where: { type: ["package"] } },
      fields: ["id", "title"],
      limit: 20,
    });
    // The element found is given as a relation target, as the property stores it, not as a reference.
    packages?.[0]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith(
      "element.bulkUpdate",
      expect.objectContaining({ property: "packages", value: { id: "uuid-5", repository: "spec" } }),
    );
    // A number property's value is a number.
    start(context, "element.bulkUpdate");
    item((await last(asked)).items, "Severity").run();
    item((await last(asked)).items, "set").run();
    (await last(asked)).text?.("3");
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.bulkUpdate", expect.objectContaining({ value: 3 }));
  });

  it("offers the properties of the element's type for a property of an element, and says why the metamodel cannot be read", async () => {
    // As a read command: the prompt lists no write command that the element buffer covers.
    const unset = {
      ...command("element.update"),
      effect: "read" as const,
      arguments: [
        { field: "ref", complete: "element" as const },
        { field: "unset", complete: "property" as const, of: "ref" },
      ],
      input: { type: "object", required: ["ref", "unset"] },
    };
    const { context, asked } = setup([shown], {
      "element.get": element("requirement"),
      "metamodel.get": () => FIXTURE_METAMODEL,
    });
    catalogItems(context, [unset], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    expect((await last(asked)).items.map((i) => i.name)).toEqual(["Rationale", "Package"]);
    const gone = setup([shown], { "element.get": () => failure });
    catalogItems(gone.context, [unset], [])[0]?.run();
    (await last(gone.asked)).items[0]?.run();
    expect((await last(gone.asked)).label).toBe("No such element · Update element SR-1 · unset:");
    const noModel = setup([list], {
      "metamodel.get": () => Object.assign(new Error("Broken"), { name: "x" }),
    });
    start(noModel.context, "element.bulkUpdate");
    expect((await last(noModel.asked)).label).toBe("Broken · Bulk update elements · property:");
    // The value of an unknown property, or of a property never given, is typed text.
    const valueOf = {
      ...command("element.bulkUpdate"),
      arguments: [
        { field: "property", complete: "text" as const },
        { field: "value", complete: "value" as const, of: "property" },
      ],
      input: { type: "object", required: ["property", "value"] },
    };
    // A relation property without target types: any element, the shown one first, as a relation target.
    const related = setup([shown], {
      "metamodel.get": () => CREATE_METAMODEL,
      "element.bulkUpdate": () => ({ total: 0, changes: [] }),
    });
    catalogItems(related.context, [valueOf], [])[0]?.run();
    (await last(related.asked)).text?.("related");
    const relatedValue = await last(related.asked);
    expect(relatedValue.items.map((i) => i.name)).toEqual(["SR-1 Title 1"]);
    relatedValue.items[0]?.run();
    await flush();
    expect(related.call).toHaveBeenLastCalledWith("element.bulkUpdate", {
      property: "related",
      value: { id: "uuid-1", repository: "spec" },
    });
    const typed = setup([list], { "metamodel.get": () => FIXTURE_METAMODEL });
    catalogItems(typed.context, [valueOf], [])[0]?.run();
    (await last(typed.asked)).text?.("nothing");
    expect((await last(typed.asked)).text).toBeDefined();
    // A choice property without choices offers none.
    const bare = setup([list], {
      "metamodel.get": () => ({
        ...FIXTURE_METAMODEL,
        properties: [{ key: "mood", name: "Mood", kind: "choice" }],
      }),
    });
    catalogItems(bare.context, [valueOf], [])[0]?.run();
    (await last(bare.asked)).text?.("mood");
    expect((await last(bare.asked)).items).toEqual([]);
    const broken = setup([list], {
      "metamodel.get": () => Object.assign(new Error("Broken"), { name: "x" }),
    });
    catalogItems(broken.context, [valueOf], [])[0]?.run();
    (await last(broken.asked)).text?.("component");
    expect((await last(broken.asked)).label).toBe("Broken · Bulk update elements component · value:");
  });

  it("Create relation: the shown element as source, a kind relation options allows from it, a target, and the written result", async () => {
    const { context, asked, call, dispatched } = setup([shown], {
      "relation.options": () => OPTIONS,
      "element.search": () => ({ hits: [hit(7)], total: 1 }),
      "relation.add": () => ({ files: ["f1.md"] }),
    });
    start(context, "relation.add");
    const source = await last(asked);
    expect(source.label).toBe("Create relation · source:");
    expect(source.items.map((i) => i.name)).toEqual(["SR-1 Title 1"]);
    source.items[0]?.run();
    const kind = await last(asked);
    expect(call).toHaveBeenLastCalledWith("relation.options", { ref: "uuid-1" });
    expect(kind.items.map((i) => i.name)).toEqual(["derives from", "refines"]);
    item(kind.items, "refines").run();
    (await (await last(asked)).find?.("tit"))?.[0]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("relation.add", {
      source: "uuid-1",
      kind: "refines",
      target: "uuid-7",
    });
    expect(dispatched.at(-1)).toMatchObject({
      type: "open",
      buffer: { kind: "result", name: "Create relation SR-1 refines SR-000007", written: true },
    });
  });

  it("[SR-108/AK4] completes the target of a relation with elements of the kind's target types only", async () => {
    const { context, asked, call } = setup([shown], {
      "relation.options": () => OPTIONS,
      "element.search": () => ({ hits: [hit(7)], total: 1 }),
      "relation.add": () => ({ files: [] }),
    });
    start(context, "relation.add");
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "derives from").run();
    const target = await last(asked);
    expect(target.label).toBe("Create relation SR-1 derives from · target:");
    // The shown element is no candidate: it need not be of a target type.
    expect(target.items).toEqual([]);
    const found = await target.find?.("tit");
    expect(call).toHaveBeenLastCalledWith("element.search", {
      query: "tit",
      selection: { where: { type: ["need"] } },
      fields: ["id", "title"],
      limit: 20,
    });
    found?.[0]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("relation.add", {
      source: "uuid-1",
      kind: "derives-from",
      target: "uuid-7",
    });
  });

  it("[SR-108/AK4] a typed fragment of a relation target with a typo is searched with the kind's target types", async () => {
    const { context, asked, call } = setup([shown], {
      "relation.options": () => OPTIONS,
      "element.search": () => ({ hits: [hit(7)], total: 1 }),
    });
    start(context, "relation.add");
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "refines").run();
    await (await last(asked)).find?.("Titel 7");
    expect(call).toHaveBeenLastCalledWith("element.search", {
      query: "Titel 7",
      selection: { where: { type: ["need"] } },
      fields: ["id", "title"],
      limit: 20,
    });
  });

  it("takes the target types of a kind from the metamodel without a source, and none for a kind that allows none", async () => {
    const targetOf = {
      ...command("relation.add"),
      arguments: [
        { field: "kind", complete: "relationKind" as const },
        { field: "target", complete: "relationTarget" as const, of: "kind" },
      ],
      input: { type: "object", required: ["kind", "target"] },
    };
    const { context, asked, call } = setup([shown], {
      "metamodel.get": () => FIXTURE_METAMODEL,
      "element.search": () => ({ hits: [], total: 0 }),
    });
    catalogItems(context, [targetOf], [])[0]?.run();
    item((await last(asked)).items, "Based on").run();
    await (await last(asked)).find?.("x");
    expect(call).toHaveBeenLastCalledWith(
      "element.search",
      expect.objectContaining({ selection: { where: { type: ["decision"] } } }),
    );
    // A kind without target types finds any element; an unknown kind too.
    catalogItems(context, [targetOf], [])[0]?.run();
    item((await last(asked)).items, "Refines").run();
    await (await last(asked)).find?.("x");
    expect(call.mock.lastCall?.[0]).toBe("element.search");
    expect(call.mock.lastCall?.[1]).not.toHaveProperty("selection");
    // A kind whose source allows no target type offers nothing.
    const none = setup([shown], {
      "relation.options": () => ({ kinds: [{ kind: "blocks", name: "blocks", targetTypes: [] }] }),
    });
    start(none.context, "relation.add");
    (await last(none.asked)).items[0]?.run();
    item((await last(none.asked)).items, "blocks").run();
    const empty = await last(none.asked);
    expect(empty.items).toEqual([]);
    expect(empty.find).toBeUndefined();
    // Why the target types cannot be read, in the label.
    const broken = setup([shown], {
      "metamodel.get": () => Object.assign(new Error("Broken"), { name: "x" }),
    });
    catalogItems(
      broken.context,
      [{ ...targetOf, arguments: [{ field: "target", complete: "relationTarget" as const }] }],
      [],
    )[0]?.run();
    expect((await last(broken.asked)).label).toBe("Broken · Create relation · target:");
    let options = 0;
    const late = setup([shown], {
      "relation.options": () => {
        options += 1;
        return options === 1 ? OPTIONS : Object.assign(new Error("Gone"), { name: "x" });
      },
    });
    start(late.context, "relation.add");
    (await last(late.asked)).items[0]?.run();
    item((await last(late.asked)).items, "refines").run();
    expect((await last(late.asked)).label).toBe("Gone · Create relation SR-1 refines · target:");
  });

  it("[SR-108/AK4] completes the relation to remove from the element's relations, and an open hint from hint.list", async () => {
    const relations = [
      { kind: "refines", direction: "out", id: "uuid-2", shortId: "SR-000002", title: "Title 2" },
      { kind: "refines", direction: "out", id: "uuid-3" },
      { kind: "based-on", direction: "in", id: "uuid-4", shortId: "SR-000004" },
      { kind: "packages", property: true, direction: "out", id: "uuid-5", shortId: "PKG-000005" },
    ];
    const { context, asked, call } = setup([shown], {
      "element.get": element("requirement", relations),
      "metamodel.get": () => FIXTURE_METAMODEL,
      "relation.remove": () => ({ files: [] }),
      "hint.list": () => HINTS,
    });
    start(context, "relation.remove");
    (await last(asked)).items[0]?.run();
    const kind = await last(asked);
    // The kinds of its outgoing relations, not a property of kind relation, not an incoming one.
    expect(kind.items.map((i) => i.name)).toEqual(["Refines"]);
    kind.items[0]?.run();
    const target = await last(asked);
    expect(target.label).toBe("Remove relation SR-1 Refines · target:");
    expect(target.items.map((i) => i.name)).toEqual(["SR-000002 Title 2", "uuid-3"]);
    target.items[0]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("relation.remove", {
      source: "uuid-1",
      kind: "refines",
      target: "uuid-2",
    });
    // An open hint: only the hints that can be confirmed, by their message.
    start(context, "hint.confirm");
    (await last(asked)).items[0]?.run();
    const hints = await last(asked);
    expect(call).toHaveBeenLastCalledWith("hint.list", { ref: "uuid-1" });
    expect(hints.items.map((i) => i.name)).toEqual(["Relation Refines is outdated"]);
    // Without an element the hint IDs are typed; a source that cannot be read says why.
    const hintOf = {
      ...command("hint.confirm"),
      arguments: [{ field: "hintIds", complete: "hint" as const }],
    };
    catalogItems(context, [hintOf], [])[0]?.run();
    expect((await last(asked)).text).toBeDefined();
    // Without an element there is no relation to offer.
    const relationOf = {
      ...command("relation.remove"),
      arguments: [{ field: "kind", complete: "relation" as const }],
      input: { type: "object", required: ["kind"] },
    };
    catalogItems(context, [relationOf], [])[0]?.run();
    expect((await last(asked)).items).toEqual([]);
    const gone = setup([shown], { "element.get": () => failure });
    start(gone.context, "relation.remove");
    (await last(gone.asked)).items[0]?.run();
    expect((await last(gone.asked)).label).toBe("No such element · Remove relation SR-1 · kind:");
  });
});
