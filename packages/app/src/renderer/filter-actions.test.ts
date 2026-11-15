// The cascade of list filters (SR-124): each filter narrows the list the one before gave. The actions
// run against a context that records what they dispatch, ask and echo.
import { describe, expect, it, vi } from "vitest";
import { ACTIONS, commandPrompt, runAction } from "./actions.js";
import type { ActionContext, Prompt } from "./actions.js";
import type { Buffers, ListBuffer, SearchBuffer } from "./buffers.js";
import {
  bufferName,
  filteredList,
  listBuffer,
  listHeading,
  perspectiveBuffer,
  searchBuffer,
} from "./buffers.js";
import type { CommandListing } from "../shared/protocol.js";
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

const METAMODEL = {
  types: [{ key: "system-requirement", name: "System Requirement" }],
  statuses: [],
  relations: [],
  properties: [],
};

/** The kinds "Filter list" asks first (SR-124 AK5). */
const KINDS = [
  "Type",
  "Status",
  "Property",
  "Verification status",
  "Validation status",
  "Validity",
  "Relation",
  "Text search",
  "Saved filter",
];

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
  const pick = (prompt: Prompt | undefined, name: string): void => {
    const item = prompt?.items.find((candidate) => candidate.name === name);
    if (item === undefined) {
      throw new Error(`no choice ${name} in ${prompt?.label ?? "no prompt"}`);
    }
    item.run();
  };
  /** "Filter list": the kind, then each value in the prompt asked after the one before. */
  const filter = async (kind: string, ...values: string[]): Promise<void> => {
    pick(await run("filter"), kind);
    await flush();
    for (const value of values) {
      pick(asked.at(-1), value);
      await flush();
    }
  };
  return { context, shown, asked, echoed, call, run, choose, filter };
};

const titles = (context: ActionContext): string[] => commandPrompt(context).items.map((item) => item.name);

