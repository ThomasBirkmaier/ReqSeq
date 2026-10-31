import { describe, expect, it, vi } from "vitest";
import { ACTIONS, GRAPH_SHORTCUT, actionFor, commandPrompt, runAction } from "./actions.js";
import type { ActionContext } from "./actions.js";
import type { BufferAction, Buffers } from "./buffers.js";
import {
  bufferName,
  elementBuffer,
  graphBuffer,
  listBuffer,
  neighbourhoodBuffer,
  overviewBuffer,
  reduceBuffers,
} from "./buffers.js";
import { EVERYTHING } from "./graph-choices.js";
import type { GraphFilterChoice } from "./graph-choices.js";
import { matches } from "./keys.js";
import { INCOMPLETE, bufferView } from "./modeline.js";

const context = (buffers: Buffers, mac = false) => {
  const dispatched: BufferAction[] = [];
  const full: ActionContext = {
    workspace: true,
    buffers,
    mac,
    theme: { shown: () => "light", chosen: () => false, toggle: () => "dark", follow: () => undefined },
    call: vi.fn() as never,
    dispatch: (action) => dispatched.push(action),
    ask: vi.fn(),
    echo: vi.fn(),
    modified: false,
    closeArmed: () => false,
    armClose: vi.fn(),
    discard: vi.fn(),
    drafted: () => false,
    cycleOrder: [],
    cycled: () => undefined,
    leaveEditor: vi.fn(),
  };
  return { full, dispatched };
};

const element = elementBuffer("uuid-S1", "spec", "SR-001 Show wind speed");
const neighbourhood = neighbourhoodBuffer("uuid-S1", "spec", "SR-001 Show wind speed");
const graph = graphBuffer("uuid-S1", "spec", "SR-001 Show wind speed");
const names = (buffers: Buffers): string[] =>
  commandPrompt(context(buffers).full).items.map((item) => item.name);
const action = (id: string) => ACTIONS.find((candidate) => candidate.id === id) ?? fail();

describe("Show graph and Show element", () => {
  it("offers the graph on an element and on its neighbourhood, and the element on a graph", () => {
    expect(names([element])).toContain("Show graph");
    expect(names([neighbourhood])).toContain("Show graph");
    expect(names([graph])).toContain("Show element");
    expect(names([graph])).not.toContain("Show graph");
    for (const buffers of [[listBuffer("All elements")], [overviewBuffer()], []] as Buffers[]) {
      expect(names(buffers)).not.toContain("Show graph");
    }
  });

  it("is Ctrl/Cmd+Shift+G, not Ctrl+G (the Emacs keyboard-quit), and shows it as the platform writes it", () => {
    expect(GRAPH_SHORTCUT).toEqual({ mod: true, shift: true, key: "g" });
    for (const [buffers, title] of [
      [[element], "Show graph"],
      [[neighbourhood], "Show graph"],
      [[graph], "Show element"],
    ] as [Buffers, string][]) {
      for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
        const pressed = {
          ctrlKey: false,
          metaKey: false,
          shiftKey: true,
          altKey: false,
          key: "G",
          ...modifiers,
        };
        expect(actionFor(context(buffers).full, (shortcut) => matches(pressed, shortcut, false))?.title).toBe(
          title,
        );
      }
      const plain = { ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: "g" };
      expect(actionFor(context(buffers).full, (shortcut) => matches(plain, shortcut, false))).toBeUndefined();
    }
    const hint = (mac: boolean) =>
      commandPrompt(context([element], mac).full).items.find((item) => item.name === "Show graph")?.hint;
    expect([hint(false), hint(true)]).toEqual(["Ctrl+Shift+G", "⌘⇧G"]);
  });

  it("opens the graph of the shown element or of the neighbourhood's element, named as the element", () => {
    for (const shown of [element, neighbourhood]) {
      const { full, dispatched } = context([shown]);
      runAction(action("graph"), full);
      expect(dispatched).toEqual([{ type: "open", buffer: graph }]);
    }
    expect(bufferName(graph)).toBe("Graph: SR-001 Show wind speed");
  });

  it("shows the open graph again with its depth and selection, and the element from the graph", () => {
    const used = { ...graph, depth: 3, selected: "spec:uuid-C1" };
    const back = context([element, used]);
    runAction(action("graph"), back.full);
    expect(back.dispatched).toEqual([{ type: "switch", key: used.key }]);
    expect(back.dispatched.reduce<Buffers>(reduceBuffers, [element, used])[0]).toBe(used);
    const there = context([used]);
    runAction(action("graph-back"), there.full);
    expect(there.dispatched).toEqual([{ type: "open", buffer: element }]);
  });

  it("does nothing when the shown buffer is the wrong one", () => {
    const { full, dispatched } = context([listBuffer("All elements")]);
    for (const id of ["graph", "graph-back"]) {
      action(id).run(full);
    }
    expect(dispatched).toEqual([]);
  });
});

