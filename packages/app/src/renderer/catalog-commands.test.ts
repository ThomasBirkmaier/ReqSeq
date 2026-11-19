import os from "node:os";
import { createCommandRuntime, defineTestCommand, Workspace } from "@reqseq/core";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandListing } from "../shared/protocol.js";
import type { Choice, ElementControls, Prompt } from "./action-types.js";
import { ACTIONS, commandPrompt, unusedOrder } from "./actions.js";
import type { Buffers } from "./buffers.js";
import {
  elementBuffer,
  listBuffer,
  neighbourhoodBuffer,
  overviewBuffer,
  perspectiveBuffer,
  readOnlyBuffer,
  resultBuffer,
} from "./buffers.js";
import type { Call } from "./call.js";
import type { CatalogContext } from "./catalog-arguments.js";
import { PREFIX_BINDINGS } from "./bindings.js";
import { contextField, fits } from "./catalog-arguments.js";
import { catalogItems, refusedOf } from "./catalog-commands.js";
import { SHOWN_IN, shownIn } from "./command-entry.js";
import { rank } from "./fuzzy.js";
import type { PromptUse } from "./usage.js";
import { openingRows, promptUse, rankByUse } from "./usage.js";
import { CREATE_METAMODEL } from "./create-test-data.js";
import { FIXTURE_METAMODEL } from "./metamodel-test-data.js";
import {
  PLATFORM_SEP,
  CATALOG,
  flush,
  BULK_PREVIEW,
  setup,
  command,
  item,
  last,
  refusedWith,
  start,
  OPTIONS,
  hit,
  HINTS,
} from "./catalog-commands.test-helper.js";

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

  it("Create relation: the shown element as source, a kind relation options allows from it, a target, and the written result on a click on the message", async () => {
    const { context, asked, call, dispatched, reported } = setup([shown], {
      "relation.options": () => OPTIONS,
      "element.search": () => ({ hits: [hit(7)], total: 1 }),
      "relation.add": () => ({ answer: "Added SR-1 refines SR-7; 1 file written.", files: ["f1.md"] }),
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
    expect(reported.map((said) => said.message)).toEqual(["Added SR-1 refines SR-7; 1 file written."]);
    reported[0]?.open();
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
