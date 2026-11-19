import { Workspace, getCommandRuntime } from "@reqseq/core";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  ACTIONS,
  historyKeyAction,
  isBufferMouseButton,
  mouseButtonAction,
  swipeAction,
  actionFor,
  commandPrompt,
  criterionEntryOf,
  jumpPrompt,
  referencePrompt,
  runAction,
} from "./actions.js";
import type { ActionContext } from "./action-types.js";
import { elementBuffer, filteredList, overviewBuffer, resultBuffer, searchBuffer } from "./buffers.js";
import { savedStep, typeStep } from "./list-filters.js";
import { MOST_FREQUENT, PREFIX, PREFIX_BINDINGS, prefixLabel } from "./bindings.js";
import type { KeyPress } from "./keys.js";
import { COMMAND_SHORTCUT, matches, shortcutLabel } from "./keys.js";
import type { Call } from "./call.js";
import { rank } from "./fuzzy.js";
import {
  flush,
  setup,
  action,
  list,
  filtered,
  element,
  titles,
  everyContext,
} from "./actions.test-helper.js";

describe("the command prompt", () => {
  it("offers on a list: search and filter and sort, not what needs an element or a filter", () => {
    expect(titles(setup([list]).context)).toEqual([
      "Go to element or buffer",
      "Show overview",
      "Search elements",
      "List all elements",
      "Open perspective",
      "Save list as perspective",
      "Save list as saved filter",
      "Rename perspective",
      "Delete perspective",
      "Rename saved filter",
      "Delete saved filter",
      "Filter list",
      "Sort list",
      "Group list",
      "Show traceability matrix",
      "Close buffer",
      "Close all buffers",
      "Show metamodel",
      "Toggle dark mode",
    ]);
  });

  it("offers to clear the filter of a filtered list", () => {
    expect(titles(setup([filtered]).context)).toContain("Clear list filter");
  });

  it("offers the version on an element, and no list action", () => {
    const names = titles(setup([element, list]).context);
    expect(names).toContain("Show element ID and version");
    expect(names).not.toContain("Sort list");
    expect(names).not.toContain("Filter list");
  });

  it("offers editing the title on an element whose buffer gives it, by its name (ThomasBirkmaier/ReqSeq-archive#621, SR-073 AK2)", () => {
    const editTitle = vi.fn();
    const element$ = setup([element], {}, true, {
      element: {
        save: vi.fn(),
        edit: vi.fn(),
        editTitle,
        follow: vi.fn(),
        copy: vi.fn(),
        addProperty: vi.fn(),
        clearProperty: vi.fn(),
        insertImage: vi.fn(),
        listValue: vi.fn(),
        flush: vi.fn(() => Promise.resolve(true)),
        prompting: vi.fn(),
      },
    });
    const item = commandPrompt(element$.context).items.find((found) => found.name === "Edit title");
    expect(item?.hint).toBe("Enter on the title");
    item?.run();
    expect(editTitle).toHaveBeenCalledTimes(1);
  });

  it("offers saving and editing the text on an element that has loaded", () => {
    const element$ = setup([element], {}, true, {
      element: {
        save: vi.fn(),
        edit: vi.fn(),
        follow: vi.fn(),
        copy: vi.fn(),
        addProperty: vi.fn(),
        clearProperty: vi.fn(),
        insertImage: vi.fn(),
        listValue: vi.fn(),
        flush: vi.fn(() => Promise.resolve(true)),
        prompting: vi.fn(),
      },
    });
    const items = commandPrompt(element$.context).items;
    expect(items.map((item) => item.name)).toEqual([
      "Go to element or buffer",
      "Show overview",
      "Search elements",
      "List all elements",
      "Open perspective",
      "Rename perspective",
      "Delete perspective",
      "Rename saved filter",
      "Delete saved filter",
      "Close buffer",
      "Close all buffers",
      "Save element",
      "Edit text",
      "Follow reference",
      "List elements with this value",
      "Copy field",
      "Add property",
      "Clear property",
      "Insert image",
      "Show element ID and version",
      "Show neighbourhood",
      "Show graph",
      "Show metamodel",
      "Toggle dark mode",
    ]);
    expect(items.map((item) => item.hint)).toEqual([
      "Ctrl+P",
      "Ctrl+K O",
      "Ctrl+Shift+F",
      "Ctrl+K L",
      "Ctrl+K V",
      undefined,
      undefined,
      undefined,
      undefined,
      "Ctrl+K B",
      undefined,
      "Ctrl+S",
      "Enter",
      "Ctrl+Enter",
      "Ctrl+Shift+Enter",
      "Ctrl+Shift+C",
      "Ctrl+Alt+A",
      undefined,
      undefined,
      undefined,
      "Ctrl+J",
      "Ctrl+Shift+G",
      undefined,
      undefined,
    ]);
    expect(commandPrompt({ ...element$.context, mac: true }).items[11]?.hint).toBe("⌘S");
    // Not while the element has not loaded, and not on a list.
    expect(titles(setup([element]).context)).not.toContain("Save element");
    expect(
      titles(
        setup([list], {}, true, {
          element: {
            save: vi.fn(),
            edit: vi.fn(),
            follow: vi.fn(),
            copy: vi.fn(),
            addProperty: vi.fn(),
            clearProperty: vi.fn(),
            insertImage: vi.fn(),
            listValue: vi.fn(),
            flush: vi.fn(() => Promise.resolve(true)),
            prompting: vi.fn(),
          },
        }).context,
      ),
    ).not.toContain("Edit text");
  });

  it("offers nothing without a workspace and nothing to close without a buffer", () => {
    expect(titles(setup([], {}, false).context)).toEqual([]);
    expect(titles(setup([]).context)).toEqual([
      "Go to element or buffer",
      "Show overview",
      "Search elements",
      "List all elements",
      "Open perspective",
      "Rename perspective",
      "Delete perspective",
      "Rename saved filter",
      "Delete saved filter",
      "Show metamodel",
      "Toggle dark mode",
    ]);
  });

  it("shows the shortcut of an action as the platform writes it, and none for one without", () => {
    const items = commandPrompt(setup([list]).context).items;
    expect(items.map((item) => item.hint)).toEqual([
      "Ctrl+P",
      "Ctrl+K O",
      "Ctrl+Shift+F",
      "Ctrl+K L",
      "Ctrl+K V",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "Ctrl+K F",
      "Ctrl+K S",
      undefined,
      "Ctrl+T",
      "Ctrl+K B",
      undefined,
      undefined,
      undefined,
    ]);
    expect(commandPrompt({ ...setup([list]).context, mac: true }).items[0]?.hint).toBe("⌘P");
    expect(titles(setup([list]).context)).not.toContain("Command");
    expect(COMMAND_SHORTCUT).toEqual({ mod: true, shift: true, key: "p" });
  });

  it("[SR-109/AK-d5b0] shows each action that has a shortcut with its shortcut, as the platform writes it", () => {
    const shown = new Set<string>();
    // The keys that work only in the buffer are those commands' shortcuts there (ThomasBirkmaier/ReqSeq-archive#472 Q2), pinned literally.
    const bufferKeys: Readonly<Record<string, string>> = {
      edit: "Enter",
      "edit-title": "Enter on the title",
      "graph-depth": "+ / -",
    };
    const bufferKeysShown = new Set<string>();
    for (const context of everyContext()) {
      for (const mac of [false, true]) {
        const now = { ...context, mac };
        const items = commandPrompt(now).items;
        for (const action of ACTIONS.filter((candidate) => candidate.available(now))) {
          const hint = items.find((item) => item.id === action.id)?.hint;
          if (action.shortcut !== undefined) {
            expect(hint).toBe(shortcutLabel(action.shortcut, mac));
            shown.add(action.id);
          } else if (action.hint !== undefined) {
            // A key that works only in the buffer ("Enter" for "Edit text") is its shortcut there (ThomasBirkmaier/ReqSeq-archive#472).
            expect(hint).toBe(bufferKeys[action.id]);
            bufferKeysShown.add(action.id);
          }
        }
      }
    }
    // Every action with a shortcut was seen with it.
    expect([...shown].sort()).toEqual(
      ACTIONS.filter((action) => action.shortcut !== undefined)
        .map((action) => action.id)
        .sort(),
    );
    // Every buffer key was seen with its text.
    expect([...bufferKeysShown].sort()).toEqual(Object.keys(bufferKeys).sort());
  });

  it("[SR-109/AK-hxz3] shows nothing next to an action without a shortcut", () => {
    // A letter after the prefix key is a shortcut too ("Ctrl+K O" for "Show overview", SR-121 AK3).
    const bound = new Set(PREFIX_BINDINGS.map((binding) => binding.id));
    const plain = new Set<string>();
    for (const context of everyContext()) {
      const items = commandPrompt(context).items;
      for (const action of ACTIONS.filter((candidate) => candidate.available(context))) {
        if (
          action.shortcut === undefined &&
          action.systemKey === undefined &&
          action.hint === undefined &&
          !bound.has(action.id)
        ) {
          expect(items.find((item) => item.id === action.id)).not.toHaveProperty("hint");
          plain.add(action.id);
        }
      }
    }
    expect(plain).toContain("clear-filter");
    expect(plain).toContain("close-all");
    expect(plain).toContain("version");
    expect(plain).not.toContain("overview");
  });

  it("[SR-108/AK-bs83] finds each action among the first three by its initials and by a typo, on the real names", () => {
    // Every action that applies somewhere: a list, a chained filter, an element with unsaved text on a package page, the overview.
    const contexts = [
      setup([list]).context,
      setup([filteredList([typeStep("need"), savedStep("open")])]).context,
      setup([element], {}, true, {
        element: {
          save: vi.fn(),
          edit: vi.fn(),
          follow: vi.fn(),
          copy: vi.fn(),
          addProperty: vi.fn(),
          clearProperty: vi.fn(),
          insertImage: vi.fn(),
          listValue: vi.fn(),
          flush: vi.fn(() => Promise.resolve(true)),
          prompting: vi.fn(),
          members: true,
        },
        modified: true,
      }).context,
      setup([overviewBuffer()]).context,
    ];
    const offered = new Set(contexts.flatMap((context) => titles(context)));
    expect(offered.size).toBeGreaterThan(15);
    const first = (context: ActionContext, query: string): string[] =>
      rank(commandPrompt(context).items, (item) => item.name, query)
        .slice(0, 3)
        .map(({ item }) => item.name);
    for (const context of contexts) {
      for (const name of titles(context)) {
        const words = name.split(" ");
        if (words.length > 1) {
          expect(first(context, words.map((word) => word.slice(0, 1)).join("")), name).toContain(name);
        }
        // Two neighbouring letters of the longest word swapped: one slip.
        const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
        const slip = `${longest.slice(0, 1)}${longest.slice(2, 3)}${longest.slice(1, 2)}${longest.slice(3)}`;
        expect(first(context, name.replace(longest, slip)), name).toContain(name);
      }
    }
  });

  it("[SR-121/AK-ynwj] carries what was used to the prompt, and has none without", () => {
    const use = { score: () => 0, remembered: () => undefined, record: vi.fn() };
    expect(commandPrompt(setup([list]).context, use).use).toBe(use);
    expect(commandPrompt(setup([list]).context)).not.toHaveProperty("use");
    expect(jumpPrompt(setup([list]).context)).not.toHaveProperty("use");
  });

  it("runs the chosen action", () => {
    const { context, dispatched } = setup([list]);
    commandPrompt(context)
      .items.find((item) => item.name === "Close buffer")
      ?.run();
    expect(dispatched).toEqual([{ type: "close", key: "list" }]);
  });
});

