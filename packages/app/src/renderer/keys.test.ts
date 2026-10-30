import { describe, expect, it } from "vitest";
import {
  ctrlStep,
  historyStep,
  isMac,
  isModClick,
  listStep,
  matches,
  rowStep,
  rowTarget,
  shortcutLabel,
} from "./keys.js";

const press = (
  key: string,
  extra: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> & {
    readonly code?: string;
    readonly isComposing?: boolean;
  } = {},
) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...extra,
});

describe("keys", () => {
  const palette = { mod: true, shift: true, key: "p" };

  it("matches Ctrl or Cmd with the letter in any case, and the exact modifiers", () => {
    expect(matches(press("P", { ctrlKey: true, shiftKey: true }), palette, false)).toBe(true);
    expect(matches(press("p", { metaKey: true, shiftKey: true }), palette, false)).toBe(true);
    expect(matches(press("P", { shiftKey: true }), palette, false)).toBe(false);
    expect(matches(press("p", { ctrlKey: true }), palette, false)).toBe(false);
    expect(matches(press("p", { ctrlKey: true, shiftKey: true, altKey: true }), palette, false)).toBe(false);
    expect(matches(press("f", { ctrlKey: true, shiftKey: true }), palette, false)).toBe(false);
    expect(matches(press("p", { ctrlKey: true }), { mod: true, shift: false, key: "p" }, false)).toBe(true);
  });

  it("[SR-145/AK1] under macOS the modifier is Cmd only: the physical Ctrl key with a letter is no shortcut, so Ctrl+P does not jump", () => {
    const goTo = { mod: true, shift: false, key: "p" };
    const next = { mod: false, shift: false, alt: true, key: "n" };
    // Cmd+P jumps, Cmd+Shift+P is the command prompt, Cmd+Option+A adds a property.
    expect(matches(press("p", { metaKey: true }), goTo, true)).toBe(true);
    expect(matches(press("p", { metaKey: true, shiftKey: true }), { ...goTo, shift: true }, true)).toBe(true);
    expect(
      matches(
        press("å", { metaKey: true, altKey: true, code: "KeyA" }),
        { ...goTo, alt: true, key: "a" },
        true,
      ),
    ).toBe(true);
    // The physical Ctrl key: the caret keys of the editor and the row keys of a list, never a shortcut.
    expect(matches(press("p", { ctrlKey: true }), goTo, true)).toBe(false);
    expect(matches(press("p", { ctrlKey: true, shiftKey: true }), { ...goTo, shift: true }, true)).toBe(
      false,
    );
    expect(matches(press("p", { ctrlKey: true, metaKey: true }), goTo, true)).toBe(false);
    expect(matches(press("Dead", { ctrlKey: true, altKey: true, code: "KeyN" }), next, true)).toBe(false);
    // Option+N alone switches the buffer; a shortcut without the modifier is no Cmd shortcut.
    expect(matches(press("Dead", { altKey: true, code: "KeyN" }), next, true)).toBe(true);
    expect(matches(press("p"), goTo, true)).toBe(false);
    // Linux and Windows: Ctrl+P still jumps.
    expect(matches(press("p", { ctrlKey: true }), goTo, false)).toBe(true);
  });

  it("matches Alt (Option) only when the shortcut has it; Cmd+Option counts the physical key, Ctrl+Alt (AltGr) does not", () => {
    const add = { mod: true, shift: false, alt: true, key: "a" };
    expect(matches(press("a", { ctrlKey: true, altKey: true }), add, false)).toBe(true);
    expect(matches(press("a", { metaKey: true, altKey: true }), add, false)).toBe(true);
    expect(matches(press("å", { metaKey: true, altKey: true, code: "KeyA" }), add, false)).toBe(true);
    expect(matches(press("ą", { ctrlKey: true, altKey: true, code: "KeyA" }), add, false)).toBe(false);
    expect(matches(press("å", { metaKey: true, altKey: true, code: "KeyB" }), add, false)).toBe(false);
    expect(matches(press("a", { ctrlKey: true }), add, false)).toBe(false);
    expect(matches(press("a", { ctrlKey: true, altKey: true, shiftKey: true }), add, false)).toBe(false);
    expect(
      matches(
        press("å", { metaKey: true, altKey: true, code: "KeyA" }),
        {
          mod: true,
          shift: false,
          key: "a",
        },
        false,
      ),
    ).toBe(false);
  });

  it("[SR-115/AK5] [SR-145/AK2] Alt+N and Alt+P match by the letter on Linux and Windows, and by the physical key under macOS, where Option types a character", () => {
    const next = { mod: false, shift: false, alt: true, key: "n" };
    const previous = { mod: false, shift: false, alt: true, key: "p" };
    // Linux and Windows: the letter.
    expect(matches(press("n", { altKey: true, code: "KeyN" }), next, false)).toBe(true);
    expect(matches(press("p", { altKey: true }), previous, false)).toBe(true);
    // macOS: Option+N is the dead key of "~", Option+P is "π"; the physical key counts.
    expect(matches(press("Dead", { altKey: true, code: "KeyN" }), next, false)).toBe(true);
    expect(matches(press("π", { altKey: true, code: "KeyP" }), previous, false)).toBe(true);
    expect(matches(press("Dead", { altKey: true, code: "KeyU" }), next, false)).toBe(false);
    expect(matches(press("Dead", { altKey: true }), next, false)).toBe(false);
    // A non-Latin layout on Linux (Russian Alt+N is "т"): the physical key.
    expect(matches(press("т", { altKey: true, code: "KeyN" }), next, false)).toBe(true);
    // Dvorak on Linux: the letter, not the place ("b" lies where QWERTY has N; "n" where it has L).
    expect(matches(press("b", { altKey: true, code: "KeyN" }), next, false)).toBe(false);
    expect(matches(press("n", { altKey: true, code: "KeyL" }), next, false)).toBe(true);
    // An input method that composes keeps the key.
    expect(matches(press("Process", { altKey: true, code: "KeyN", isComposing: true }), next, false)).toBe(
      false,
    );
  });

  it("[SR-115/AK5] Alt+N is Alt alone: Ctrl+Alt (AltGr), Cmd+Option, Shift or no Alt do not count", () => {
    const next = { mod: false, shift: false, alt: true, key: "n" };
    expect(matches(press("ñ", { ctrlKey: true, altKey: true, code: "KeyN" }), next, false)).toBe(false);
    expect(matches(press("n", { ctrlKey: true, altKey: true, code: "KeyN" }), next, false)).toBe(false);
    expect(matches(press("Dead", { metaKey: true, altKey: true, code: "KeyN" }), next, false)).toBe(false);
    expect(matches(press("N", { altKey: true, shiftKey: true, code: "KeyN" }), next, false)).toBe(false);
    expect(matches(press("n", { code: "KeyN" }), next, false)).toBe(false);
    expect(matches(press("n", { ctrlKey: true, code: "KeyN" }), next, false)).toBe(false);
    // Ctrl+Alt+... shortcuts keep their rule: "ñ" with Ctrl+Alt is no Ctrl+Alt+N.
    expect(
      matches(press("ñ", { ctrlKey: true, altKey: true, code: "KeyN" }), { ...next, mod: true }, false),
    ).toBe(false);
  });

  it("[SR-115/AK5] writes Alt+N as Linux and Windows do and as ⌥N on macOS", () => {
    expect(shortcutLabel({ mod: false, shift: false, alt: true, key: "n" }, false)).toBe("Alt+N");
    expect(shortcutLabel({ mod: false, shift: false, alt: true, key: "p" }, true)).toBe("⌥P");
  });

  it("knows macOS by the platform", () => {
    expect(isMac("MacIntel")).toBe(true);
    expect(isMac("Linux x86_64")).toBe(false);
    expect(isMac("Win32")).toBe(false);
  });

  it("[SR-132/AK1] knows Ctrl/Cmd+click with the main button; under macOS only Cmd", () => {
    const click = { button: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
    expect(isModClick({ ...click, ctrlKey: true }, false)).toBe(true);
    expect(isModClick({ ...click, metaKey: true }, false)).toBe(true);
    expect(isModClick({ ...click, metaKey: true }, true)).toBe(true);
    expect(isModClick({ ...click, ctrlKey: true }, true)).toBe(false);
    expect(isModClick({ ...click, ctrlKey: true, metaKey: true }, true)).toBe(false);
    expect(isModClick(click, false)).toBe(false);
    expect(isModClick({ ...click, ctrlKey: true, shiftKey: true }, false)).toBe(false);
    expect(isModClick({ ...click, ctrlKey: true, altKey: true }, false)).toBe(false);
    expect(isModClick({ ...click, ctrlKey: true, button: 1 }, false)).toBe(false);
  });

  it("writes a shortcut the way the platform does", () => {
    expect(shortcutLabel(palette, false)).toBe("Ctrl+Shift+P");
    expect(shortcutLabel(palette, true)).toBe("⌘⇧P");
    expect(shortcutLabel({ mod: true, shift: false, key: "p" }, false)).toBe("Ctrl+P");
    expect(shortcutLabel({ mod: true, shift: false, key: "p" }, true)).toBe("⌘P");
    expect(shortcutLabel({ mod: false, shift: false, key: "x" }, false)).toBe("X");
    expect(shortcutLabel({ mod: false, shift: false, key: "x" }, true)).toBe("X");
    expect(shortcutLabel({ mod: true, shift: false, alt: true, key: "a" }, false)).toBe("Ctrl+Alt+A");
    expect(shortcutLabel({ mod: true, shift: false, alt: true, key: "a" }, true)).toBe("⌥⌘A");
    expect(shortcutLabel({ mod: true, shift: true, alt: true, key: "a" }, false)).toBe("Ctrl+Alt+Shift+A");
  });

  it("writes the Enter key by its name", () => {
    const follow = { mod: true, shift: false, key: "enter" };
    expect(shortcutLabel(follow, false)).toBe("Ctrl+Enter");
    expect(shortcutLabel(follow, true)).toBe("⌘↩");
  });

  it("[SR-122/AK1] Ctrl+N steps down and Ctrl+P steps up, in either case", () => {
    expect(listStep(press("n", { ctrlKey: true }))).toBe(1);
    expect(listStep(press("N", { ctrlKey: true }))).toBe(1);
    expect(listStep(press("p", { ctrlKey: true }))).toBe(-1);
    expect(listStep(press("P", { ctrlKey: true }))).toBe(-1);
  });

  it("[SR-122/AK2] [SR-145/AK3] only the physical Ctrl key counts: Cmd+N/P, Alt, Shift or no modifier give no step", () => {
    expect(listStep(press("n", { metaKey: true }))).toBeUndefined();
    expect(listStep(press("p", { metaKey: true }))).toBeUndefined();
    expect(listStep(press("p", { ctrlKey: true, metaKey: true }))).toBeUndefined();
    expect(listStep(press("p", { ctrlKey: true, altKey: true }))).toBeUndefined();
    expect(listStep(press("p", { ctrlKey: true, shiftKey: true }))).toBeUndefined();
    expect(listStep(press("n", {}))).toBeUndefined();
    expect(listStep(press("x", { ctrlKey: true }))).toBeUndefined();
  });

  it("[SR-122/AK3] the arrow keys and Tab step as before", () => {
    expect(listStep(press("ArrowDown"))).toBe(1);
    expect(listStep(press("Tab"))).toBe(1);
    expect(listStep(press("ArrowUp"))).toBe(-1);
    expect(listStep(press("Enter"))).toBeUndefined();
  });

  it("[SR-122/AK5] [SR-145/AK3] Ctrl+N and Ctrl+P are the physical Ctrl key alone with the letter; Cmd, Shift and AltGr do not count", () => {
    expect(ctrlStep(press("n", { ctrlKey: true }))).toBe(1);
    expect(ctrlStep(press("N", { ctrlKey: true }))).toBe(1);
    expect(ctrlStep(press("p", { ctrlKey: true }))).toBe(-1);
    expect(ctrlStep(press("n", { metaKey: true }))).toBeUndefined();
    expect(ctrlStep(press("p", { metaKey: true }))).toBeUndefined();
    expect(ctrlStep(press("p", { ctrlKey: true, metaKey: true }))).toBeUndefined();
    expect(ctrlStep(press("n", { ctrlKey: true, shiftKey: true }))).toBeUndefined();
    expect(ctrlStep(press("n", { ctrlKey: true, altKey: true }))).toBeUndefined();
    expect(ctrlStep(press("x", { ctrlKey: true }))).toBeUndefined();
    expect(ctrlStep(press("n"))).toBeUndefined();
  });

  it("[SR-122/AK4] a step in a list is Down or Ctrl+N, Up or Ctrl+P; Tab is not a row key", () => {
    expect(rowStep(press("ArrowDown"))).toBe(1);
    expect(rowStep(press("n", { ctrlKey: true }))).toBe(1);
    expect(rowStep(press("ArrowUp"))).toBe(-1);
    expect(rowStep(press("p", { ctrlKey: true }))).toBe(-1);
    expect(rowStep(press("Tab"))).toBeUndefined();
    expect(rowStep(press("Enter"))).toBeUndefined();
  });

  it("[SR-122/AK4] Ctrl+N and Ctrl+P move like Down and Up; with no row selected Ctrl+N and Down go to the first row", () => {
    const ctrl = { ctrlKey: true };
    expect(rowTarget(press("n", ctrl), 3, 10)).toBe(4);
    expect(rowTarget(press("ArrowDown"), 3, 10)).toBe(4);
    expect(rowTarget(press("p", ctrl), 3, 10)).toBe(2);
    expect(rowTarget(press("ArrowUp"), 3, 10)).toBe(2);
    expect(rowTarget(press("n", ctrl), -1, 10)).toBe(0);
    expect(rowTarget(press("ArrowDown"), -1, 10)).toBe(0);
    // The list clamps what is below the first row: Up with none selected selects the first.
    expect(Math.max(0, rowTarget(press("ArrowUp"), -1, 10) ?? NaN)).toBe(0);
    // On the last row Ctrl+N stays the list's key: the list clamps it.
    expect(rowTarget(press("n", ctrl), 9, 10)).toBe(10);
  });

  it("[SR-122/AK5] with a row selected Ctrl+P is the list's, also on the first row; with none, and in a list without rows, it is not", () => {
    const ctrl = { ctrlKey: true };
    expect(rowTarget(press("p", ctrl), 0, 10)).toBe(-1);
    expect(rowTarget(press("p", ctrl), -1, 10)).toBeUndefined();
    expect(rowTarget(press("p", ctrl), 0, 0)).toBeUndefined();
    expect(rowTarget(press("n", ctrl), -1, 0)).toBeUndefined();
    expect(rowTarget(press("p", { metaKey: true }), 3, 10)).toBeUndefined();
    expect(rowTarget(press("n", { metaKey: true }), 3, 10)).toBeUndefined();
    expect(rowTarget(press("p", { ctrlKey: true, shiftKey: true }), 3, 10)).toBeUndefined();
    expect(rowTarget(press("n", { ctrlKey: true, altKey: true }), 3, 10)).toBeUndefined();
  });

  it("moves by a screen with Page Down and Page Up only where the list has one, and to the ends with Home and End", () => {
    expect(rowTarget(press("PageDown"), 3, 50, 10)).toBe(13);
    expect(rowTarget(press("PageUp"), 13, 50, 10)).toBe(3);
    // From no row Page Down lands on the last row of the first screen.
    expect(rowTarget(press("PageDown"), -1, 50, 10)).toBe(9);
    expect(rowTarget(press("PageDown"), 3, 50)).toBeUndefined();
    expect(rowTarget(press("PageUp"), 3, 50)).toBeUndefined();
    expect(rowTarget(press("Home"), -1, 50)).toBe(0);
    expect(rowTarget(press("End"), -1, 50)).toBe(49);
    // Without rows the arrows are still the list's (it clamps them), as before.
    expect(rowTarget(press("ArrowDown"), -1, 0)).toBe(0);
    expect(rowTarget(press("Tab"), 3, 10)).toBeUndefined();
    expect(rowTarget(press("Enter"), 3, 10)).toBeUndefined();
    expect(rowTarget(press("constructor"), 3, 10)).toBeUndefined();
  });
});

describe("historyStep", () => {
  it("[SR-105/AK2] [SR-145/AK1] takes Ctrl/Cmd+Z as undo and Ctrl/Cmd+Shift+Z as redo, Ctrl+Y as redo outside macOS", () => {
    expect(historyStep(press("z", { ctrlKey: true }), false)).toBe("undo");
    expect(historyStep(press("Z", { ctrlKey: true, shiftKey: true }), false)).toBe("redo");
    expect(historyStep(press("y", { ctrlKey: true }), false)).toBe("redo");
    expect(historyStep(press("z", { metaKey: true }), true)).toBe("undo");
    expect(historyStep(press("z", { metaKey: true, shiftKey: true }), true)).toBe("redo");
    expect(historyStep(press("y", { metaKey: true }), true)).toBeUndefined();
    expect(historyStep(press("z", { ctrlKey: true }), true)).toBeUndefined();
    expect(historyStep(press("z"), false)).toBeUndefined();
  });
});
