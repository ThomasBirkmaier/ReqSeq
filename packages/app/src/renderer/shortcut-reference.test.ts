import { describe, expect, it } from "vitest";
import { ACTIONS } from "./actions.js";
import { PREFIX_BINDINGS, PREFIX_KEYS, prefixStep } from "./bindings.js";
import { ELEMENT_MORE_KEYS, FIELD_KEYS, PACKAGE_KEYS, fieldKey, onDiskKey } from "./element-keys.js";
import { BOX_KEYS, EDITOR_KEYS, codeMirrorPress } from "./editor/editor-keys.js";
import { DEPTH_LESS, DEPTH_MORE, GRAPH_KEYS, GRAPH_MORE_KEYS, GRAPH_MOVES } from "./graph-nav.js";
import type { KeyPress, KeyRow, KeySpec } from "./keys.js";
import {
  HISTORY_KEYS,
  LIST_MOVES,
  PROMPT_MOVES,
  MOD_CLICK,
  ctrlStep,
  historyStep,
  leavesPart,
  isModClick,
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
    expect(pressLabel(press("Enter"), true)).toBe("↩");
    expect(pressLabel(press("Enter"), false)).toBe("Enter");
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

  it("lists exactly the keys the element buffer takes on a field (fieldKey), all without a modifier", () => {
    const listed = pressesOf(FIELD_KEYS, false);
    for (const mac of [false, true]) {
      expect(pressesOf(FIELD_KEYS, mac)).toEqual(listed);
    }
    for (const event of listed) {
      expect([event.ctrlKey, event.metaKey, event.altKey, event.shiftKey], event.key).toEqual([
        false,
        false,
        false,
        false,
      ]);
    }
    for (const key of ["Enter", "ArrowDown", "ArrowUp", "Escape", "ArrowLeft", "Tab", "Home", "a"]) {
      expect(fieldKey(key, "title"), key).toBe(listed.some((event) => event.key === key));
    }
  });

  it("lists the keys into and out of the elements of a package page (ctrlStep, leavesPart)", () => {
    const [into, out] = PACKAGE_KEYS;
    for (const mac of [false, true]) {
      expect(pressesOf(into === undefined ? [] : [into], mac).map(ctrlStep)).toEqual([1]);
      for (const event of pressesOf(out === undefined ? [] : [out], mac)) {
        expect(leavesPart(event, 0), event.key).toBe(true);
      }
    }
    expect(leavesPart(press("ArrowUp"), 1)).toBe(false);
    expect(leavesPart(press("ArrowDown"), 0)).toBe(false);
  });

  it("lists the keys between the editors, the Emacs keys on macOS only (boxNavigation)", () => {
    expect(BOX_KEYS.map((row) => row.keys.map((spec) => keySpecLabel(spec, false)))).toEqual([
      ["Down", undefined],
      ["Up", undefined],
    ]);
    expect(BOX_KEYS.map((row) => row.keys.map((spec) => keySpecLabel(spec, true)))).toEqual([
      ["Down", "⌃N"],
      ["Up", "⌃P"],
    ]);
  });

  it("lists the depth keys of the graph", () => {
    expect(pressesOf(GRAPH_MORE_KEYS, false).map((event) => event.key)).toEqual([
      "Enter",
      DEPTH_MORE,
      DEPTH_LESS,
    ]);
  });

  it("lists Enter and Escape of the block On disk (onDiskKey) and the click on a value (isModClick)", () => {
    const [resolve, leave] = ELEMENT_MORE_KEYS;
    expect(pressesOf(resolve === undefined ? [] : [resolve], false).map(onDiskKey)).toEqual(["resolve"]);
    expect(pressesOf(leave === undefined ? [] : [leave], false).map(onDiskKey)).toEqual(["leave"]);
    expect(onDiskKey({ ...press("Enter"), shiftKey: true })).toBeUndefined();
    expect(onDiskKey(press("a"))).toBeUndefined();
    for (const mac of [false, true]) {
      expect(isModClick({ ...eventOf({ shortcut: MOD_CLICK }, mac), button: 0 }, mac)).toBe(true);
    }
    expect(keySpecLabel({ shortcut: MOD_CLICK }, false)).toBe("Ctrl+Click");
    expect(keySpecLabel({ shortcut: MOD_CLICK }, true)).toBe("⌘Click");
  });

  it("writes the slash menu's keys as CodeMirror names them", () => {
    expect(codeMirrorPress("Ctrl-n")).toEqual(press("n", true));
    expect(codeMirrorPress("Tab")).toEqual(press("Tab"));
    expect(EDITOR_KEYS[2]?.keys.map((spec) => keySpecLabel(spec, true))).toEqual(["Down", "Tab", "⌃N"]);
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
      "In the text editor",
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

  it("gives actions that share a key one row, and leaves the keys of a buffer (hints) to its section", () => {
    const actions = shortcutReference(COMMANDS)[1]?.rows ?? [];
    expect(actions).toContainEqual({
      keys: ["Ctrl+J"],
      mac: ["⌘J"],
      does: "Show neighbourhood / Show element",
    });
    expect(actions.some((row) => row.does === "Edit text" || row.does === "Graph depth")).toBe(false);
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