describe("Show overview", () => {
  it("[SR-118/AK-yggg] opens the overview, and is offered when it is not the shown buffer", () => {
    const { context, dispatched } = setup([list, overviewBuffer()]);
    expect(action("overview").available(context)).toBe(true);
    runAction(action("overview"), context);
    expect(dispatched).toEqual([{ type: "open", buffer: overviewBuffer() }]);
    expect(action("overview").available(setup([overviewBuffer(), list]).context)).toBe(false);
    expect(action("overview").available(setup([list], {}, false).context)).toBe(false);
  });
});

describe("the action of a shortcut", () => {
  it("is the one that applies now", () => {
    const { context } = setup([list]);
    expect(actionFor(context, (shortcut) => shortcut.key === "p")?.id).toBe("go-to");
    expect(actionFor(context, (shortcut) => shortcut.key === "f")?.id).toBe("search");
    expect(actionFor(context, () => false)).toBeUndefined();
    expect(actionFor(setup([list], {}, false).context, (shortcut) => shortcut.key === "p")).toBeUndefined();
  });

  it("in an open prompt is only one that opens a prompt of its own (#1577)", () => {
    const { context } = setup([list]);
    expect(actionFor(context, (shortcut) => shortcut.key === "p", true)?.id).toBe("go-to");
    expect(actionFor(context, (shortcut) => shortcut.key === "f", true)?.id).toBe("search");
    const prompting = ACTIONS.filter((action) => action.shortcut !== undefined && action.inPrompt === true);
    expect(prompting.map((action) => action.id).sort()).toEqual(["find-in-element", "go-to", "search"]);
    for (const action of ACTIONS.filter((entry) => entry.shortcut !== undefined && entry.inPrompt !== true)) {
      expect(actionFor(context, (shortcut) => shortcut === action.shortcut, true)).toBeUndefined();
    }
  });
});

