// The cascade of list filters (SR-124): each filter narrows the list the one before gave. The actions
// run against a context that records what they dispatch, ask and echo.
import { describe, expect, it, vi } from "vitest";
import { ACTIONS, commandPrompt } from "./actions.js";
import type { ActionContext, Prompt } from "./actions.js";
import type { Buffers, ListBuffer, SearchBuffer } from "./buffers.js";
import { bufferName, filteredList, listBuffer, listHeading, searchBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import { propertyStep, savedStep, statusStep, textStep, typeStep } from "./list-filters.js";

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const FACETS = {
  total: 3,
  statuses: [{ key: "draft", count: 3 }],
  properties: [
    {
      key: "topic",
      name: "Topic",
      kind: "text",
      count: 3,
      missing: 0,
      distinct: 1,
      values: [{ value: "Bearbeiten und Finden", count: 3 }],
    },
    {
      key: "acceptance-criteria",
      name: "Acceptance criteria",
      kind: "text",
      count: 3,
      missing: 0,
      distinct: 3,
    },
  ],
  incomplete: false,
};

/** A context that shows `list` and answers the commands with `answers`. */
const start = (list: ListBuffer | SearchBuffer, answers: Record<string, unknown> = {}) => {
  let buffers: Buffers = [list];
  const asked: Prompt[] = [];
  const echoed: string[] = [];
  const call = vi.fn((name: string) => {
    const output = answers[name];
    return Promise.resolve(
      output instanceof Error
        ? { ok: false, code: "x.failed", message: output.message }
        : { ok: true, output },
    );
  });
  const context: ActionContext = {
    workspace: true,
    buffers,
    mac: false,
    theme: { shown: () => "light", chosen: () => false, toggle: () => "dark", follow: () => undefined },
    call: call as unknown as Call,
    dispatch: (action) => {
      if (action.type === "open") {
        buffers = [action.buffer];
        (context as { buffers: Buffers }).buffers = buffers;
      }
    },
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
  };
  const shown = (): ListBuffer => {
    const [current] = buffers;
    if (current?.kind !== "list") {
      throw new Error("no list");
    }
    return current;
  };
  const run = async (id: string): Promise<Prompt> => {
    const found = ACTIONS.find((candidate) => candidate.id === id);
    if (found === undefined) {
      throw new Error(`no action ${id}`);
    }
    found.run(context);
    await flush();
    const prompt = asked.at(-1);
    if (prompt === undefined) {
      throw new Error("nothing asked");
    }
    return prompt;
  };
  const choose = async (id: string, name: string): Promise<void> => {
    const prompt = await run(id);
    const item = prompt.items.find((candidate) => candidate.name === name);
    if (item === undefined) {
      throw new Error(`no choice ${name}`);
    }
    item.run();
  };
  return { context, shown, asked, echoed, call, run, choose };
};

const titles = (context: ActionContext): string[] => commandPrompt(context).items.map((item) => item.name);

describe("cascading list filters (SR-124)", () => {
  it("[SR-124/AK-jz48] type, status and property: each step narrows the current list", async () => {
    const { shown, choose, call, asked } = start(listBuffer("All elements"), {
      "metamodel.get": { types: [{ key: "system-requirement" }] },
      "element.facets": FACETS,
    });
    await choose("filter-type", "system-requirement");
    await choose("filter-status", "draft");
    expect(call).toHaveBeenLastCalledWith("element.facets", {
      selection: { where: { type: ["system-requirement"] } },
    });
    await choose("filter-property", "Topic");
    expect(call).toHaveBeenLastCalledWith("element.facets", {
      selection: { where: { all: [{ type: ["system-requirement"] }, { status: ["draft"] }] } },
    });
    expect(asked.at(-1)?.label).toBe("Topic");
    asked.at(-1)?.items[0]?.run();
    const steps = [
      typeStep("system-requirement"),
      statusStep("draft"),
      propertyStep("topic", "Bearbeiten und Finden", "Bearbeiten und Finden"),
    ];
    expect(shown()).toEqual(filteredList(steps, undefined));
    expect(shown().label).toBe("type: system-requirement · status: draft · topic: Bearbeiten und Finden");
    expect(shown().selection).toEqual({
      where: {
        all: [
          { type: ["system-requirement"] },
          { status: ["draft"] },
          { property: "topic", op: "eq", value: "Bearbeiten und Finden" },
        ],
      },
    });
  });

  it("[SR-124/AK-hxcz] asks element.facets for the list and offers topic, not acceptance criteria", async () => {
    const { run, call } = start(filteredList([typeStep("system-requirement")]), { "element.facets": FACETS });
    const prompt = await run("filter-property");
    expect(call).toHaveBeenCalledWith("element.facets", {
      selection: { where: { type: ["system-requirement"] } },
    });
    expect(prompt.label).toBe("Property");
    expect(prompt.items.map((item) => item.name)).toEqual(["Status", "Topic"]);
  });

  it("[SR-124/AK-hxcz] asks without a selection on the list of all elements", async () => {
    const { run, call } = start(listBuffer("All elements"), { "element.facets": FACETS });
    await run("filter-property");
    expect(call).toHaveBeenCalledWith("element.facets", {});
  });

  it("echoes why there is nothing to choose by property", async () => {
    const failing = start(listBuffer("All elements"), { "element.facets": new Error("The facets failed") });
    ACTIONS.find((a) => a.id === "filter-property")?.run(failing.context);
    await flush();
    expect(failing.echoed).toEqual(["The facets failed"]);
    const none = start(listBuffer("All elements"), {
      "element.facets": { ...FACETS, statuses: [], properties: [] },
    });
    ACTIONS.find((a) => a.id === "filter-property")?.run(none.context);
    await flush();
    expect(none.echoed).toEqual(["No property of the elements in this list has values to choose from."]);
    expect(none.asked).toEqual([]);
  });

  it("[SR-124/AK-mch4] narrows by text search within the list; empty text does nothing", async () => {
    const { run, shown } = start(filteredList([typeStep("system-requirement")]));
    const prompt = await run("filter-text");
    expect(prompt.label).toBe("Text");
    prompt.text?.("   ");
    expect(shown().steps).toEqual([typeStep("system-requirement")]);
    prompt.text?.("  wind ");
    expect(shown()).toEqual(filteredList([typeStep("system-requirement"), textStep("wind")]));
    expect(shown().selection).toEqual({
      where: { all: [{ type: ["system-requirement"] }, { text: "wind" }] },
    });
  });

  it("offers a saved filter only while the chain has none, and ANDs it with the conditions", async () => {
    const { run, shown, context } = start(filteredList([typeStep("need")]), {
      "filter.list": { filters: [{ name: "open" }] },
      "metamodel.get": { types: [{ key: "need" }] },
    });
    const prompt = await run("filter-saved");
    prompt.items[0]?.run();
    expect(shown()).toEqual(filteredList([typeStep("need"), savedStep("open")]));
    expect(shown().selection).toEqual({ filter: "open", where: { type: ["need"] } });
    expect(titles(context)).not.toContain("Filter list by saved filter");
    const typePrompt = await run("filter-type");
    expect(typePrompt.label).toBe("Type");
  });

  it("clear list filter removes the last step, clear all removes every step; both keep the sort", () => {
    const sort = [{ by: "title", order: "asc" }] as const;
    const steps = [typeStep("system-requirement"), statusStep("draft"), textStep("wind")];
    const { context, shown } = start(filteredList(steps, sort));
    const action = (id: string) => ACTIONS.find((candidate) => candidate.id === id);
    action("clear-filter")?.run(context);
    expect(shown()).toEqual(filteredList(steps.slice(0, 2), sort));
    expect(shown().label).toBe("type: system-requirement · status: draft");
    action("clear-filters")?.run(context);
    expect(shown()).toEqual(listBuffer("All elements", undefined, sort));
  });

  it("offers to clear all on a filtered list (SR-198 AK1), and clear the last step there too", () => {
    expect(titles(start(listBuffer("All elements")).context)).not.toContain("Clear all list filters");
    expect(titles(start(filteredList([typeStep("need")])).context)).toContain("Clear list filter");
    expect(titles(start(filteredList([typeStep("need")])).context)).toContain("Clear all list filters");
    expect(titles(start(filteredList([typeStep("need"), statusStep("draft")])).context)).toContain(
      "Clear all list filters",
    );
  });

  it("sorting keeps the steps", async () => {
    const steps = [typeStep("need"), statusStep("draft")];
    const { run, shown } = start(filteredList(steps));
    const prompt = await run("sort");
    prompt.items[4]?.run();
    expect(shown()).toEqual(filteredList(steps, [{ by: "title", order: "asc" }]));
  });
});

describe("filters and groups on the hits of a search (SR-124 AK4, SR-149 AK6)", () => {
  const shownSearch = (context: ActionContext): SearchBuffer => {
    const [current] = context.buffers;
    if (current?.kind !== "search") {
      throw new Error("no search");
    }
    return current;
  };

  it("[SR-124/AK-mtm9] a filter narrows the search: the same query, the step as its selection, the facets of its hits", async () => {
    const { context, choose, call } = start(searchBuffer("wind"), { "element.facets": FACETS });
    await choose("filter-status", "draft");
    // The values offered are those of the hits: the selection with the search's own text.
    expect(call).toHaveBeenLastCalledWith("element.facets", { selection: { where: { text: "wind" } } });
    expect(shownSearch(context)).toEqual(searchBuffer("wind", [statusStep("draft")]));
    expect(shownSearch(context).selection).toEqual({ where: { status: ["draft"] } });
    await choose("filter-property", "Topic");
    expect(call).toHaveBeenLastCalledWith("element.facets", {
      selection: { where: { all: [{ text: "wind" }, { status: ["draft"] }] } },
    });
    expect(bufferName(shownSearch(context))).toBe("Search: wind · status: draft");
    expect(
      listHeading(searchBuffer("wind", [{ ...typeStep("need"), heading: "Need" }, statusStep("draft")])),
    ).toBe("Search: wind · Need · status: draft");
  });

  it("[SR-149/AK-byyt] [SR-075/AK-qgzh] groups and ungroups the search; it offers no sort, and clearing a filter keeps the grouping", async () => {
    const { context, choose } = start(searchBuffer("wind", [statusStep("draft")]), {
      "element.facets": FACETS,
      "metamodel.get": { meanings: { packages: ["packages"] } },
    });
    expect(titles(context)).toEqual(expect.arrayContaining(["Group list", "Filter list by status"]));
    expect(titles(context)).not.toContain("Sort list");
    expect(titles(context)).not.toContain("Show traceability matrix");
    await choose("group", "Status");
    expect(shownSearch(context)).toEqual(searchBuffer("wind", [statusStep("draft")], "status"));
    expect(bufferName(shownSearch(context))).toBe("Search: wind · status: draft · grouped by status");
    ACTIONS.find((action) => action.id === "clear-filter")?.run(context);
    expect(shownSearch(context)).toEqual(searchBuffer("wind", [], "status"));
    ACTIONS.find((action) => action.id === "ungroup")?.run(context);
    expect(shownSearch(context)).toEqual(searchBuffer("wind"));
  });
});
