import { describe, expect, it, vi } from "vitest";
import { ACTIONS, actionFor, commandPrompt, runAction } from "./actions.js";
import type { ActionContext } from "./actions.js";
import type { BufferAction, Buffers } from "./buffers.js";
import {
  bufferName,
  elementBuffer,
  listBuffer,
  neighbourhoodBuffer,
  overviewBuffer,
  reduceBuffers,
} from "./buffers.js";
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
    leaveEditor: () => undefined,
  };
  return { full, dispatched };
};

const element = elementBuffer("uuid-N1", "spec", "N-001 See the wind");
const neighbourhood = neighbourhoodBuffer("uuid-N1", "spec", "N-001 See the wind");
const names = (buffers: Buffers): string[] =>
  commandPrompt(context(buffers).full).items.map((item) => item.name);

describe("Show neighbourhood and Show element", () => {
  it("[SR-107/AK2] offers the neighbourhood on an element, and the element on a neighbourhood, never both", () => {
    expect(names([element])).toContain("Show neighbourhood");
    expect(names([element])).not.toContain("Show element");
    expect(names([neighbourhood, element])).toContain("Show element");
    expect(names([neighbourhood, element])).not.toContain("Show neighbourhood");
    for (const buffers of [[listBuffer("All elements")], [overviewBuffer()], []] as Buffers[]) {
      expect(names(buffers)).not.toContain("Show neighbourhood");
      expect(names(buffers)).not.toContain("Show element");
    }
  });

  it("[SR-107/AK2] is Ctrl+J or Cmd+J on both, and shows the shortcut as the platform writes it", async () => {
    const { matches } = await import("./keys.js");
    for (const [buffers, title] of [
      [[element], "Show neighbourhood"],
      [[neighbourhood], "Show element"],
    ] as [Buffers, string][]) {
      for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
        const found = actionFor(context(buffers).full, (shortcut) =>
          matches(
            { ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, key: "j", ...modifiers },
            shortcut,
            false,
          ),
        );
        expect(found?.title).toBe(title);
      }
    }
    const other = actionFor(context([element]).full, (shortcut) =>
      matches({ ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, key: "k" }, shortcut, false),
    );
    expect(other).toBeUndefined();
    const hint = (mac: boolean) =>
      commandPrompt(context([element], mac).full).items.find((item) => item.name === "Show neighbourhood")
        ?.hint;
    expect([hint(false), hint(true)]).toEqual(["Ctrl+J", "⌘J"]);
  });

  it("opens the neighbourhood of the shown element, named as the element", () => {
    const { full, dispatched } = context([element]);
    runAction(ACTIONS.find((action) => action.id === "neighbourhood") ?? fail(), full);
    expect(dispatched).toEqual([{ type: "open", buffer: neighbourhood }]);
    expect(bufferName(neighbourhood)).toBe("Neighbourhood: N-001 See the wind");
  });

  it("shows the open neighbourhood again with its open rows and cursor, and the open element with its text", () => {
    const used = { ...neighbourhood, open: ["spec:uuid-S1"], cursor: 3 };
    const back = context([element, used]);
    runAction(ACTIONS.find((action) => action.id === "neighbourhood") ?? fail(), back.full);
    expect(back.dispatched).toEqual([{ type: "switch", key: used.key }]);
    expect(back.dispatched.reduce<Buffers>(reduceBuffers, [element, used])[0]).toBe(used);
    const there = context([used, element]);
    runAction(ACTIONS.find((action) => action.id === "neighbourhood-back") ?? fail(), there.full);
    expect(there.dispatched).toEqual([{ type: "switch", key: element.key }]);
    const none = context([used]);
    runAction(ACTIONS.find((action) => action.id === "neighbourhood-back") ?? fail(), none.full);
    expect(none.dispatched).toEqual([{ type: "open", buffer: element }]);
  });

  it("does nothing when the shown buffer is the wrong one", () => {
    const { full, dispatched } = context([listBuffer("All elements")]);
    for (const id of ["neighbourhood", "neighbourhood-back"]) {
      ACTIONS.find((action) => action.id === id)?.run(full);
    }
    expect(dispatched).toEqual([]);
  });
});

describe("the modeline of a neighbourhood", () => {
  it("shows its name, and that the answer is incomplete when a repository is missing", () => {
    expect(bufferView(neighbourhood, undefined)).toEqual(["Neighbourhood: N-001 See the wind"]);
    expect(bufferView(neighbourhood, { kind: "neighbourhood", incomplete: false })).toEqual([
      "Neighbourhood: N-001 See the wind",
    ]);
    expect(bufferView(neighbourhood, { kind: "neighbourhood", incomplete: true })).toEqual([
      "Neighbourhood: N-001 See the wind",
      INCOMPLETE,
    ]);
  });
});

describe("the buffers around a neighbourhood", () => {
  it("keeps the cursor of the neighbourhood and replaces it by itself when rows are opened", () => {
    const moved = reduceBuffers([neighbourhood], { type: "cursor", key: neighbourhood.key, cursor: 4 });
    expect(moved).toEqual([{ ...neighbourhood, cursor: 4 }]);
    const opened = reduceBuffers([element, neighbourhood], {
      type: "open",
      buffer: { ...neighbourhood, open: ["spec:uuid-S1"] },
    });
    expect(opened.map((buffer) => buffer.key)).toEqual([neighbourhood.key, element.key]);
  });
});

function fail(): never {
  throw new Error("no such action");
}