/** An element as element.resolve gives it, for an answer without criterion. */
const resolvedElement = { id: "u1", repository: "spec", shortId: "SR-000001", title: "Wind" };

describe("go to element or buffer", () => {
  it("[SR-220/AK-bfrh] offers the elements whose title holds another designation, as core finds and marks them", async () => {
    // fixtures/SR-220/designations: "package" is the English term of the glossary term "Paket".
    const fixture = await createFixtureWorkspace({ fixture: "SR-220/designations" });
    onTestFinished(() => fixture.cleanup());
    const workspace = new Workspace(fixture.root);
    onTestFinished(() => workspace.close());
    const runtime = getCommandRuntime();
    const call = (async (name: string, input: unknown) => ({
      ok: true,
      output: await runtime.invoke(name, input, { workspace, access: "app" }),
    })) as unknown as Call;
    const { context, asked } = setup([list], {}, true, { call });
    action("go-to").run(context);
    const found = await asked[0]?.find?.("package");
    expect(found?.map((choice) => [choice.name, choice.marks])).toEqual([
      ["SR-0000c3 (REQ-3) Package export", [[18, 25]]],
      ["GT-0000d1 Paket", [[10, 15]]],
      ["SR-0000c1 Paket laden", [[10, 15]]],
      ["SR-0000c7 Altes Paket", [[16, 21]]],
      ["SR-0000c2 Pakete zeigen", [[10, 16]]],
    ]);
  });

  it("lists the open buffers but the shown one, recent first; Enter switches", () => {
    const search = searchBuffer("wind");
    const { context, dispatched } = setup([element, search, list]);
    action("go-to").run(context);
    const prompt = jumpPrompt(context);
    expect(prompt.label).toBe("Go to");
    expect(prompt.items.map((item) => item.name)).toEqual(["Search: wind", "All elements"]);
    prompt.items[0]?.run();
    expect(dispatched).toEqual([{ type: "switch", key: search.key }]);
  });

  it("finds elements by `element.search` on the ID and the title", async () => {
    const hits = {
      hits: [
        {
          id: "u1",
          repository: "spec",
          shortId: "SR-000001",
          identifier: "SR-036",
          title: "Wind",
          type: "t",
          score: 1,
          fields: ["id", "title"],
          terms: ["wind"],
          titleMarks: [{ start: 0, end: 4 }],
        },
        {
          id: "u2",
          repository: "spec",
          shortId: "SR-000002",
          title: "Windy",
          type: "t",
          score: 1,
          fields: ["title"],
          terms: ["windy"],
          titleMarks: [{ start: 0, end: 5 }],
        },
      ],
      total: 2,
      incomplete: false,
    };
    const { context, dispatched, call, asked } = setup([list], { "element.search": hits });
    action("go-to").run(context);
    const found = await asked[0]?.find?.("wind");
    expect(call).toHaveBeenCalledWith("element.search", {
      query: "wind",
      fields: ["id", "title"],
      limit: 20,
    });
    // The marks of core: the ID that matched and the words of the title (SR-183 AK3).
    expect(found?.map((choice) => [choice.id, choice.name, choice.marks])).toEqual([
      [
        "element:spec:u1",
        "SR-000001 (SR-036) Wind",
        [
          [0, 9],
          [19, 23],
        ],
      ],
      ["element:spec:u2", "SR-000002 Windy", [[10, 15]]],
    ]);
    found?.[0]?.run();
    expect(dispatched).toEqual([
      { type: "open", buffer: { ...elementBuffer("u1", "spec", "SR-000001 (SR-036) Wind"), type: "t" } },
    ]);
  });

  it("[SR-115/AK-gxzy] Go to offers every open buffer but the shown one, the one used last first, then the elements shown last that are not open, and finds any element through element.search", async () => {
    const search = searchBuffer("wind");
    const hit = {
      id: "u9",
      repository: "spec",
      shortId: "SR-000009",
      title: "Survive icing",
      type: "t",
      score: 1,
      fields: ["title"],
      terms: ["icing"],
    };
    const speed = elementBuffer("u2", "spec", "SR-000002 Wind speed");
    const direction = elementBuffer("u3", "other", "SR-000003 Wind direction");
    // In order of use: the search is shown, the element was used before it, the list before that.
    const { context, dispatched, call } = setup(
      [search, element, list],
      { "element.search": { hits: [hit], total: 1, incomplete: false } },
      true,
      // Newest first: the open element, then one closed in each of two repositories.
      { recent: () => [element, speed, direction] },
    );
    const prompt = jumpPrompt(context);
    expect(prompt.items.map((item) => [item.id, item.name])).toEqual([
      ["element:spec:u1", "SR-036 Title"],
      ["list", "All elements"],
      ["element:spec:u2", "SR-000002 Wind speed"],
      ["element:other:u3", "SR-000003 Wind direction"],
    ]);
    // Nothing is asked of core when the prompt opens: the search for the typed text is not queued behind reads.
    expect(call).not.toHaveBeenCalled();
    expect(prompt).not.toHaveProperty("fill");
    prompt.items[3]?.run();
    prompt.items[0]?.run();
    expect(dispatched).toEqual([
      { type: "open", buffer: direction },
      { type: "switch", key: "element:spec:u1" },
    ]);
    // Any other element is found by core for the typed text (typo tolerant, SR-119).
    const found = await prompt.find?.("icimg");
    expect(call).toHaveBeenLastCalledWith("element.search", {
      query: "icimg",
      fields: ["id", "title"],
      limit: 20,
    });
    expect(found?.map((choice) => choice.name)).toEqual(["SR-000009 Survive icing"]);
  });

  it("[SR-205/AK-ndnj] Go to resolves a test name's reference to a criterion and names the requirement, number and text", async () => {
    const resolved = {
      element: { id: "u1", repository: "spec", shortId: "SR-000001", identifier: "SR-036", title: "Wind" },
      criterion: { criterion: 2, key: "k7f3", text: "Given a gust.", reference: "[SR-036/AK-k7f3]" },
      current: null,
    };
    const { context, dispatched, call } = setup([list], {
      "element.resolve": resolved,
      "element.search": { hits: [], total: 0, incomplete: false },
    });
    const found = await jumpPrompt(context).find?.(" [SR-036/AK-k7f3] ");
    expect(call).toHaveBeenCalledWith("element.resolve", { ref: "[SR-036/AK-k7f3]" });
    expect(found?.map((choice) => choice.name)).toEqual([
      "SR-000001 (SR-036) Wind · AK2 (k7f3) · Given a gust.",
    ]);
    found?.[0]?.run();
    expect(dispatched).toEqual([
      { type: "open", buffer: elementBuffer("u1", "spec", "SR-000001 (SR-036) Wind") },
    ]);
  });

  it("[SR-205/AK-ndnj] Go to asks element.resolve only for a reference with a key, and echoes its refusal of a bracket token", async () => {
    const { context, call, echoed } = setup([list], {
      "element.resolve": new Error("SR-036 has no acceptance criterion with the criterion key zzzz"),
      "element.search": { hits: [], total: 0, incomplete: false },
    });
    const prompt = jumpPrompt(context);
    expect(await prompt.find?.("wind")).toEqual([]);
    expect(await prompt.find?.("[SR-036/AK2]")).toEqual([]);
    expect(call).not.toHaveBeenCalledWith("element.resolve", expect.anything());
    // Without brackets it may still be being typed: refused without an echo.
    expect(await prompt.find?.("SR-036/AK-zzzz")).toEqual([]);
    expect(echoed).toEqual([]);
    expect(await prompt.find?.("[SR-036/AK-zzzz]")).toEqual([]);
    expect(echoed).toEqual(["SR-036 has no acceptance criterion with the criterion key zzzz"]);
    expect(
      await criterionEntryOf(
        setup([list], { "element.resolve": { element: resolvedElement, current: null } }).context,
        "[SR-036/AK-zzzz]",
      ),
    ).toBeUndefined();
  });

  it("[SR-222/AK-znd8] Go to lists the requirement of a typed criterion reference once, as the criterion's entry", async () => {
    const found = (id: string, shortId: string, identifier: string): Record<string, unknown> => ({
      id,
      repository: "spec",
      shortId,
      identifier,
      title: "Wind",
      type: "t",
      score: 0,
      fields: ["id"],
      terms: [],
    });
    const { context, dispatched } = setup([list], {
      "element.resolve": {
        element: { id: "u1", repository: "spec", shortId: "SR-000001", identifier: "SR-036", title: "Wind" },
        criterion: { criterion: 2, key: "k7f3", text: "Given a gust.", reference: "[SR-036/AK-k7f3]" },
        current: null,
      },
      // The search finds the requirement by the reference, and another one by its words.
      "element.search": {
        hits: [found("u1", "SR-000001", "SR-036"), found("u7", "SR-000007", "SR-0367")],
        total: 2,
        incomplete: false,
      },
    });
    const choices = await jumpPrompt(context).find?.("[SR-036/AK-k7f3]");
    expect(choices?.map((choice) => [choice.id, choice.name])).toEqual([
      ["criterion:element:spec:u1", "SR-000001 (SR-036) Wind · AK2 (k7f3) · Given a gust."],
      ["element:spec:u7", "SR-000007 (SR-0367) Wind"],
    ]);
    choices?.[0]?.run();
    expect(dispatched).toEqual([
      { type: "open", buffer: elementBuffer("u1", "spec", "SR-000001 (SR-036) Wind") },
    ]);
  });

  it("[SR-115/AK-gxzy] Go to offers no element shown last that is open, nor the shown buffer, and none without recent elements", () => {
    const { context } = setup([element, list], {}, true, { recent: () => [element] });
    expect(jumpPrompt(context).items.map((item) => item.name)).toEqual(["All elements"]);
    expect(jumpPrompt(setup([list, element]).context).items.map((item) => item.name)).toEqual([
      "SR-036 Title",
    ]);
  });

  it("echoes why the search failed and finds nothing", async () => {
    const { context, echoed } = setup([list], {
      "element.search": new Error("The search index is not ready"),
    });
    expect(await jumpPrompt(context).find?.("wind")).toEqual([]);
    expect(echoed).toEqual(["The search index is not ready"]);
  });
});

