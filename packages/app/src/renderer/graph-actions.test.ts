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
    opened: [],
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
        expect(actionFor(context(buffers).full, (shortcut) => matches(pressed, shortcut))?.title).toBe(title);
      }
      const plain = { ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: "g" };
      expect(actionFor(context(buffers).full, (shortcut) => matches(plain, shortcut))).toBeUndefined();
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

describe("the modeline of a graph", () => {
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
