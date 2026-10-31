import { describe, expect, it } from "vitest";
import { ACTIONS } from "./actions.js";
import { PREFIX_BINDINGS, PREFIX_KEYS, prefixStep } from "./bindings.js";
import { ELEMENT_KEYS, fieldKey } from "./element-keys.js";
import { GRAPH_KEYS, GRAPH_MOVES } from "./graph-nav.js";
import type { KeyPress, KeyRow, KeySpec } from "./keys.js";
import {
  HISTORY_KEYS,
  LIST_MOVES,
  PROMPT_MOVES,
  historyStep,
  keySpecLabel,
  listStep,
  matches,
  press,
  pressLabel,
  rowTarget,
} from "./keys.js";
import { MORE_SHORTCUT, PROMPT_KEYS } from "./prompt-keys.js";
import { SHORTCUT_TABLES, shortcutReference } from "./shortcut-reference.js";

/** The key press `spec` is on macOS (`mac`) or on the other systems. */
const eventOf = (spec: KeySpec, mac: boolean): KeyPress => {
  if ("press" in spec) {
    return spec.press;
  }
  const { mod, shift, alt, key } = spec.shortcut;
  return { ctrlKey: mod && !mac, metaKey: mod && mac, shiftKey: shift, altKey: alt ?? false, key };
};

/** The presses of the rows on one system. */
const pressesOf = (rows: readonly KeyRow[], mac: boolean): KeyPress[] =>
  rows.flatMap((row) =>
    row.keys.filter((spec) => keySpecLabel(spec, mac) !== undefined).map((spec) => eventOf(spec, mac)),
  );

const COMMANDS = [
  { name: "element.create", title: "Create element" },
  { name: "relation.add", title: "Create relation" },
  { name: "element.setStatus", title: "Set status" },
  { name: "hint.confirm", title: "Confirm hints" },
];

describe("key labels", () => {
  it("writes a press with the physical Ctrl key and named keys", () => {
    expect(pressLabel(press("n", true), false)).toBe("Ctrl+N");
    expect(pressLabel(press("n", true), true)).toBe("⌃N");
    expect(pressLabel({ ...press("x"), altKey: true, metaKey: true, shiftKey: true }, true)).toBe("⌥⌘⇧X");
    expect(pressLabel({ ...press("x"), altKey: true, shiftKey: true }, false)).toBe("Alt+Shift+X");
    expect(pressLabel(press("PageDown"), true)).toBe("Page Down");
    expect(pressLabel(press(" "), false)).toBe("Space");
    expect(pressLabel(press("Enter"), true)).toBe("Enter");
  });

  it("leaves out a key of the other system", () => {
    expect(keySpecLabel({ press: press("n", true), only: "mac" }, false)).toBeUndefined();
    expect(keySpecLabel({ press: press("n", true), only: "mac" }, true)).toBe("⌃N");
    expect(keySpecLabel({ shortcut: MORE_SHORTCUT, only: "other" }, true)).toBeUndefined();
    expect(keySpecLabel({ shortcut: MORE_SHORTCUT }, true)).toBe("⌘↩");
  });
});

