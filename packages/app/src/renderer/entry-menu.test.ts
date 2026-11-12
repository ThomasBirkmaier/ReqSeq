// The context menu of an element as an entry (SR-197): its entries, the element they act on, and the actions.
import { describe, expect, it } from "vitest";
import type { Action, ActionContext } from "./actions.js";
import { ACTIONS } from "./actions.js";
import type { Buffer, BufferAction, ElementBuffer } from "./buffers.js";
import {
  elementBuffer,
  graphBuffer,
  listBuffer,
  neighbourhoodBuffer,
  overviewBuffer,
  searchBuffer,
} from "./buffers.js";
import type { MenuHit } from "./context-menu.js";
import { MENU_PLACES, menuEntries } from "./context-menu.js";
import { ENTRY_ACTIONS, ENTRY_MENU, menuContext, promptEntry } from "./entry-menu.js";

const entry = elementBuffer("uuid-2", "spec", "SR-2 Second");
const shown = elementBuffer("uuid-1", "spec", "SR-1 First");

/** A context with `buffers` and the element of the entry; it records what it dispatches. */
const contextOf = (buffers: readonly Buffer[], of: ElementBuffer | undefined) => {
  const dispatched: BufferAction[] = [];
  const context = {
    buffers,
    ...(of === undefined ? {} : { entry: of }),
    dispatch: (action: BufferAction) => dispatched.push(action),
  } as unknown as ActionContext;
  return { context, dispatched };
};

const action = (id: string): Action => {
  const found = ENTRY_ACTIONS.find((candidate) => candidate.id === id);
  if (found === undefined) {
    throw new Error(id);
  }
  return found;
};

describe("the entries of an element (SR-197)", () => {
  it("[SR-197/AK-w7yx] are the same, in the same order, on every entry and on a connected element of the matrix", () => {
    const names = [
      "entry-show",
      "entry-graph",
      "entry-neighbourhood",
      "command:trace.affected",
      "command:relation.add",
      "command:element.setStatus",
    ];
    expect(ENTRY_MENU.map((one) => one.id)).toEqual(names);
    expect(MENU_PLACES["element-entry"].map((one) => one.id)).toEqual(names);
    expect(MENU_PLACES["matrix-target"].map((one) => one.id).slice(0, names.length)).toEqual(names);
    const items = names.map((id) => ({ id, name: id, run: () => undefined }));
    const at = (place: MenuHit["place"]): string[] =>
      menuEntries({ place, target: {} as Element, point: { x: 0, y: 0 } }, items).map((item) => item.id);
    expect(at("element-entry")).toEqual(names);
    expect(at("matrix-target")).toEqual(names);
  });

  it("are actions of the command prompt, under the names of those on the shown element", () => {
    for (const one of ENTRY_ACTIONS) {
      expect(ACTIONS).toContain(one);
    }
    expect(ENTRY_ACTIONS.map((one) => one.title)).toEqual([
      "Show element",
      "Show graph",
      "Show neighbourhood",
    ]);
  });
});

describe("the element of the entry", () => {
  const base = { buffers: [shown], marked: entry } as unknown as ActionContext;
  const on = (place: MenuHit["place"]): { hit: Pick<MenuHit, "place"> } => ({ hit: { place } });

  it("is the marked element while the menu of an entry is open, wherever it is (`menuContext`)", () => {
    expect(menuContext(base, on("element-entry")).entry).toBe(entry);
    expect(menuContext(base, on("matrix-target")).entry).toBe(entry);
    // Elsewhere, and with nothing marked, the context stays as it is.
    expect(menuContext(base, on("buffer"))).toBe(base);
    expect(menuContext(base, undefined)).toBe(base);
    const none = { buffers: [shown] } as unknown as ActionContext;
    expect(menuContext(none, on("element-entry"))).toBe(none);
  });

  it("holds what was pressed while the menu of a property box is open (SR-205 AK4)", () => {
    const target = { id: "line" } as unknown as Element;
    expect(menuContext(base, { hit: { place: "field-property", target } }).pressed).toBe(target);
    expect(menuContext(base, { hit: { place: "field", target } }).pressed).toBeUndefined();
  });

  it("in the prompt, is the marked one only where the buffer has no element of its own (`promptEntry`)", () => {
    for (const buffer of [listBuffer("All elements"), searchBuffer("wind"), overviewBuffer()]) {
      expect(promptEntry(buffer, entry)).toEqual({ entry });
    }
    for (const buffer of [
      shown,
      graphBuffer("uuid-1", "spec", "SR-1"),
      neighbourhoodBuffer("uuid-1", "spec", "SR-1"),
    ]) {
      expect(promptEntry(buffer, entry)).toEqual({});
    }
    expect(promptEntry(undefined, entry)).toEqual({});
    expect(promptEntry(listBuffer("All elements"), undefined)).toEqual({});
  });
});

describe("the actions on the element of the entry", () => {
  it("are there only with an entry", () => {
    for (const one of ENTRY_ACTIONS) {
      expect(one.available(contextOf([listBuffer("All elements")], entry).context)).toBe(true);
      expect(one.available(contextOf([listBuffer("All elements")], undefined).context)).toBe(false);
    }
  });

  it("[SR-197/AK-pz85] Show element opens the entry's element as Enter does, in the active area", () => {
    const { context, dispatched } = contextOf([listBuffer("All elements")], entry);
    action("entry-show").run(context);
    expect(dispatched).toEqual([{ type: "open", buffer: entry }]);
  });

  it("Show graph and Show neighbourhood show the entry's, or switch to them when open", () => {
    const graph = graphBuffer(entry.id, entry.repository, entry.name);
    const neighbourhood = neighbourhoodBuffer(entry.id, entry.repository, entry.name);
    const fresh = contextOf([listBuffer("All elements")], entry);
    action("entry-graph").run(fresh.context);
    action("entry-neighbourhood").run(fresh.context);
    expect(fresh.dispatched).toEqual([
      { type: "open", buffer: graph },
      { type: "open", buffer: neighbourhood },
    ]);
    const open = contextOf([listBuffer("All elements"), { ...graph, depth: 3 }, neighbourhood], entry);
    action("entry-graph").run(open.context);
    action("entry-neighbourhood").run(open.context);
    expect(open.dispatched).toEqual([
      { type: "switch", key: graph.key },
      { type: "switch", key: neighbourhood.key },
    ]);
  });

  it("do nothing without an entry", () => {
    const { context, dispatched } = contextOf([listBuffer("All elements")], undefined);
    for (const one of ENTRY_ACTIONS) {
      one.run(context);
    }
    expect(dispatched).toEqual([]);
  });
});
