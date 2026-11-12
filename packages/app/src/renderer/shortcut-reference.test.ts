import { describe, expect, it } from "vitest";
import { ACTIONS } from "./actions.js";
import { PREFIX_BINDINGS, PREFIX_KEYS, prefixLabel, prefixStep } from "./bindings.js";
import {
  ELEMENT_MORE_KEYS,
  FIELD_CTRL_KEYS,
  FIELD_KEYS,
  PACKAGE_KEYS,
  fieldKey,
  onDiskKey,
} from "./element-keys.js";
import { BOX_KEYS, EDITOR_KEYS, codeMirrorPress } from "./editor/editor-keys.js";
import {
  DEPTH_LESS,
  DEPTH_MORE,
  GRAPH_KEYS,
  GRAPH_MORE_KEYS,
  GRAPH_MOVES,
  LINK_BACK,
  LINK_NEXT,
} from "./graph-nav.js";
import type { KeyPress, KeyRow, KeySpec } from "./keys.js";
import {
  HISTORY_KEYS,
  LIST_MOVES,
  PROMPT_MOVES,
  MOD_CLICK,
  CLICK,
  ctrlStep,
  historyStep,
  leavesPart,
  isModClick,
  isPlainClick,
  keySpecLabel,
  listStep,
  matches,
  press,
  pressLabel,
  rowTarget,
  shortcutLabel,
} from "./keys.js";
import { MORE_SHORTCUT, PROMPT_KEYS } from "./prompt-keys.js";
import { docsTopic } from "./docs-help.js";
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

  it("lists Ctrl+N and Ctrl+P on a field, the physical Ctrl key on every platform (ctrlStep)", () => {
    for (const mac of [false, true]) {
      expect(pressesOf(FIELD_CTRL_KEYS, mac).map(ctrlStep)).toEqual([1, -1]);
    }
  });

  it("lists the keys between the editors, the Emacs keys on every platform (boxNavigation)", () => {
    expect(BOX_KEYS.map((row) => row.keys.map((spec) => keySpecLabel(spec, false)))).toEqual([
      ["Down", "Ctrl+N"],
      ["Up", "Ctrl+P"],
    ]);
    expect(BOX_KEYS.map((row) => row.keys.map((spec) => keySpecLabel(spec, true)))).toEqual([
      ["Down", "⌃N"],
      ["Up", "⌃P"],
    ]);
  });

  it("lists the depth keys and the link keys of the graph", () => {
    expect(pressesOf(GRAPH_MORE_KEYS, false).map((event) => event.key)).toEqual([
      "Enter",
      DEPTH_MORE,
      DEPTH_LESS,
      LINK_NEXT,
      LINK_BACK,
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

  it("lists the plain click on the value of a choice box (isPlainClick) as Click", () => {
    expect(
      ELEMENT_MORE_KEYS.some((row) => row.keys.some((spec) => "shortcut" in spec && spec.shortcut === CLICK)),
    ).toBe(true);
    for (const mac of [false, true]) {
      const click = { ...eventOf({ shortcut: CLICK }, mac), button: 0 };
      expect(isPlainClick(click)).toBe(true);
      expect(isModClick(click, mac)).toBe(false);
      expect(keySpecLabel({ shortcut: CLICK }, mac)).toBe("Click");
    }
  });

  it("writes the slash menu's keys as CodeMirror names them", () => {
    expect(codeMirrorPress("Ctrl-n")).toEqual(press("n", true));
    expect(codeMirrorPress("Tab")).toEqual(press("Tab"));
    expect(EDITOR_KEYS[2]?.keys.map((spec) => keySpecLabel(spec, true))).toEqual(["Down", "Tab", "⌃N"]);
  });

  it("moves the graph with the keys of its table", () => {
    expect(GRAPH_MOVES).toEqual(pressesOf(GRAPH_KEYS, false).map((event) => event.key));
  });

  it("lists what the prefix does with a second Ctrl/Cmd+K, Escape, the moves and Enter (prefixStep)", () => {
    for (const mac of [false, true]) {
      expect(pressesOf(PREFIX_KEYS, mac).map((event) => prefixStep(event, mac).kind)).toEqual([
        "show",
        "cancel",
        "move",
        "move",
        "move",
        "move",
        "enter",
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
      "In the context menu",
      "In a list",
      "In a graph",
      "On an element",
      "In the text editor",
      "Actions without a key",
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
    const element = sections[7]?.rows ?? [];
    expect(element.find((row) => row.does.startsWith("Redo"))).toMatchObject({
      keys: ["Ctrl+Shift+Z", "Ctrl+Y"],
      mac: ["⌘⇧Z"],
    });
  });

  it("[SR-193/AK-wyfx] names Tab for folding in the text, the neighbourhood tree and a line with a whole reason", () => {
    const sections = shortcutReference(COMMANDS);
    const tabRows = (title: string): string[] =>
      (sections.find((section) => section.title === title)?.rows ?? [])
        .filter((row) => row.keys.includes("Tab") && row.mac.includes("Tab"))
        .map((row) => row.does);
    expect(tabRows("In the text editor").some((does) => does.includes("fold the section"))).toBe(true);
    expect(tabRows("In a list").some((does) => does.includes("tree row"))).toBe(true);
    expect(tabRows("On an element").some((does) => does.includes("whole reason"))).toBe(true);
  });

  it("gives actions that share a key one row, and leaves the keys of a buffer (hints) to its section", () => {
    const actions = shortcutReference(COMMANDS)[1]?.rows ?? [];
    expect(actions).toContainEqual({
      keys: ["Ctrl+J"],
      mac: ["⌘J"],
      does: "Show neighbourhood / Show element",
      // Of actions with different titles, each description is named by its title; "Show neighbourhood" runs a
      // catalog command and has none of its own.
      description: "Show element: Show the element of the shown neighbourhood again.",
      actions: ["neighbourhood", "neighbourhood-back"],
    });
    expect(actions.some((row) => row.does === "Edit text" || row.does === "Graph depth")).toBe(false);
    expect(actions.some((row) => row.does === "Close all buffers")).toBe(false);
  });

  it("[SR-139/AK-kdr8] [SR-141/AK-c1s5] anchors each action at its first row, a keyless one too, for F1 on it in the command prompt", () => {
    const sections = shortcutReference(COMMANDS);
    const anchors = sections.flatMap((section) => section.rows.flatMap((row) => row.actions ?? []));
    expect(new Set(anchors).size).toBe(anchors.length);
    // Every action F1 sends as itself (no command page of its own) has its anchor, a keyless one too.
    const own = ACTIONS.filter((candidate) => docsTopic(candidate.id, COMMANDS) === candidate.id);
    expect(own.length).toBeGreaterThan(30);
    for (const candidate of own) {
      expect(anchors, candidate.id).toContain(candidate.id);
    }
    // The row of each such action names it, with its key where it has one (SR-139 AK6).
    const rows = sections.flatMap((section) => section.rows);
    for (const candidate of own) {
      const at = rows.find((row) => row.actions?.includes(candidate.id) === true);
      expect(at?.does, candidate.id).toContain(candidate.title);
      // Its own key on Windows and Linux and on macOS: its shortcut, else its letter after the prefix key;
      // none where it has neither.
      const letter = PREFIX_BINDINGS.find((binding) => binding.id === candidate.id)?.key;
      const own = (mac: boolean): string[] => [
        ...(candidate.shortcut === undefined ? [] : [shortcutLabel(candidate.shortcut, mac)]),
        ...(letter === undefined ? [] : [prefixLabel(letter, mac)]),
      ];
      expect(at?.keys, candidate.id).toEqual(own(false));
      expect(at?.mac, candidate.id).toEqual(own(true));
    }
    const keyless = sections.at(-1)?.rows ?? [];
    expect(keyless.find((row) => row.actions?.includes("close-all") === true)).toEqual({
      keys: [],
      mac: [],
      does: "Close all buffers",
      description: "Close every buffer except the overview.",
      actions: ["close-all"],
    });
    expect(keyless.some((row) => row.actions?.includes("open-documentation") === true)).toBe(true);
    // An action with a key and with a letter after the prefix key is anchored at its key.
    expect(anchors).toContain("search");
    // An action with a letter only is anchored after the prefix key; a command there is not an action.
    const prefix = sections[2]?.rows ?? [];
    expect(prefix.find((row) => row.does === "Close buffer")?.actions).toEqual(["close"]);
    expect(prefix.find((row) => row.does === "Create element")?.actions).toBeUndefined();
  });

  it("[SR-139/AK-kdr8] names each action of the app with its description in the row it is anchored at", () => {
    const rows = shortcutReference(COMMANDS).flatMap((section) => section.rows);
    // As the command prompt shows it (SR-210 AK6).
    for (const candidate of ACTIONS.filter((action) => action.description !== undefined)) {
      const at = rows.find((row) => row.actions?.includes(candidate.id) === true);
      expect(at?.description, candidate.id).toContain(candidate.description);
    }
    // Actions of one title that share a row and a description name it once.
    const twice = shortcutReference(COMMANDS, {
      ...SHORTCUT_TABLES,
      actions: [
        { id: "a", title: "Same", description: "Does it.", available: () => true, run: () => undefined },
        { id: "b", title: "Same", description: "Does it.", available: () => true, run: () => undefined },
        { id: "c", title: "Plain", available: () => true, run: () => undefined },
      ],
      bindings: [],
    });
    expect(twice.at(-1)?.rows).toEqual([
      { keys: [], mac: [], does: "Same", description: "Does it.", actions: ["a", "b"] },
      { keys: [], mac: [], does: "Plain", actions: ["c"] },
    ]);
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
