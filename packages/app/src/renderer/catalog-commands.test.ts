import os from "node:os";
import { createCommandRuntime, defineTestCommand, getCommandRuntime, Workspace } from "@reqseq/core";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { cliUsage } from "../core/cli-usage.js";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { listedEntry } from "../core/listing.js";
import type { CommandListing } from "../shared/protocol.js";
import type { ActionContext, Choice, ElementControls, Prompt } from "./action-types.js";
import { ACTIONS, commandPrompt, unusedOrder } from "./actions.js";
import type { BufferAction, Buffers } from "./buffers.js";
import {
  elementBuffer,
  filteredList,
  listBuffer,
  neighbourhoodBuffer,
  overviewBuffer,
  perspectiveBuffer,
  readOnlyBuffer,
  resultBuffer,
  withQuery,
} from "./buffers.js";
import { savedStep, typeStep } from "./list-filters.js";
import type { Call } from "./call.js";
import type { CatalogContext } from "./catalog-commands.js";
import { PREFIX_BINDINGS } from "./bindings.js";
import { isWindows } from "./keys.js";
import {
  askable,
  catalogItems,
  contextField,
  fits,
  refusedOf,
  startBuilder,
  withExplanations,
} from "./catalog-commands.js";
import { coveredCommand, SHOWN_IN, shownIn } from "./command-entry.js";
import { shortcutReference } from "./shortcut-reference.js";
import { rank } from "./fuzzy.js";
import type { PromptUse } from "./usage.js";
import { openingRows, promptUse, rankByUse } from "./usage.js";
import { CREATE_METAMODEL } from "./create-test-data.js";
import { FIXTURE_METAMODEL } from "./metamodel-test-data.js";
import { contextOf } from "../../../../scripts/contracts/catalog-checks.mjs";

const PLATFORM_SEP = isWindows(navigator.platform) ? "\\" : "/";

const runtime = getCommandRuntime();
/** The catalog as the bridge lists it (`commands()`), with what this version implements. */
const CATALOG: readonly CommandListing[] = runtime.contracts.commands.map((entry) => ({
  ...listedEntry(entry, runtime.contracts.schemas),
  implemented: runtime.commands.has(entry.name),
  cliUsage: cliUsage(entry, runtime.contracts.schemas),
}));

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type Answer = unknown;

/** A preview of `element.bulkUpdate` that writes no element, as its output schema has it. */
const BULK_PREVIEW = {
  applied: false,
  count: 0,
  affected: [],
  unchanged: 0,
  skipped: [],
  files: [],
  problems: [],
  plan: `p1:${"0".repeat(64)}`,
};

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
    // A bulk update answers with a preview unless the test gives its own (SR-071 AK5 reads its counts).
    const output = (answers[name] ?? (name === "element.bulkUpdate" ? () => BULK_PREVIEW : undefined))?.(
      input,
    );
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
    cycleOrder: [],
    cycled: () => undefined,
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

/**
 * A read command that asks an element and then, optional, a relation kind that element may have: the
 * arguments of `relation.options`, which the prompt neither lists nor finds (SR-133 AK4), under a name of
 * its own, so the tests of the argument entry keep their command.
 */
const KINDS: CommandListing = { ...command("relation.options"), name: "test.kinds", title: "Show kinds" };

/** The catalog with `KINDS`. */
const WITH_KINDS: readonly CommandListing[] = [...CATALOG, KINDS];

