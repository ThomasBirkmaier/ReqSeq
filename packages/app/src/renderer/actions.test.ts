import { describe, expect, it, vi } from "vitest";
import {
  ACTIONS,
  COMMAND_SHORTCUT,
  NEXT_BUFFER_SHORTCUT,
  PREVIOUS_BUFFER_SHORTCUT,
  actionFor,
  commandPrompt,
  jumpPrompt,
  referencePrompt,
  runAction,
} from "./actions.js";
import type { ActionContext, Prompt } from "./actions.js";
import type { BufferAction, Buffers } from "./buffers.js";
import {
  DEFAULT_SORT,
  elementBuffer,
  filteredList,
  listBuffer,
  listSort,
  graphBuffer,
  neighbourhoodBuffer,
  overviewBuffer,
  searchBuffer,
  withMatrix,
} from "./buffers.js";
import { savedStep, typeStep } from "./list-filters.js";
import { matches } from "./keys.js";
import { openingOrder } from "./opening-order.js";
import type { Call } from "./call.js";
import { rank } from "./fuzzy.js";
import type { Theme } from "./theme.js";
import type { Scheme } from "../shared/theme.js";

/** A theme over a flag: `system` is dark, `choice` is what a command chose. */
const fakeTheme = (system = false): Theme & { readonly choice: () => Scheme | undefined } => {
  let choice: Scheme | undefined;
  const shown = (): Scheme => choice ?? (system ? "dark" : "light");
  return {
    shown,
    chosen: () => choice !== undefined,
    toggle: () => {
      choice = shown() === "dark" ? "light" : "dark";
      return choice;
    },
    follow: () => {
      choice = undefined;
    },
    choice: () => choice,
  };
};

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A context over `buffers`, with the commands answered by `answers` and what the actions did recorded. */
const setup = (
  buffers: Buffers,
  answers: Record<string, unknown> = {},
  workspace = true,
  extra: Partial<ActionContext> = {},
) => {
  const dispatched: BufferAction[] = [];
  const armed: (string | undefined)[] = [];
  const discarded: string[] = [];
  const asked: Prompt[] = [];
  const echoed: string[] = [];
  const left: boolean[] = [];
  const call = vi.fn((name: string) => {
    const output = answers[name];
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, code: "x.failed", message: output.message }
        : { ok: true, output },
    );
  });
  const context: ActionContext = {
    workspace,
    buffers,
    mac: false,
    theme: fakeTheme(),
    call: call as unknown as Call,
    dispatch: (action) => dispatched.push(action),
    ask: (prompt) => asked.push(prompt),
    echo: (message) => echoed.push(message),
    modified: false,
    closeArmed: () => false,
    armClose: (value) => armed.push(value),
    discard: (key) => discarded.push(key),
    drafted: () => false,
    opened: openingOrder([], buffers),
    leaveEditor: () => {
      left.push(true);
    },
    ...extra,
  };
  return { context, dispatched, asked, echoed, call, armed, discarded, left };
};

const action = (id: string) => {
  const found = ACTIONS.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(`no action ${id}`);
  }
  return found;
};

const list = listBuffer("All elements");
const filtered = listBuffer("type: need", { where: { type: ["need"] } }, [{ by: "title", order: "asc" }]);
const element = elementBuffer("u1", "spec", "SR-036 Title");

const titles = (context: ActionContext): string[] => commandPrompt(context).items.map((item) => item.name);