describe("cascading list filters (SR-124)", () => {
  it("[SR-124/AK-jz48] type, status and property: each step narrows the current list", async () => {
    const { shown, filter, call, asked } = start(listBuffer("All elements"), {
      "metamodel.get": METAMODEL,
      "element.facets": FACETS,
    });
    await filter("Type", "System Requirement");
    await filter("Status", "draft");
    expect(call).toHaveBeenLastCalledWith("metamodel.get", {});
    expect(call).toHaveBeenCalledWith("element.facets", {
      selection: { where: { type: ["system-requirement"] } },
    });
    await filter("Property", "Topic");
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

  it("[SR-124/AK-hxcz] asks element.facets for the list and offers topic, not acceptance criteria nor the status", async () => {
    const { filter, call, asked } = start(filteredList([typeStep("system-requirement")]), {
      "element.facets": FACETS,
    });
    await filter("Property");
    expect(call).toHaveBeenCalledWith("element.facets", {
      selection: { where: { type: ["system-requirement"] } },
    });
    expect(asked.at(-1)?.label).toBe("Property");
    expect(asked.at(-1)?.items.map((item) => item.name)).toEqual(["Topic"]);
  });

  it("[SR-124/AK-hxcz] asks without a selection on the list of all elements", async () => {
    const { filter, call } = start(listBuffer("All elements"), { "element.facets": FACETS });
    await filter("Property");
    expect(call).toHaveBeenCalledWith("element.facets", {});
  });

  it("[SR-124/AK-zmfp] asks the kind first: the kinds of a condition and the saved filter", async () => {
    const { run, context } = start(filteredList([typeStep("need")]));
    const prompt = await run("filter");
    expect(prompt.label).toBe("Filter by");
    expect(prompt.items.map((item) => item.name)).toEqual(KINDS);
    // One entry in the command prompt, none of the five it replaces.
    expect(titles(context).filter((title) => title.startsWith("Filter list"))).toEqual(["Filter list"]);
  });

  it("[SR-124/AK-zmfp] leaves out the saved filter while a step or the selection of the perspective has one", async () => {
    const stepped = await start(filteredList([typeStep("need"), savedStep("open")])).run("filter");
    expect(stepped.items.map((item) => item.name)).toEqual(KINDS.slice(0, -1));
    const perspective = perspectiveBuffer({
      name: "Open needs",
      saved: { where: { all: [] }, filter: "open" },
    });
    const viewed = await start(perspective).run("filter");
    expect(viewed.items.map((item) => item.name)).toEqual(KINDS.slice(0, -1));
    const plain = await start(perspectiveBuffer({ name: "All", saved: { where: { all: [] } } })).run(
      "filter",
    );
    expect(plain.items.map((item) => item.name)).toEqual(KINDS);
  });

  it("[SR-124/AK-y24h] one value adds exactly one step, labelled with kind and value; no mark, no JSON, no closing hit", async () => {
    const { filter, shown, asked } = start(filteredList([typeStep("need")]), {
      "element.facets": FACETS,
      "metamodel.get": METAMODEL,
      "filter.list": { filters: [{ name: "SRs in draft" }] },
    });
    await filter("Status");
    const values = asked.at(-1);
    expect(values?.label).toBe("Status");
    expect(values?.items.map((item) => item.name)).toEqual(["draft"]);
    expect(values?.marks).toBeUndefined();
    expect(values?.literal).toBeUndefined();
    expect(values?.more).toBeUndefined();
    values?.items[0]?.run();
    expect(shown().steps).toEqual([typeStep("need"), statusStep("draft")]);
    expect(shown().label).toBe("type: need · status: draft");
    // A property asks the property, then its value.
    await filter("Property", "Topic", "Bearbeiten und Finden");
    expect(shown().steps.at(-1)).toEqual(
      propertyStep("topic", "Bearbeiten und Finden", "Bearbeiten und Finden"),
    );
    await filter("Saved filter", "SRs in draft");
    expect(shown().steps.at(-1)).toEqual(savedStep("SRs in draft"));
    expect(shown().label).toBe(
      "type: need · status: draft · topic: Bearbeiten und Finden · filter: SRs in draft",
    );
  });

  it("[SR-124/AK-y24h] the verification status from the catalog, labelled as its mark; the facets in the view of the window", async () => {
    const shownCall = vi.fn(() => Promise.resolve({ ok: true, output: FACETS }));
    const started = start(listBuffer("All elements"), { "metamodel.get": METAMODEL });
    const catalog = [
      {
        name: "filter.save",
        arguments: [{ field: "where", complete: "condition" }],
        input: {
          properties: {
            where: {
              oneOf: [{ properties: { verification: { type: "array", items: { enum: ["failed"] } } } }],
            },
          },
        },
      },
    ] as unknown as readonly CommandListing[];
    Object.assign(started.context, { shownCall: shownCall as unknown as Call, catalog: () => catalog });
    await started.filter("Verification status", "failed");
    expect(started.shown().steps).toEqual([
      { label: "verification: failed", selection: { where: { verification: ["failed"] } } },
    ]);
    await started.filter("Status");
    expect(shownCall).toHaveBeenCalledWith("element.facets", {
      selection: { where: { verification: ["failed"] } },
    });
    expect(started.call).not.toHaveBeenCalledWith("element.facets", expect.anything());
  });

  it("[SR-124/AK-y24h] a kind without values says so, and the list stays as it is", async () => {
    const steps = [typeStep("need")];
    const none = start(filteredList(steps), {
      "element.facets": { ...FACETS, statuses: [], properties: [] },
      "metamodel.get": METAMODEL,
      "filter.list": { filters: [] },
    });
    await none.filter("Property");
    await none.filter("Status");
    await none.filter("Saved filter");
    await none.filter("Verification status");
    expect(none.echoed).toEqual([
      "No property of the elements in this list has values to choose from.",
      "The elements of this list have no status.",
      "The workspace has no saved filters.",
      "There is no verification status to choose from.",
    ]);
    expect(none.asked.map((prompt) => prompt.label)).toEqual([
      "Filter by",
      "Filter by",
      "Filter by",
      "Filter by",
    ]);
    expect(none.shown().steps).toEqual(steps);
    const failing = start(listBuffer("All elements"), { "element.facets": new Error("The facets failed") });
    await failing.filter("Property");
    expect(failing.echoed).toEqual(["The facets failed"]);
  });

  it("[SR-124/AK-y24h] Escape goes back a step; from the kind to the command list only when chosen there", async () => {
    const { context, asked } = start(listBuffer("All elements"), {
      "element.facets": FACETS,
      "metamodel.get": METAMODEL,
    });
    const action = ACTIONS.find((candidate) => candidate.id === "filter");
    if (action === undefined) {
      throw new Error("no action filter");
    }
    const last = (): Prompt => {
      const prompt = asked.at(-1);
      if (prompt === undefined) {
        throw new Error("nothing asked");
      }
      return prompt;
    };
    const escape = (): void => {
      last().previous?.();
    };
    const commandList = vi.fn();
    runAction(action, context, commandList);
    const kinds = last();
    escape();
    expect(commandList).toHaveBeenCalledOnce();
    kinds.items.find((item) => item.name === "Property")?.run();
    await flush();
    last().items[0]?.run();
    expect(last().label).toBe("Topic");
    // From the values back to the properties, from there to the kinds.
    escape();
    expect(last().label).toBe("Property");
    escape();
    expect(last().label).toBe("Filter by");
    // Run by its key or the context menu, Escape in the kind step closes the prompt.
    runAction(action, context);
    expect(last().label).toBe("Filter by");
    expect(last().previous).toBeUndefined();
  });

  it("[SR-124/AK-mch4] narrows by text search within the list: the typed query is the value; empty text does nothing", async () => {
    const { filter, shown, asked } = start(filteredList([typeStep("system-requirement")]));
    await filter("Text search");
    const prompt = asked.at(-1);
    expect(prompt?.label).toBe("Text");
    prompt?.text?.("   ");
    expect(shown().steps).toEqual([typeStep("system-requirement")]);
    prompt?.text?.("  wind ");
    expect(shown()).toEqual(filteredList([typeStep("system-requirement"), textStep("wind")]));
    expect(shown().selection).toEqual({
      where: { all: [{ type: ["system-requirement"] }, { text: "wind" }] },
    });
  });

  it("ANDs a saved filter with the conditions", async () => {
    const { filter, shown } = start(filteredList([typeStep("need")]), {
      "filter.list": { filters: [{ name: "open" }] },
    });
    await filter("Saved filter", "open");
    expect(shown()).toEqual(filteredList([typeStep("need"), savedStep("open")]));
    expect(shown().selection).toEqual({ filter: "open", where: { type: ["need"] } });
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
    const { run, shown, asked } = start(filteredList(steps));
    const prompt = await run("sort");
    prompt.items.find((item) => item.name === "Title")?.run();
    asked
      .at(-1)
      ?.items.find((item) => item.name === "ascending")
      ?.run();
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
    const { context, filter, call } = start(searchBuffer("wind"), {
      "element.facets": FACETS,
      "metamodel.get": METAMODEL,
    });
    await filter("Status", "draft");
    // The values offered are those of the hits: the selection with the search's own text.
    expect(call).toHaveBeenCalledWith("element.facets", { selection: { where: { text: "wind" } } });
    expect(shownSearch(context)).toEqual(searchBuffer("wind", [statusStep("draft")]));
    expect(shownSearch(context).selection).toEqual({ where: { status: ["draft"] } });
    await filter("Property", "Topic");
    expect(call).toHaveBeenLastCalledWith("element.facets", {
      selection: { where: { all: [{ text: "wind" }, { status: ["draft"] }] } },
    });
    expect(bufferName(shownSearch(context))).toBe("Search: wind · status: draft");
    expect(
      listHeading(searchBuffer("wind", [{ ...typeStep("need"), heading: "Need" }, statusStep("draft")])),
    ).toBe("Search: wind · Need · status: draft");
  });

  it("[SR-124/AK-mtm9] [SR-216/AK-yq3n] on a search in chosen fields the facets are those of its hits: the steps with the search in its fields", async () => {
    const fields = [{ key: "acceptance-criteria", name: "Acceptance Criteria" }];
    const { context, filter, call } = start(searchBuffer("gust", [], undefined, fields), {
      "element.facets": FACETS,
      "metamodel.get": METAMODEL,
    });
    await filter("Status", "draft");
    // Not a text condition, which searches every field and would count elements the list does not show.
    expect(call).toHaveBeenCalledWith("element.facets", {
      search: { query: "gust", fields: ["acceptance-criteria"] },
    });
    expect(shownSearch(context)).toEqual(searchBuffer("gust", [statusStep("draft")], undefined, fields));
    await filter("Property", "Topic");
    expect(call).toHaveBeenLastCalledWith("element.facets", {
      selection: { where: { status: ["draft"] } },
      search: { query: "gust", fields: ["acceptance-criteria"] },
    });
  });

  it("[SR-149/AK-byyt] [SR-075/AK-qgzh] groups and ungroups the search; it offers no sort, and clearing a filter keeps the grouping", async () => {
    const { context, choose } = start(searchBuffer("wind", [statusStep("draft")]), {
      "element.facets": FACETS,
      "metamodel.get": { meanings: { packages: ["packages"] } },
    });
    expect(titles(context)).toEqual(expect.arrayContaining(["Group list", "Filter list"]));
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