/** The entries of the relation kind prompts as the app builds them from the catalog and the metamodel. */
const CHOICES: readonly GraphFilterChoice[] = [
  EVERYTHING,
  { name: "Derivations", filter: { meanings: ["derivation"] } },
  { name: "Inline references", filter: { meanings: ["reference"] } },
  { name: "Based on", hint: "based-on", filter: { kinds: ["based-on"] } },
];

/** Runs the action on the shown buffers; gives what it asked, said and opened. */
const ran = (id: string, buffers: Buffers, choices?: readonly GraphFilterChoice[]) => {
  const { full, dispatched } = context(buffers);
  const shown = { ...full, ...(choices === undefined ? {} : { graphChoices: choices }) };
  runAction(action(id), shown);
  const asked = vi.mocked(shown.ask).mock.calls.map(([prompt]) => prompt);
  return { asked, echoed: vi.mocked(shown.echo).mock.calls.map(([message]) => message), dispatched };
};

describe("the depth and relation kind prompts of a graph", () => {
  it("offers Graph depth and the relation kind prompts on a graph only", () => {
    const titles = ["Graph depth", "Show only relation kind", "Also show relation kind"];
    // Also show only while the graph follows some kinds only.
    expect(names([graph]).filter((name) => titles.includes(name))).toEqual(titles.slice(0, 2));
    expect(names([{ ...graph, kinds: ["based-on"] }]).filter((name) => titles.includes(name))).toEqual(
      titles,
    );
    expect(names([{ ...graph, meanings: [] }]).filter((name) => titles.includes(name))).toEqual(titles);
    for (const buffers of [
      [element],
      [neighbourhood],
      [listBuffer("All elements")],
      [overviewBuffer()],
      [],
    ] as Buffers[]) {
      expect(names(buffers).filter((name) => titles.includes(name))).toEqual([]);
    }
    // No shortcut of their own: Graph depth names `+` and `-`, which do the same on the graph.
    const hints = commandPrompt(context([graph]).full).items.filter((item) => titles.includes(item.name));
    expect(hints.map((item) => item.hint)).toEqual(["+ / -", undefined]);
    expect(ACTIONS.filter((candidate) => titles.includes(candidate.title)).map((a) => a.shortcut)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);

    // Graph depth: the depths, the current one with the keys; taking one opens the graph at that depth.
    const depth = ran("graph-depth", [{ ...graph, depth: 2 }]);
    expect(depth.asked.map((prompt) => prompt.label)).toEqual(["Graph depth"]);
    const depths = depth.asked[0]?.items ?? [];
    expect(depths.map((item) => [item.name, item.hint])).toEqual([
      ["Direct neighbours", undefined],
      ["2 levels", "+ / -"],
      ...[3, 4, 5, 6, 7, 8, 9].map((n) => [`${String(n)} levels`, undefined]),
      ["Whole chain", undefined],
    ]);
    depths.at(-1)?.run();
    expect(depth.dispatched).toEqual([{ type: "open", buffer: { ...graph, depth: "all" } }]);

    // Show only: the entries by name, the key as hint; taking one replaces the filter.
    const only = ran("graph-only", [{ ...graph, kinds: ["based-on"] }], CHOICES);
    expect(only.asked.map((prompt) => prompt.label)).toEqual(["Show only"]);
    const kinds = only.asked[0]?.items ?? [];
    expect(kinds.map((item) => [item.name, item.hint])).toEqual([
      ["Everything", undefined],
      ["Derivations", undefined],
      ["Inline references", undefined],
      ["Based on", "based-on"],
    ]);
    kinds[1]?.run();
    expect(only.dispatched).toEqual([{ type: "open", buffer: { ...graph, meanings: ["derivation"] } }]);
    // Without the entries of the catalog and the metamodel, only "Everything".
    const plain = ran("graph-only", [graph]);
    expect(plain.asked[0]?.items.map((item) => item.name)).toEqual(["Everything"]);

    // Also show: the entries the filter lacks; taking one adds it.
    const also = ran("graph-also", [{ ...graph, meanings: ["derivation"] }], CHOICES);
    expect(also.asked.map((prompt) => prompt.label)).toEqual(["Also show"]);
    const more = also.asked[0]?.items ?? [];
    expect(more.map((item) => item.name)).toEqual(["Inline references", "Based on"]);
    more[1]?.run();
    expect(also.dispatched).toEqual([
      { type: "open", buffer: { ...graph, meanings: ["derivation"], kinds: ["based-on"] } },
    ]);
    // Everything added already: it says so and asks nothing.
    const full = ran(
      "graph-also",
      [{ ...graph, meanings: ["derivation", "reference"], kinds: ["based-on"] }],
      CHOICES,
    );
    expect(full.asked).toEqual([]);
    expect(full.echoed).toEqual(["Every relation kind is shown already."]);

    // On another buffer they do nothing.
    for (const id of ["graph-depth", "graph-only", "graph-also"]) {
      const other = ran(id, [element], CHOICES);
      expect([other.asked, other.echoed, other.dispatched]).toEqual([[], [], []]);
    }
  });
});