describe("insert reference (SR-129)", () => {
  const hit = {
    id: "u1",
    repository: "other",
    shortId: "SR-000001",
    identifier: "SR-036",
    title: "Wind",
    type: "t",
    score: 1,
    fields: ["title"],
    terms: ["wind"],
  };

  it("[SR-129/AK-nxbm] finds elements as Go to does, and a pick hands the element to the editor", async () => {
    const { context, call } = setup([list], {
      "element.search": { hits: [hit], total: 1, incomplete: false },
    });
    const request = { insert: vi.fn(), cancel: vi.fn() };
    const prompt = referencePrompt(context, request);
    expect(prompt.label).toBe("Insert reference");
    expect(prompt.items).toEqual([]);
    const found = await prompt.find?.("wind");
    expect(call).toHaveBeenCalledWith("element.search", {
      query: "wind",
      fields: ["id", "title"],
      limit: 20,
    });
    expect(found?.map((choice) => choice.name)).toEqual(["SR-000001 (SR-036) Wind"]);
    found?.[0]?.run();
    expect(request.insert).toHaveBeenCalledExactlyOnceWith({
      id: "u1",
      title: "Wind",
      label: "SR-036",
      shortId: "SR-000001",
      repository: "other",
    });
    expect(request.cancel).not.toHaveBeenCalled();
  });

  it("[SR-129/AK-rbjm] cancels through the request, and echoes why the search failed", async () => {
    const { context, echoed } = setup([list], {
      "element.search": new Error("The search index is not ready"),
    });
    const request = { insert: vi.fn(), cancel: vi.fn() };
    const prompt = referencePrompt(context, request);
    prompt.cancel?.();
    expect(request.cancel).toHaveBeenCalledTimes(1);
    expect(await prompt.find?.("wind")).toEqual([]);
    expect(echoed).toEqual(["The search index is not ready"]);
  });
});