describe("the key tables follow their handlers", () => {
  it("lists exactly the moves of a list (rowTarget)", () => {
    for (const mac of [false, true]) {
      for (const event of pressesOf(LIST_MOVES, mac)) {
        expect(rowTarget(event, 3, 10, 4), event.key).toBeDefined();
      }
    }
    for (const key of ["ArrowLeft", "ArrowRight", "Enter", "Tab", "a"]) {
      expect(rowTarget(press(key), 3, 10, 4), key).toBeUndefined();
    }
  });

  it("lists the next, then the previous candidate of a prompt (listStep)", () => {
    expect(PROMPT_KEYS.slice(0, 2)).toEqual(PROMPT_MOVES);
    for (const mac of [false, true]) {
      expect(pressesOf(PROMPT_MOVES.slice(0, 1), mac).map(listStep)).toEqual([1, 1, 1]);
      expect(pressesOf(PROMPT_MOVES.slice(1), mac).map(listStep)).toEqual([-1, -1]);
    }
  });

  it("lists undo, then redo (historyStep), Ctrl+Y not on macOS", () => {
    for (const mac of [false, true]) {
      expect(pressesOf(HISTORY_KEYS.slice(0, 1), mac).map((event) => historyStep(event, mac))).toEqual([
        "undo",
      ]);
      const redo = pressesOf(HISTORY_KEYS.slice(1), mac).map((event) => historyStep(event, mac));
      expect(redo).toEqual(mac ? ["redo"] : ["redo", "redo"]);
    }
  });

  it("lists the keys the element buffer takes on a field (fieldKey)", () => {
    for (const spec of ELEMENT_KEYS.flatMap((row) => row.keys)) {
      if (!("press" in spec) || spec.press.ctrlKey) {
        continue;
      }
      expect(fieldKey(spec.press.key, "title", true), spec.press.key).toBe(true);
    }
  });

  it("moves the graph with the keys of its table", () => {
    expect(GRAPH_MOVES).toEqual(pressesOf(GRAPH_KEYS, false).map((event) => event.key));
  });

  it("lists what the prefix does with a second Ctrl/Cmd+K and with Escape (prefixStep)", () => {
    for (const mac of [false, true]) {
      expect(pressesOf(PREFIX_KEYS, mac).map((event) => prefixStep(event, mac).kind)).toEqual([
        "show",
        "cancel",
      ]);
    }
  });

  it("takes the optional arguments with the key of its row", () => {
    const row = PROMPT_KEYS.find((candidate) =>
      candidate.keys.some((spec) => "shortcut" in spec && spec.shortcut === MORE_SHORTCUT),
    );
    expect(row).toBeDefined();
    expect(matches(eventOf({ shortcut: MORE_SHORTCUT }, true), MORE_SHORTCUT, true)).toBe(true);
  });
});

describe("shortcutReference", () => {
  it("names every key on both systems, the letters after the prefix by the command they run", () => {
    const sections = shortcutReference(COMMANDS);
    expect(sections.map((section) => section.title)).toEqual([
      "Everywhere",
      "Actions",
      "After the prefix key",
      "In a prompt",
      "In a list",
      "In a graph",
      "On an element",
    ]);
    const prefix = sections[2]?.rows ?? [];
    expect(prefix.slice(0, PREFIX_BINDINGS.length).map((row) => row.does)).toEqual([
      "Create element",
      "Create relation",
      "Set status",
      "Confirm hints",
      "List all elements",
      "Show overview",
      "Filter list by type",
      "Sort list",
      "Close buffer",
    ]);
    expect(prefix[0]).toEqual({ keys: ["Ctrl+K E"], mac: ["⌘K E"], does: "Create element" });
    const element = sections[6]?.rows ?? [];
    expect(element.find((row) => row.does.startsWith("Redo"))).toMatchObject({
      keys: ["Ctrl+Shift+Z", "Ctrl+Y"],
      mac: ["⌘⇧Z"],
    });
  });

  it("gives actions that share a key one row, and a key that works only in the buffer as the action writes it", () => {
    const actions = shortcutReference(COMMANDS)[1]?.rows ?? [];
    expect(actions).toContainEqual({
      keys: ["Ctrl+J"],
      mac: ["⌘J"],
      does: "Show neighbourhood / Show element",
    });
    expect(actions).toContainEqual({ keys: ["Enter"], mac: ["Enter"], does: "Edit text" });
    expect(actions.some((row) => row.does === "Close all buffers")).toBe(false);
  });

  it("names a command by the action that covers it, and refuses a letter that runs nothing", () => {
    const covered = shortcutReference([{ name: "element.create", title: "Show overview" }], {
      ...SHORTCUT_TABLES,
      actions: ACTIONS,
      bindings: [{ key: "e", id: "command:element.create" }],
    });
    expect(covered[2]?.rows[0]?.does).toBe("Show overview");
    expect(() =>
      shortcutReference(COMMANDS, { ...SHORTCUT_TABLES, bindings: [{ key: "x", id: "command:no.such" }] }),
    ).toThrow("keyboard reference: the prefix key names command:no.such");
  });
});