describe("the command prompt", () => {
  it("offers on a list: search and filter and sort, not what needs an element or a filter", () => {
    expect(titles(setup([list]).context)).toEqual([
      "Go to element or buffer",
      "Show overview",
      "Search elements",
      "List all elements",
      "Filter list by type",
      "Filter list by status",
      "Filter list by property",
      "Filter list by text search",
      "Filter list by saved filter",
      "Sort list",
      "Show traceability matrix",
      "Close buffer",
      "Close all buffers",
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
    expect(names).not.toContain("Filter list by type");
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
      },
    });
    const items = commandPrompt(element$.context).items;
    expect(items.map((item) => item.name)).toEqual([
      "Go to element or buffer",
      "Show overview",
      "Search elements",
      "List all elements",
      "Close buffer",
      "Close all buffers",
      "Save element",
      "Edit text",
      "Follow reference",
      "Copy field",
      "Add property",
      "Clear property",
      "Show element ID and version",
      "Show neighbourhood",
      "Show graph",
      "Toggle dark mode",
    ]);
    expect(items.map((item) => item.hint)).toEqual([
      "Ctrl+P",
      undefined,
      "Ctrl+Shift+F",
      undefined,
      undefined,
      undefined,
      "Ctrl+S",
      "Enter",
      "Ctrl+Enter",
      "Ctrl+Shift+C",
      "Ctrl+Alt+A",
      undefined,
      undefined,
      "Ctrl+J",
      "Ctrl+Shift+G",
      undefined,
    ]);
    expect(commandPrompt({ ...element$.context, mac: true }).items[6]?.hint).toBe("⌘S");
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
      "Toggle dark mode",
    ]);
  });

  it("shows the shortcut of an action as the platform writes it, and none for one without", () => {
    const items = commandPrompt(setup([list]).context).items;
    expect(items.map((item) => item.hint)).toEqual([
      "Ctrl+P",
      undefined,
      "Ctrl+Shift+F",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "Ctrl+T",
      undefined,
      undefined,
      undefined,
    ]);
    expect(commandPrompt({ ...setup([list]).context, mac: true }).items[0]?.hint).toBe("⌘P");
    expect(titles(setup([list]).context)).not.toContain("Command");
    expect(COMMAND_SHORTCUT).toEqual({ mod: true, shift: true, key: "p" });
  });

  it("[SR-108/AK1] finds each action among the first three by its initials and by a typo, on the real names", () => {
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

  it("[SR-121/AK2] carries what was used to the prompt, and has none without", () => {
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
  it("[SR-118/AK1] opens the overview, and is offered when it is not the shown buffer", () => {
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
});

describe("go to element or buffer", () => {
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
    expect(found?.map((choice) => [choice.id, choice.name, choice.terms])).toEqual([
      ["element:spec:u1", "SR-036 Wind", ["wind", "sr-036"]],
      ["element:spec:u2", "SR-000002 Windy", ["windy"]],
    ]);
    found?.[0]?.run();
    expect(dispatched).toEqual([{ type: "open", buffer: elementBuffer("u1", "spec", "SR-036 Wind") }]);
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

  it("[SR-129/AK4] finds elements as Go to does, and a pick hands the element to the editor", async () => {
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
    expect(found?.map((choice) => choice.name)).toEqual(["SR-036 Wind"]);
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

  it("[SR-129/AK3] cancels through the request, and echoes why the search failed", async () => {
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

describe("list actions", () => {
  it("list all elements keeps the sort, and from an element starts without one", () => {
    const first = setup([filtered]);
    action("list-all").run(first.context);
    expect(first.dispatched).toEqual([
      { type: "open", buffer: listBuffer("All elements", undefined, [{ by: "title", order: "asc" }]) },
    ]);
    const second = setup([element]);
    action("list-all").run(second.context);
    expect(second.dispatched).toEqual([{ type: "open", buffer: listBuffer("All elements") }]);
  });

  it("filters by a type of the metamodel and keeps the sort", async () => {
    const { context, asked, dispatched, call } = setup([filtered], {
      "metamodel.get": {
        types: [{ key: "need" }, { key: "system-requirement" }],
        statuses: [{ key: "draft" }],
      },
    });
    action("filter-type").run(context);
    await flush();
    expect(call).toHaveBeenCalledWith("metamodel.get", {});
    expect(asked[0]?.label).toBe("Type");
    expect(asked[0]?.items.map((item) => item.name)).toEqual(["need", "system-requirement"]);
    asked[0]?.items[1]?.run();
    expect(dispatched).toEqual([
      {
        type: "open",
        // The list was filtered by type need already: the new step narrows it (SR-124 AK1).
        buffer: filteredList(
          [typeStep("need"), typeStep("system-requirement")],
          [{ by: "title", order: "asc" }],
        ),
      },
    ]);
  });

  it("filters by a status the elements of the list have", async () => {
    const { context, asked, dispatched, call } = setup([list], {
      "element.facets": {
        statuses: [
          { key: "draft", count: 3 },
          { key: "accepted", count: 1 },
        ],
      },
    });
    action("filter-status").run(context);
    await flush();
    expect(call).toHaveBeenCalledWith("element.facets", {});
    expect(asked[0]?.items.map((item) => item.name)).toEqual(["draft", "accepted"]);
    asked[0]?.items[0]?.run();
    expect(dispatched).toEqual([
      { type: "open", buffer: listBuffer("status: draft", { where: { status: ["draft"] } }) },
    ]);
  });

  it("filters by a saved filter", async () => {
    const { context, asked, dispatched, call } = setup([list], {
      "filter.list": { filters: [{ name: "open-needs" }] },
    });
    action("filter-saved").run(context);
    await flush();
    expect(call).toHaveBeenCalledWith("filter.list", {});
    asked[0]?.items[0]?.run();
    expect(dispatched).toEqual([
      { type: "open", buffer: listBuffer("filter: open-needs", { filter: "open-needs" }) },
    ]);
  });

  it("says why there is nothing to choose from", async () => {
    const empty = setup([list], {
      "metamodel.get": { types: [] },
      "element.facets": { statuses: [] },
      "filter.list": { filters: [] },
    });
    action("filter-type").run(empty.context);
    action("filter-status").run(empty.context);
    action("filter-saved").run(empty.context);
    await flush();
    expect(empty.asked).toEqual([]);
    expect(empty.echoed).toEqual([
      "The metamodel has no types.",
      "The elements of this list have no status.",
      "The workspace has no saved filters.",
    ]);
    const failing = setup([list], {
      "metamodel.get": new Error("The metamodel is not valid"),
      "element.facets": new Error("The facets failed"),
      "filter.list": new Error("No filters"),
    });
    action("filter-type").run(failing.context);
    action("filter-status").run(failing.context);
    action("filter-saved").run(failing.context);
    await flush();
    expect(failing.echoed).toEqual(["The metamodel is not valid", "The facets failed", "No filters"]);
  });

  it("clears the filter and keeps the sort", () => {
    const { context, dispatched } = setup([filtered]);
    expect(action("clear-filter").available(setup([list]).context)).toBe(false);
    expect(action("clear-filter").available(context)).toBe(true);
    action("clear-filter").run(context);
    expect(dispatched).toEqual([
      { type: "open", buffer: listBuffer("All elements", undefined, [{ by: "title", order: "asc" }]) },
    ]);
  });

  it("sorts by type and ID, ID, title, type, status or hierarchy, or the workspace order, and keeps the filter", () => {
    const { context, asked, dispatched } = setup([filtered]);
    action("sort").run(context);
    const names = asked[0]?.items.map((item) => item.name);
    expect(names).toEqual([
      "Type and ID",
      "Workspace order",
      "ID ascending",
      "ID descending",
      "Title ascending",
      "Title descending",
      "Type ascending",
      "Type descending",
      "Status ascending",
      "Status descending",
      "Hierarchy (tree)",
    ]);
    asked[0]?.items[0]?.run();
    asked[0]?.items[1]?.run();
    asked[0]?.items[2]?.run();
    asked[0]?.items[3]?.run();
    asked[0]?.items[10]?.run();
    const selection = { where: { type: ["need"] } };
    // "Type and ID" is the default sent explicitly, "Workspace order" is `[]`, "ID" sorts by `identifier`
    // (what the rows show), so each holds on a list with a saved filter too.
    expect(dispatched).toEqual([
      { type: "open", buffer: listBuffer("type: need", selection, DEFAULT_SORT) },
      { type: "open", buffer: listBuffer("type: need", selection, []) },
      { type: "open", buffer: listBuffer("type: need", selection, [{ by: "identifier", order: "asc" }]) },
      { type: "open", buffer: listBuffer("type: need", selection, [{ by: "identifier", order: "desc" }]) },
      { type: "open", buffer: listBuffer("type: need", selection, [{ by: "hierarchy", order: "asc" }]) },
    ]);
  });

  it("sorting a list with a saved filter by type and ID asks for the default, by workspace order for none", () => {
    const saved = filteredList([savedStep("open")]);
    const { context, asked, dispatched } = setup([saved]);
    action("sort").run(context);
    asked[0]?.items[0]?.run();
    asked[0]?.items[1]?.run();
    const [first, second] = dispatched.map((d) =>
      d.type === "open" && d.buffer.kind === "list" ? listSort(d.buffer) : "?",
    );
    expect(first).toBe(DEFAULT_SORT);
    expect(second).toEqual([]);
  });

  describe("on a package page (SR-112)", () => {
    const page = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
      members: true,
    };
    const tree = [{ by: "hierarchy" as const, order: "asc" as const }];

    it('[SR-112/AK2] "Sort list" is offered on a package page and not on another element; no filter is', () => {
      const onPage = setup([element, list], {}, true, { element: page }).context;
      expect(action("sort").available(onPage)).toBe(true);
      expect(titles(onPage)).toContain("Sort list");
      for (const id of ["filter-type", "filter-status", "filter-property", "filter-text", "filter-saved"]) {
        expect(action(id).available(onPage)).toBe(false);
      }
      const other = { ...page, members: false };
      expect(action("sort").available(setup([element], {}, true, { element: other }).context)).toBe(false);
      expect(action("sort").available(setup([element]).context)).toBe(false);
      // The controls of an element that is no longer shown do not make a search a package page.
      expect(
        action("sort").available(setup([searchBuffer("wind")], {}, true, { element: page }).context),
      ).toBe(false);
    });

    it("[SR-112/AK2] sorting on a package page sorts its elements and keeps the element buffer", () => {
      const { context, asked, dispatched } = setup([element], {}, true, { element: page });
      action("sort").run(context);
      expect(asked[0]?.label).toBe("Sort by");
      asked[0]?.items[10]?.run();
      asked[0]?.items[1]?.run();
      asked[0]?.items[0]?.run();
      expect(dispatched).toEqual([
        { type: "open", buffer: { ...element, memberSort: tree, memberCursor: 0 } },
        { type: "open", buffer: { ...element, memberSort: [], memberCursor: 0 } },
        { type: "open", buffer: { ...element, memberSort: DEFAULT_SORT, memberCursor: 0 } },
      ]);
      expect(dispatched.map((d) => (d.type === "open" ? d.buffer.key : ""))).toEqual([
        element.key,
        element.key,
        element.key,
      ]);
    });

    it("[SR-112/AK2] the sort prompt on a package page offers the same choices as on a list", () => {
      const onList = setup([filtered]);
      action("sort").run(onList.context);
      const onPage = setup([element], {}, true, { element: page });
      action("sort").run(onPage.context);
      expect(onPage.asked[0]?.items.map((item) => item.name)).toEqual(
        onList.asked[0]?.items.map((item) => item.name),
      );
      expect(onPage.asked[0]?.label).toBe(onList.asked[0]?.label);
    });
  });

  it("do nothing when the shown buffer is no list", async () => {
    const { context, asked, dispatched, echoed, call } = setup([element]);
    for (const id of [
      "filter-type",
      "filter-status",
      "filter-property",
      "filter-text",
      "filter-saved",
      "clear-filter",
      "clear-filters",
      "sort",
    ]) {
      expect(action(id).available(context)).toBe(false);
      action(id).run(context);
    }
    await flush();
    expect([asked, dispatched, echoed, call.mock.calls]).toEqual([[], [], [], []]);
  });
});

describe("close buffer", () => {
  it("closes the shown buffer, and does nothing without one", () => {
    const { context, dispatched } = setup([element, list]);
    action("close").run(context);
    expect(dispatched).toEqual([{ type: "close", key: element.key }]);
    const none = setup([]);
    action("close").run(none.context);
    expect(none.dispatched).toEqual([]);
  });
});

describe("close buffer with unsaved changes", () => {
  it("asks once, with the key that saves, and discards and closes when closing is repeated", () => {
    const first = setup([element, list], {}, true, { modified: true });
    action("close").run(first.context);
    expect(first.dispatched).toEqual([]);
    expect(first.armed).toEqual([element.key]);
    expect(first.echoed).toEqual([
      "SR-036 Title has unsaved changes: Ctrl+S saves them, closing again discards them",
    ]);
    const again = setup([element, list], {}, true, { modified: true, closeArmed: () => true });
    action("close").run(again.context);
    expect(again.discarded).toEqual([element.key]);
    expect(again.dispatched).toEqual([{ type: "close", key: element.key }]);
    const mac = setup([element], {}, true, { modified: true, mac: true });
    action("close").run(mac.context);
    expect(mac.echoed[0]).toContain("⌘S saves them");
  });

  it("any other action ends the question", () => {
    const { context, armed } = setup([element, list]);
    runAction(action("search"), context);
    runAction(action("close"), context);
    expect(armed).toEqual([undefined]);
  });
});

describe("close all buffers", () => {
  const other = elementBuffer("u2", "spec", "SR-037 Other");
  const closes = (dispatched: BufferAction[]): BufferAction[] =>
    dispatched.filter((entry) => entry.type === "close");
  const choices = (prompt: Prompt | undefined) => {
    if (prompt === undefined) {
      throw new Error("nothing was asked");
    }
    return prompt.items;
  };

  it("[SR-123/AK1] closes every open buffer and says so", () => {
    const { context, dispatched, discarded, echoed, asked } = setup([element, other, list]);
    action("close-all").run(context);
    expect(closes(dispatched)).toEqual([
      { type: "close", key: element.key },
      { type: "close", key: other.key },
      { type: "close", key: list.key },
    ]);
    expect(discarded).toEqual([element.key, other.key, list.key]);
    expect(echoed).toEqual(["Closed 3 buffers"]);
    expect(asked).toEqual([]);
    const one = setup([list]);
    action("close-all").run(one.context);
    expect(one.echoed).toEqual(["Closed 1 buffer"]);
  });

  it("[SR-123/AK2] with unsaved text it asks in the minibuffer: keep the unsaved buffers, or discard and close all", () => {
    const drafted = (key: string): boolean => key === other.key;
    const { context, dispatched, discarded, echoed, asked } = setup([element, other, list], {}, true, {
      drafted,
    });
    action("close-all").run(context);
    // Nothing is closed before a choice; the question is in the minibuffer, not a dialog.
    expect(dispatched).toEqual([]);
    expect(echoed).toEqual([]);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.label).toBe("1 buffer with unsaved changes (SR-037 Other)");
    expect(choices(asked[0]).map((item) => item.name)).toEqual([
      "Close all but the buffers with unsaved changes",
      "Close all and discard the unsaved changes",
    ]);
    // The first choice is the one Enter takes: it keeps the unsaved text.
    choices(asked[0])[0]?.run();
    expect(closes(dispatched)).toEqual([
      { type: "close", key: element.key },
      { type: "close", key: list.key },
    ]);
    expect(discarded).toEqual([element.key, list.key]);
    expect(echoed).toEqual(["Closed 2 buffers"]);
    choices(asked[0])[1]?.run();
    expect(closes(dispatched).slice(2)).toEqual([
      { type: "close", key: element.key },
      { type: "close", key: other.key },
      { type: "close", key: list.key },
    ]);
    expect(discarded.slice(2)).toEqual([element.key, other.key, list.key]);
    expect(echoed.at(-1)).toBe("Closed 3 buffers");
  });

  it("names at most three of the buffers with unsaved text", () => {
    const many = [1, 2, 3, 4, 5].map((n) => elementBuffer(`u${String(n)}`, "spec", `SR-00${String(n)} T`));
    const { context, asked } = setup(many, {}, true, { drafted: () => true });
    action("close-all").run(context);
    expect(asked[0]?.label).toBe("5 buffers with unsaved changes (SR-001 T, SR-002 T, SR-003 T and 2 more)");
    const three = setup(many.slice(0, 3), {}, true, { drafted: () => true });
    action("close-all").run(three.context);
    expect(three.asked[0]?.label).toBe("3 buffers with unsaved changes (SR-001 T, SR-002 T, SR-003 T)");
  });

  it('[SR-123/AK3] "cab" ranks Close all buffers first in the command prompt', () => {
    const controls = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
    };
    const { context } = setup([element, other, filtered], {}, true, { element: controls });
    const items = commandPrompt(context).items;
    expect(rank(items, (item) => item.name, "cab")[0]?.item.name).toBe("Close all buffers");
  });

  it("is offered with buffers only", () => {
    expect(action("close-all").available(setup([list]).context)).toBe(true);
    expect(action("close-all").available(setup([]).context)).toBe(false);
  });

  it("[SR-118/AK1] leaves the overview open and out of the count; the lone overview has nothing to close", () => {
    const overview = overviewBuffer();
    const { context, dispatched, discarded, echoed } = setup([element, overview]);
    action("close-all").run(context);
    expect(closes(dispatched)).toEqual([{ type: "close", key: element.key }]);
    expect(discarded).toEqual([element.key]);
    expect(echoed).toEqual(["Closed 1 buffer"]);
    const lone = setup([overview]).context;
    expect(action("close-all").available(lone)).toBe(false);
    expect(action("close").available(lone)).toBe(false);
    expect(action("close").available(setup([element, overview]).context)).toBe(true);
    // With unsaved text only the other buffers are asked about and closed.
    const drafted = setup([element, other, overview], {}, true, { drafted: (key) => key === other.key });
    action("close-all").run(drafted.context);
    expect(drafted.asked[0]?.label).toBe("1 buffer with unsaved changes (SR-037 Other)");
    choices(drafted.asked[0])[0]?.run();
    expect(closes(drafted.dispatched)).toEqual([{ type: "close", key: element.key }]);
  });

  it("any other action ends a question that Close buffer asked, Close all buffers too", () => {
    const { context, armed } = setup([element]);
    runAction(action("close-all"), context);
    expect(armed).toEqual([undefined]);
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

  it("[SR-128/AK3] Copy field runs the controls with Ctrl/Cmd+Shift+C, on an element with a loaded text only", () => {
    const controls = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
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

  it("[SR-104/AK2] Add property runs the controls with Ctrl/Cmd+Alt+A, on an element with a loaded text only", () => {
    const controls = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
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

  it("[SR-104/AK4] Clear property runs the controls, has no shortcut, and applies to an element with a loaded text only", () => {
    const controls = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
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

  it("[SR-128/AK3] gives no two actions that apply together the same shortcut, nor the shortcut of the command prompt", () => {
    const controls = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
    };
    const page = { ...controls, members: true };
    const contexts = [
      setup([element], {}, true, { element: controls }).context,
      setup([element], {}, true, { element: page }).context,
      setup([element]).context,
      setup([list]).context,
      setup([filtered]).context,
      // The matrix (SR-125): the list in matrix mode (a package page above offers it too).
      setup([withMatrix(filtered, true)]).context,
      setup([overviewBuffer()]).context,
      setup([neighbourhoodBuffer("uuid", "spec", "X")]).context,
      // The graph (SR-111): Ctrl/Cmd+Shift+G back to the element.
      setup([graphBuffer("uuid", "spec", "X")]).context,
      setup([], {}, true).context,
      // Follow agent (SR-117): Ctrl/Cmd+Shift+O on and off, on every buffer.
      ...[false, true].flatMap((on) =>
        [[element], [list], [graphBuffer("uuid", "spec", "X")], [overviewBuffer()]].map(
          (buffers) =>
            setup(buffers, {}, true, {
              element: controls,
              follow: { on, start: vi.fn(), stop: vi.fn() },
            }).context,
        ),
      ),
    ];
    // Shortcuts as written: `shift` may be left out.
    const written = (shortcut: { mod: boolean; shift?: boolean; key: string }): string =>
      JSON.stringify([shortcut.mod, shortcut.shift === true, shortcut.key]);
    for (const context of contexts) {
      const shortcuts = ACTIONS.filter((candidate) => candidate.available(context)).flatMap((candidate) =>
        candidate.shortcut === undefined ? [] : [written(candidate.shortcut)],
      );
      expect(new Set(shortcuts).size).toBe(shortcuts.length);
      expect(shortcuts).not.toContain(written(COMMAND_SHORTCUT));
    }
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

describe("light and dark", () => {
  it('[SR-113/AK2] "Toggle dark mode" switches to the other scheme and says so', () => {
    const light = setup([list], {}, true, { theme: fakeTheme(false) });
    runAction(action("toggle-dark-mode"), light.context);
    expect(light.context.theme.shown()).toBe("dark");
    runAction(action("toggle-dark-mode"), light.context);
    expect(light.context.theme.shown()).toBe("light");
    expect(light.echoed).toEqual(["Dark mode until the app quits", "Light mode until the app quits"]);
    const dark = setup([list], {}, true, { theme: fakeTheme(true) });
    runAction(action("toggle-dark-mode"), dark.context);
    expect(dark.context.theme.shown()).toBe("light");
  });

  it('[SR-113/AK2] "Follow system light or dark mode" is offered only after a choice, and drops it', () => {
    const theme = fakeTheme(true);
    const { context, echoed } = setup([list], {}, true, { theme });
    expect(titles(context)).toContain("Toggle dark mode");
    expect(titles(context)).not.toContain("Follow system light or dark mode");
    runAction(action("toggle-dark-mode"), context);
    expect(titles(context)).toContain("Follow system light or dark mode");
    runAction(action("follow-system-theme"), context);
    expect(theme.choice()).toBeUndefined();
    expect(theme.shown()).toBe("dark");
    expect(echoed.at(-1)).toBe("Light or dark as the system says");
    expect(titles(context)).not.toContain("Follow system light or dark mode");
  });

  it("offers neither without a workspace, where the prompt cannot be opened", () => {
    const theme = fakeTheme();
    theme.toggle();
    expect(titles(setup([], {}, false, { theme }).context)).toEqual([]);
  });
});

describe("Next buffer and Previous buffer (SR-115 AK5)", () => {
  const overview = overviewBuffer();
  const search = searchBuffer("wind");
  // Opened in this order: the overview, the list, the element, the search; the element was used last.
  const opened = [overview.key, list.key, element.key, search.key];
  const used: Buffers = [element, search, list, overview];

  it("[SR-115/AK5] Next buffer shows the buffer opened after the shown one, after the last the first; Previous buffer the one before", () => {
    const next = setup(used, {}, true, { opened });
    runAction(action("next-buffer"), next.context);
    expect(next.dispatched).toEqual([{ type: "switch", key: search.key }]);
    const previous = setup(used, {}, true, { opened });
    runAction(action("previous-buffer"), previous.context);
    expect(previous.dispatched).toEqual([{ type: "switch", key: list.key }]);
    const last = setup([search, element, list, overview], {}, true, { opened });
    runAction(action("next-buffer"), last.context);
    expect(last.dispatched).toEqual([{ type: "switch", key: overview.key }]);
    const first = setup([overview, search, element, list], {}, true, { opened });
    runAction(action("previous-buffer"), first.context);
    expect(first.dispatched).toEqual([{ type: "switch", key: search.key }]);
  });

  it("[SR-115/AK5] the focus leaves a text editor before the switch, so that the editor gets nothing of the key", () => {
    const { context, left, dispatched } = setup(used, {}, true, { opened });
    runAction(action("next-buffer"), context);
    expect(left).toEqual([true]);
    expect(dispatched).toHaveLength(1);
  });

  it("[SR-115/AK5] are commands of the prompt with their keys while several buffers are open", () => {
    const linux = commandPrompt(setup(used, {}, true, { opened }).context).items;
    expect(linux.find((item) => item.name === "Next buffer")?.hint).toBe("Alt+N");
    expect(linux.find((item) => item.name === "Previous buffer")?.hint).toBe("Alt+P");
    const mac = commandPrompt(setup(used, {}, true, { opened, mac: true }).context).items;
    expect(mac.find((item) => item.name === "Next buffer")?.hint).toBe("⌥N");
    expect(mac.find((item) => item.name === "Previous buffer")?.hint).toBe("⌥P");
    const names = titles(setup(used, {}, true, { opened }).context);
    expect(names.indexOf("Next buffer")).toBe(names.indexOf("Close all buffers") + 1);
    expect(names.indexOf("Previous buffer")).toBe(names.indexOf("Next buffer") + 1);
  });

  it("[SR-115/AK5] are not offered and take no key with one buffer, or without a workspace", () => {
    expect(titles(setup([overview]).context)).not.toContain("Next buffer");
    expect(titles(setup([list]).context)).not.toContain("Previous buffer");
    const alone = setup([overview]).context;
    expect(actionFor(alone, (shortcut) => shortcut === NEXT_BUFFER_SHORTCUT)).toBeUndefined();
    const none = setup([], {}, false).context;
    expect(actionFor(none, (shortcut) => shortcut === PREVIOUS_BUFFER_SHORTCUT)).toBeUndefined();
  });

  it("[SR-115/AK5] Alt+N and Alt+P find the actions, Option+N and Option+P by the physical key", () => {
    const { context } = setup(used, {}, true, { opened });
    const press = (key: string, code: string) => ({
      key,
      code,
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    const found = (key: string, code: string) =>
      actionFor(context, (shortcut) => matches(press(key, code), shortcut, false))?.id;
    expect(found("n", "KeyN")).toBe("next-buffer");
    expect(found("p", "KeyP")).toBe("previous-buffer");
    expect(found("Dead", "KeyN")).toBe("next-buffer");
    expect(found("π", "KeyP")).toBe("previous-buffer");
  });

  it("[SR-115/AK5] switches nothing when the shown buffer is not in the order, and leaves the focus where it is", () => {
    const { context, dispatched, left } = setup(used, {}, true, { opened: [list.key, search.key] });
    runAction(action("next-buffer"), context);
    runAction(action("previous-buffer"), context);
    expect(dispatched).toEqual([]);
    expect(left).toEqual([]);
  });
});

describe("Open workspace (SR-131)", () => {
  const workspaces = {
    name: "Weather station",
    list: () => Promise.resolve([{ root: "/req/buoy", state: "found" as const }]),
    open: () => Promise.resolve({ ok: true as const }),
  };

  it("Open workspace is offered with and without an open workspace", async () => {
    for (const open of [true, false]) {
      const { context, asked } = setup(open ? [list] : [], {}, open, { workspaces });
      const items = commandPrompt(context).items;
      expect(
        items.some((item) => item.name === "Open workspace"),
        String(open),
      ).toBe(true);
      if (!open) {
        // Without a workspace it is the one action that applies.
        expect(items.map((item) => item.name)).toEqual(["Open workspace"]);
      }
      runAction(action("open-workspace"), context);
      expect(asked.at(-1)?.label).toBe("Workspace");
      expect((await asked.at(-1)?.fill)?.items?.map((item) => item.name)).toEqual(["/req/buoy"]);
    }
  });

  it("is not offered where the window has no workspaces to offer, and does nothing there", () => {
    const { context, asked } = setup([list]);
    expect(action("open-workspace").available(context)).toBe(false);
    action("open-workspace").run(context);
    expect(asked).toEqual([]);
  });

  it("names the buffer with unsaved input instead of switching", async () => {
    const open = vi.fn(() => Promise.resolve({ ok: true as const }));
    const { context, asked, echoed } = setup([element, list], {}, true, {
      workspaces: { ...workspaces, open },
      drafted: (key) => key === element.key,
    });
    runAction(action("open-workspace"), context);
    (await asked[0]?.fill)?.items?.[0]?.run();
    expect(open).not.toHaveBeenCalled();
    expect(echoed).toEqual(["Unsaved input in SR-036 Title: save it before opening another workspace"]);
    // Without unsaved input it switches.
    const clean = setup([element, list], {}, true, { workspaces: { ...workspaces, open } });
    runAction(action("open-workspace"), clean.context);
    (await clean.asked[0]?.fill)?.items?.[0]?.run();
    expect(open).toHaveBeenCalledExactlyOnceWith("/req/buoy");
  });
});