describe("search elements", () => {
  it("asks for text and opens a search buffer with it", () => {
    const { context, asked, dispatched } = setup([list]);
    action("search").run(context);
    const prompt = asked[0];
    expect(prompt?.label).toBe("Search");
    expect(prompt?.items).toEqual([]);
    prompt?.text?.("  wind speed ");
    prompt?.text?.("   ");
    expect(dispatched).toEqual([{ type: "open", buffer: searchBuffer("wind speed") }]);
  });
});

describe("save element and edit text", () => {
  it("save runs the controls with Ctrl/Cmd+S, edit has no shortcut", () => {
    const controls = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
      insertImage: vi.fn(),
      listValue: vi.fn(),
      flush: vi.fn(() => Promise.resolve(true)),
      prompting: vi.fn(),
    };
    const { context } = setup([element], {}, true, { element: controls });
    expect(actionFor(context, (shortcut) => shortcut.key === "s" && shortcut.mod)?.id).toBe("save");
    action("save").run(context);
    action("edit").run(context);
    expect(controls.save).toHaveBeenCalledTimes(1);
    expect(controls.edit).toHaveBeenCalledTimes(1);
    expect(action("edit").shortcut).toBeUndefined();
  });

  it("follow reference runs the controls with Ctrl/Cmd+Enter, on an element with a loaded text only", () => {
    const controls = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
      insertImage: vi.fn(),
      listValue: vi.fn(),
      flush: vi.fn(() => Promise.resolve(true)),
      prompting: vi.fn(),
    };
    const { context } = setup([element], {}, true, { element: controls });
    expect(actionFor(context, (shortcut) => shortcut.key === "enter" && shortcut.mod)?.id).toBe(
      "follow-reference",
    );
    action("follow-reference").run(context);
    expect(controls.follow).toHaveBeenCalledTimes(1);
    expect(action("follow-reference").available(setup([element]).context)).toBe(false);
    expect(action("follow-reference").available(setup([list], {}, true, { element: controls }).context)).toBe(
      false,
    );
    action("follow-reference").run(setup([element]).context);
    expect(controls.follow).toHaveBeenCalledTimes(1);
  });

  it("[SR-132/AK-y207] [SR-145/AK-bfb2] List elements with this value runs the controls with Ctrl/Cmd+Shift+Enter, on every element with a loaded text", () => {
    const controls = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
      insertImage: vi.fn(),
      listValue: vi.fn(),
      flush: vi.fn(() => Promise.resolve(true)),
      prompting: vi.fn(),
    };
    const { context } = setup([element], {}, true, { element: controls });
    const key = (event: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }, mac: boolean) =>
      actionFor({ ...context, mac }, (shortcut) =>
        matches(
          { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: "Enter", ...event },
          shortcut,
          mac,
        ),
      )?.id;
    expect(key({ ctrlKey: true, shiftKey: true }, false)).toBe("list-value");
    expect(key({ metaKey: true, shiftKey: true }, true)).toBe("list-value");
    // On macOS only Cmd is the modifier; Ctrl/Cmd+Enter stays "Follow reference".
    expect(key({ ctrlKey: true, shiftKey: true }, true)).toBeUndefined();
    expect(key({ ctrlKey: true }, false)).toBe("follow-reference");
    action("list-value").run(context);
    expect(controls.listValue).toHaveBeenCalledTimes(1);
    expect(action("list-value").available(setup([element]).context)).toBe(false);
    expect(action("list-value").available(setup([list], {}, true, { element: controls }).context)).toBe(
      false,
    );
    action("list-value").run(setup([element]).context);
    expect(controls.listValue).toHaveBeenCalledTimes(1);
    expect(
      commandPrompt({ ...context, mac: true }).items.find((item) => item.id === "list-value")?.hint,
    ).toBe("⌘⇧↩");
  });

  it("[SR-205/AK-zvtb] offers Copy criterion reference with the cursor on a criterion, and runs it", () => {
    const base = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
      insertImage: vi.fn(),
      listValue: vi.fn(),
      flush: vi.fn(() => Promise.resolve(true)),
      prompting: vi.fn(),
    };
    const copyCriterionReference = vi.fn();
    const on = { ...base, onCriterion: () => true, copyCriterionReference };
    const off = { ...base, onCriterion: () => false, copyCriterionReference };
    expect(action("copy-criterion-reference").title).toBe("Copy criterion reference");
    expect(
      action("copy-criterion-reference").available(setup([element], {}, true, { element: on }).context),
    ).toBe(true);
    expect(
      action("copy-criterion-reference").available(setup([element], {}, true, { element: off }).context),
    ).toBe(false);
    expect(
      action("copy-criterion-reference").available(setup([element], {}, true, { element: base }).context),
    ).toBe(false);
    action("copy-criterion-reference").run(setup([element], {}, true, { element: on }).context);
    expect(copyCriterionReference).toHaveBeenCalledWith(undefined);
    // From the context menu: the line pressed.
    const pressed = { id: "line" } as unknown as Element;
    action("copy-criterion-reference").run({
      ...setup([element], {}, true, { element: on }).context,
      pressed,
    });
    expect(copyCriterionReference).toHaveBeenLastCalledWith(pressed);
  });

  it("[SR-128/AK-pk21] Copy field runs the controls with Ctrl/Cmd+Shift+C, on an element with a loaded text only", () => {
    const controls = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
      insertImage: vi.fn(),
      listValue: vi.fn(),
      flush: vi.fn(() => Promise.resolve(true)),
      prompting: vi.fn(),
    };
    const { context } = setup([element], {}, true, { element: controls });
    expect(action("copy-field").title).toBe("Copy field");
    expect(action("copy-field").shortcut).toEqual({ mod: true, shift: true, key: "c" });
    expect(actionFor(context, (shortcut) => shortcut.key === "c" && shortcut.shift && shortcut.mod)?.id).toBe(
      "copy-field",
    );
    action("copy-field").run(context);
    expect(controls.copy).toHaveBeenCalledTimes(1);
    expect(action("copy-field").available(setup([element]).context)).toBe(false);
    expect(action("copy-field").available(setup([list], {}, true, { element: controls }).context)).toBe(
      false,
    );
    action("copy-field").run(setup([element]).context);
    expect(controls.copy).toHaveBeenCalledTimes(1);
  });

  it("Copy result puts the whole shown output on the clipboard as one block", () => {
    const copy = vi.fn();
    const info = resultBuffer(
      "tool.info",
      {},
      "About ReqSeq",
      { versions: { app: "1.0.0", cli: "1.0.0" } },
      0,
    );
    expect(action("copy-result").title).toBe("Copy result");
    action("copy-result").run(setup([info], {}, true, { copy }).context);
    expect(copy).toHaveBeenCalledWith("result", "versions:\n  app: 1.0.0\n  cli: 1.0.0");
    const failed = { ...info, output: undefined, error: "x" };
    expect(action("copy-result").available(setup([failed]).context)).toBe(false);
    expect(action("copy-result").available(setup([list]).context)).toBe(false);
    action("copy-result").run(setup([failed], {}, true, { copy }).context);
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it("[SR-104/AK-k13x] Add property runs the controls with Ctrl/Cmd+Alt+A, on an element with a loaded text only", () => {
    const controls = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
      insertImage: vi.fn(),
      listValue: vi.fn(),
      flush: vi.fn(() => Promise.resolve(true)),
      prompting: vi.fn(),
    };
    const { context } = setup([element], {}, true, { element: controls });
    expect(action("add-property").title).toBe("Add property");
    expect(action("add-property").shortcut).toEqual({ mod: true, shift: false, alt: true, key: "a" });
    expect(
      actionFor(context, (shortcut) => shortcut.key === "a" && shortcut.alt === true && shortcut.mod)?.id,
    ).toBe("add-property");
    action("add-property").run(context);
    expect(controls.addProperty).toHaveBeenCalledTimes(1);
    expect(action("add-property").available(setup([element]).context)).toBe(false);
    expect(action("add-property").available(setup([list], {}, true, { element: controls }).context)).toBe(
      false,
    );
    action("add-property").run(setup([element]).context);
    expect(controls.addProperty).toHaveBeenCalledTimes(1);
    // The command prompt lists it with its shortcut.
    const item = commandPrompt(context).items.find((candidate) => candidate.name === "Add property");
    expect(item?.hint).toBe("Ctrl+Alt+A");
    expect(
      commandPrompt({ ...context, mac: true }).items.find((candidate) => candidate.name === "Add property")
        ?.hint,
    ).toBe("⌥⌘A");
  });

  it("[SR-104/AK-sxnr] Clear property runs the controls, has no shortcut, and applies to an element with a loaded text only", () => {
    const controls = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
      insertImage: vi.fn(),
      listValue: vi.fn(),
      flush: vi.fn(() => Promise.resolve(true)),
      prompting: vi.fn(),
    };
    const { context } = setup([element], {}, true, { element: controls });
    expect(action("clear-property").title).toBe("Clear property");
    expect(action("clear-property").shortcut).toBeUndefined();
    action("clear-property").run(context);
    expect(controls.clearProperty).toHaveBeenCalledTimes(1);
    expect(action("clear-property").available(setup([element]).context)).toBe(false);
    expect(action("clear-property").available(setup([list], {}, true, { element: controls }).context)).toBe(
      false,
    );
    action("clear-property").run(setup([element]).context);
    expect(controls.clearProperty).toHaveBeenCalledTimes(1);
  });

  it("[SR-097/AK-zs31] Insert image runs the controls on an element with a loaded text only and covers Add attachment", () => {
    const controls = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
      insertImage: vi.fn(),
      listValue: vi.fn(),
      flush: vi.fn(() => Promise.resolve(true)),
      prompting: vi.fn(),
    };
    const { context } = setup([element], {}, true, { element: controls });
    expect(action("insert-image").title).toBe("Insert image");
    expect(action("insert-image").covers).toEqual(["element.addAttachment"]);
    action("insert-image").run(context);
    expect(controls.insertImage).toHaveBeenCalledTimes(1);
    expect(action("insert-image").available(setup([element]).context)).toBe(false);
    expect(action("insert-image").available(setup([list], {}, true, { element: controls }).context)).toBe(
      false,
    );
    action("insert-image").run(setup([element]).context);
    expect(controls.insertImage).toHaveBeenCalledTimes(1);
  });

  it("[SR-128/AK-pk21] gives no two actions that apply together the same shortcut, nor the shortcut of the command prompt", () => {
    const contexts = everyContext();
    // Shortcuts as written: `shift` may be left out.
    const written = (shortcut: { mod: boolean; shift?: boolean; key: string }): string =>
      JSON.stringify([shortcut.mod, shortcut.shift === true, shortcut.key]);
    for (const context of contexts) {
      const shortcuts = ACTIONS.filter((candidate) => candidate.available(context)).flatMap((candidate) =>
        candidate.shortcut === undefined ? [] : [written(candidate.shortcut)],
      );
      expect(new Set(shortcuts).size).toBe(shortcuts.length);
      expect(shortcuts).not.toContain(written(COMMAND_SHORTCUT));
      // Ctrl/Cmd+K is the prefix key (ThomasBirkmaier/ReqSeq-archive#472): no action has it as its own shortcut.
      expect(shortcuts).not.toContain(written(PREFIX));
    }
    // The letters after the prefix are unique, and no action has both a shortcut and a letter.
    const letters = PREFIX_BINDINGS.map((binding) => binding.key);
    expect(new Set(letters).size).toBe(letters.length);
    for (const binding of PREFIX_BINDINGS) {
      expect(ACTIONS.find((candidate) => candidate.id === binding.id)?.shortcut).toBeUndefined();
    }
  });

  it("[SR-121/AK-q4xh] shows the fixed shortcut next to each of the most frequent commands where it applies", () => {
    const seen = new Set<string>();
    for (const context of everyContext()) {
      for (const mac of [false, true]) {
        const now = { ...context, mac };
        const items = commandPrompt(now).items;
        for (const id of MOST_FREQUENT) {
          const item = items.find((candidate) => candidate.id === id);
          if (item === undefined) {
            continue;
          }
          seen.add(id);
          const shortcut = ACTIONS.find((candidate) => candidate.id === id)?.shortcut;
          const letter = PREFIX_BINDINGS.find((binding) => binding.id === id)?.key;
          expect(item.hint).toBe(
            shortcut === undefined ? prefixLabel(letter ?? "", mac) : shortcutLabel(shortcut, mac),
          );
        }
      }
    }
    // Each of the actions among them is shown somewhere ("Create element" is a catalog command,
    // `catalog-commands-create.test.ts`).
    expect([...seen].sort()).toEqual(MOST_FREQUENT.filter((id) => !id.startsWith("command:")).sort());
    // Written out once: the letters of the list and the overview.
    const onList = commandPrompt(setup([list]).context).items;
    expect(onList.find((item) => item.id === "list-all")?.hint).toBe("Ctrl+K L");
    expect(
      commandPrompt({ ...setup([list]).context, mac: true }).items.find((item) => item.id === "overview")
        ?.hint,
    ).toBe("⌘K O");
  });

  it("do nothing without controls", () => {
    const { context } = setup([element]);
    action("save").run(context);
    action("edit").run(context);
    expect(action("save").available(context)).toBe(false);
    expect(actionFor(context, (shortcut) => shortcut.key === "s")).toBeUndefined();
  });
});