describe("the modeline of a graph", () => {
  it("names the filter in the modeline by the names of the prompt, and nothing without a filter", () => {
    const data = { kind: "graph", nodes: 4, truncated: false, incomplete: false } as const;
    expect(bufferView(graph, data, new Map(), CHOICES)).toEqual([
      "Graph: SR-001 Show wind speed",
      "1 level",
      "4 nodes",
    ]);
    expect(
      bufferView({ ...graph, meanings: ["derivation"], kinds: ["based-on"] }, data, new Map(), CHOICES),
    ).toEqual(["Graph: SR-001 Show wind speed", "1 level", "only Derivations, Based on", "4 nodes"]);
    // A key no entry names is shown as it is; an empty filter follows nothing.
    expect(bufferView({ ...graph, kinds: ["packages"] }, data, new Map(), CHOICES)).toContain(
      "only packages",
    );
    expect(bufferView({ ...graph, kinds: [] }, data, new Map(), CHOICES)).toContain("nothing followed");
  });

  it("shows its name, depth, the kinds followed when chosen, the nodes, and when more exist or a repository is missing", () => {
    expect(bufferView(graph, undefined)).toEqual(["Graph: SR-001 Show wind speed"]);
    expect(bufferView(graph, { kind: "graph", nodes: 1, truncated: false, incomplete: false })).toEqual([
      "Graph: SR-001 Show wind speed",
      "1 level",
      "1 node",
    ]);
    expect(
      bufferView(
        { ...graph, depth: "all", meanings: ["derivation"] },
        { kind: "graph", nodes: 500, truncated: true, incomplete: true },
      ),
    ).toEqual([
      "Graph: SR-001 Show wind speed",
      "whole chain",
      "only derivation",
      "500 nodes",
      "more not shown",
      INCOMPLETE,
    ]);
    // Data of a graph on another buffer names the buffer only.
    expect(bufferView(element, { kind: "graph", nodes: 3, truncated: false, incomplete: false })).toEqual([
      "SR-001 Show wind speed",
    ]);
  });
});

describe("the buffers around a graph", () => {
  it("keeps the selected node of a graph, and a row cursor does not touch it", () => {
    const chosen = reduceBuffers([graph, element], { type: "select", key: graph.key, node: "spec:uuid-C1" });
    expect(chosen).toEqual([{ ...graph, selected: "spec:uuid-C1" }, element]);
    expect(reduceBuffers(chosen, { type: "cursor", key: graph.key, cursor: 4 })).toEqual(chosen);
    expect(reduceBuffers([element], { type: "select", key: element.key, node: "x" })).toEqual([element]);
  });
});

function fail(): never {
  throw new Error("no such action");
}