const start = (context: ActionContext & CatalogContext, name: string, more = false): void => {
  const listing = name === KINDS.name ? KINDS : command(name);
  const choice = item(catalogItems(context, WITH_KINDS, ACTIONS), listing.title);
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

describe("path arguments of catalog commands (SR-143)", () => {
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const listing = {
    folder: "/w",
    name: "",
    entries: [
      { name: "out", kind: "folder" },
      { name: "export.reqif", kind: "file" },
    ],
  };

  it("takes the typed path first and completes it from workspace.listFolder, with files for a file argument", async () => {
    const { context, asked, call } = setup([shown], {
      "workspace.listFolder": () => listing,
      "reqif.analyze": () => ({}),
    });
    start(context, "reqif.analyze");
    const prompt = await last(asked);
    expect(prompt.literal?.("  ")).toBeUndefined();
    expect(prompt.literal?.("new.reqif")).toMatchObject({ name: "Use new.reqif", hint: "file" });
    expect((await prompt.seek?.(""))?.choices.map((choice) => [choice.name, choice.complete])).toEqual([
      // Nothing typed yet: a folder gets the separator of the platform.
      [`out${PLATFORM_SEP}`, `out${PLATFORM_SEP}`],
      ["export.reqif", "export.reqif"],
    ]);
    expect(call).toHaveBeenLastCalledWith("workspace.listFolder", { path: "", files: true });
    prompt.literal?.("new.reqif")?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("reqif.analyze", { file: "new.reqif" });
    // Typed text without a choice, and Ctrl/Cmd+Enter, take it too.
    start(context, "reqif.analyze");
    (await last(asked)).text?.("a.reqif");
    await flush();
    expect(call).toHaveBeenLastCalledWith("reqif.analyze", { file: "a.reqif" });
    start(context, "reqif.analyze");
    (await last(asked)).literal?.("b.reqif")?.more?.();
    expect((await last(asked)).label).toContain("more arguments");
    start(context, "reqif.analyze");
    (await last(asked)).more?.("c.reqif");
    expect((await last(asked)).label).toContain("more arguments");
  });

  it("lists only folders for a folder argument, and says why a folder cannot be listed", async () => {
    const { context, asked, call } = setup([shown], {
      "workspace.listFolder": () => new Error("No workspace is open"),
    });
    start({ ...context, workspace: false }, "workspace.init");
    const prompt = await last(asked);
    expect(prompt.literal?.("spec")).toMatchObject({ hint: "folder" });
    expect(await prompt.seek?.("sp")).toEqual({ choices: [], note: "No workspace is open" });
    expect(call).toHaveBeenLastCalledWith("workspace.listFolder", { path: "", files: false });
  });

  it("[SR-143/AK-zhpy] gives the evidence of Record evidence and the folder of Create element no suggestions, and the command gets a leading ~ as typed", async () => {
    const typed = [
      ["evidence.record", "evidence", "~/reports/run.pdf"],
      ["element.create", "folder", "~/drafts"],
    ] as const;
    const { context, asked, call } = setup([shown], {
      "workspace.listFolder": () => listing,
      "evidence.record": () => ({ files: [] }),
      "element.create": () => ({ element: hit(1), files: [] }),
    });
    const sent: Record<string, unknown> = {};
    for (const [name, field, text] of typed) {
      const listed = command(name);
      const alone = { ...listed, arguments: listed.arguments.filter((arg) => arg.field === field) };
      catalogItems(context, [{ ...alone, input: { ...alone.input, required: [field] } }], [])[0]?.run();
      const prompt = await last(asked);
      // Typed text: nothing to seek, no row of its own, no suggestions.
      expect(prompt.seek).toBeUndefined();
      expect(prompt.literal).toBeUndefined();
      expect(prompt.items).toEqual([]);
      prompt.text?.(text);
      await flush();
      expect(call).toHaveBeenLastCalledWith(name, { [field]: text });
      sent[name] = call.mock.lastCall?.[1];
    }
    expect(call.mock.calls.map(([name]) => name)).not.toContain("workspace.listFolder");

    // Under the app's path rule core takes a leading ~ for the home folder only in local paths
    // (`withHome`); these two get the text as the prompt sent it.
    const fixture = await createFixtureWorkspace({ fixture: "SR-069/filter" });
    onTestFinished(fixture.cleanup);
    const received: unknown[] = [];
    const stub = (name: string) =>
      defineTestCommand<unknown, unknown>({
        name,
        run: (ctx, input) => {
          received.push({ input, home: ctx.localPaths.home });
          return Promise.resolve({});
        },
      });
    const core = createCommandRuntime({
      commands: [stub("evidence.record"), stub("element.create")],
      validateOutput: false,
    });
    const workspace = new Workspace(fixture.root);
    const record = {
      ref: "SR-1",
      kind: "verification",
      result: "passed",
      ...(sent["evidence.record"] as object),
    };
    const create = { type: "need", title: "Drafted", ...(sent["element.create"] as object) };
    await core.invoke("evidence.record", record, { workspace, access: "app" });
    await core.invoke("element.create", create, { workspace, access: "app" });
    expect(received).toEqual([
      { input: { ...record, evidence: "~/reports/run.pdf" }, home: os.homedir() },
      { input: { ...create, folder: "~/drafts" }, home: os.homedir() },
    ]);
  });
});

describe("catalog commands in the command prompt", () => {
  const list = listBuffer("type: need", { where: { type: ["need"] } });
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");

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
    // Only those whose output the app shows in other commands are not reachable (SR-133 AK4).
    expect(reads.filter((entry) => !reachable(entry)).map((entry) => entry.name)).toEqual(
      reads.filter((entry) => shownIn(entry) !== undefined).map((entry) => entry.name),
    );
    // Covered commands are not listed twice; the implemented ones are, reqif.export too.
    expect(offered.has("Get element")).toBe(false);
    expect(offered.has("Update element")).toBe(false);
    expect(offered.has("Export ReqIF")).toBe(true);
    expect(offered.has("Analyse ReqIF file")).toBe(true);
    expect(offered.has("Show trace chain")).toBe(true);
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

  it("[SR-109/AK-hxz3] shows nothing next to a catalog command without a key", () => {
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

  it("[SR-121/AK-q4xh] gives Create element its fixed shortcut in the prompt, and no other catalog command one", () => {
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

  it("[SR-121/AK-q4xh] gives Create relation, Set status and Confirm hints their fixed shortcut", () => {
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

  it("[SR-121/AK-q4xh] offers no write command with a letter in a read-only workspace, so the letter is not shown", () => {
    const { context } = setup([shown]);
    const ids = new Set(catalogItems({ ...context, readOnly: true }, CATALOG, ACTIONS).map((i) => i.id));
    for (const binding of PREFIX_BINDINGS.filter((row) => row.id.startsWith("command:"))) {
      expect(ids.has(binding.id)).toBe(false);
    }
  });

  it("[SR-108/AK-bs83] finds a catalog command by its initials and with one slip among the first three", () => {
    const { context } = setup([list]);
    const items = commandPrompt(context, undefined, catalogItems(context, CATALOG, ACTIONS)).items;
    const top = (query: string): string[] =>
      rank(items, (i) => i.name, query)
        .slice(0, 3)
        .map(({ item: i }) => i.name);
    expect(top("sae")).toContain("Show affected elements");
    expect(top("lh")).toContain("List hints");
    expect(top("chek workspace")).toContain("Check workspace");
    expect(top("shwo trace chain")).toContain("Show trace chain");
  });

  it("offers a command that needs the shown list's selection only on a list, and fills it in", async () => {
    const needs = {
      ...command("evidence.coverage"),
      input: { ...command("evidence.coverage").input, required: ["selection"] },
    };
    expect(catalogItems(setup([shown]).context, [needs], [])).toEqual([]);
    // A perspective buffer that came back with nothing saved lists nothing, so it gives no selection
    // (it would read as every element).
    const faulty = perspectiveBuffer({ name: "Broken", error: "faulty file" });
    expect(catalogItems(setup([faulty]).context, [needs], [])).toEqual([]);
    const { context, dispatched, call } = setup([list], { "evidence.coverage": () => ({ total: 1 }) });
    const [only] = catalogItems(context, [needs], []);
    only?.run();
    await flush();
    expect(call).toHaveBeenCalledWith("evidence.coverage", { selection: { where: { type: ["need"] } } });
    expect(dispatched).toEqual([
      {
        type: "open",
        buffer: resultBuffer(
          "evidence.coverage",
          { selection: { where: { type: ["need"] } } },
          "Show evidence coverage",
          { total: 1 },
          3,
        ),
      },
    ]);
  });

  it("[SR-050/AK-cvrg] fills in the package of a package page for a selection: Create baseline asks only the name", async () => {
    const { context, asked, call } = setup([shown], { "baseline.create": () => ({ files: [] }) });
    // An element buffer that is no package page gives no selection, a package page its package.
    expect(catalogItems(context, [command("baseline.create")], [])).toEqual([]);
    const page = { ...context, element: { members: true } as ElementControls };
    expect(fits(page, command("baseline.create"))).toBe(true);
    start(page, "baseline.create");
    expect((await last(asked)).label).toBe("Create baseline · name:");
    await answer(asked, "Release 1");
    await flush();
    expect(call).toHaveBeenCalledWith("baseline.create", {
      name: "Release 1",
      selection: { package: "uuid-1" },
    });
  });

  it("fills in the package of a package page for every selection, an optional one too, and offers Bulk update there", async () => {
    const { context, call } = setup([shown], { "evidence.coverage": () => ({ total: 1 }) });
    const page = { ...context, element: { members: true } as ElementControls };
    expect(catalogItems(context, [command("element.bulkUpdate")], [])).toEqual([]);
    expect(catalogItems(page, [command("element.bulkUpdate")], [])).toHaveLength(1);
    expect(fits(page, command("element.bulkUpdate"))).toBe(true);
    expect(fits(page, command("evidence.coverage"))).toBe(true);
    start(page, "evidence.coverage");
    await flush();
    expect(call).toHaveBeenLastCalledWith("evidence.coverage", { selection: { package: "uuid-1" } });
  });

  it("runs a command without required arguments at once and shows its output in a result buffer", async () => {
    const { context, dispatched, asked } = setup([shown], { "baseline.list": () => ({ baselines: [] }) });
    start(context, "baseline.list");
    await flush();
    expect(asked).toEqual([]);
    expect(dispatched).toEqual([
      { type: "open", buffer: resultBuffer("baseline.list", {}, "List baselines", { baselines: [] }, 3) },
    ]);
    // A selection that is not required is left out where no list is shown.
    start(context, "evidence.coverage");
    await flush();
    expect(dispatched.at(-1)).toMatchObject({ buffer: { command: "evidence.coverage", input: {} } });
  });

  it("[SR-161/AK-hbxy] About ReqSeq shows the output of tool.info in its own window, not in a result buffer", async () => {
    const info = { versions: { app: "1.0.0" } };
    const shownAbout = vi.fn();
    const { context, dispatched } = setup([shown], { "tool.info": () => info });
    start({ ...context, about: shownAbout }, "tool.info");
    await flush();
    expect(shownAbout).toHaveBeenCalledWith(info);
    expect(dispatched).toEqual([]);
    // Without the window (a context that has none), a result buffer shows it.
    start(context, "tool.info");
    await flush();
    expect(dispatched.at(-1)).toMatchObject({ buffer: { command: "tool.info", name: "About ReqSeq" } });
  });

  it("asks an element with the shown element first, then the kinds relation.options allows from it", async () => {
    const { context, asked, dispatched, call } = setup([shown], {
      "relation.options": () => OPTIONS,
    });
    start(context, "test.kinds");
    const ref = await last(asked);
    expect(ref.label).toBe("Show kinds · ref:");
    expect(ref.items.map((i) => i.name)).toEqual(["SR-000001 (SR-1) Title 1"]);
    ref.items[0]?.run();
    await flush();
    // ref was the last required argument: Enter runs the command.
    expect(call).toHaveBeenLastCalledWith("test.kinds", { ref: "uuid-1" });
    expect(dispatched.at(-1)).toMatchObject({
      type: "open",
      buffer: { name: "Show kinds SR-000001 (SR-1)" },
    });
  });

  it("offers the optional arguments on Ctrl/Cmd+Enter, Run first, and their candidates from core", async () => {
    const { context, asked, call } = setup(
      [neighbourhoodBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1")],
      {
        "relation.options": () => OPTIONS,
      },
    );
    start(context, "test.kinds");
    const ref = await last(asked);
    ref.items[0]?.more?.();
    const more = await last(asked);
    expect(more.label).toBe("Show kinds SR-000001 (SR-1) · more arguments:");
    expect(more.items.map((i) => i.name)).toEqual(["Run", "kind"]);
    item(more.items, "kind").run();
    const kind = await last(asked);
    expect(call).toHaveBeenLastCalledWith("relation.options", { ref: "uuid-1" });
    expect(kind.label).toBe("Show kinds SR-000001 (SR-1) · kind:");
    expect(kind.items.map((i) => i.name)).toEqual(["derives from", "refines"]);
    item(kind.items, "refines").run();
    // Still in "more": the prompt offers what is left, and Run runs it.
    const again = await last(asked);
    expect(again.items.map((i) => i.name)).toEqual(["Run"]);
    again.items[0]?.more?.();
    await flush();
    expect(call).toHaveBeenLastCalledWith("test.kinds", { ref: "uuid-1", kind: "refines" });
  });

  it("puts the selected row of the shown list first for an element argument", async () => {
    const row = elementBuffer("uuid-7", "spec", "SR-000007 (SR-7) Title 7");
    const { context, asked, call } = setup([list], { "trace.affected": () => ({ elements: [], total: 0 }) });
    start({ ...context, row }, "trace.affected");
    const ref = await last(asked);
    expect(ref.items.map((i) => i.name)).toEqual(["SR-000007 (SR-7) Title 7"]);
    ref.items[0]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("trace.affected", { ref: "uuid-7" });
    // The shown element wins over a row.
    const shownToo = setup([shown]);
    start({ ...shownToo.context, row }, "trace.affected");
    expect((await last(shownToo.asked)).items.map((i) => i.name)).toEqual(["SR-000001 (SR-1) Title 1"]);
  });

  it("puts the element of an entry first, before the shown element (SR-197)", async () => {
    const entry = elementBuffer("uuid-8", "spec", "SR-000008 (SR-8) Title 8");
    const { context, asked, call } = setup([shown], { "trace.affected": () => ({ elements: [], total: 0 }) });
    start({ ...context, entry }, "trace.affected");
    const ref = await last(asked);
    expect(ref.items.map((i) => i.name)).toEqual(["SR-000008 (SR-8) Title 8"]);
    ref.items[0]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("trace.affected", { ref: "uuid-8" });
  });

  it("opens the prompt of an argument at once with its label and fills its candidates when they arrive", async () => {
    const { context, asked } = setup([shown], { "relation.options": () => OPTIONS });
    start(context, "test.kinds");
    // Before any answer: the prompt is there, with its label and no candidates yet.
    expect(asked.at(-1)?.label).toBe("Show kinds · ref:");
    expect(asked.at(-1)?.items).toEqual([]);
    expect((await asked.at(-1)?.fill)?.items?.map((i) => i.name)).toEqual(["SR-000001 (SR-1) Title 1"]);
  });

  it("gives a result buffer the revision when the command runs, not when its prompt opened", async () => {
    const { context, asked, dispatched, changed } = setup([shown], {
      "relation.options": () => OPTIONS,
    });
    start(context, "test.kinds");
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
    start(context, "test.kinds");
    const ref = await last(asked);
    ref.items[0]?.run();
    await flush();
    expect(dispatched.at(-1)).toMatchObject({ type: "open", buffer: { revision: 3 } });
  });

  it("[SR-108/AK-v62v] finds elements by element.search for an element argument, and takes the one chosen", async () => {
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

  it("[SR-205/AK-ndnj] takes a typed reference to a criterion for an element argument, which no search finds", async () => {
    const { context, asked, call } = setup([list], {
      "element.search": () => ({ hits: [], total: 0 }),
      "element.resolve": () => ({ element: { id: "u1" }, current: null }),
    });
    start(context, "element.resolve");
    const ref = await last(asked);
    expect(await ref.find?.("tit")).toEqual([]);
    const found = await ref.find?.(" [SR-036/AK-k7f3] ");
    expect(found?.map((i) => i.name)).toEqual(["Use [SR-036/AK-k7f3]"]);
    found?.[0]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.resolve", { ref: "[SR-036/AK-k7f3]" });
    // Ctrl/Cmd+Enter: taken, then the optional arguments.
    (await ref.find?.("SR-036/AK-k7f3"))?.[0]?.more?.();
    expect((await last(asked)).label).toContain("more arguments:");
  });

  it("[SR-205/AK-ndnj] offers a typed reference to a criterion only for element.resolve, which reads it", async () => {
    const { context, asked } = setup([list], {
      "element.search": () => ({ hits: [], total: 0 }),
    });
    start(context, "evidence.list");
    expect(await (await last(asked)).find?.("[SR-036/AK-k7f3]")).toEqual([]);
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
    expect(second.label).toBe("Show related elements SR-000001 (SR-1) · refs:");
    (await second.find?.("t"))?.[0]?.run();
    const third = await last(asked);
    third.empty?.(false);
    const direction = await last(asked);
    expect(direction.label).toBe("Show related elements SR-000001 (SR-1) SR-000002 · direction:");
    // Back: SR-000002 is taken back, and refs takes values again with SR-000001 (SR-1) kept.
    direction.back?.();
    const refs = await last(asked);
    expect(refs.label).toBe("Show related elements SR-000001 (SR-1) · refs:");
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
    expect(direction.label).toBe("Show related elements SR-000001 (SR-1) · direction:");
    item(direction.items, "parents").run();
    expect((await last(asked)).label).toBe(
      "Show related elements SR-000001 (SR-1) parents · more arguments:",
    );
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
    expect((await last(asked)).label).toBe("Show related elements SR-000001 (SR-1) · direction:");
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
      "Invalid input for trace.chain: maxDepth must be >= 0 · Show trace chain SR-000001 (SR-1) · maxDepth:",
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
    expect(more.label).toBe("Show trace chain SR-000001 (SR-1) 2 · more arguments:");
    item(more.items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith(
      "trace.chain",
      expect.objectContaining({ ref: "uuid-1", maxDepth: 2 }),
    );
    expect(dispatched.at(-1)).toMatchObject({
      type: "open",
      buffer: { name: "Show trace chain SR-000001 (SR-1) 2" },
    });
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
    expect((await last(asked)).label).toBe(
      "selection: wrong · Show trace chain SR-000001 (SR-1) · maxDepth:",
    );
  });

  it("drops with a refused value the values whose offer was read from it, and asks them again", async () => {
    let refuse = true;
    const { context, asked, call } = setup([shown], {
      "relation.options": () => OPTIONS,
      "test.kinds": (input) =>
        refuse && input["kind"] !== undefined
          ? refusedWith("ref: wrong", { errors: [{ field: "ref", message: "ref: wrong" }] })
          : OPTIONS,
    });
    start(context, "test.kinds", true);
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "kind").run();
    item((await last(asked)).items, "refines").run();
    item((await last(asked)).items, "Run").run();
    const again = await last(asked);
    // `kind` was offered for the refused `ref`: it goes with it.
    expect(again.label).toBe("ref: wrong · Show kinds · ref:");
    refuse = false;
    again.items[0]?.run();
    const more = await last(asked);
    expect(more.items.map((i) => i.name)).toEqual(["Run", "kind"]);
    item(more.items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("test.kinds", { ref: "uuid-1" });
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
    item((await last(asked)).items, "SR-000001 (SR-1) Title 1").run();
    item((await last(asked)).items, "repository").run();
    const repository = await last(asked);
    expect(repository.label).toBe("No workspace · Read it SR-000001 (SR-1) · repository:");
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
    // A metamodel without a variant type has the core alone (#285).
    expect(await names(asked)).toEqual(["Core"]);
    await pick(asked, "Core", true);
    await pick(asked, "Run");
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.get", {
      ref: "uuid-1",
      repository: "spec",
      versionDate: true,
      view: "core",
    });
    catalogItems(context, [{ ...command("hint.list"), title: "Hints" }], [])[0]?.more?.();
    await pick(asked, "type");
    expect(await names(asked)).toEqual(["Need"]);
  });

  it("offers the core and the variants of the workspace for a view, or says why it cannot (#285)", async () => {
    const variants = setup([shown], {
      "metamodel.get": () => ({ types: [{ key: "variant", name: "Variant", meaning: "variant" }] }),
      "element.list": () => ({ elements: [{ id: "u-coast", shortId: "VAR-1", title: "Coast" }] }),
    });
    const chain = { ...command("trace.chain"), title: "Chain" };
    catalogItems(variants.context, [chain], [])[0]?.more?.();
    await pick(variants.asked);
    await pick(variants.asked, "view");
    expect(await names(variants.asked)).toEqual(["Core", "VAR-1 Coast"]);
    await pick(variants.asked, "VAR-1 Coast", true);
    await pick(variants.asked, "Run");
    await flush();
    expect(variants.call).toHaveBeenLastCalledWith("trace.chain", { ref: "uuid-1", view: "u-coast" });
    const broken = setup([shown], { "metamodel.get": () => new Error("No metamodel") });
    catalogItems(broken.context, [chain], [])[0]?.more?.();
    await pick(broken.asked);
    await pick(broken.asked, "view");
    expect((await last(broken.asked)).label).toBe("No metamodel · Chain SR-000001 (SR-1) · view:");
  });

  it("offers the baselines of the workspace by name (baseline.list), or says why it cannot", async () => {
    const { context, asked, call } = setup([shown], {
      "baseline.list": () => ({
        baselines: [
          { name: "Release 1", file: "b/r.yaml", repository: "spec", date: "2026-11-02", elements: 2 },
        ],
      }),
    });
    start(context, "baseline.get");
    expect(await names(asked)).toEqual(["Release 1"]);
    await pick(asked, "Release 1");
    await flush();
    expect(call).toHaveBeenLastCalledWith("baseline.get", { baseline: "Release 1" });
    // Two baselines that share a name (ignoring case) are offered, and given, by their file names.
    const shared = setup([shown], {
      "baseline.list": () => ({
        baselines: [
          {
            name: "Release 1",
            file: "b/release-1.yaml",
            repository: "spec",
            date: "2026-11-02",
            elements: 2,
          },
          { name: "RELEASE 1", file: "b/r1.yaml", repository: "spec", date: "2026-11-03", elements: 2 },
          { name: "Release 2", file: "b/r2.yaml", repository: "spec", date: "2026-11-04", elements: 2 },
        ],
      }),
    });
    start(shared.context, "baseline.get");
    expect(await names(shared.asked)).toEqual([
      "Release 1 · release-1.yaml",
      "RELEASE 1 · r1.yaml",
      "Release 2",
    ]);
    await pick(shared.asked, "RELEASE 1 · r1.yaml");
    await flush();
    expect(shared.call).toHaveBeenLastCalledWith("baseline.get", { baseline: "r1.yaml" });
    const broken = setup([shown], { "baseline.list": () => new Error("No baselines folder") });
    start(broken.context, "baseline.get");
    expect((await last(broken.asked)).label).toBe("No baselines folder · Show baseline · baseline:");
  });

  it("offers the perspectives of the workspace by name (perspective.list, SR-213)", async () => {
    const { context, asked } = setup([shown], {
      "perspective.list": () => ({
        perspectives: [{ name: "Drafts by package", file: "perspectives/d.yaml", where: { all: [] } }],
      }),
    });
    catalogItems(context, [{ ...command("element.list"), title: "List" }], [])[0]?.more?.();
    await pick(asked, "perspective");
    expect(await names(asked)).toEqual(["Drafts by package"]);
  });

  const numbers = {
    ...command("evidence.coverage"),
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
    expect(call).toHaveBeenLastCalledWith("evidence.coverage", {
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
    expect(call).toHaveBeenLastCalledWith("evidence.coverage", {
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

describe("the fixed values of SR-215 AK1 as hits (#1644)", () => {
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const ADDED = new Set([
    "criterion",
    "evidenceLocation",
    "elementFile",
    "metamodelLocation",
    "group",
    "condition",
    "sort",
    "searchField",
    "properties",
    "relations",
  ]);

  /** A copy of `name` that asks only `fields`, all required, in their catalog order, titled "Ask it". */
  const only = (name: string, ...fields: readonly string[]): CommandListing => {
    const listing = command(name);
    return {
      ...listing,
      title: "Ask it",
      arguments: listing.arguments.filter((arg) => fields.includes(arg.field)),
      input: { ...listing.input, required: [...fields] },
    };
  };

  /** The name and the key beside it of each hit of the last prompt. */
  const hits = async (asked: readonly Prompt[]): Promise<string[]> =>
    (await last(asked)).items.map((choice) => `${choice.name} | ${choice.hint ?? ""}`);

  const CRITERIA = {
    property: "acceptance-criteria",
    criteria: [
      { criterion: 1, key: "kone", text: "Given a list,\n  when it opens" },
      { criterion: 2, text: "Without a key" },
      { criterion: 3, key: "k3x9", text: "Third" },
    ],
  };

  it("lists the new sources on the arguments the plan names, and a meaning only on element arguments", () => {
    const named = CATALOG.flatMap((entry) =>
      entry.arguments
        .filter((arg) => ADDED.has(arg.complete) || arg.meaning !== undefined)
        .map(
          (arg) =>
            `${entry.name} ${arg.field} ${arg.complete}${arg.meaning === undefined ? "" : `/${arg.meaning}`}`,
        ),
    );
    expect(named.sort()).toEqual(
      [
        "element.addAttachment file elementFile",
        "element.create properties properties",
        "element.create relations relations",
        "element.get file elementFile",
        "element.list group group",
        "element.list sort sort",
        "element.resolve file elementFile",
        "element.search fields searchField",
        "element.search group group",
        "evidence.list file elementFile",
        "evidence.record criteria criterion",
        "evidence.record folder evidenceLocation",
        "evidence.record variant element/variant",
        "filter.save sort sort",
        "filter.save where condition",
        "hint.list package element/package",
        "hint.list variant element/variant",
        "perspective.save group group",
        "perspective.save sort sort",
        "perspective.save where condition",
        "trace.affected file elementFile",
        "trace.chain file elementFile",
        "trace.matrix sort sort",
        "variant.diff variant element/variant",
        "variant.exclude variant element/variant",
        "workspace.init metamodel metamodelLocation",
      ].sort(),
    );
  });

  it("[SR-215/AK-fj75] shows types, statuses, properties, relation kinds and choices by name with the key beside", async () => {
    const { context, asked } = setup([shown], {
      "element.get": () => ({
        element: { ...hit(1), type: "software-requirement", properties: {}, relations: [] },
      }),
      "metamodel.get": () => FIXTURE_METAMODEL,
      "relation.options": () => OPTIONS,
    });
    catalogItems(context, [only("element.create", "type")], [])[0]?.run();
    expect(await hits(asked)).toEqual([
      "System Requirement | requirement",
      "Software Requirement | software-requirement",
      "Decision | decision",
      "Package | package",
    ]);
    catalogItems(context, [only("element.setStatus", "refs", "status")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    (await last(asked)).empty?.(false);
    expect(await hits(asked)).toEqual(["Draft | draft", "Approved | approved", "Retired | retired"]);
    catalogItems(context, [only("element.bulkUpdate", "property", "value")], [])[0]?.run();
    expect(await hits(asked)).toContain("Component | component");
    item((await last(asked)).items, "Component").run();
    expect(await hits(asked)).toEqual(["Display | display", "Sensor | sensor"]);
    catalogItems(context, [only("relation.add", "source", "kind")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    expect(await hits(asked)).toEqual(["derives from | derives-from", "refines | "]);
    // A value whose name is its key (a choice of the catalog, a repository) shows it once.
    catalogItems(context, [only("element.get", "versionDate")], [])[0]?.run();
    expect(await hits(asked)).toEqual(["yes | ", "no | "]);
  });

  it("[SR-216/AK-s99w] offers the fields of element.searchFields by name with the key beside, without those taken", async () => {
    const { context, asked, call } = setup([shown], {
      "element.searchFields": () => ({
        fields: [
          { key: "title", name: "Title" },
          { key: "text", name: "Text" },
          { key: "id", name: "IDs" },
          { key: "properties", name: "All properties" },
          { key: "rationale", name: "Rationale" },
        ],
      }),
      "element.search": () => ({ hits: [], total: 0 }),
    });
    catalogItems(context, [only("element.search", "fields")], [])[0]?.run();
    expect(await hits(asked)).toEqual([
      "Title | title",
      "Text | text",
      "IDs | id",
      "All properties | properties",
      "Rationale | rationale",
    ]);
    item((await last(asked)).items, "Rationale").run();
    expect(await hits(asked)).toEqual([
      "Title | title",
      "Text | text",
      "IDs | id",
      "All properties | properties",
    ]);
    (await last(asked)).empty?.(false);
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.search", { fields: ["rationale"] });
  });

  it("[SR-215/AK-fj75] offers the saved filters, the variants and the packages as hits and puts in what the command expects", async () => {
    const { context, asked, call } = setup([shown], {
      "filter.list": () => ({ filters: [{ name: "open needs", file: "f.yaml", where: {} }], problems: [] }),
      "metamodel.get": () => ({
        ...FIXTURE_METAMODEL,
        types: [...FIXTURE_METAMODEL.types, { key: "variant", name: "Variant", meaning: "variant" }],
      }),
      "element.list": (input) => ({
        elements: JSON.stringify(input).includes('"variant"')
          ? [{ ...hit(7), shortId: "VAR-1", identifier: "VAR-001", title: "Coast" }]
          : [{ ...hit(8), shortId: "PKG-1", title: "App" }],
      }),
    });
    catalogItems(context, [only("perspective.save", "filter")], [])[0]?.run();
    expect(await hits(asked)).toEqual(["open needs | "]);
    item((await last(asked)).items, "open needs").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("perspective.save", { filter: "open needs" });
    catalogItems(context, [only("hint.list", "package", "variant")], [])[0]?.run();
    expect(await hits(asked)).toEqual(["PKG-1 App | "]);
    expect(call).toHaveBeenCalledWith("element.list", {
      selection: { where: { type: ["package"] } },
      limit: 5000,
    });
    (await last(asked)).items[0]?.run();
    // The line names a hit by its ID, as an element found by search.
    expect((await last(asked)).label).toBe("Ask it PKG-1 · variant:");
    expect(await hits(asked)).toEqual(["VAR-1 (VAR-001) Coast | "]);
    (await last(asked)).items[0]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("hint.list", { package: "uuid-8", variant: "uuid-7" });
    // A metamodel without a type of the meaning offers none, and a failed read says why.
    const none = setup([shown], { "metamodel.get": () => FIXTURE_METAMODEL });
    catalogItems(none.context, [only("variant.diff", "variant")], [])[0]?.run();
    expect(await hits(none.asked)).toEqual([]);
    const broken = setup([shown], { "metamodel.get": () => new Error("No metamodel") });
    catalogItems(broken.context, [only("variant.diff", "variant")], [])[0]?.run();
    expect((await last(broken.asked)).label).toBe("No metamodel · Ask it · variant:");
  });

  it("[SR-215/AK-fj75] offers the acceptance criteria of the element that have a key, by number and text with the key beside, and puts in the key", async () => {
    const { context, asked, call } = setup([shown], {
      "element.get": () => ({ element: hit(1), criterionReferences: CRITERIA }),
      "evidence.record": () => ({ files: ["e.md"] }),
    });
    catalogItems(context, [only("evidence.record", "ref", "criteria")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    expect(call).toHaveBeenCalledWith("element.get", { ref: "uuid-1" });
    expect(await hits(asked)).toEqual(["AK1 Given a list, when it opens | kone", "AK3 Third | k3x9"]);
    item((await last(asked)).items, "AK3 Third").run();
    // A list takes one per Enter, without those taken; the line names a criterion by number and key.
    expect((await last(asked)).label).toBe("Ask it SR-000001 (SR-1) AK3 (k3x9) · criteria:");
    expect(await hits(asked)).toEqual(["AK1 Given a list, when it opens | kone"]);
    (await last(asked)).items[0]?.run();
    expect(await hits(asked)).toEqual([]);
    (await last(asked)).empty?.(false);
    await flush();
    expect(call).toHaveBeenLastCalledWith("evidence.record", { ref: "uuid-1", criteria: ["k3x9", "kone"] });
    // Without an element they are typed, and a failed read says why.
    const alone = setup([shown], { "evidence.record": () => ({ files: [] }) });
    catalogItems(alone.context, [only("evidence.record", "criteria")], [])[0]?.run();
    expect((await last(alone.asked)).text).toBeDefined();
    const broken = setup([shown], { "element.get": () => new Error("No such element") });
    catalogItems(broken.context, [only("evidence.record", "ref", "criteria")], [])[0]?.run();
    (await last(broken.asked)).items[0]?.run();
    expect((await last(broken.asked)).label).toBe("No such element · Ask it SR-000001 (SR-1) · criteria:");
  });

  it("[SR-215/AK-fj75] offers the evidence locations evidence.record takes with the repository beside, and typed text for a folder below one", async () => {
    const { context, asked, call } = setup([shown], {
      "workspace.status": () => ({
        repositories: [
          { name: "spec", available: true },
          { name: "tests", available: true },
          { name: "far", available: false },
        ],
        evidence: [
          { repository: "spec", path: "evidence", available: true, folder: "evidence" },
          { repository: "tests", path: "out", available: false, folder: "../tests/out" },
          { repository: "spec", path: "evidence", available: true, folder: "evidence" },
          { repository: "far", path: "ev", available: false, folder: "../far/ev" },
          { repository: "unlisted", path: "ev", available: false },
        ],
      }),
      "evidence.record": () => ({ files: [] }),
    });
    catalogItems(context, [only("evidence.record", "folder")], [])[0]?.run();
    expect(await hits(asked)).toEqual(["evidence | spec", "../tests/out | tests"]);
    item((await last(asked)).items, "../tests/out").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("evidence.record", { folder: "../tests/out" });
    catalogItems(context, [only("evidence.record", "folder")], [])[0]?.run();
    const prompt = await last(asked);
    // A folder below a location comes first as itself; a text below none has no such row.
    expect(prompt.literal?.("evidence/manual")?.name).toBe("Use evidence/manual");
    expect(prompt.literal?.("evidently")).toBeUndefined();
    prompt.literal?.("evidence/manual")?.more?.();
    expect((await last(asked)).label).toBe("Ask it evidence/manual · more arguments:");
    catalogItems(context, [only("evidence.record", "folder")], [])[0]?.run();
    (await last(asked)).text?.("elsewhere");
    await flush();
    expect(call).toHaveBeenLastCalledWith("evidence.record", { folder: "elsewhere" });
  });

  it("[SR-215/AK-fj75] offers the file of the element, or the files of an ambiguous reference with the repository beside", async () => {
    const ambiguous = Object.assign(new Error("ref names 2 elements"), {
      name: "ref.ambiguous",
      details: {
        ref: "uuid-1",
        candidates: [
          { id: "uuid-1", repository: "spec", file: "a/SR-1.md" },
          { id: "uuid-1", repository: "copy", file: "b/SR-1.md" },
          { id: "uuid-1" },
        ],
      },
    });
    let answer: unknown = { element: hit(1) };
    const { context, asked, call } = setup([shown], {
      "element.get": (input) => (input["file"] === undefined ? answer : { element: hit(1) }),
    });
    catalogItems(context, [only("element.get", "ref", "file")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    expect(await hits(asked)).toEqual(["f1.md | spec"]);
    answer = ambiguous;
    catalogItems(context, [only("element.get", "ref", "file")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    expect(await hits(asked)).toEqual(["a/SR-1.md | spec", "b/SR-1.md | copy"]);
    item((await last(asked)).items, "b/SR-1.md").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.get", { ref: "uuid-1", file: "b/SR-1.md" });
    // A reference element.get does not read, or a refusal without candidates: typed, core checks it.
    answer = new Error("No such element");
    catalogItems(context, [only("element.get", "ref", "file")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    expect((await last(asked)).text).toBeDefined();
    answer = Object.assign(new Error("ambiguous"), { name: "ref.ambiguous" });
    catalogItems(context, [only("element.get", "ref", "file")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    expect((await last(asked)).text).toBeDefined();
  });

  it("[SR-215/AK-fj75] gives the repository with a file two repositories hold, and offers only the files of a repository given before", async () => {
    const ambiguous = Object.assign(new Error("ref names 3 elements"), {
      name: "ref.ambiguous",
      details: {
        candidates: [
          { id: "uuid-1", repository: "spec", file: "x/SR-1.md" },
          { id: "uuid-1", repository: "copy", file: "x/SR-1.md" },
          { id: "uuid-1", repository: "copy", file: "y/SR-1.md" },
        ],
      },
    });
    const { context, asked, call } = setup([shown], {
      "element.get": (input) => (input["file"] === undefined ? ambiguous : { element: hit(1) }),
      "workspace.status": () => ({ repositories: [{ name: "copy", available: true }] }),
    });
    // `repository` is an optional argument of the command, not asked here.
    const get = only("element.get", "ref", "repository", "file");
    const files = { ...get, input: { ...get.input, required: ["ref", "file"] } };
    catalogItems(context, [files], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    const offered = (await last(asked)).items;
    expect(new Set(offered.map((choice) => choice.id)).size).toBe(3);
    expect(offered.map((choice) => `${choice.name} | ${choice.hint ?? ""}`)).toEqual([
      "x/SR-1.md | spec",
      "x/SR-1.md | copy",
      "y/SR-1.md | copy",
    ]);
    offered[1]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.get", {
      ref: "uuid-1",
      repository: "copy",
      file: "x/SR-1.md",
    });
    offered[2]?.run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.get", { ref: "uuid-1", file: "y/SR-1.md" });
    catalogItems(context, [only("element.get", "ref", "repository", "file")], [])[0]?.run();
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "copy").run();
    expect(await hits(asked)).toEqual(["x/SR-1.md | copy", "y/SR-1.md | copy"]);
  });

  it("[SR-215/AK-fj75] asks the metamodel location in two steps: the main repository or a typed one, then the path, completed below the new workspace's folder", async () => {
    const { context, asked, call } = setup([], {
      "workspace.listFolder": () => ({ entries: [{ name: "model", kind: "folder" }] }),
      "workspace.init": () => ({ files: [], problems: [] }),
    });
    const init = only("workspace.init", "path", "metamodel");
    catalogItems(context, [init], [])[0]?.run();
    (await last(asked)).text?.("work/new/");
    const repository = await last(asked);
    expect(repository.label).toBe("Ask it work/new/ · metamodel:");
    expect(repository.items.map((choice) => `${choice.name} | ${choice.hint ?? ""}`)).toEqual([
      "Main repository | default",
    ]);
    expect(repository.literal?.("")).toBeUndefined();
    repository.items[0]?.run();
    const path = await last(asked);
    expect(path.label).toBe("Ask it work/new/ · metamodel · path in the main repository:");
    const found = await path.seek?.("");
    expect(call).toHaveBeenLastCalledWith("workspace.listFolder", { path: "work/new/", files: false });
    expect(found?.choices.map((choice) => choice.complete)).toEqual([`model${PLATFORM_SEP}`]);
    // Backspace goes back to the repository.
    path.back?.();
    expect((await last(asked)).label).toBe("Ask it work/new/ · metamodel:");
    (await last(asked)).items[0]?.run();
    (await last(asked)).text?.("model");
    await flush();
    expect(call).toHaveBeenLastCalledWith("workspace.init", {
      path: "work/new/",
      metamodel: { path: "model" },
    });
  });

  it("[SR-215/AK-fj75] asks the path of a metamodel in another repository, typed by its name, as typed text", async () => {
    const { context, asked, call } = setup([], { "workspace.init": () => ({ files: [], problems: [] }) });
    const init = only("workspace.init", "path", "metamodel");
    catalogItems(context, [init], [])[0]?.run();
    (await last(asked)).text?.("work/new");
    (await last(asked)).literal?.(" shared ")?.more?.();
    const other = await last(asked);
    expect(other.label).toBe("Ask it work/new · metamodel · path in shared:");
    expect(other.seek).toBeUndefined();
    other.text?.("mm");
    expect((await last(asked)).label).toBe("Ask it work/new shared:mm · more arguments:");
    item((await last(asked)).items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("workspace.init", {
      path: "work/new",
      metamodel: { repository: "shared", path: "mm" },
    });
  });

  it("reads the field `CONTEXT` of catalog-checks.mjs names for every argument of the catalog, never one with a meaning", () => {
    for (const entry of CATALOG) {
      entry.arguments.forEach((arg, at) => {
        expect(contextField(entry.arguments, at), `${entry.name} ${arg.field}`).toBe(
          contextOf(entry.arguments, at),
        );
      });
    }
    const record = command("evidence.record").arguments;
    const at = (field: string): number => record.findIndex((arg) => arg.field === field);
    expect(at("variant")).toBeLessThan(at("criteria"));
    expect(contextField(record, at("criteria"))).toBe("ref");
    const create = command("element.create").arguments;
    expect(
      contextField(
        create,
        create.findIndex((arg) => arg.field === "relations"),
      ),
    ).toBe("type");
    const init = command("workspace.init").arguments;
    expect(
      contextField(
        init,
        init.findIndex((arg) => arg.field === "metamodel"),
      ),
    ).toBe("path");
  });

  it("asks nothing new after the required arguments of Record evidence", async () => {
    const { context, asked, call } = setup([shown], { "evidence.record": () => ({ files: ["e.md"] }) });
    start(context, "evidence.record");
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "verification").run();
    item((await last(asked)).items, "passed").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("evidence.record", {
      ref: "uuid-1",
      kind: "verification",
      result: "passed",
    });
  });

  it("drops the criteria of a refused reference with it, keeps the variant, and offers the criteria again", async () => {
    let refuse = true;
    const { context, asked, call } = setup([shown], {
      "element.search": () => ({ hits: [hit(2)], total: 1 }),
      "element.get": () => ({ element: hit(1), criterionReferences: CRITERIA }),
      "metamodel.get": () => ({ types: [{ key: "variant", name: "Variant", meaning: "variant" }] }),
      "element.list": () => ({ elements: [{ ...hit(7), shortId: "VAR-1", title: "Coast" }] }),
      "evidence.record": () =>
        refuse
          ? refusedWith("ref: wrong", { errors: [{ field: "ref", message: "ref: wrong" }] })
          : { files: ["e.md"] },
    });
    start(context, "evidence.record");
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "verification").run();
    item((await last(asked)).items, "passed").more?.();
    item((await last(asked)).items, "variant").run();
    (await last(asked)).items[0]?.more?.();
    item((await last(asked)).items, "criteria").run();
    item((await last(asked)).items, "AK1 Given a list, when it opens").run();
    (await last(asked)).empty?.(true);
    item((await last(asked)).items, "Run").run();
    const again = await last(asked);
    expect(again.label).toMatch(/^ref: wrong · Record evidence .*· ref:$/);
    refuse = false;
    again.items[0]?.more?.();
    expect((await last(asked)).items.map((i) => i.name)).toContain("criteria");
    item((await last(asked)).items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("evidence.record", {
      ref: "uuid-1",
      kind: "verification",
      result: "passed",
      variant: "uuid-7",
    });
  });
});

describe("the commands that fit the shown view", () => {
  const list = listBuffer("type: need", { where: { type: ["need"] } });
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const around = neighbourhoodBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  /** The command prompt with nothing typed and nothing used, as the minibuffer orders it. */
  const prompt = (buffers: Buffers): Choice[] => {
    const { context } = setup(buffers);
    const { items } = commandPrompt(context, undefined, catalogItems(context, CATALOG, ACTIONS));
    return rankByUse(items, (choice) => choice.name, "", undefined).map(({ item: choice }) => choice);
  };

  it("[SR-133/AK-w23t] fits a command with a required element argument to a shown element, one with the selection to a list", () => {
    const fitting = (buffers: Buffers, name: string): boolean => fits(setup(buffers).context, command(name));
    for (const buffers of [[shown], [around]]) {
      expect(fitting(buffers, "trace.chain")).toBe(true);
      expect(fitting(buffers, "trace.affected")).toBe(true);
      // An element argument that is not required, the selection, or no argument: the view gives nothing.
      expect(fitting(buffers, "hint.list")).toBe(false);
      expect(fitting(buffers, "evidence.degree")).toBe(false);
      expect(fitting(buffers, "baseline.list")).toBe(false);
    }
    expect(fitting([list], "evidence.degree")).toBe(true);
    expect(fitting([list], "evidence.coverage")).toBe(true);
    expect(fitting([list], "trace.chain")).toBe(false);
    expect(fitting([list], "workspace.status")).toBe(false);
    // In the overview every command fits.
    expect(fitting([overviewBuffer()], "trace.chain")).toBe(true);
    expect(fitting([overviewBuffer()], "workspace.status")).toBe(true);
    expect(fitting([], "evidence.degree")).toBe(false);
  });

  it("[SR-133/AK-smn1] neither lists nor finds the seven commands whose output other commands show; every other command stays", () => {
    const hidden = CATALOG.filter((entry) => shownIn(entry) !== undefined);
    expect(hidden.map((entry) => entry.title).sort()).toEqual([
      "List folder",
      "List perspectives",
      "List recent workspaces",
      "List saved filters",
      "Show facets",
      "Show last agent access",
      "Show relation options",
    ]);
    expect(hidden.map((entry) => entry.name).sort()).toEqual(Object.keys(SHOWN_IN).sort());
    const page = { ...setup([shown]).context, element: { members: true } as ElementControls };
    const views: CatalogContext[] = [
      setup([shown]).context,
      setup([list]).context,
      setup([overviewBuffer()]).context,
      page,
      { ...setup([shown]).context, readOnly: true },
      { ...setup([list]).context, readOnly: true },
    ];
    const offered = new Set<string>();
    for (const context of views) {
      const { items } = commandPrompt(context, undefined, catalogItems(context, CATALOG, ACTIONS));
      for (const choice of items) {
        offered.add(choice.id);
      }
      for (const entry of hidden) {
        expect(items.map((choice) => choice.id)).not.toContain(`command:${entry.name}`);
        // Typing its title finds no entry of it; what the title finds is another entry.
        const found = rank(items, (choice) => choice.name, entry.title).map(({ item: choice }) => choice);
        expect(found.map((choice) => choice.name)).not.toContain(entry.title);
      }
    }
    // Every other implemented command is offered by its title, or covered by an action (which the prompt
    // offers where it applies: "Copy graph as Mermaid" in a graph).
    for (const entry of CATALOG.filter((listing) => listing.implemented && shownIn(listing) === undefined)) {
      const covered = ACTIONS.some(
        (candidate) => candidate.title === entry.title || candidate.covers?.includes(entry.name) === true,
      );
      expect(covered || offered.has(`command:${entry.name}`), entry.name).toBe(true);
    }
  });

  it("[SR-133/AK-w23t] shows the actions and the fitting commands above the others when nothing is typed", () => {
    expect(prompt([overviewBuffer()]).every((choice) => choice.fits === true)).toBe(true);
    for (const buffers of [[shown], [list]]) {
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
        ["Show affected elements", "Show trace chain", "Show workspace status", "Check workspace"],
      ),
    ).toEqual(["Show trace chain", "Show affected elements", "Show workspace status", "Check workspace"]);
    expect(order([list], ["Show trace chain", "Show evidence coverage"])).toEqual([
      "Show evidence coverage",
      "Show trace chain",
    ]);
  });

  /** The rows of the command prompt with an empty input as the window builds it, without use (SR-133 AK1). */
  const opening = (context: CatalogContext, use?: PromptUse): string[] => {
    const built = commandPrompt(context, use, catalogItems(context, CATALOG, ACTIONS), undefined, vi.fn());
    return openingRows({ ...built, items: unusedOrder(built.items) }, "", []).map(({ item }) => item.name);
  };

  it("[SR-133/AK-w23t] opens with the first nine fitting commands: the letters after the prefix key, the own shortcuts, then by name; last All commands…", () => {
    expect(opening(setup([shown]).context)).toEqual([
      "Create relation",
      "Set status",
      "Confirm hints",
      "List all elements",
      "Open perspective",
      "Show overview",
      "Close buffer",
      "Go to element or buffer",
      "Search elements",
      "All commands…",
    ]);
    expect(opening(setup([list]).context)).toEqual([
      "List all elements",
      "Open perspective",
      "Show overview",
      "Filter list",
      "Sort list",
      "Close buffer",
      "Go to element or buffer",
      "Search elements",
      "Show traceability matrix",
      "All commands…",
    ]);
    // In a read-only workspace the write commands are not among them (SR-011 AK3).
    expect(opening({ ...setup([shown]).context, readOnly: true }).slice(0, 4)).toEqual([
      "List all elements",
      "Open perspective",
      "Show overview",
      "Close buffer",
    ]);
    // In the overview every command fits; without use the letters come first there too.
    expect(opening(setup([overviewBuffer()]).context).slice(0, 3)).toEqual([
      "Create element",
      "Create relation",
      "Set status",
    ]);
  });

  it("[SR-133/AK-w23t] puts the commands in use first, and orders as without use when the use cannot be read", () => {
    const used: PromptUse = {
      score: (id) => (id === "command:trace.chain" ? 2 : id === "sort" ? 1 : 0),
      remembered: () => undefined,
      record: vi.fn(),
    };
    // "Sort list" does not fit an element: in use or not, it is not among the nine there.
    expect(opening(setup([shown]).context, used).slice(0, 3)).toEqual([
      "Show trace chain",
      "Create relation",
      "Set status",
    ]);
    const unreadable = promptUse(() => {
      throw new Error("no storage");
    });
    expect(opening(setup([shown]).context, unreadable)).toEqual(opening(setup([shown]).context));
  });

  it("[SR-133/AK-w23t] shows every command without All commands… where at most ten can run", () => {
    const few = (count: number): Prompt => ({
      label: "Command",
      opening: { first: 9, last: { id: "all", name: "All commands…", run: vi.fn() } },
      items: Array.from({ length: count }, (_, at) => ({
        id: String(at),
        name: `C${String(at)}`,
        run: vi.fn(),
      })),
    });
    // None of them fits: at most ten are shown all the same, more give the fitting ones and the last row.
    expect(openingRows(few(10), "", [])).toHaveLength(10);
    expect(openingRows(few(11), "", []).map(({ item }) => item.name)).toEqual(["All commands…"]);
    // A typed text finds among all of them, never the last row.
    expect(openingRows(few(11), "all", []).map(({ item }) => item.name)).toEqual([]);
    expect(openingRows(few(11), "C1", []).map(({ item }) => item.name)).toEqual(["C1", "C10"]);
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

  it("[SR-064/AK-xjg5] is in the command prompt once, by the title of element.create, and asks the type among the types that can have elements", async () => {
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

  it("[SR-064/AK-xjg5] asks, after the type and the title, only the required properties of the type, one after the other", async () => {
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
    // Only with Ctrl/Cmd+Enter on the title its optional arguments follow: the other properties and the
    // relations of the new element among them (SR-215 AK8).
    const more = creating();
    start(more.context, "element.create");
    item((await last(more.asked)).items, "Decision").run();
    (await last(more.asked)).more?.("Use wind");
    expect((await last(more.asked)).items.map((i) => i.name)).toEqual([
      "Run",
      "text",
      "properties",
      "relations",
      "repository",
      "folder",
    ]);
  });

  it("[SR-064/AK-yhn7] creates the element with every required property left empty, opens it, and says how many hints core gave", async () => {
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
      buffer: { ...elementBuffer("uuid-9", "spec", "REP-000009 Wind gusts"), type: "report" },
    });
    expect(echoed.at(-1)).toBe("Created REP-000009 Wind gusts · 3 hints");
  });

  it("[SR-064/AK-yhn7] creates the element with an empty title too, when the title is left empty", async () => {
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
    // The other properties are offered as `properties` (SR-215 AK8).
    expect(more.items.map((i) => i.name)).toEqual([
      "Run",
      "text",
      "properties",
      "relations",
      "repository",
      "folder",
    ]);
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

describe('"Create element": the other properties and the relations built from marks (SR-215 AK8)', () => {
  const created = (input: Record<string, unknown>) => ({
    element: { ...hit(9), type: input["type"], title: input["title"], properties: {}, relations: [] },
    files: ["f9.md"],
    problems: [],
  });

  /**
   * "Create element" of a Software Requirement titled "Wind" with Ctrl/Cmd+Enter, its required `component`
   * skipped (or answered `component`), at the optional argument `field`; resolves the first step.
   */
  const atBuilt = async (
    field: string,
    component?: string,
    answers: Record<string, (input: Record<string, unknown>) => Answer> = {},
  ) => {
    const running = setup([overviewBuffer()], {
      "metamodel.get": () => CREATE_METAMODEL,
      "element.create": created,
      "element.search": () => ({ hits: [hit(4), hit(5)], total: 2 }),
      ...answers,
    });
    const { context, asked } = running;
    start(context, "element.create");
    item((await last(asked)).items, "Software Requirement").run();
    (await last(asked)).more?.("Wind");
    const required = await last(asked);
    if (component === undefined) {
      required.empty?.(true);
    } else {
      item(required.items, component).more?.();
    }
    item((await last(asked)).items, field).run();
    return { ...running, first: await last(asked) };
  };

  const names = (prompt: Prompt): string[] =>
    prompt.items.map((choice) => `${choice.name}${choice.hint === undefined ? "" : ` | ${choice.hint}`}`);
  const markLabels = (prompt: Prompt): string[] => (prompt.marks ?? []).map((mark) => mark.label);

  it("[SR-215/AK-tn9x] [SR-215/AK-hnzf] [SR-210/AK-t8sc] offers the properties of the type without a value, a skipped required one too, then their values; each property with its values is one mark", async () => {
    const { asked, call, first } = await atBuilt("properties");
    expect(first.label).toBe("Create element Software Requirement Wind · properties:");
    expect(first.explain?.building).toEqual({ enter: "takes the marked hit", unmark: false, json: false });
    // By name with the key beside; never the title.
    expect(names(first)).toEqual([
      "No properties",
      "Rationale | rationale",
      "Package | packages",
      "Component | component",
    ]);
    item(first.items, "Component").run();
    const component = await last(asked);
    expect(component.label).toBe("Create element Software Requirement Wind · properties · component:");
    expect(names(component)).toEqual(["Display | display", "Sensor | sensor"]);
    item(component.items, "Display").run();
    // A list takes one value per Enter, in the same mark.
    const more = await last(asked);
    expect(markLabels(more)).toEqual(["component: Display"]);
    expect(names(more)).toEqual(["Sensor | sensor"]);
    item(more.items, "Sensor").run();
    (await last(asked)).empty?.(false);
    const second = await last(asked);
    expect(markLabels(second)).toEqual(["component: Display, Sensor"]);
    expect(second.explain?.building?.unmark).toBe(true);
    expect(names(second)).toEqual(["Take 1 property", "Rationale | rationale", "Package | packages"]);
    item(second.items, "Rationale").run();
    (await last(asked)).text?.("Gusts break masts");
    item((await last(asked)).items, "Package").run();
    (await (await last(asked)).find?.("pkg"))?.[0]?.run();
    // The explanation line names the keys of the step (SR-210 AK2).
    expect((await last(asked)).explain?.building?.enter).toBe(
      "adds a value, on an empty input ends the values",
    );
    (await last(asked)).empty?.(false);
    const third = await last(asked);
    expect(markLabels(third)).toEqual([
      "component: Display, Sensor",
      "rationale: Gusts break masts",
      "packages: SR-000004",
    ]);
    expect(names(third)).toEqual(["Take 3 properties"]);
    item(third.items, "Take 3 properties").run();
    const run = await last(asked);
    expect(run.label).toBe(
      "Create element Software Requirement Wind component: Display, Sensor · rationale: Gusts break masts · packages: SR-000004 · more arguments:",
    );
    // The properties built from marks are not offered again.
    expect(run.items.map((choice) => choice.name)).not.toContain("properties");
    item(run.items, "Run").run();
    await flush();
    // Each entry with its value, as the command line takes it (AK10).
    expect(call).toHaveBeenLastCalledWith("element.create", {
      type: "software-requirement",
      title: "Wind",
      properties: {
        component: ["display", "sensor"],
        rationale: "Gusts break masts",
        packages: [{ id: "uuid-4", repository: "spec" }],
      },
    });
  });

  it("[SR-215/AK-tn9x] [SR-215/AK-hnzf] offers the relation kinds the type may have as source, then the elements of their target types; each relation is one mark", async () => {
    const { asked, call, first } = await atBuilt("relations");
    expect(first.label).toBe("Create element Software Requirement Wind · relations:");
    expect(names(first)).toEqual([
      "No relations",
      "Derives from | derives-from",
      "Replaces | replaces",
      "Delegates to | delegates-to",
      "Based on | based-on",
      "Concerns | concerns",
      "Refines | refines",
    ]);
    item(first.items, "Derives from").run();
    const target = await last(asked);
    expect(target.label).toBe("Create element Software Requirement Wind · relations · derives-from:");
    const found = await target.find?.("tit");
    expect(call.mock.lastCall?.[1]).toMatchObject({
      selection: { where: { type: ["requirement", "software-requirement"] } },
    });
    found?.[0]?.run();
    item((await last(asked)).items, "Derives from").run();
    (await (await last(asked)).find?.("tit"))?.[1]?.run();
    item((await last(asked)).items, "Based on").run();
    (await (await last(asked)).find?.("tit"))?.[0]?.run();
    const taken = await last(asked);
    expect(markLabels(taken)).toEqual([
      "derives-from: SR-000004",
      "derives-from: SR-000005",
      "based-on: SR-000004",
    ]);
    item(taken.items, "Take 3 relations").run();
    item((await last(asked)).items, "Run").run();
    await flush();
    // A kind with several targets as a list, with one as its reference (AK10).
    expect(call).toHaveBeenLastCalledWith("element.create", {
      type: "software-requirement",
      title: "Wind",
      relations: { "derives-from": ["uuid-4", "uuid-5"], "based-on": "uuid-4" },
    });
  });

  it("[SR-215/AK-fm4s] the finishing hit is marked first: without a mark it skips the argument, with marks it takes them; Ctrl/Cmd+Enter offers the optional arguments", async () => {
    const { asked, call, first } = await atBuilt("relations");
    expect(first.items[0]?.name).toBe("No relations");
    first.items[0]?.run();
    const skipped = await last(asked);
    expect(skipped.label).toBe("Create element Software Requirement Wind · more arguments:");
    item(skipped.items, "properties").run();
    item((await last(asked)).items, "Rationale").run();
    (await last(asked)).text?.("Gusts");
    const marked = await last(asked);
    expect(marked.items[0]?.name).toBe("Take 1 property");
    // With a mark, Ctrl/Cmd+Enter on any hit takes the marks.
    item(marked.items, "Package").more?.();
    item((await last(asked)).items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.create", {
      type: "software-requirement",
      title: "Wind",
      properties: { rationale: "Gusts" },
    });
  });

  it("[SR-215/AK-rx2z] [SR-134/AK-fmf6] an × removes its mark; Backspace removes the last mark where the property or kind is chosen; Escape keeps the marks, which stand again", async () => {
    const { asked, first } = await atBuilt("relations");
    expect(first.unmark).toBe(true);
    item(first.items, "Based on").run();
    const target = await last(asked);
    // Choosing the target: Backspace and Escape go back to the kinds, no mark goes.
    expect(target.unmark).toBeUndefined();
    target.back?.();
    item((await last(asked)).items, "Based on").run();
    (await (await last(asked)).find?.("tit"))?.[0]?.run();
    item((await last(asked)).items, "Refines").run();
    (await (await last(asked)).find?.("tit"))?.[1]?.run();
    const two = await last(asked);
    expect(markLabels(two)).toEqual(["based-on: SR-000004", "refines: SR-000005"]);
    two.marks?.[0]?.remove();
    const one = await last(asked);
    expect(markLabels(one)).toEqual(["refines: SR-000005"]);
    // Escape goes back an argument (the property skipped last) with the marks, which stand again later.
    one.back?.();
    const skipped = await last(asked);
    expect(skipped.label).toBe("Create element Software Requirement Wind · component:");
    skipped.empty?.(true);
    item((await last(asked)).items, "relations").run();
    expect(markLabels(await last(asked))).toEqual(["refines: SR-000005"]);
    // Back to the type: the marks go with it, a new type has other kinds.
    for (let at = 0; at < 3; at += 1) {
      (await last(asked)).back?.();
    }
    item((await last(asked)).items, "Decision").run();
    (await last(asked)).more?.("Wind");
    item((await last(asked)).items, "relations").run();
    expect(markLabels(await last(asked))).toEqual([]);
  });

  it("[SR-215/AK-rx2z] [SR-134/AK-fmf6] at a property's values Escape goes back to the properties with the values given so far; an × removes a mark in each step", async () => {
    const { asked, first } = await atBuilt("properties");
    item(first.items, "Component").run();
    item((await last(asked)).items, "Display").run();
    const values = await last(asked);
    expect(values.unmark).toBeUndefined();
    values.back?.();
    const properties = await last(asked);
    expect(properties.label).toBe("Create element Software Requirement Wind · properties:");
    expect(markLabels(properties)).toEqual(["component: Display"]);
    // An empty text adds nothing; an × in a later step removes the mark and asks the first step.
    item(properties.items, "Rationale").run();
    (await last(asked)).text?.(" ");
    item((await last(asked)).items, "Rationale").run();
    (await last(asked)).marks?.[0]?.remove();
    const none = await last(asked);
    expect(none.label).toBe("Create element Software Requirement Wind · properties:");
    expect(markLabels(none)).toEqual([]);
  });

  it("[SR-215/AK-rx2z] a property core refuses is asked again with its message and the marks back", async () => {
    let refuse = true;
    const { asked, call, first } = await atBuilt("properties", undefined, {
      "element.create": (input) =>
        refuse ? refusedWith("Too long", { key: "rationale", value: "Gusts" }) : created(input),
    });
    item(first.items, "Rationale").run();
    (await last(asked)).text?.("Gusts");
    item((await last(asked)).items, "Take 1 property").run();
    item((await last(asked)).items, "Run").run();
    await flush();
    const again = await last(asked);
    expect(again.label).toBe("Too long · Create element Software Requirement Wind · properties:");
    expect(markLabels(again)).toEqual(["rationale: Gusts"]);
    refuse = false;
    item(again.items, "Take 1 property").run();
    item((await last(asked)).items, "Run").run();
    await flush();
    expect(call.mock.lastCall?.[1]).toMatchObject({ properties: { rationale: "Gusts" } });
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

describe("write commands in the command prompt (SR-073 AK2, ThomasBirkmaier/ReqSeq-archive#85)", () => {
  const list = listBuffer("type: need", { where: { type: ["need"] } });
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const titles = (context: CatalogContext): string[] =>
    catalogItems(context, CATALOG, ACTIONS).map((choice) => choice.name);

  /** The implemented write commands of the catalog. */
  const writes = CATALOG.filter((entry) => entry.implemented && entry.effect !== "read");

  it("offers every implemented write command by its title, but element.update and element.addAttachment, which the element buffer does, the two saves the builders run (SR-219 AK1), and the renames and deletes the app's actions run (SR-218)", () => {
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
      "filter.save",
      "filter.rename",
      "filter.delete",
      "perspective.save",
      "perspective.rename",
      "perspective.delete",
    ]);
    // Renaming and deleting perspectives and saved filters are app actions under the commands' titles (SR-218).
    for (const name of ["perspective.rename", "perspective.delete", "filter.rename", "filter.delete"]) {
      const covering = ACTIONS.find((action) => action.covers?.includes(name) === true);
      expect(covering?.title).toBe(CATALOG.find((entry) => entry.name === name)?.title);
    }
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
    expect(readOnly).toContain("Show trace chain");
    expect(titles({ ...context, readOnly: false })).toContain("Create relation");
  });

  it("offers only Initialise workspace while a folder without a workspace is open, and asks its path and name", async () => {
    const { context, asked, call, dispatched } = setup([], {
      "workspace.init": () => ({ root: "/station", files: ["reqseq-workspace.yaml"] }),
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

  it("saves a filter by its name, with its condition built from hits (#1645)", async () => {
    const { context, asked, call } = setup([list], {
      "metamodel.get": () => FIXTURE_METAMODEL,
      "filter.list": () => ({ filters: [] }),
      "filter.save": () => ({ files: ["filters/open.yaml"] }),
    });
    startBuilder(context, "filter.save", CATALOG);
    (await last(asked)).text?.("open");
    (await last(asked)).literal?.('{"status":["draft"]}')?.run();
    item((await last(asked)).items, "Next: sort").run();
    item((await last(asked)).items, "Save").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: { all: [{ status: ["draft"] }] },
    });
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
    expect(hintIds.label).toBe("Confirm hints SR-000001 (SR-1) · hintIds:");
    hintIds.empty?.(false);
    await flush();
    expect(call).toHaveBeenLastCalledWith("hint.confirm", { ref: "uuid-1" });
    expect(dispatched.at(-1)).toMatchObject({
      type: "open",
      buffer: { kind: "result", name: "Confirm hints SR-000001 (SR-1)", written: true },
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
    expect(second.label).toBe("Confirm hints SR-000001 (SR-1) Relation Refines is outdated · hintIds:");
    // A hint taken is not offered again.
    expect(second.items).toEqual([]);
    second.empty?.(false);
    await flush();
    // The chosen hints take the place of `ref` (`replaces`): only they are confirmed, not every hint of SR-1 (#291).
    expect(call).toHaveBeenLastCalledWith("hint.confirm", { hintIds: ["h1"] });
    // Skipped with Ctrl/Cmd+Enter: the optional arguments follow, the skipped one among them.
    const again = setup([shown], { "hint.confirm": () => ({ confirmed: [] }), "hint.list": () => HINTS });
    start(again.context, "hint.confirm");
    (await last(again.asked)).items[0]?.run();
    (await last(again.asked)).empty?.(true);
    const more = await last(again.asked);
    expect(more.items.map((i) => i.name)).toEqual(["Run", "target", "all", "kind", "expected", "hintIds"]);
    // Backspace on it asks the skipped one again.
    more.back?.();
    expect((await last(again.asked)).label).toBe("Confirm hints SR-000001 (SR-1) · hintIds:");
  });

  it("confirms the hints of a kind in the whole workspace with all yes, not those of the shown element (#644)", async () => {
    const { context, asked, call } = setup([shown], {
      "hint.confirm": () => ({ confirmed: ["h1"], files: ["f1.md"], problems: [] }),
      "hint.list": () => HINTS,
    });
    start(context, "hint.confirm");
    (await last(asked)).items[0]?.run();
    (await last(asked)).empty?.(true);
    item((await last(asked)).items, "all").run();
    item((await last(asked)).items, "yes").more?.();
    item((await last(asked)).items, "kind").run();
    // The problem codes of the catalog are offered (#1575).
    item((await last(asked)).items, "relation.outdated").more?.();
    item((await last(asked)).items, "expected").run();
    (await last(asked)).more?.("3");
    item((await last(asked)).items, "Run").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("hint.confirm", {
      all: true,
      kind: ["relation.outdated"],
      expected: 3,
    });
  });

  it("leaves every field hintIds replaces out of the input, target and kind too (#291)", async () => {
    const { context, asked, call } = setup([shown], {
      "hint.confirm": () => ({ confirmed: [] }),
      "hint.list": () => HINTS,
    });
    start(context, "hint.confirm");
    (await last(asked)).items[0]?.run();
    (await last(asked)).empty?.(true);
    item((await last(asked)).items, "target").run();
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "hintIds").run();
    item((await last(asked)).items, "Relation Refines is outdated").run();
    (await last(asked)).empty?.(false);
    item((await last(asked)).items, "Run").run();
    await flush();
    // Given were ref and target SR-000001 (SR-1) and the hint h1: only h1 is confirmed, not every hint pointing at SR-000001 (SR-1).
    expect(call).toHaveBeenLastCalledWith("hint.confirm", { hintIds: ["h1"] });
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
    const other = elementBuffer("uuid-2", "spec", "SR-000002 (SR-2) Title 2");
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
    expect(stopped.echoed.at(-1)).toBe(
      "SR-000002 (SR-2) Title 2 could not be saved: Confirm hints did not run",
    );
    // Without saveDraft nothing is saved, and the command runs; a read command saves nothing.
    const unsaving = setup([shown], {
      "hint.confirm": () => ({ confirmed: [] }),
      "hint.list": () => HINTS,
      "test.kinds": () => OPTIONS,
    });
    const plain = { ...unsaving.context, drafted: () => true };
    start(plain, "hint.confirm");
    (await last(unsaving.asked)).items[0]?.run();
    (await last(unsaving.asked)).empty?.(false);
    await flush();
    expect(unsaving.call).toHaveBeenLastCalledWith("hint.confirm", { ref: "uuid-1" });
    const saveDraft = vi.fn(() => Promise.resolve(true));
    start({ ...unsaving.context, drafted: () => true, saveDraft }, "test.kinds");
    (await last(unsaving.asked)).items[0]?.run();
    await flush();
    expect(saveDraft).not.toHaveBeenCalled();
    expect(unsaving.call).toHaveBeenLastCalledWith("test.kinds", { ref: "uuid-1" });
  });
});

describe("the arguments a command expects, completed with the values of the metamodel (SR-108 AK4)", () => {
  const list = listBuffer("type: need", { where: { type: ["need"] } });
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  /** The element `element.get` gives: of `type`, with `relations`. */
  const element =
    (type: string, relations: readonly Record<string, unknown>[] = []) =>
    () => ({
      element: { ...hit(1), type, properties: {}, relations },
    });
  const failure = Object.assign(new Error("No such element"), { name: "ref.unknown" });

  it("[SR-108/AK-v62v] completes the status of an element with the statuses its type allows", async () => {
    const { context, asked, call } = setup([shown], {
      "element.get": element("decision"),
      "metamodel.get": () => FIXTURE_METAMODEL,
      "element.setStatus": () => ({ files: [] }),
    });
    start(context, "element.setStatus");
    (await last(asked)).items[0]?.run();
    (await last(asked)).empty?.(false);
    const status = await last(asked);
    expect(status.label).toBe("Set status SR-000001 (SR-1) · status:");
    // `refs` is a list: the statuses of its first element's type, by name; core checks the others.
    expect(call).toHaveBeenCalledWith("element.get", { ref: "uuid-1" });
    expect(status.items.map((i) => i.name)).toEqual(["Open", "Decided"]);
    item(status.items, "Decided").run();
    await flush();
    expect(call).toHaveBeenLastCalledWith("element.setStatus", { refs: ["uuid-1"], status: "decided" });
  });

  it("[SR-044/AK-d2rh] offers an element shown read-only first to a read command, never to a write command", async () => {
    const readOnly = readOnlyBuffer(shown);
    const write = setup([readOnly], { "metamodel.get": () => FIXTURE_METAMODEL });
    start(write.context, "element.setStatus");
    expect((await last(write.asked)).items.map((i) => i.name)).toEqual([]);
    const read = setup([readOnly], {});
    start(read.context, "trace.affected");
    expect((await last(read.asked)).items.map((i) => i.name)).toEqual([
      "SR-000001 (SR-1) Title 1 · read-only",
    ]);
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
    expect((await last(gone.asked)).label).toBe("No such element · Set status SR-000001 (SR-1) · status:");
  });

  it("[SR-108/AK-v62v] completes the property of a bulk update with the properties of the metamodel, and its value with the values the metamodel fixes for it", async () => {
    const { context, asked, call } = setup([list], {
      "metamodel.get": () => FIXTURE_METAMODEL,
      "element.search": () => ({ hits: [hit(5)], total: 1 }),
      "element.bulkUpdate": () => BULK_PREVIEW,
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

  it("gives a bulk update on the list of all elements outside a view every element, the empty selection (#856)", async () => {
    const all = setup([listBuffer("All elements")], {
      "metamodel.get": () => FIXTURE_METAMODEL,
      "element.bulkUpdate": () => BULK_PREVIEW,
      "baseline.create": () => ({ files: [] }),
      "evidence.coverage": () => ({ total: 0 }),
    });
    start(all.context, "element.bulkUpdate");
    item((await last(all.asked)).items, "Severity").run();
    item((await last(all.asked)).items, "set").run();
    (await last(all.asked)).text?.("3");
    await flush();
    expect(all.call).toHaveBeenLastCalledWith("element.bulkUpdate", {
      selection: {},
      property: "severity",
      operation: "set",
      value: 3,
    });
    // Create baseline requires a selection too: there it is every element, and only the name is asked.
    start(all.context, "baseline.create");
    (await last(all.asked)).text?.("Release 1");
    await flush();
    expect(all.call).toHaveBeenLastCalledWith("baseline.create", { name: "Release 1", selection: {} });
    // A command whose selection is optional reads every element without one.
    const facets = {
      ...command("evidence.coverage"),
      arguments: [{ field: "selection", complete: "selection" as const }],
    };
    catalogItems(all.context, [facets], [])[0]?.run();
    await flush();
    expect(all.call).toHaveBeenLastCalledWith("evidence.coverage", {});
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
    expect((await last(gone.asked)).label).toBe("No such element · Update element SR-000001 (SR-1) · unset:");
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
      "element.bulkUpdate": () => BULK_PREVIEW,
    });
    catalogItems(related.context, [valueOf], [])[0]?.run();
    (await last(related.asked)).text?.("related");
    const relatedValue = await last(related.asked);
    expect(relatedValue.items.map((i) => i.name)).toEqual(["SR-000001 (SR-1) Title 1"]);
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
    expect(source.items.map((i) => i.name)).toEqual(["SR-000001 (SR-1) Title 1"]);
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
      buffer: { kind: "result", name: "Create relation SR-000001 (SR-1) refines SR-000007", written: true },
    });
  });

  it("[SR-108/AK-v62v] completes the target of a relation with elements of the kind's target types only", async () => {
    const { context, asked, call } = setup([shown], {
      "relation.options": () => OPTIONS,
      "element.search": () => ({ hits: [hit(7)], total: 1 }),
      "relation.add": () => ({ files: [] }),
    });
    start(context, "relation.add");
    (await last(asked)).items[0]?.run();
    item((await last(asked)).items, "derives from").run();
    const target = await last(asked);
    expect(target.label).toBe("Create relation SR-000001 (SR-1) derives from · target:");
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

  it("[SR-108/AK-v62v] a typed fragment of a relation target with a typo is searched with the kind's target types", async () => {
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
    expect((await last(late.asked)).label).toBe("Gone · Create relation SR-000001 (SR-1) refines · target:");
  });

  it("[SR-108/AK-v62v] completes the relation to remove from the element's relations, and an open hint from hint.list", async () => {
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
    expect(target.label).toBe("Remove relation SR-000001 (SR-1) Refines · target:");
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
    expect(call).toHaveBeenLastCalledWith("hint.list", {
      ref: "uuid-1",
      kind: ["relation.outdated", "variant.core-changed"],
      limit: 5000,
    });
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
    expect((await last(gone.asked)).label).toBe("No such element · Remove relation SR-000001 (SR-1) · kind:");
  });

  it("names a hint by its target first, where the hints of one element differ (#293)", async () => {
    const outdated = (target: string, hintId: string) => ({
      code: "relation.outdated",
      severity: "warning",
      message: `Refines of Requirement SR-000001 (SR-1) points to an older version of Requirement ${target}`,
      targetShortId: target,
      hintId,
    });
    const { context, asked } = setup([shown], {
      "hint.list": () => ({
        hints: [outdated("SR-2", "h2"), outdated("SR-3", "h3"), HINTS.hints[0]],
        incomplete: false,
      }),
    });
    start(context, "hint.confirm");
    (await last(asked)).items[0]?.run();
    expect((await last(asked)).items.map((i) => i.name)).toEqual([
      "SR-2 · Refines of Requirement SR-000001 (SR-1) points to an older version of Requirement SR-2",
      "SR-3 · Refines of Requirement SR-000001 (SR-1) points to an older version of Requirement SR-3",
      "Relation Refines is outdated",
    ]);
  });
});

describe("a view the window shows (SR-043 AK1)", () => {
  const list = listBuffer("type: need", { where: { type: ["need"] } });
  const coast = { view: "u-coast", title: "Coast", shortId: "VAR-1" };

  /** The context of `setup` in the view of Coast: `shownCall` records apart from the call in no view. */
  const inCoast = (buffers: Buffers, answers: Record<string, () => unknown>) => {
    const base = setup(buffers, answers);
    const shownCall = vi.fn((name: string, input: Record<string, unknown>) => base.call(name, input));
    const context: CatalogContext = {
      ...base.context,
      shownCall: shownCall as unknown as Call,
      views: { shown: coast, choose: () => undefined },
    };
    return { ...base, context, shownCall };
  };

  it("searches all elements for an element argument of a write, and runs the command in the shown call", async () => {
    const { context, asked, shownCall } = inCoast([list], {
      "metamodel.get": () => ({ types: [{ key: "variant", name: "Variant", meaning: "variant" }] }),
      "element.list": () => ({ elements: [{ ...hit(3), shortId: "VAR-1", title: "Coast" }] }),
      "element.search": () => ({ hits: [hit(2)], total: 1 }),
      "variant.exclude": () => ({ file: "variants/VAR-1.md" }),
    });
    start(context, "variant.exclude");
    // The offers go through the call in no view: an excluded core requirement is still found (SR-042 AK6).
    item((await last(asked)).items, "VAR-1 Coast").run();
    (await (await last(asked)).find?.("wind"))?.[0]?.run();
    expect(shownCall).not.toHaveBeenCalled();
    (await last(asked)).empty?.(false);
    await flush();
    expect(shownCall).toHaveBeenLastCalledWith("variant.exclude", { variant: "uuid-3", refs: ["uuid-2"] });
  });

  it("gives the selection of the shown list the view, unless it names a view or ids (B2)", async () => {
    const answers = { "element.bulkUpdate": () => BULK_PREVIEW };
    const bulk = {
      ...command("element.bulkUpdate"),
      arguments: [{ field: "selection", complete: "selection" as const }],
    };
    const shownList = inCoast([list], answers);
    catalogItems(shownList.context, [bulk], [])[0]?.run();
    await flush();
    expect(shownList.shownCall).toHaveBeenLastCalledWith("element.bulkUpdate", {
      selection: { where: { type: ["need"] }, view: "u-coast" },
    });
    const byIds = inCoast([listBuffer("ids", { ids: ["SR-1"] })], answers);
    catalogItems(byIds.context, [bulk], [])[0]?.run();
    await flush();
    expect(byIds.shownCall).toHaveBeenLastCalledWith("element.bulkUpdate", { selection: { ids: ["SR-1"] } });
  });

  it("gives the list of all elements in the view of Coast the selection of that view (SR-103 AK2)", async () => {
    const create = {
      ...command("baseline.create"),
      arguments: [{ field: "selection", complete: "selection" as const }],
    };
    const all = inCoast([listBuffer("All elements")], { "baseline.create": () => ({ files: [] }) });
    catalogItems(all.context, [create], [])[0]?.run();
    await flush();
    expect(all.shownCall).toHaveBeenLastCalledWith("baseline.create", { selection: { view: "u-coast" } });
  });
});

// SR-071 AK5: after the last argument of a bulk update the prompt shows the preview and asks the confirmation; it
// writes the plan of the shown preview (AK2, #158).
describe("a bulk update shows its preview and asks the confirmation next (SR-071 AK5)", () => {
  const list = listBuffer("type: need", { where: { type: ["need"] } });
  const PLAN = `p1:${"a".repeat(64)}`;
  const PREVIEW = {
    selection: { where: { type: ["need"] } },
    property: "rationale",
    operation: "set",
    value: "Why",
  };
  const skipped = { id: "uuid-9", shortId: "SR-9", reason: "not-a-property", message: "no rationale" };
  const preview = {
    applied: false,
    count: 2,
    affected: [],
    unchanged: 0,
    skipped: [skipped],
    files: [],
    problems: [],
    plan: PLAN,
  };
  const written = { ...preview, applied: true, files: ["a.md", "b.md"] };
  const answers = (bulkUpdate: (input: Record<string, unknown>) => Answer) => ({
    "metamodel.get": () => FIXTURE_METAMODEL,
    "element.bulkUpdate": bulkUpdate,
  });
  const bulkCalls = (call: ReturnType<typeof setup>["call"]) =>
    call.mock.calls.filter(([name]) => name === "element.bulkUpdate").map(([, input]) => input);

  /** Runs "Bulk update elements" rationale set "Why" up to the step after the last argument. */
  const answer = async (
    context: ActionContext & CatalogContext,
    asked: readonly Prompt[],
  ): Promise<Prompt> => {
    start(context, "element.bulkUpdate");
    item((await last(asked)).items, "Rationale").run();
    item((await last(asked)).items, "set").run();
    (await last(asked)).text?.("Why");
    return last(asked);
  };

  it("opens the preview, then asks No first and Yes, apply, with the counts and that Ctrl+Enter writes", async () => {
    const { context, asked, call, dispatched, echoed } = setup(
      [list],
      answers(() => preview),
    );
    const confirm = await answer(context, asked);
    expect(bulkCalls(call)).toEqual([PREVIEW]);
    expect(dispatched.at(-1)).toMatchObject({
      type: "open",
      buffer: { command: "element.bulkUpdate", input: PREVIEW, output: preview, written: true },
    });
    expect(confirm.label).toBe("Bulk update elements Rationale set Why · confirm:");
    expect(confirm.items.map((hit) => hit.name)).toEqual(["No", "Yes, apply"]);
    expect(confirm.explain).toMatchObject({
      name: "confirm",
      description: "Writes 2 elements, skips 1 element",
      more: true,
      moreDoes: "writes",
    });
    expect(confirm.confirm).toBeDefined();
    expect(echoed).toEqual([]);
  });

  it("goes back to the last argument on No and Escape, keeps the preview, and writes nothing", async () => {
    const { context, asked, call, dispatched } = setup(
      [list],
      answers(() => preview),
    );
    const confirm = await answer(context, asked);
    const opened = dispatched.length;
    item(confirm.items, "No").run();
    const back = await last(asked);
    expect(back.label).toBe("Bulk update elements Rationale set · value:");
    back.text?.("Why");
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe("Bulk update elements Rationale set · value:");
    expect(bulkCalls(call).filter((input) => input["confirm"] === true)).toEqual([]);
    // The preview buffer stays: nothing closes it, only the new previews open.
    expect(dispatched.slice(opened).map((action) => action.type)).toEqual(["open"]);
  });

  it("writes the plan of the shown preview on Yes, apply and on Ctrl/Cmd+Enter", async () => {
    const yes = setup(
      [list],
      answers((input) => (input["confirm"] === true ? written : preview)),
    );
    item((await answer(yes.context, yes.asked)).items, "Yes, apply").run();
    await flush();
    expect(yes.call).toHaveBeenLastCalledWith("element.bulkUpdate", {
      ...PREVIEW,
      confirm: true,
      plan: PLAN,
    });
    expect(yes.dispatched.at(-1)).toMatchObject({ buffer: { output: written } });
    const more = setup(
      [list],
      answers((input) => (input["confirm"] === true ? written : preview)),
    );
    (await answer(more.context, more.asked)).confirm?.();
    await flush();
    expect(bulkCalls(more.call)).toEqual([PREVIEW, { ...PREVIEW, confirm: true, plan: PLAN }]);
  });

  it("shows the new preview and asks again when core refuses the plan, and says another refusal", async () => {
    const changed = { ...preview, count: 3, skipped: [], plan: `p1:${"b".repeat(64)}` };
    let previews = 0;
    const refused = setup(
      [list],
      answers((input) => {
        if (input["confirm"] === true) {
          return input["plan"] === PLAN
            ? refusedWith("plan: the change now writes other elements", { reason: "plan-changed" })
            : written;
        }
        previews += 1;
        return previews === 1 ? preview : changed;
      }),
    );
    item((await answer(refused.context, refused.asked)).items, "Yes, apply").run();
    await flush();
    expect(refused.dispatched.at(-1)).toMatchObject({ buffer: { input: PREVIEW, output: changed } });
    const again = await last(refused.asked);
    expect(again.label).toBe(
      "Something changed since the preview, so nothing was written; this is the new preview · Bulk update elements Rationale set Why · confirm:",
    );
    expect(again.explain?.description).toBe("Writes 3 elements, skips 0 elements");
    item(again.items, "Yes, apply").run();
    await flush();
    expect(refused.call).toHaveBeenLastCalledWith("element.bulkUpdate", {
      ...PREVIEW,
      confirm: true,
      plan: changed.plan,
    });
    // A new preview that writes no element asks nothing and says why it was made.
    const emptied = setup(
      [list],
      answers((input) =>
        input["confirm"] === true
          ? refusedWith("plan: changed", { reason: "plan-changed" })
          : bulkCalls(emptied.call).length === 1
            ? preview
            : { ...preview, count: 0 },
      ),
    );
    item((await answer(emptied.context, emptied.asked)).items, "Yes, apply").run();
    await flush();
    expect(emptied.echoed.at(-1)).toBe(
      "Something changed since the preview, so nothing was written; this is the new preview · Bulk update elements writes no element (skips 1 element), so there is nothing to confirm",
    );
    // A failing new preview, and another refusal of the confirmed call, are said.
    const failing = setup(
      [list],
      answers((input) => {
        if (input["confirm"] === true) {
          return refusedWith("plan: changed", { reason: "plan-changed" });
        }
        previews += 1;
        return previews === 3 ? preview : Object.assign(new Error("Workspace is read-only"), { name: "x" });
      }),
    );
    item((await answer(failing.context, failing.asked)).items, "Yes, apply").run();
    await flush();
    expect(failing.echoed.at(-1)).toBe("Workspace is read-only");
    const other = setup(
      [list],
      answers((input) =>
        input["confirm"] === true
          ? Object.assign(new Error("a.md is read-only"), { name: "file.read-only" })
          : preview,
      ),
    );
    item((await answer(other.context, other.asked)).items, "Yes, apply").run();
    await flush();
    expect(other.echoed.at(-1)).toBe("a.md is read-only");
  });

  it("does not ask when the change writes no element, and says so", async () => {
    const none = { ...preview, count: 0 };
    const { context, asked, call, dispatched, echoed } = setup(
      [list],
      answers(() => none),
    );
    const after = await answer(context, asked);
    expect(after.label).toBe("Bulk update elements Rationale set · value:");
    expect(bulkCalls(call)).toEqual([PREVIEW]);
    expect(dispatched.at(-1)).toMatchObject({ buffer: { output: none } });
    expect(echoed).toEqual([
      "Bulk update elements writes no element (skips 1 element), so there is nothing to confirm",
    ]);
  });

  it("asks a refused argument of the preview again, and does not write when a buffer cannot be saved", async () => {
    const { context, asked } = setup(
      [list],
      answers(() => refusedWith("value: not a text", { errors: [{ field: "value" }] })),
    );
    const again = await answer(context, asked);
    expect(again.label).toContain("value: not a text");
    let saves = 0;
    const stopped = setup(
      [list],
      answers(() => preview),
    );
    const saving = {
      ...stopped.context,
      drafted: () => true,
      saveDraft: () => {
        saves += 1;
        return Promise.resolve(saves === 1);
      },
    };
    item((await answer(saving, stopped.asked)).items, "Yes, apply").run();
    await flush();
    expect(bulkCalls(stopped.call)).toEqual([PREVIEW]);
    expect(stopped.echoed.at(-1)).toBe("type: need could not be saved: Bulk update elements did not run");
  });

  it("[SR-215/AK-qpq7] asks no confirm, plan or expected: Ctrl/Cmd+Enter offers only Run after the value", async () => {
    const { context, asked } = setup(
      [list],
      answers(() => preview),
    );
    start(context, "element.bulkUpdate");
    item((await last(asked)).items, "Rationale").run();
    item((await last(asked)).items, "set").run();
    const value = await last(asked);
    expect(value.explain?.more).toBe(false);
    value.more?.("Why");
    expect((await last(asked)).items.map((hit) => hit.name)).toEqual(["Run"]);
    expect(askable(command("element.bulkUpdate")).map((arg) => arg.field)).toEqual([
      "property",
      "operation",
      "value",
    ]);
  });
});

describe("arguments given before the prompt asks (SR-199)", () => {
  const list = listBuffer("All elements");
  const row = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");

  it("[SR-199/AK-ngjy] asks only the other end of a relation whose source and kind are given", async () => {
    const { context, asked, call } = setup([list], { "relation.options": () => OPTIONS });
    const given = {
      "relation.add": [
        { field: "source", value: "uuid-1", label: "SR-1" },
        { field: "kind", value: "refines", label: "Refines" },
      ],
    };
    start({ ...context, entry: row, given }, "relation.add");
    const target = await last(asked);
    expect(target.label).toBe("Create relation SR-1 Refines · target:");
    expect(call).toHaveBeenCalledWith("relation.options", { ref: "uuid-1" });
    expect(target.find).toBeDefined();
  });

  it("[SR-199/AK-ngjy] refuses a given kind that relation.options does not offer for the given source", async () => {
    const { context, asked } = setup([list], { "relation.options": () => OPTIONS });
    const given = {
      "relation.add": [
        { field: "source", value: "uuid-1", label: "N-1" },
        { field: "kind", value: "based-on", label: "Based on" },
      ],
    };
    start({ ...context, given }, "relation.add");
    const target = await last(asked);
    expect(target.label).toBe(
      "The source cannot have a relation of kind based-on · Create relation N-1 Based on · target:",
    );
    expect(target.find).toBeUndefined();
    expect(target.items).toEqual([]);
  });

  it("[SR-199/AK-ngjy] does not offer first the element already given to another argument", async () => {
    const { context, asked } = setup([list]);
    const given = {
      "relation.add": [
        { field: "kind", value: "derives-from", label: "Derives from" },
        { field: "target", value: "uuid-1", label: "SR-1" },
      ],
    };
    start({ ...context, entry: row, given }, "relation.add");
    const source = await last(asked);
    expect(source.label).toBe("Create relation Derives from SR-1 · source:");
    expect(source.items).toEqual([]);
    // Without that, the entry is offered first, as before.
    start({ ...context, entry: row }, "relation.add");
    expect((await last(asked)).items.map((i) => i.id)).toEqual([row.key]);
  });

  it("[SR-199/AK-k1z8] runs a command whose arguments are all given at once", async () => {
    const { context, asked, call } = setup([list], { "relation.remove": () => ({ files: [] }) });
    const given = {
      "relation.remove": [
        { field: "source", value: "uuid-1", label: "SR-1" },
        { field: "kind", value: "refines", label: "Refines" },
        { field: "target", value: "uuid-2", label: "N-2" },
        { field: "repository", value: "spec", label: "" },
      ],
    };
    start({ ...context, given }, "relation.remove");
    await flush();
    expect(call).toHaveBeenLastCalledWith("relation.remove", {
      source: "uuid-1",
      kind: "refines",
      target: "uuid-2",
      repository: "spec",
    });
    // With Ctrl/Cmd+Enter, the optional arguments are offered first.
    start({ ...context, given }, "relation.remove", true);
    expect((await last(asked)).label).toBe("Remove relation SR-1 Refines N-2 · more arguments:");
  });
});

describe("the explanation line of the command prompt (SR-210)", () => {
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  /** The command prompt as the window builds it: the actions, the catalog commands, each with its explanation. */
  const entries = (context: CatalogContext): readonly Choice[] =>
    withExplanations(
      commandPrompt(context, undefined, catalogItems(context, WITH_KINDS, ACTIONS)),
      WITH_KINDS,
    ).items;
  /** The description of `field` in the input schema of `name`, as the catalog has it. */
  const described = (name: string, field: string): unknown =>
    (command(name).input as { properties: Record<string, { description?: unknown }> }).properties[field]
      ?.description;

  it("[SR-210/AK-gqgt] a marked catalog command has its catalog summary and the number of its optional arguments; the prompt keeps the line", () => {
    const { context } = setup([shown]);
    const prompt = withExplanations(
      commandPrompt(context, undefined, catalogItems(context, WITH_KINDS, ACTIONS)),
      WITH_KINDS,
    );
    // The line keeps its place whatever is marked, also an entry without an explanation.
    expect(prompt.explains).toBe(true);
    const items = prompt.items;
    expect(item(items, "Show kinds").explain).toEqual({
      summary: KINDS.summary,
      optional: 1,
    });
    // A write command without a required argument asks its first one; the others are optional.
    expect(item(items, "Confirm hints").explain).toEqual({
      summary: command("hint.confirm").summary,
      optional: 5,
    });
    // No arguments at all.
    expect(item(items, "List baselines").explain).toEqual({
      summary: command("baseline.list").summary,
      optional: 0,
    });
    // An argument given before the prompt asks (as the matrix gives one, SR-199) is not asked: not counted.
    const given = { "test.kinds": [{ field: "kind", value: "refines", label: "Refines" }] };
    expect(item(entries({ ...context, given }), "Show kinds").explain?.optional).toBe(0);
  });

  it("[SR-210/AK-r2d2] an action of the app has its own description; one that runs one catalog command that command's summary; an element has none", () => {
    const { context } = setup([shown]);
    const items = entries({ ...context, docs: () => undefined });
    // An action that runs no catalog command: its description, and as the command help its title with it.
    const docs = ACTIONS.find((action) => action.id === "open-documentation");
    expect(docs?.description).toMatch(/^[A-Z][^.]*\.$/);
    expect(item(items, "Open documentation").explain).toEqual({ summary: docs?.description });
    // Its key as the prompt shows it (F1, bound to it), and F1 opens its row of the keyboard reference.
    expect(item(items, "Open documentation").help).toEqual({
      title: "Open documentation",
      summary: docs?.description,
      ...(item(items, "Open documentation").hint === undefined
        ? {}
        : { key: item(items, "Open documentation").hint }),
      keyReference: true,
    });
    // By the same title, and by `covers`: the command's summary, without its arguments.
    expect(item(items, "List all elements").explain).toEqual({ summary: command("element.list").summary });
    expect(item(items, "Go to element or buffer").explain).toEqual({
      summary: command("element.get").summary,
    });
    // Its command help too: the summary, but no arguments and no call on the command line.
    expect(item(items, "Go to element or buffer").help).toEqual({
      title: "Go to element or buffer",
      summary: command("element.get").summary,
    });
    // An action that covers several commands runs one of them by the view: its own description.
    const both = {
      id: "both",
      title: "Both",
      description: "Does one or the other.",
      covers: ["trace.mermaid", "metamodel.mermaid"],
      available: () => true,
      run: vi.fn(),
    };
    const several = withExplanations(
      { label: "Command", items: [{ id: "both", name: "Both", run: vi.fn() }] },
      CATALOG,
      [both],
    );
    expect(several.items[0]?.explain).toEqual({ summary: "Does one or the other." });
    // Its command help names its key and the catalog commands it runs, with the display it runs each in.
    const runs = [
      { where: "in the graph of an element", command: "trace.mermaid" },
      { where: "in the graph of the metamodel", command: "metamodel.mermaid" },
    ];
    const keyed = withExplanations(
      { label: "Command", items: [{ id: "both", name: "Both", hint: "Ctrl+M", run: vi.fn() }] },
      CATALOG,
      [{ ...both, runs }],
    );
    expect(keyed.items[0]?.help).toEqual({
      title: "Both",
      summary: "Does one or the other.",
      key: "Ctrl+M",
      runs,
      keyReference: true,
    });
    // "Copy graph as Mermaid" is such an action of the app.
    expect(ACTIONS.find((action) => action.id === "copy-mermaid")?.covers).toHaveLength(2);
    // An action that runs one command has no description of its own, so the line cannot show another text.
    for (const action of ACTIONS) {
      expect(action.description === undefined, action.id).toBe(coveredCommand(action, CATALOG) !== undefined);
    }
    // An entry no action and no catalog command has, such as an element or a buffer, gets none.
    const other = withExplanations(
      { label: "Command", items: [{ id: "uuid-1", name: "SR-1", run: vi.fn() }] },
      CATALOG,
    );
    expect(other.items[0]?.explain).toBeUndefined();
    expect(other.items[0]?.help).toBeUndefined();
  });

  it("[SR-210/AK-r2d2] an action that runs a catalog command only to show its output as hits (SR-133 AK4) has its own description", () => {
    // No action covers one of them, so none takes over a summary of theirs.
    for (const action of ACTIONS) {
      expect(
        (action.covers ?? []).filter((name) => Object.hasOwn(SHOWN_IN, name)),
        action.id,
      ).toEqual([]);
    }
    const carrying = [
      ["Open workspace", "workspace.recent"],
      ["Follow agent", "workspace.activity"],
      ["Filter list", "filter.list"],
      ["Open perspective", "perspective.list"],
      ["Save list as perspective", "perspective.list"],
    ] as const;
    const actions = carrying.map(([title]) => ACTIONS.find((candidate) => candidate.title === title));
    const feeding = withExplanations(
      {
        label: "Command",
        items: actions.map((action) => ({ id: action?.id ?? "", name: action?.title ?? "", run: vi.fn() })),
      },
      CATALOG,
    );
    carrying.forEach(([title, shows], at) => {
      const action = actions[at];
      expect(action?.description, title).toMatch(/^[A-Z][^.]*\.$/);
      expect(shownIn(command(shows))).toContain(`"${title}"`);
      expect(feeding.items[at]?.explain).toEqual({ summary: action?.description });
      expect(feeding.items[at]?.explain?.summary).not.toBe(command(shows).summary);
    });
  });

  it("[SR-210/AK-r2d2] the actions that set what a shown list or graph shows name the catalog commands of each display", () => {
    const runsOf = (id: string) => ACTIONS.find((action) => action.id === id)?.runs;
    expect(runsOf("filter")).toEqual([
      { where: "in the list", command: "element.list" },
      { where: "in the traceability matrix", command: "trace.matrix" },
      { where: "on the package page", command: "element.list" },
      { where: "in the list of search hits", command: "element.search" },
    ]);
    expect(runsOf("sort")?.map(({ command }) => command)).toEqual([
      "element.list",
      "trace.matrix",
      "element.list",
    ]);
    expect(runsOf("group")?.map(({ command }) => command)).toEqual(["element.list", "element.search"]);
    expect(runsOf("matrix-list")).toEqual([{ where: "in the list", command: "element.list" }]);
    expect(runsOf("graph-depth")).toEqual([{ where: "in the graph", command: "trace.graph" }]);
    expect(runsOf("list-value")).toEqual([{ where: "in the list", command: "element.list" }]);
    expect(runsOf("copy-mermaid")).toEqual([
      { where: "in the graph of an element", command: "trace.mermaid" },
      { where: "in the graph of the metamodel", command: "metamodel.mermaid" },
    ]);
    // Every catalog command an action names is in the catalog.
    for (const action of ACTIONS) {
      for (const { command: name } of action.runs ?? []) {
        expect(
          CATALOG.some((entry) => entry.name === name),
          `${action.id} ${name}`,
        ).toBe(true);
      }
    }
  });

  it("[SR-210/AK-cbzd] an action of the app shows the text the keyboard reference gives it, without references to the specification", () => {
    const rows = shortcutReference(CATALOG).flatMap((section) => section.rows);
    const all = withExplanations(
      {
        label: "Command",
        items: ACTIONS.map((action) => ({ id: action.id, name: action.title, run: vi.fn() })),
      },
      CATALOG,
    ).items;
    let own = 0;
    for (const action of ACTIONS) {
      const shown = all.find((entry) => entry.id === action.id);
      if (action.description === undefined) {
        // Its catalog command's summary, as the catalog has it.
        expect(shown?.explain?.summary, action.id).toBe(coveredCommand(action, CATALOG)?.summary);
        continue;
      }
      own += 1;
      const row = rows.find((candidate) => candidate.actions?.includes(action.id) === true);
      expect(shown?.explain?.summary, action.id).toBe(action.description);
      expect(shown?.help?.summary, action.id).toBe(action.description);
      expect(row?.description, action.id).toContain(action.description);
      // One English sentence, without an ID of the specification (#1428 names the terms).
      expect(action.description, action.id).toMatch(/^[A-Z][^.]*\.$/);
      expect(action.description, action.id).not.toMatch(/\b(SR|D|N|ADR)-\d/);
    }
    expect(own).toBeGreaterThan(60);
  });

  it("[SR-210/AK-cbzd] All commands… shows the sentence of its row in the keyboard reference", () => {
    const rows = shortcutReference(CATALOG).flatMap((section) => section.rows);
    const row = rows.find((candidate) => candidate.does.startsWith("On “All commands…”"));
    const { context } = setup([shown]);
    const prompt = commandPrompt(context, undefined, [], undefined, vi.fn());
    const last =
      prompt.opening === undefined || prompt.opening === "as-given" ? undefined : prompt.opening.last;
    expect(last?.name).toBe("All commands…");
    expect(row?.keys).toEqual(["Enter"]);
    expect(row?.description).toBe("Show every command you can run here, by name.");
    expect(last?.explain).toEqual({ summary: row?.description, enter: true });
    // No command help, no key and no optional arguments of its own (SR-210 AK5).
    expect(last?.help).toBeUndefined();
    expect(last?.hint).toBeUndefined();
    expect(last?.more).toBeUndefined();
  });

  it("[SR-210/AK-wz9v] a catalog command has the command help: the catalog's texts and the call on the command line", () => {
    const { context } = setup([shown]);
    const items = entries({ ...context, docs: () => undefined });
    const get = command("element.get");
    const help = withExplanations(
      { label: "Command", items: [{ ...item(catalogItems(context, [get], []), get.title) }] },
      [get],
      [],
    ).items[0]?.help;
    expect(help).toEqual({
      title: get.title,
      summary: get.summary,
      ...(get.details === undefined ? {} : { details: get.details }),
      arguments: get.arguments.map(({ field }) => ({
        name: field,
        required: field === "ref",
        ...(typeof described("element.get", field) === "string"
          ? { description: described("element.get", field) }
          : {}),
      })),
      cli: "reqseq element get <ref> [options]",
    });
    // Every argument named in the catalog, with its description where the catalog has one.
    expect(help?.arguments?.map((arg) => arg.name)).toEqual(get.arguments.map((arg) => arg.field));
    expect(help?.arguments?.find((arg) => arg.name === "versionDate")?.description).toBe(
      described("element.get", "versionDate"),
    );
    expect(item(items, "Show kinds").help?.arguments).toContainEqual(
      expect.objectContaining({ name: "kind", required: false }),
    );
    // A command with details on its reference page shows them.
    const detailed = CATALOG.find((entry) => entry.details !== undefined && entry.implemented);
    expect(detailed).toBeDefined();
    expect(item(items, detailed?.title ?? "").help?.details).toBe(detailed?.details);
    // An action of the app has no arguments and no call on the command line (AK5).
    expect(item(items, "Open documentation").help).not.toHaveProperty("cli");
    expect(item(items, "Open documentation").help).not.toHaveProperty("arguments");
  });

  it("[SR-210/AK-t8sc] an asked argument has its name, its catalog description and the keys of its step", async () => {
    const { context, asked } = setup([shown], { "relation.options": () => OPTIONS });
    start(context, "test.kinds");
    // A required argument, while the command has an optional one.
    const ref = await last(asked);
    expect(ref.explain).toEqual({
      name: "ref",
      description: described("relation.options", "ref"),
      list: false,
      ends: false,
      skips: false,
      more: true,
    });
    item(ref.items, "SR-000001 (SR-1) Title 1").more?.();
    item((await last(asked)).items, "kind").run();
    // The last optional argument: Ctrl/Cmd+Enter offers no other.
    expect((await last(asked)).explain).toMatchObject({ name: "kind", more: false });
  });

  it("[SR-210/AK-t8sc] a list argument adds a value per Enter and, once one is given, ends with Enter on an empty input; an optional one a write command asks is skipped so", async () => {
    const list = setup([shown]);
    start(list.context, "hint.list", true);
    item((await last(list.asked)).items, "kind").run();
    const kind = await last(list.asked);
    expect(kind.explain).toEqual({
      name: "kind",
      description: described("hint.list", "kind"),
      list: true,
      ends: false,
      skips: false,
      more: true,
    });
    item(kind.items, "relation.outdated").run();
    expect((await last(list.asked)).explain).toMatchObject({
      name: "kind",
      list: true,
      ends: true,
      skips: false,
    });

    const confirm = setup([shown], { "hint.list": () => HINTS });
    start(confirm.context, "hint.confirm");
    (await last(confirm.asked)).items[0]?.run();
    expect((await last(confirm.asked)).explain).toMatchObject({ name: "hintIds", ends: false, skips: true });
  });
});

describe("a condition built step by step from hits (SR-215 AK3, AK4, AK6, AK9, AK10, #1645)", () => {
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const FACETS = {
    total: 3,
    types: [],
    statuses: [{ key: "draft", count: 2 }],
    properties: [
      {
        key: "component",
        name: "Component",
        kind: "choice",
        count: 2,
        missing: 1,
        distinct: 1,
        values: [{ value: "display", name: "Display", count: 2 }],
      },
      { key: "rationale", name: "Rationale", kind: "text", count: 3, missing: 0, distinct: 3 },
    ],
  };
  const answers = {
    "metamodel.get": () => FIXTURE_METAMODEL,
    "element.facets": () => FACETS,
    "filter.list": () => ({ filters: [] }),
    "filter.save": () => ({ files: ["filters/open.yaml"] }),
  };

  /** "New saved filter" asked up to its condition: the name given. */
  const atWhere = async (extra: Record<string, (input: Record<string, unknown>) => Answer> = {}) => {
    const run = setup([shown], { ...answers, ...extra });
    startBuilder(run.context, "filter.save", CATALOG);
    (await last(run.asked)).text?.("open");
    return run;
  };

  const names = async (asked: readonly Prompt[]): Promise<string[]> =>
    (await last(asked)).items.map(
      (choice) => `${choice.name}${choice.hint === undefined ? "" : ` | ${choice.hint}`}`,
    );

  const marks = async (asked: readonly Prompt[]): Promise<(string | undefined)[]> =>
    ((await last(asked)).marks ?? []).map((mark) => mark.label);

  /** Chooses `kind`, then the value `value`, in the steps of the condition. */
  const choose = async (asked: readonly Prompt[], ...path: readonly string[]): Promise<void> => {
    for (const name of path) {
      item((await last(asked)).items, name).run();
    }
    await flush();
  };

  const KINDS = [
    "Type | type",
    "Status | status",
    "Property | property",
    "Verification status | verification",
    "Validation status | validation",
    "Validity | validFor",
    "Relation | relation",
    "Text search | text",
  ];

  it("[SR-215/AK-dt5s] offers the kinds, then their values; each chosen condition is a mark with the label of its list filter step, and the hits keep their place", async () => {
    const { asked, call } = await atWhere();
    const first = await last(asked);
    expect(first.label).toBe("New saved filter open · where:");
    expect(await names(asked)).toEqual(["No condition: all elements", ...KINDS]);
    // Types by their name in the metamodel, the key beside; the mark is the list's "type: <key>".
    await choose(asked, "Type");
    expect((await last(asked)).label).toBe("New saved filter open · where · Type:");
    expect(await names(asked)).toContain("System Requirement | requirement");
    await choose(asked, "System Requirement", "Take 1 type");
    expect(await marks(asked)).toEqual(["type: requirement"]);
    // The hits keep their place: only the finishing hit changes.
    expect(await names(asked)).toEqual(["Next: sort", ...KINDS]);
    // Statuses of the elements the marks select, by their name in the metamodel.
    await choose(asked, "Status");
    expect(call).toHaveBeenCalledWith("element.facets", {
      selection: { where: { all: [{ type: ["requirement"] }] } },
    });
    expect(await names(asked)).toEqual(["Draft | draft"]);
    await choose(asked, "Draft");
    // Properties whose values can be chosen (SR-124 AK2, AK3: free text is left out), then their values.
    await choose(asked, "Property");
    expect(await names(asked)).toEqual(["Component | component"]);
    await choose(asked, "Component");
    expect(await names(asked)).toEqual(["Display | display", "(no value)"]);
    await choose(asked, "(no value)");
    expect(await marks(asked)).toEqual(["type: requirement", "status: draft", "component: (no value)"]);
    // Verification and validation statuses from the condition's schema in the catalog.
    await choose(asked, "Verification status");
    expect(await names(asked)).toEqual(["open", "verified", "indirect", "failed", "outdated"]);
    await choose(asked, "failed");
    await choose(asked, "Validation status");
    expect(await names(asked)).toContain("open");
    await choose(asked, "open");
    // Validity: the views, the core first.
    await choose(asked, "Validity", "Core");
    // Relations: the ends of a derivation and evidence, then each relation kind and relation property.
    await choose(asked, "Relation");
    expect((await names(asked)).slice(0, 7)).toEqual([
      "without child",
      "with child",
      "without parent",
      "with parent",
      "without evidence",
      "with evidence",
      "without Derives from | derives-from",
    ]);
    expect(await names(asked)).toContain("with Package | packages");
    await choose(asked, "without child");
    // A text search takes the typed words; an empty input asks again.
    await choose(asked, "Text search");
    (await last(asked)).text?.("  ");
    expect((await last(asked)).label).toBe("New saved filter open · where · Text search:");
    (await last(asked)).text?.("brake");
    expect(await marks(asked)).toEqual([
      "type: requirement",
      "status: draft",
      "component: (no value)",
      "verification: failed",
      "validation: open",
      "validity: Core",
      "relation: without child",
      "text: brake",
    ]);
    expect(await names(asked)).toEqual(["Next: sort", ...KINDS]);
    await choose(asked, "Next: sort", "Save");
    expect(call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: {
        all: [
          { type: ["requirement"] },
          { status: ["draft"] },
          { property: "component", op: "missing" },
          { verification: ["failed"] },
          { validation: ["open"] },
          { validFor: "core" },
          { relation: { meaning: "derivation", direction: "down" }, exists: false },
          { text: "brake" },
        ],
      },
    });
  });

  it("[SR-215/AK-fm4s] [SR-219/AK-kv63] the finishing hit is marked first: without a mark it goes on with no condition, with marks it is Next: sort; Ctrl/Cmd+Enter offers the optional arguments", async () => {
    const none = await atWhere();
    expect((await last(none.asked)).items[0]?.name).toBe("No condition: all elements");
    (await last(none.asked)).items[0]?.run();
    await flush();
    // It goes on to the sort and saves nothing yet.
    expect((await last(none.asked)).label).toBe("New saved filter open · sort:");
    expect(none.call.mock.calls.some(([name]) => name === "filter.save")).toBe(false);
    await choose(none.asked, "Save");
    expect(none.call).toHaveBeenLastCalledWith("filter.save", { name: "open", where: { all: [] } });

    const some = await atWhere();
    await choose(some.asked, "Type", "Decision", "Take 1 type");
    await choose(some.asked, "Status", "Draft");
    expect((await last(some.asked)).items[0]?.name).toBe("Next: sort");
    // Ctrl/Cmd+Enter on any hit of this step takes the marks and offers the optional arguments.
    item((await last(some.asked)).items, "Status").more?.();
    const more = await last(some.asked);
    expect(more.label).toBe("New saved filter open · more arguments:");
    expect(more.earlier).toEqual(["type: decision", "status: draft"]);
    await choose(some.asked, "Next: sort", "Save");
    expect(some.call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: { all: [{ type: ["decision"] }, { status: ["draft"] }] },
    });
  });

  it("[SR-215/AK-z4bq] text that starts with { is one condition in JSON as a mark; a refused condition is asked again with core's message and the marks back", async () => {
    const refusal = refusedWith("where.all[1]: must be an object", { errors: [{ field: "where.all[1]" }] });
    const { asked, call } = await atWhere({ "filter.save": () => refusal });
    await choose(asked, "Type", "Decision", "Take 1 type");
    const prompt = await last(asked);
    // No hit for other text: Enter does nothing.
    expect(prompt.literal?.("type")).toBeUndefined();
    expect(prompt.text).toBeUndefined();
    const json = prompt.literal?.(' {"any":[{"status":["draft"]},{"not":{"type":["need"]}}]}');
    expect(json?.name).toBe("Add the condition in JSON");
    json?.run();
    expect(await marks(asked)).toEqual([
      "type: decision",
      '{"any":[{"status":["draft"]},{"not":{"type":["need"]}}]}',
    ]);
    // Text that is no JSON goes in as it is: core says what is wrong with it.
    (await last(asked)).literal?.("{a")?.run();
    expect(await marks(asked)).toContain("{a");
    await choose(asked, "Next: sort", "Save");
    expect(call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: {
        all: [{ type: ["decision"] }, { any: [{ status: ["draft"] }, { not: { type: ["need"] } }] }, "{a"],
      },
    });
    const again = await last(asked);
    expect(again.label).toBe("where.all[1]: must be an object · New saved filter open · where:");
    expect(await marks(asked)).toHaveLength(3);
    // The message is said once: the next step has the plain label.
    await choose(asked, "Type");
    expect((await last(asked)).label).toBe("New saved filter open · where · Type:");
  });

  it("[SR-215/AK-rx2z] [SR-134/AK-fmf6] an × removes its mark; Backspace removes the last mark only where the kind is chosen; Escape keeps the marks, which stand again when the prompt returns to the argument", async () => {
    const { asked } = await atWhere();
    await choose(asked, "Type", "Decision", "Take 1 type");
    await choose(asked, "Status", "Draft");
    await choose(asked, "Validity", "Core");
    const kinds = await last(asked);
    expect(kinds.unmark).toBe(true);
    // The × of the middle mark.
    kinds.marks?.[1]?.remove();
    expect(await marks(asked)).toEqual(["type: decision", "validity: Core"]);
    // In a step of the values Backspace goes back to the kinds (`back`) and removes no mark; its × does.
    await choose(asked, "Status");
    const values = await last(asked);
    expect(values.unmark).toBeUndefined();
    values.back?.();
    expect((await last(asked)).label).toBe("New saved filter open · where:");
    await choose(asked, "Property", "Component");
    (await last(asked)).marks?.[0]?.remove();
    // A property's values go back to the properties, read anew for the marks left.
    expect((await last(asked)).label).toBe("New saved filter open · where · Property:");
    expect(await marks(asked)).toEqual(["validity: Core"]);
    (await last(asked)).back?.();
    // Ctrl/Cmd+Enter takes the marks; Escape (back) from the optional arguments returns to the condition, marks and all.
    (await last(asked)).items[0]?.more?.();
    expect((await last(asked)).label).toBe("New saved filter open · more arguments:");
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe("New saved filter open · where:");
    expect(await marks(asked)).toEqual(["validity: Core"]);
    // Without a mark, back goes to the step before.
    (await last(asked)).marks?.[0]?.remove();
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe("New saved filter · name:");
  });

  it("[SR-215/AK-rx2z] Escape at the kinds keeps the marks: they stand again when the prompt returns to the condition, also after a refusal", async () => {
    const { asked } = await atWhere();
    await choose(asked, "Type", "Decision", "Take 1 type");
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe("New saved filter · name:");
    (await last(asked)).text?.("open");
    expect(await marks(asked)).toEqual(["type: decision"]);

    const refusal = refusedWith("where.all[0]: must be an object", { errors: [{ field: "where.all[0]" }] });
    const refused = await atWhere({ "filter.save": () => refusal });
    (await last(refused.asked)).literal?.("{a")?.run();
    await choose(refused.asked, "Next: sort", "Save");
    expect(await marks(refused.asked)).toEqual(["{a"]);
    (await last(refused.asked)).back?.();
    (await last(refused.asked)).text?.("open");
    expect((await last(refused.asked)).label).toBe("New saved filter open · where:");
    expect(await marks(refused.asked)).toEqual(["{a"]);
  });

  it("[SR-134/AK-trng] Escape after a refused condition goes back one step without core's message, which names the condition", async () => {
    const refusal = refusedWith("where.all[0]: must be an object", { errors: [{ field: "where.all[0]" }] });
    const { asked, call } = await atWhere({ "filter.save": () => refusal });
    (await last(asked)).literal?.("{a")?.run();
    await choose(asked, "Next: sort", "Save");
    expect((await last(asked)).label).toBe(
      "where.all[0]: must be an object · New saved filter open · where:",
    );
    const saves = () => call.mock.calls.filter(([name]) => name === "filter.save").length;
    const saved = saves();
    // Escape goes back to the name, the step before, with the plain label and the name given.
    (await last(asked)).back?.();
    const name = await last(asked);
    expect(name.label).toBe("New saved filter · name:");
    expect(name.initial).toBe("open");
    expect(saves()).toBe(saved);
  });

  it("[SR-215/AK-hnzf] the input is the marks in their order under all, as the command line takes it", async () => {
    const { asked, call } = await atWhere();
    await choose(asked, "Status", "Draft");
    await choose(asked, "Property", "Component", "Display");
    await choose(asked, "Next: sort", "Save");
    expect(call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: { all: [{ status: ["draft"] }, { property: "component", op: "eq", value: "display" }] },
    });
  });

  const TYPES = [
    "Item | item",
    "System Requirement | requirement",
    "Software Requirement | software-requirement",
    "Decision | decision",
    "Package | package",
  ];

  it("[SR-215/AK-w8q6] a chosen type goes into one type mark and the step stays; Take N types comes first and takes the mark, which selects the elements of one of the types", async () => {
    const { asked, call } = await atWhere();
    await choose(asked, "Type");
    // No type yet: the types alone, no hit that takes.
    expect(await names(asked)).toEqual(TYPES);
    expect(await marks(asked)).toEqual([]);
    await choose(asked, "Decision");
    const one = await last(asked);
    expect(one.label).toBe("New saved filter open · where · Type:");
    expect(await marks(asked)).toEqual(["type: decision"]);
    // "Take 1 type" first, so it is the marked hit; the chosen type is no longer offered.
    expect(await names(asked)).toEqual([
      "Take 1 type",
      ...TYPES.filter((name) => !name.startsWith("Decision")),
    ]);
    await choose(asked, "System Requirement");
    expect(await marks(asked)).toEqual(["type: decision, requirement"]);
    expect((await names(asked))[0]).toBe("Take 2 types");
    expect(await names(asked)).not.toContain("System Requirement | requirement");
    await choose(asked, "Take 2 types");
    expect((await last(asked)).label).toBe("New saved filter open · where:");
    expect(await marks(asked)).toEqual(["type: decision, requirement"]);
    // The other marks still all hold: the statuses are those of the elements of one of the types.
    await choose(asked, "Status");
    expect(call).toHaveBeenCalledWith("element.facets", {
      selection: { where: { all: [{ type: ["decision", "requirement"] }] } },
    });
    await choose(asked, "Draft");
    await choose(asked, "Next: sort", "Save");
    expect(call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: { all: [{ type: ["decision", "requirement"] }, { status: ["draft"] }] },
    });
  });

  it("[SR-215/AK-w8q6] a condition has one type mark: choosing Type again continues it in its place, without the types in it", async () => {
    const { asked } = await atWhere();
    await choose(asked, "Type", "Decision", "Take 1 type");
    await choose(asked, "Status", "Draft");
    await choose(asked, "Type");
    expect(await marks(asked)).toEqual(["type: decision", "status: draft"]);
    expect(await names(asked)).toEqual([
      "Take 1 type",
      ...TYPES.filter((name) => !name.startsWith("Decision")),
    ]);
    await choose(asked, "Package");
    expect(await marks(asked)).toEqual(["type: decision, package", "status: draft"]);
    await choose(asked, "Take 2 types");
    expect(await marks(asked)).toEqual(["type: decision, package", "status: draft"]);
  });

  it("[SR-215/AK-w8q6] Escape and Backspace on an empty input go back to the kinds and the mark stays; its × removes it", async () => {
    const { asked } = await atWhere();
    await choose(asked, "Status", "Draft");
    await choose(asked, "Type", "Decision");
    const types = await last(asked);
    // Backspace on an empty input does what Escape does here (`back`): it removes no mark.
    expect(types.unmark).toBeUndefined();
    types.back?.();
    expect((await last(asked)).label).toBe("New saved filter open · where:");
    expect(await marks(asked)).toEqual(["status: draft", "type: decision"]);
    // Back in the step, the × of the type mark removes it, and the step is asked again without it.
    await choose(asked, "Type");
    (await last(asked)).marks?.[1]?.remove();
    expect((await last(asked)).label).toBe("New saved filter open · where · Type:");
    expect(await marks(asked)).toEqual(["status: draft"]);
    expect(await names(asked)).toEqual(TYPES);
    // The × of another mark keeps the type mark.
    await choose(asked, "Package");
    (await last(asked)).marks?.[0]?.remove();
    expect(await marks(asked)).toEqual(["type: package"]);
    expect((await names(asked))[0]).toBe("Take 1 type");
    // Without a type, Escape goes back to the kinds with no type mark.
    (await last(asked)).marks?.[0]?.remove();
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe("New saved filter open · where:");
    expect(await marks(asked)).toEqual([]);
  });

  it("[SR-210/AK-t8sc] each step of a condition names the argument and the keys of the step: Enter, Backspace for the last mark where it removes one, and { for JSON", async () => {
    const { asked } = await atWhere();
    const first = (await last(asked)).explain;
    expect(first).toMatchObject({
      name: "where",
      description: (command("filter.save").input as { properties: Record<string, { description?: unknown }> })
        .properties["where"]?.description,
      building: { enter: "takes the marked hit; all conditions must hold", unmark: false, json: true },
    });
    await choose(asked, "Status");
    expect((await last(asked)).explain).toMatchObject({
      name: "where",
      more: false,
      building: { enter: "adds the condition", unmark: false, json: false },
    });
    await choose(asked, "Draft");
    expect((await last(asked)).explain?.building?.unmark).toBe(true);
    await choose(asked, "Type");
    expect((await last(asked)).explain).toMatchObject({
      name: "where",
      more: false,
      building: { enter: "adds the type to the mark, or takes the mark", unmark: false, json: false },
    });
    (await last(asked)).back?.();
    await choose(asked, "Text search");
    expect((await last(asked)).explain?.building?.enter).toBe("adds the text search");
  });

  it("says why the values of a kind cannot be read", async () => {
    const failing = new Error("The metamodel is faulty");
    const { asked } = await atWhere({
      "metamodel.get": () => failing,
      "element.facets": () => failing,
    });
    for (const kind of ["Type", "Status", "Property", "Validity", "Relation"]) {
      await choose(asked, kind);
      expect((await last(asked)).label).toBe(
        `The metamodel is faulty · New saved filter open · where · ${kind}:`,
      );
      (await last(asked)).back?.();
    }
    // Statuses need the names of the metamodel too.
    const named = await atWhere({ "metamodel.get": () => failing });
    await choose(named.asked, "Status");
    expect((await last(named.asked)).label).toBe(
      "The metamodel is faulty · New saved filter open · where · Status:",
    );
  });
});

describe("a sort built step by step from hits (SR-215 AK4, AK7, AK9, AK10, #1646)", () => {
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const answers = {
    "metamodel.get": () => FIXTURE_METAMODEL,
    "element.facets": () => ({ total: 0, types: [], statuses: [], properties: [] }),
    "element.list": () => ({ elements: [], total: 0 }),
    "filter.list": () => ({ filters: [] }),
    "filter.save": () => ({ files: ["filters/open.yaml"] }),
  };

  /** "New saved filter open" with no condition, asked up to its sort, the last step. */
  const atSort = async (extra: Record<string, (input: Record<string, unknown>) => Answer> = {}) => {
    const run = setup([shown], { ...answers, ...extra });
    startBuilder(run.context, "filter.save", CATALOG);
    (await last(run.asked)).text?.("open");
    item((await last(run.asked)).items, "No condition: all elements").run();
    return run;
  };

  const names = async (asked: readonly Prompt[]): Promise<string[]> =>
    (await last(asked)).items.map(
      (choice) => `${choice.name}${choice.hint === undefined ? "" : ` | ${choice.hint}`}`,
    );

  const marks = async (asked: readonly Prompt[]): Promise<string[]> =>
    ((await last(asked)).marks ?? []).map((mark) => mark.label);

  const choose = async (asked: readonly Prompt[], ...path: readonly string[]): Promise<void> => {
    for (const name of path) {
      item((await last(asked)).items, name).run();
    }
    await flush();
  };

  /** The keys: the `by` enum by name, then the properties that hold no relations and no fixed key names. */
  const KEYS = [
    "ID | identifier",
    "Short ID | id",
    "Title | title",
    "Type | type",
    "Status | status",
    "Rationale | rationale",
    "Component | component",
    "Severity | severity",
  ];

  const LINE = "New saved filter open · sort";

  it("[SR-215/AK-q4fs] [SR-215/AK-hnzf] a key asks Order and is a mark with its direction; the keys sort in their order, a key chosen again replaces its mark", async () => {
    const { asked, call } = await atSort();
    expect((await last(asked)).label).toBe(`${LINE}:`);
    expect(await names(asked)).toEqual(["Save", "Hierarchy (tree) | hierarchy", ...KEYS, "Workspace order"]);
    await choose(asked, "Title");
    const order = await last(asked);
    expect(order.label).toBe(`${LINE} · Title · Order:`);
    expect(await names(asked)).toEqual(["ascending | asc", "descending | desc"]);
    await choose(asked, "descending");
    expect(await marks(asked)).toEqual(["Title descending"]);
    // With a mark the hierarchy is gone; the other hits keep their place.
    expect(await names(asked)).toEqual(["Save", ...KEYS, "Workspace order"]);
    await choose(asked, "Component", "ascending");
    await choose(asked, "ID", "descending");
    // The same key again replaces its mark in its place.
    await choose(asked, "Title", "ascending");
    expect(await marks(asked)).toEqual(["Title ascending", "Component ascending", "ID descending"]);
    await choose(asked, "Save");
    expect(call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: { all: [] },
      sort: [
        { by: "title", order: "asc" },
        { by: "component", order: "asc" },
        { by: "identifier", order: "desc" },
      ],
    });
  });

  it("[SR-215/AK-q4fs] [SR-215/AK-hnzf] [SR-219/AK-tbwz] the hierarchy only comes first and sorts ascending; Workspace order is a mark of the empty sort in place of the keys", async () => {
    const tree = await atSort();
    await choose(tree.asked, "Hierarchy (tree)");
    expect(await marks(tree.asked)).toEqual(["Hierarchy (tree)"]);
    expect(await names(tree.asked)).not.toContain("Hierarchy (tree) | hierarchy");
    await choose(tree.asked, "Short ID", "descending", "Save");
    expect(tree.call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: { all: [] },
      sort: [
        { by: "hierarchy", order: "asc" },
        { by: "id", order: "desc" },
      ],
    });
    // Workspace order sets a mark and stays in the step; a key takes its place, and it takes theirs.
    const none = await atSort();
    await choose(none.asked, "Title", "ascending", "Workspace order");
    expect((await last(none.asked)).label).toBe(`${LINE}:`);
    expect(await marks(none.asked)).toEqual(["Workspace order"]);
    await choose(none.asked, "Status", "descending");
    expect(await marks(none.asked)).toEqual(["Status descending"]);
    await choose(none.asked, "Workspace order", "Save");
    expect(none.call).toHaveBeenLastCalledWith("filter.save", { name: "open", where: { all: [] }, sort: [] });
  });

  it("[SR-215/AK-fm4s] [SR-219/AK-kv63] Save is marked first: without a mark a saved filter saves no sort, with marks their keys; Ctrl/Cmd+Enter offers the optional arguments, Save first", async () => {
    const none = await atSort();
    expect((await last(none.asked)).items[0]?.name).toBe("Save");
    await choose(none.asked, "Save");
    expect(none.call).toHaveBeenLastCalledWith("filter.save", { name: "open", where: { all: [] } });

    const skipped = await atSort();
    item((await last(skipped.asked)).items, "Save").more?.();
    const more = await last(skipped.asked);
    expect(more.label).toBe("New saved filter open · more arguments:");
    expect(more.items.map((choice) => choice.name)).toEqual(["Save", "description", "view"]);
    await choose(skipped.asked, "Save");
    expect(skipped.call).toHaveBeenLastCalledWith("filter.save", { name: "open", where: { all: [] } });

    // Ctrl/Cmd+Enter on a key without a mark takes no empty sort either.
    const key = await atSort();
    item((await last(key.asked)).items, "Title").more?.();
    await choose(key.asked, "Save");
    expect(key.call).toHaveBeenLastCalledWith("filter.save", { name: "open", where: { all: [] } });

    const some = await atSort();
    await choose(some.asked, "Type", "ascending");
    expect((await last(some.asked)).items[0]?.name).toBe("Save");
    // Ctrl/Cmd+Enter on any hit of this step takes the marks.
    item((await last(some.asked)).items, "Status").more?.();
    await choose(some.asked, "Save");
    expect(some.call).toHaveBeenLastCalledWith("filter.save", {
      name: "open",
      where: { all: [] },
      sort: [{ by: "type", order: "asc" }],
    });
  });

  it("[SR-215/AK-fm4s] outside a builder the finishing hit skips the sort without a mark and takes the marks with one; Workspace order takes the empty sort at once", async () => {
    const listed: CommandListing = { ...command("element.list"), title: "Ask it" };
    const atListSort = async () => {
      const run = setup([shown], answers);
      catalogItems(run.context, [listed], [])[0]?.more?.();
      await choose(run.asked, "sort");
      return run;
    };
    const none = await atListSort();
    expect((await names(none.asked))[0]).toBe("No sort");
    await choose(none.asked, "No sort", "Run");
    expect(none.call).toHaveBeenLastCalledWith("element.list", {});
    const some = await atListSort();
    await choose(some.asked, "Title", "ascending");
    expect((await names(some.asked))[0]).toBe("Take 1 sort key");
    await choose(some.asked, "Take 1 sort key", "Run");
    expect(some.call).toHaveBeenLastCalledWith("element.list", { sort: [{ by: "title", order: "asc" }] });
    const workspace = await atListSort();
    await choose(workspace.asked, "Workspace order", "Run");
    expect(workspace.call).toHaveBeenLastCalledWith("element.list", { sort: [] });
  });

  it("[SR-215/AK-rx2z] [SR-134/AK-fmf6] an × removes its mark; Backspace removes the last mark only where the key is chosen; Escape keeps the marks, which stand again when the prompt returns to the sort", async () => {
    const { asked } = await atSort();
    await choose(asked, "Title", "ascending");
    await choose(asked, "Status", "descending");
    await choose(asked, "ID", "ascending");
    const keys = await last(asked);
    expect(keys.unmark).toBe(true);
    keys.marks?.[1]?.remove();
    expect(await marks(asked)).toEqual(["Title ascending", "ID ascending"]);
    // In "Order" Backspace and Escape go back to the keys with the marks; its × removes one and asks it again.
    await choose(asked, "Type");
    const order = await last(asked);
    expect(order.unmark).toBeUndefined();
    order.marks?.[0]?.remove();
    expect((await last(asked)).label).toBe(`${LINE} · Type · Order:`);
    expect(await marks(asked)).toEqual(["ID ascending"]);
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe(`${LINE}:`);
    expect(await marks(asked)).toEqual(["ID ascending"]);
    // Escape at the keys goes back a step and keeps the marks: they stand again at the sort.
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe("New saved filter open · where:");
    await choose(asked, "No condition: all elements");
    expect(await marks(asked)).toEqual(["ID ascending"]);
    // Taken with Ctrl/Cmd+Enter, then asked again by going back from the optional arguments: the marks stand again.
    item((await last(asked)).items, "Save").more?.();
    (await last(asked)).back?.();
    expect((await last(asked)).label).toBe(`${LINE}:`);
    expect(await marks(asked)).toEqual(["ID ascending"]);
  });

  it("[SR-215/AK-rx2z] a sort core refuses is asked again with its message and the marks back", async () => {
    const refusal = refusedWith("sort[0].by: no such property", { errors: [{ field: "sort[0].by" }] });
    const { asked } = await atSort({ "filter.save": () => refusal });
    await choose(asked, "Rationale", "ascending", "Save");
    expect((await last(asked)).label).toBe(`sort[0].by: no such property · ${LINE}:`);
    expect(await marks(asked)).toEqual(["Rationale ascending"]);
    // The message is said once.
    await choose(asked, "Title");
    expect((await last(asked)).label).toBe(`${LINE} · Title · Order:`);
  });

  it("[SR-210/AK-t8sc] each step of a sort names the argument and the keys of the step: Enter, and Backspace for the last mark where it removes one", async () => {
    const { asked } = await atSort();
    expect((await last(asked)).explain).toMatchObject({
      name: "sort",
      description: (command("filter.save").input as { properties: Record<string, { description?: unknown }> })
        .properties["sort"]?.description,
      building: {
        enter: "takes the marked hit; Save saves with the keys in their order",
        unmark: false,
        json: false,
      },
    });
    await choose(asked, "Title");
    expect((await last(asked)).explain).toMatchObject({
      name: "sort",
      more: false,
      building: { enter: "adds the sort key", unmark: false, json: false },
    });
    await choose(asked, "ascending");
    expect((await last(asked)).explain?.building?.unmark).toBe(true);
  });

  it("reads the keys once for the argument, not again in each step", async () => {
    const { asked, call } = await atSort();
    const before = call.mock.calls.filter(([name]) => name === "metamodel.get").length;
    await choose(asked, "Title", "ascending");
    (await last(asked)).marks?.[0]?.remove();
    expect(await names(asked)).toContain("Title | title");
    expect(call.mock.calls.filter(([name]) => name === "metamodel.get")).toHaveLength(before);
  });

  it("offers the fixed keys and says why when the metamodel cannot be read", async () => {
    const { asked } = await atSort({ "metamodel.get": () => new Error("The metamodel is faulty") });
    expect((await last(asked)).label).toBe(`The metamodel is faulty · ${LINE}:`);
    expect(await names(asked)).toEqual([
      "Save",
      "Hierarchy (tree) | hierarchy",
      ...KEYS.slice(0, 5),
      "Workspace order",
    ]);
  });
});

describe("a grouping chosen from hits (SR-215 AK1, #1647)", () => {
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const FACETS = {
    total: 3,
    types: [],
    statuses: [{ key: "draft", count: 2 }],
    properties: [
      {
        key: "component",
        name: "Component",
        kind: "choice",
        count: 2,
        missing: 1,
        distinct: 1,
        values: [{ value: "display", name: "Display", count: 2 }],
      },
      {
        key: "packages",
        name: "Packages",
        kind: "relation",
        count: 1,
        missing: 2,
        distinct: 1,
        values: [{ value: "PKG-1", count: 1 }],
      },
      { key: "rationale", name: "Rationale", kind: "text", count: 3, missing: 0, distinct: 3 },
    ],
  };
  const PERSPECTIVE = { name: "Mine", file: "perspectives/mine.yaml", where: { status: ["draft"] } };
  const answers = {
    "metamodel.get": () => FIXTURE_METAMODEL,
    "element.facets": () => FACETS,
    "element.list": () => ({ elements: [], total: 0 }),
    "filter.list": () => ({ filters: [{ name: "open needs", file: "f.yaml", where: {} }], problems: [] }),
    "perspective.list": () => ({
      perspectives: [PERSPECTIVE, { ...PERSPECTIVE, name: "Other", filter: "x" }],
    }),
    "perspective.save": () => ({ files: ["perspectives/rain.yaml"] }),
  };

  const choose = async (asked: readonly Prompt[], ...path: readonly string[]): Promise<void> => {
    for (const name of path) {
      item((await last(asked)).items, name).run();
    }
    await flush();
  };

  const names = async (asked: readonly Prompt[]): Promise<string[]> =>
    (await last(asked)).items.map(
      (choice) => `${choice.name}${choice.hint === undefined ? "" : ` | ${choice.hint}`}`,
    );

  const facetCalls = (call: ReturnType<typeof setup>["call"]): unknown[] =>
    call.mock.calls.filter(([name]) => name === "element.facets").map(([, input]) => input);

  /** "New perspective rain" with the condition type Decision, asked up to its grouping, `filter` given before. */
  const atGroup = async (
    extra: Record<string, (input: Record<string, unknown>) => Answer> = {},
    filter = false,
    beforeGroup = (): void => undefined,
  ) => {
    const run = setup([shown], { ...answers, ...extra });
    startBuilder(run.context, "perspective.save", CATALOG);
    (await last(run.asked)).text?.("rain");
    await choose(run.asked, "Type", "Decision", "Take 1 type");
    const before = facetCalls(run.call).length;
    beforeGroup();
    if (filter) {
      item((await last(run.asked)).items, "Next: grouping").more?.();
      await choose(run.asked, "filter", "open needs");
    } else {
      await choose(run.asked, "Next: grouping");
    }
    return { ...run, before };
  };

  const KEYS = ["Type | type", "Status | status", "Package | package", "Component | component"];

  it("[SR-215/AK-fj75] offers type, status, package and the properties with values of the elements where and filter select, by name with the key beside, from one element.facets", async () => {
    const { asked, call, before } = await atGroup({}, true);
    expect((await last(asked)).label).toBe("New perspective rain open needs · group:");
    // "No grouping" first (SR-219 AK2); not the property of the packages, which "Package" groups by, nor free text.
    expect(await names(asked)).toEqual(["No grouping", ...KEYS]);
    const facets = facetCalls(call).slice(before);
    expect(facets).toHaveLength(1);
    await choose(asked, "Component", "Save");
    const [name, saved] = call.mock.calls.filter(([called]) => called === "perspective.save").at(-1) ?? [];
    expect(name).toBe("perspective.save");
    expect(saved).toMatchObject({ name: "rain", filter: "open needs", group: "component" });
    expect(facets[0]).toEqual({ selection: { where: saved?.["where"], filter: "open needs" } });
  });

  it("[SR-215/AK-fj75] after a refused where the grouping is offered again for the new condition, and the other answers stand", async () => {
    const refusal = refusedWith("where: unknown type", { errors: [{ field: "where" }] });
    const { asked, call } = await atGroup({ "perspective.save": () => refusal }, true);
    await choose(asked, "Status", "Save");
    expect(call).toHaveBeenLastCalledWith("perspective.save", expect.objectContaining({ group: "status" }));
    expect((await last(asked)).label).toBe("where: unknown type · New perspective rain open needs · where:");
    const before = facetCalls(call).length;
    await choose(asked, "Next: grouping");
    expect((await last(asked)).label).toBe("New perspective rain open needs · group:");
    expect(facetCalls(call)).toHaveLength(before + 1);
    await choose(asked, "Status", "Save");
    expect(call).toHaveBeenLastCalledWith(
      "perspective.save",
      expect.objectContaining({ filter: "open needs", group: "status" }),
    );
  });

  it("[SR-215/AK-fj75] of a list command, the groupings of the shown selection and the perspective's, whose saved filter counts where the list has none", async () => {
    const list = filteredList([savedStep("Sensors"), typeStep("need")]);
    const listed: CommandListing = { ...command("element.list"), title: "Ask it" };
    const ofList = async (buffers: Buffers, perspective: string) => {
      const run = setup(buffers, answers);
      catalogItems(run.context, [listed], [])[0]?.more?.();
      await choose(run.asked, "perspective");
      item((await last(run.asked)).items, perspective).more?.();
      await choose(run.asked, "group");
      return facetCalls(run.call).at(-1);
    };
    expect(await ofList([list], "Other")).toEqual({
      selection: { filter: "Sensors", where: { all: [list.selection?.where, PERSPECTIVE.where] } },
    });
    expect(await ofList([shown], "Other")).toEqual({ selection: { where: PERSPECTIVE.where, filter: "x" } });
    // Without a selection: every element.
    const bare = setup([shown], answers);
    catalogItems(bare.context, [listed], [])[0]?.more?.();
    await choose(bare.asked, "group");
    expect(facetCalls(bare.call).at(-1)).toEqual({});
    // Outside a builder there is no "No grouping".
    expect(await names(bare.asked)).toEqual(KEYS);
  });

  it("says why when the perspective or the facets cannot be read, and offers no Package without a property of the packages", async () => {
    const listed: CommandListing = { ...command("element.list"), title: "Ask it" };
    let faultyFiles = false;
    const run = setup([shown], {
      ...answers,
      "perspective.list": () =>
        faultyFiles ? new Error("The perspectives are faulty") : answers["perspective.list"](),
    });
    catalogItems(run.context, [listed], [])[0]?.more?.();
    await choose(run.asked, "perspective");
    item((await last(run.asked)).items, "Mine").more?.();
    faultyFiles = true;
    await choose(run.asked, "group");
    expect((await last(run.asked)).label).toBe("The perspectives are faulty · Ask it Mine · group:");

    const faulty = await atGroup({ "element.facets": () => new Error("The facets failed") });
    expect((await last(faulty.asked)).label).toBe("The facets failed · New perspective rain · group:");
    // The builder goes on without them.
    expect(await names(faulty.asked)).toEqual(["No grouping"]);
    let broken = false;
    const bare = await atGroup(
      { "metamodel.get": () => (broken ? new Error("faulty") : FIXTURE_METAMODEL) },
      false,
      () => {
        broken = true;
      },
    );
    expect(await names(bare.asked)).toEqual([
      "No grouping",
      "Type | type",
      "Status | status",
      "Component | component",
      "Packages | packages",
    ]);
  });
});

describe("New perspective and New saved filter ask every step before they save (SR-219, #1746)", () => {
  const shown = elementBuffer("uuid-1", "spec", "SR-000001 (SR-1) Title 1");
  const FACETS = { total: 1, types: [], statuses: [{ key: "draft", count: 1 }], properties: [] };
  const RAIN = { name: "Rain", file: "perspectives/rain.yaml", where: { all: [] } };
  const answers = {
    "metamodel.get": () => FIXTURE_METAMODEL,
    "element.facets": () => FACETS,
    "element.list": () => ({ elements: [], total: 0 }),
    "perspective.list": () => ({ perspectives: [RAIN] }),
    "filter.list": () => ({ filters: [{ name: "Open needs", file: "filters/open-needs.yaml", where: {} }] }),
    "perspective.save": () => ({ files: ["perspectives/rain.yaml"] }),
    "filter.save": () => ({ files: ["filters/open.yaml"] }),
  };

  const choose = async (asked: readonly Prompt[], ...path: readonly string[]): Promise<void> => {
    for (const name of path) {
      item((await last(asked)).items, name).run();
    }
    await flush();
  };

  const names = async (asked: readonly Prompt[]): Promise<string[]> =>
    (await last(asked)).items.map((choice) => choice.name);

  const saves = (call: ReturnType<typeof setup>["call"], name = "perspective.save") =>
    call.mock.calls.filter(([called]) => called === name);

  /** "New perspective" (or `name`) started over `buffers`. */
  const begin = (
    buffers: Buffers = [shown],
    extra: Record<string, (input: Record<string, unknown>) => Answer> = {},
    name: "perspective.save" | "filter.save" = "perspective.save",
  ) => {
    const run = setup(buffers, { ...answers, ...extra });
    startBuilder(run.context, name, CATALOG);
    return run;
  };

  it("[SR-219/AK-v80n] the command prompt has New perspective and New saved filter, which run perspective.save and filter.save, and no Save perspective or Save filter; they fit the overview and a list", () => {
    const context = { ...setup([shown]).context, build: () => undefined };
    const entries = (buffers: Buffers) =>
      withExplanations(
        commandPrompt(
          { ...context, buffers },
          undefined,
          catalogItems({ ...context, buffers }, CATALOG, ACTIONS),
        ),
        CATALOG,
      ).items;
    for (const buffers of [[shown], [listBuffer("All elements")]] as Buffers[]) {
      const titles = entries(buffers).map((entry) => entry.name);
      expect(titles).toContain("New perspective");
      expect(titles).toContain("New saved filter");
      expect(titles).not.toContain("Save perspective");
      expect(titles).not.toContain("Save filter");
    }
    const builders = ACTIONS.filter((action) =>
      ["New perspective", "New saved filter"].includes(action.title),
    );
    expect(builders.map((action) => coveredCommand(action, CATALOG)?.name)).toEqual([
      "perspective.save",
      "filter.save",
    ]);
    // Their explanation line is the summary of the command they run (SR-210 AK5).
    const newPerspective = entries([shown]).find((entry) => entry.name === "New perspective");
    expect(newPerspective?.explain?.summary).toBe(command("perspective.save").summary);
    // They fit the overview and a list, not an element.
    const fitting = (buffers: Buffers) =>
      entries(buffers)
        .filter((entry) => entry.name.startsWith("New "))
        .map((entry) => entry.fits);
    expect(fitting([shown])).toEqual([false, false]);
    expect(fitting([listBuffer("All elements")])).toEqual([true, true]);
    expect(fitting([overviewBuffer()])).toEqual([true, true]);
    // Not in a read-only workspace, and not where the window cannot start them.
    const readOnly = { ...context, readOnly: true };
    expect(builders.some((action) => action.available(readOnly))).toBe(false);
    const { build: _build, ...without } = context;
    expect(builders.some((action) => action.available(without))).toBe(false);
    // The action hands its context to the window.
    const started: unknown[] = [];
    builders[0]?.run({ ...context, build: (name, from) => started.push([name, from.buffers]) });
    expect(started).toEqual([["perspective.save", [shown]]]);
  });

  it("[SR-219/AK-tbwz] New perspective asks name, condition, grouping and sort in turn, the first hit marked, and saves only with Save, without keys sorted by type and ID", async () => {
    const run = begin();
    const name = await last(run.asked);
    expect(name.label).toBe("New perspective · name:");
    name.text?.("Open work");
    // The condition starts without a mark and without a hit for the shown list.
    expect((await last(run.asked)).label).toBe("New perspective Open work · where:");
    expect((await names(run.asked))[0]).toBe("No condition: all elements");
    await choose(run.asked, "Type", "Decision", "Take 1 type");
    expect((await names(run.asked))[0]).toBe("Next: grouping");
    await choose(run.asked, "Next: grouping");
    // The grouping, without Ctrl/Cmd+Enter: "No grouping" first, then the groupings.
    expect((await last(run.asked)).label).toBe("New perspective Open work · group:");
    expect((await names(run.asked)).slice(0, 2)).toEqual(["No grouping", "Type"]);
    await choose(run.asked, "Status");
    // The sort: "Save" first.
    expect((await last(run.asked)).label).toBe("New perspective Open work · sort:");
    expect((await names(run.asked))[0]).toBe("Save");
    expect(saves(run.call)).toHaveLength(0);
    await choose(run.asked, "Save");
    expect(saves(run.call)).toEqual([
      [
        "perspective.save",
        {
          name: "Open work",
          where: { all: [{ type: ["decision"] }] },
          group: "status",
          sort: [
            { by: "type", order: "asc" },
            { by: "identifier", order: "asc" },
          ],
        },
      ],
    ]);
    // "No condition: all elements" and "No grouping" go on as well; chosen keys are saved as chosen.
    const plain = begin();
    (await last(plain.asked)).text?.("All");
    await choose(plain.asked, "No condition: all elements", "No grouping", "Title", "descending", "Save");
    expect(saves(plain.call).at(-1)).toEqual([
      "perspective.save",
      { name: "All", where: { all: [] }, sort: [{ by: "title", order: "desc" }] },
    ]);
  });

  it("[SR-219/AK-kv63] New saved filter asks name, condition and sort; its take hit is Next: sort, and Save without keys saves no sort", async () => {
    const run = begin([shown], {}, "filter.save");
    (await last(run.asked)).text?.("Drafts");
    await choose(run.asked, "Status", "Draft");
    expect((await names(run.asked))[0]).toBe("Next: sort");
    await choose(run.asked, "Next: sort");
    expect((await last(run.asked)).label).toBe("New saved filter Drafts · sort:");
    await choose(run.asked, "Save");
    expect(saves(run.call, "filter.save")).toEqual([
      ["filter.save", { name: "Drafts", where: { all: [{ status: ["draft"] }] } }],
    ]);
  });

  it("[SR-219/AK-vnsd] the name step shows the saved ones as hits and says when the typed name replaces one, and that a modified buffer loses its changes", async () => {
    const run = begin();
    const name = await last(run.asked);
    expect(name.preview).toBe(true);
    expect(name.items.map((choice) => choice.name)).toEqual(["Rain"]);
    expect(name.explain?.note?.("Sun")).toBeUndefined();
    // Ignoring case and Unicode normal form, as core compares names.
    expect(name.explain?.note?.(" rain ")).toBe("Replaces the perspective Rain");
    const perspective = perspectiveBuffer({ name: "Rain", saved: { where: { all: [] } } });
    const modified = withQuery(perspective, { steps: [...perspective.steps, typeStep("need")] });
    const changed = begin([modified]);
    expect((await last(changed.asked)).explain?.note?.("RAIN")).toBe(
      "Replaces the perspective Rain; the changes of its modified buffer are lost",
    );
    // A hit chosen takes its name.
    (await last(run.asked)).items[0]?.run();
    expect((await last(run.asked)).label).toBe("New perspective Rain · where:");
    // The saved filters for a saved filter; "Café" is "Café".
    const filter = begin(
      [shown],
      { "filter.list": () => ({ filters: [{ name: "Café", file: "f.yaml" }] }) },
      "filter.save",
    );
    expect((await last(filter.asked)).explain?.note?.("café")).toBe("Replaces the saved filter Café");
    // An empty name is asked again; a list that cannot be read says why.
    (await last(filter.asked)).text?.("  ");
    expect((await last(filter.asked)).label).toBe("New saved filter · name:");
    const failing = begin([shown], { "perspective.list": () => new Error("The perspectives are faulty") });
    expect((await last(failing.asked)).label).toBe("The perspectives are faulty · New perspective · name:");
  });

  it("[SR-219/AK-wsw0] Ctrl/Cmd+Enter in a step saves nothing, offers the optional arguments that are no step, then goes on with the next step", async () => {
    const run = begin();
    (await last(run.asked)).more?.("rain");
    const more = await last(run.asked);
    expect(more.label).toBe("New perspective rain · more arguments:");
    expect(more.items.map((choice) => choice.name)).toEqual(["Next: condition", "description", "filter"]);
    await choose(run.asked, "description");
    (await last(run.asked)).text?.("For the review");
    // After the optional argument, the next step.
    expect((await last(run.asked)).label).toBe("New perspective rain For the review · where:");
    item((await last(run.asked)).items, "No condition: all elements").more?.();
    expect(await names(run.asked)).toEqual(["Next: grouping", "filter"]);
    await choose(run.asked, "filter", "Open needs");
    expect((await last(run.asked)).label).toBe("New perspective rain For the review Open needs · group:");
    item((await last(run.asked)).items, "No grouping").more?.();
    expect(await names(run.asked)).toEqual(["Next: sort"]);
    await choose(run.asked, "Next: sort");
    expect(saves(run.call)).toHaveLength(0);
    // In the last step Ctrl/Cmd+Enter offers them with Save first.
    item((await last(run.asked)).items, "Save").more?.();
    expect(await names(run.asked)).toEqual(["Save"]);
    await choose(run.asked, "Save");
    expect(saves(run.call)).toEqual([
      [
        "perspective.save",
        {
          name: "rain",
          description: "For the review",
          filter: "Open needs",
          where: { all: [] },
          sort: [
            { by: "type", order: "asc" },
            { by: "identifier", order: "asc" },
          ],
        },
      ],
    ]);
    // The explanation line names Ctrl/Cmd+Enter while such an argument is left.
    const filter = begin([shown], {}, "filter.save");
    expect((await last(filter.asked)).explain?.more).toBe(true);
  });

  it("[SR-219/AK-pqry] Escape goes back a step with its answers and marks; each step shows the marks of the steps before without ×", async () => {
    const run = begin();
    (await last(run.asked)).text?.("rain");
    await choose(run.asked, "Type", "Decision", "Take 1 type", "Next: grouping");
    expect((await last(run.asked)).earlier).toEqual(["type: decision"]);
    await choose(run.asked, "Status", "Title", "ascending");
    const sort = await last(run.asked);
    expect(sort.earlier).toEqual(["type: decision", "grouped by Status"]);
    expect(sort.marks?.map((mark) => mark.label)).toEqual(["Title ascending"]);
    // The sort's marks are its own; Escape goes back to the grouping, whose answer stands first and marked, so
    // Enter keeps it.
    sort.back?.();
    const group = await last(run.asked);
    expect(group.label).toBe("New perspective rain · group:");
    expect((await names(run.asked)).slice(0, 2)).toEqual(["Status", "No grouping"]);
    (await last(run.asked)).items[0]?.run();
    await flush();
    const sortAgain = await last(run.asked);
    expect(sortAgain.earlier).toEqual(["type: decision", "grouped by Status"]);
    expect(sortAgain.marks?.map((mark) => mark.label)).toEqual(["Title ascending"]);
    // Back to the grouping, then to the condition with its marks.
    sortAgain.back?.();
    (await last(run.asked)).back?.();
    const where = await last(run.asked);
    expect(where.label).toBe("New perspective rain · where:");
    expect(where.marks?.map((mark) => mark.label)).toEqual(["type: decision"]);
    expect(where.earlier).toEqual([]);
    // Forward again: the sort's marks stand again.
    await choose(run.asked, "Next: grouping", "No grouping");
    expect((await last(run.asked)).marks?.map((mark) => mark.label)).toEqual(["Title ascending"]);
    expect((await last(run.asked)).earlier).toEqual(["type: decision"]);
    // Back to the name, which stands again, and before it the command prompt.
    const back = begin();
    (await last(back.asked)).text?.("rain");
    (await last(back.asked)).back?.();
    expect((await last(back.asked)).initial).toBe("rain");
    (await last(back.asked)).back?.();
    expect(back.reopened()).toBe(1);
    expect(saves(run.call)).toHaveLength(0);
  });

  it("[SR-219/AK-k5p2] after Save New perspective opens the perspective as saved and says so, New saved filter only says so; a refusal shows its step with the message and every answer again", async () => {
    const opened: string[] = [];
    const run = setup([shown], answers);
    const context = {
      ...run.context,
      perspectives: { used: () => [], opened: (name: string) => opened.push(name) },
    };
    startBuilder(context, "perspective.save", CATALOG);
    (await last(run.asked)).text?.("Rain");
    await choose(run.asked, "No condition: all elements", "No grouping", "Save");
    expect(run.dispatched.at(-1)).toMatchObject({ type: "open", buffer: { perspective: { name: "Rain" } } });
    expect(opened).toEqual(["Rain"]);
    expect(run.echoed.at(-1)).toBe("Saved perspective Rain");
    // Saved but not opened: it says so, and why.
    let faulty = false;
    const unopened = begin([shown], {
      "perspective.list": () =>
        faulty ? new Error("The perspectives are faulty") : answers["perspective.list"](),
      "perspective.save": () => {
        faulty = true;
        return { files: ["perspectives/rain.yaml"] };
      },
    });
    (await last(unopened.asked)).text?.("Rain");
    await choose(unopened.asked, "No condition: all elements", "No grouping", "Save");
    expect(unopened.echoed.at(-1)).toBe("Saved perspective Rain · The perspectives are faulty");

    const filter = begin([shown], {}, "filter.save");
    (await last(filter.asked)).text?.("Open");
    await choose(filter.asked, "No condition: all elements", "Save");
    expect(filter.echoed.at(-1)).toBe("Saved filter Open");
    expect(filter.dispatched).toEqual([]);

    // A refused name: the name step with core's message, then every answer again, until Save.
    const refusal = refusedWith("name: too long", { errors: [{ field: "name" }] });
    let refuse = true;
    const refused = begin([shown], {
      "perspective.save": () => (refuse ? refusal : { files: ["perspectives/x.yaml"] }),
    });
    (await last(refused.asked)).text?.("x");
    await choose(
      refused.asked,
      "Type",
      "Decision",
      "Take 1 type",
      "Next: grouping",
      "Status",
      "Title",
      "ascending",
      "Save",
    );
    const name = await last(refused.asked);
    expect(name.label).toBe("name: too long · New perspective · name:");
    expect(name.initial).toBe("x");
    refuse = false;
    name.text?.("y");
    expect((await last(refused.asked)).marks?.map((mark) => mark.label)).toEqual(["type: decision"]);
    await choose(refused.asked, "Next: grouping");
    // The grouping given stands first and marked: Enter keeps it.
    expect((await names(refused.asked))[0]).toBe("Status");
    (await last(refused.asked)).items[0]?.run();
    await flush();
    expect((await last(refused.asked)).marks?.map((mark) => mark.label)).toEqual(["Title ascending"]);
    await choose(refused.asked, "Save");
    expect(saves(refused.call).at(-1)).toEqual([
      "perspective.save",
      {
        name: "y",
        where: { all: [{ type: ["decision"] }] },
        group: "status",
        sort: [{ by: "title", order: "asc" }],
      },
    ]);
    // A refusal that names no step shows the last step; one of an optional argument asks that again first.
    const other = begin([shown], { "perspective.save": () => new Error("The workspace is read-only") });
    (await last(other.asked)).text?.("z");
    await choose(other.asked, "No condition: all elements", "No grouping", "Save");
    expect((await last(other.asked)).label).toBe("The workspace is read-only · New perspective z · sort:");
    const described = refusedWith("description: too long", { errors: [{ field: "description" }] });
    const optional = begin([shown], { "perspective.save": () => described });
    (await last(optional.asked)).more?.("z");
    await choose(optional.asked, "description");
    (await last(optional.asked)).text?.("long");
    await choose(optional.asked, "No condition: all elements", "No grouping", "Save");
    expect((await last(optional.asked)).label).toBe(
      "description: too long · New perspective z · description:",
    );
    (await last(optional.asked)).text?.("short");
    expect((await last(optional.asked)).label).toBe("New perspective z short · sort:");
  });
});

describe("no argument with fixed values asked as free text or JSON (SR-215 AK2, #1649)", () => {
  type Source = CommandListing["arguments"][number]["complete"];
  /**
   * How the prompt asks each source: hits of AK1, built from hits by AK3/AK6, AK7 or AK8, typed with path
   * completion (SR-143), or free input, which AK2 allows only for the classes below and the numbers.
   */
  const ASKED: Readonly<Record<Source, "hits" | "built" | "path" | "text" | "number" | "json" | "never">> = {
    element: "hits",
    type: "hits",
    status: "hits",
    invalidStatus: "hits",
    relationKind: "hits",
    relationTarget: "hits",
    relation: "hits",
    property: "hits",
    value: "hits",
    hint: "hits",
    filter: "hits",
    baseline: "hits",
    perspective: "hits",
    view: "hits",
    repository: "hits",
    choice: "hits",
    boolean: "hits",
    criterion: "hits",
    evidenceLocation: "hits",
    elementFile: "hits",
    metamodelLocation: "hits",
    group: "hits",
    searchField: "hits",
    condition: "built",
    sort: "built",
    properties: "built",
    relations: "built",
    folder: "path",
    file: "path",
    text: "text",
    number: "number",
    json: "json",
    selection: "never",
  };
  /** The free text AK2 allows: names, titles, texts, descriptions, points in time, versions, Git revisions, search queries, paths and values another command gives. */
  const CLASSES: readonly string[] = [
    "name",
    "title",
    "text",
    "description",
    "time",
    "version",
    "revision",
    "query",
    "path",
    "output",
  ];
  /** The only argument asked as JSON: the mapping of "Save ReqIF mapping". */
  const AS_JSON = ["reqif.saveMapping mapping"];

  /** The commands the prompt offers by their own entry (not those an action covers), with a list shown. */
  const prompted = (catalog: readonly CommandListing[]): CommandListing[] => {
    const { context } = setup([listBuffer("type: need", { where: { type: ["need"] } })]);
    const ids = new Set(catalogItems(context, catalog, ACTIONS).map((item) => item.id));
    return catalog.filter((command) => ids.has(`command:${command.name}`));
  };
  /** Every argument the prompt asks that AK2 does not allow, as `<command> <field>`. */
  const outside = (catalog: readonly CommandListing[]): string[] =>
    prompted(catalog).flatMap((command) =>
      askable(command).flatMap((arg) => {
        const asked = ASKED[arg.complete];
        const allowed =
          asked === "text"
            ? arg.class !== undefined && CLASSES.includes(arg.class)
            : asked !== "json" || AS_JSON.includes(`${command.name} ${arg.field}`);
        return allowed ? [] : [`${command.name} ${arg.field}`];
      }),
    );

  it("[SR-215/AK-qpq7] asks as free text only the classes of AK2 and numbers, and as JSON only the ReqIF mapping", () => {
    const commands = prompted(CATALOG);
    const free = commands.flatMap((command) =>
      command.arguments
        .filter((arg) => arg.complete === "text")
        .map((arg) => `${command.name} ${arg.field}: ${arg.class ?? "none"}`),
    );
    expect(outside(CATALOG)).toEqual([]);
    // The cases whose class was not obvious (#1649).
    expect(free).toEqual(
      expect.arrayContaining([
        "evidence.enrichJunit namePattern: query",
        "evidence.record item: name",
        "evidence.record evidence: path",
        "reqif.export profile: name",
      ]),
    );
    // The commands an action covers are not asked, so they are not checked: element.update asks `set` as JSON.
    expect(commands.map((command) => command.name)).not.toContain("element.update");
    // A new argument asked as text without a class, or as JSON, fails.
    const evidenceRecord = CATALOG.find((command) => command.name === "evidence.record");
    const saveMapping = CATALOG.find((command) => command.name === "reqif.saveMapping");
    if (evidenceRecord === undefined || saveMapping === undefined) {
      throw new Error("catalog without evidence.record or reqif.saveMapping");
    }
    const unclassed = {
      ...evidenceRecord,
      arguments: evidenceRecord.arguments.map(({ class: _class, ...arg }) => arg),
    };
    const asJson = {
      ...evidenceRecord,
      arguments: evidenceRecord.arguments.map((arg) =>
        arg.field === "variant" ? { field: arg.field, complete: "json" as const } : arg,
      ),
    };
    expect(outside([unclassed, saveMapping])).toEqual([
      "evidence.record item",
      "evidence.record date",
      "evidence.record evidence",
      "evidence.record testCase",
      "evidence.record reason",
    ]);
    expect(outside([asJson, saveMapping])).toEqual(["evidence.record variant"]);
  });
});