describe("show element ID and version", () => {
  const read = (versionDate?: string | null) => ({
    element: {
      id: "uuid-1",
      repository: "spec",
      file: "a/b.md",
      version: "n1:abcd",
      ...(versionDate === undefined ? {} : { versionDate }),
    },
  });

  it("echoes the UUID and the date of the version, never the check value (D-013)", async () => {
    const { context, echoed, call } = setup([element], { "element.get": read("2026-10-24T10:00:00Z") });
    action("version").run(context);
    await flush();
    expect(call).toHaveBeenCalledWith("element.get", { ref: "u1", repository: "spec", versionDate: true });
    expect(echoed).toEqual(["uuid-1 · version of 2026-10-24T10:00:00Z · spec:a/b.md"]);
    expect(echoed.join("")).not.toContain("n1:");
  });

  it("says that the date is unknown when Git does not tell", async () => {
    for (const date of [null, undefined]) {
      const { context, echoed } = setup([element], { "element.get": read(date) });
      action("version").run(context);
      await flush();
      expect(echoed).toEqual(["uuid-1 · version of unknown date · spec:a/b.md"]);
    }
  });

  it("echoes why the element could not be read", async () => {
    const { context, echoed } = setup([element], { "element.get": new Error("No such element") });
    action("version").run(context);
    await flush();
    expect(echoed).toEqual(["No such element"]);
  });

  it("is available on an element only", () => {
    expect(action("version").available(setup([list]).context)).toBe(false);
    expect(action("version").available(setup([]).context)).toBe(false);
    const { context, call } = setup([list]);
    action("version").run(context);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("Mouse buttons Back and Forward (SR-163)", () => {
  it("[SR-163/AK-xtth] [SR-163/AK-v661] Back runs Previous buffer, Forward Next buffer, where they apply; other buttons nothing", () => {
    const { context } = setup([list, overviewBuffer()]);
    expect(mouseButtonAction(context, 3)?.id).toBe("previous-buffer");
    expect(mouseButtonAction(context, 4)?.id).toBe("next-buffer");
    expect(mouseButtonAction(setup([list]).context, 3)).toBeUndefined();
    for (const button of [0, 1, 2, 5]) {
      expect(isBufferMouseButton(button)).toBe(false);
      expect(mouseButtonAction(context, button)).toBeUndefined();
    }
    expect(isBufferMouseButton(3) && isBufferMouseButton(4)).toBe(true);
  });

  it("[SR-163/AK-fkcm] a swipe to the left runs Previous buffer, to the right Next buffer, where they apply", () => {
    const { context } = setup([list, overviewBuffer()]);
    expect(swipeAction(context, "left")?.id).toBe("previous-buffer");
    expect(swipeAction(context, "right")?.id).toBe("next-buffer");
    expect(swipeAction(setup([list]).context, "left")).toBeUndefined();
  });
});

describe("Cmd+[ and Cmd+] on macOS (SR-163 AK3)", () => {
  const key = (init: Partial<KeyPress>): KeyPress => ({
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: true,
    altKey: false,
    shiftKey: false,
    ...init,
  });
  it("[SR-163/AK-bh0y] Cmd+[ is Previous buffer, Cmd+] Next buffer, by character or physical key, on macOS only", () => {
    const { context } = setup([list, overviewBuffer()]);
    const mac = { ...context, mac: true };
    expect(historyKeyAction(mac, key({ key: "[" }))?.id).toBe("previous-buffer");
    expect(historyKeyAction(mac, key({ key: "ü", code: "BracketLeft" }))?.id).toBe("previous-buffer");
    expect(historyKeyAction(mac, key({ key: "]" }))?.id).toBe("next-buffer");
    expect(historyKeyAction(mac, key({ key: "+", code: "BracketRight" }))?.id).toBe("next-buffer");
    expect(historyKeyAction({ ...context, mac: false }, key({ key: "[" }))).toBeUndefined();
    // A German layout types "[" and "]" with Option.
    expect(historyKeyAction(mac, key({ key: "[", code: "Digit5", altKey: true }))?.id).toBe(
      "previous-buffer",
    );
    expect(historyKeyAction(mac, key({ key: "]", code: "Digit6", altKey: true }))?.id).toBe("next-buffer");
    for (const other of [{ metaKey: false }, { ctrlKey: true }, { shiftKey: true }, { key: "x" }]) {
      expect(historyKeyAction(mac, key({ key: "[", ...other }))).toBeUndefined();
    }
    // The physical key counts with Cmd alone; an unknown key name is no history key.
    expect(historyKeyAction(mac, key({ key: "“", code: "BracketLeft", altKey: true }))).toBeUndefined();
    expect(historyKeyAction(mac, key({ key: "constructor", code: "constructor" }))).toBeUndefined();
    expect(historyKeyAction({ ...setup([list]).context, mac: true }, key({ key: "[" }))).toBeUndefined();
  });
});
