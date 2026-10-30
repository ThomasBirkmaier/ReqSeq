import { describe, expect, it, vi } from "vitest";
import type { Choice } from "./actions.js";
import type { PrefixPress } from "./bindings.js";
import {
  MOST_FREQUENT,
  PREFIX,
  PREFIX_BINDINGS,
  PREFIX_DELAY_MS,
  SINGLE_KEY_IDS,
  bindingLabel,
  nextKeys,
  prefixLabel,
  prefixStep,
  prefixWaiting,
} from "./bindings.js";

const press = (key: string, extra: Partial<PrefixPress> = {}): PrefixPress => ({
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  key,
  ...extra,
});

describe("the prefix key and its letters (#472)", () => {
  it("is Ctrl+K, or Cmd+K on macOS, and waits half a second", () => {
    expect(PREFIX).toEqual({ mod: true, shift: false, key: "k" });
    expect(PREFIX_DELAY_MS).toBe(500);
  });

  it("writes a letter after the prefix as each platform writes a shortcut", () => {
    expect(prefixLabel("l", false)).toBe("Ctrl+K L");
    expect(prefixLabel("l", true)).toBe("⌘K L");
    expect(prefixWaiting(false)).toBe("Ctrl+K-");
    expect(prefixWaiting(true)).toBe("⌘K-");
  });

  it("gives the label of a bound entry and none for another", () => {
    expect(bindingLabel("list-all", false)).toBe("Ctrl+K L");
    expect(bindingLabel("command:element.create", true)).toBe("⌘K E");
    expect(bindingLabel("go-to", false)).toBeUndefined();
  });

  it("names the most frequent commands: the single shortcuts and the letters, once each", () => {
    expect(MOST_FREQUENT).toEqual([...SINGLE_KEY_IDS, ...PREFIX_BINDINGS.map((row) => row.id)]);
    expect(new Set(MOST_FREQUENT).size).toBe(MOST_FREQUENT.length);
    const letters = PREFIX_BINDINGS.map((row) => row.key);
    expect(new Set(letters).size).toBe(letters.length);
    for (const letter of letters) {
      expect(letter).toMatch(/^[a-z]$/);
    }
  });
});

describe("the key after the prefix", () => {
  it("ignores a modifier alone, a composing input method and a held K", () => {
    for (const key of ["Control", "Meta", "Shift", "Alt", "AltGraph", "CapsLock", "OS"]) {
      expect(prefixStep(press(key), false)).toEqual({ kind: "ignore" });
    }
    expect(prefixStep(press("Process", { isComposing: true, code: "KeyL" }), false)).toEqual({
      kind: "ignore",
    });
    expect(prefixStep(press("k", { ctrlKey: true, repeat: true }), false)).toEqual({ kind: "ignore" });
    expect(prefixStep(press("k", { metaKey: true, repeat: true }), true)).toEqual({ kind: "ignore" });
  });

  it("shows the next keys at once on a second Ctrl/Cmd+K", () => {
    expect(prefixStep(press("k", { ctrlKey: true }), false)).toEqual({ kind: "show" });
    expect(prefixStep(press("k", { metaKey: true }), true)).toEqual({ kind: "show" });
  });

  it("ends on Escape", () => {
    expect(prefixStep(press("Escape"), false)).toEqual({ kind: "cancel" });
  });

  it("takes a Latin letter bare or with the prefix modifier held", () => {
    const l = { kind: "letter", letter: "l", label: "Ctrl+K L" };
    expect(prefixStep(press("l"), false)).toEqual(l);
    expect(prefixStep(press("l", { ctrlKey: true }), false)).toEqual(l);
    expect(prefixStep(press("l", { metaKey: true }), false)).toEqual(l);
    expect(prefixStep(press("l", { metaKey: true }), true)).toEqual({
      kind: "letter",
      letter: "l",
      label: "⌘K L",
    });
    expect(prefixStep(press("l"), true)).toEqual({ kind: "letter", letter: "l", label: "⌘K L" });
    // CapsLock: an upper-case letter without Shift is the letter.
    expect(prefixStep(press("L"), false)).toEqual(l);
    // A non-Latin layout: the place of the key gives the letter.
    expect(prefixStep(press("д", { code: "KeyL" }), false)).toEqual(l);
  });

  it("[SR-145/AK1] does not take a letter with Shift, with Alt, or with the physical Ctrl key on macOS", () => {
    expect(prefixStep(press("L", { shiftKey: true }), false)).toEqual({
      kind: "unbound",
      label: "Ctrl+K Shift+L",
    });
    expect(prefixStep(press("n", { altKey: true }), false)).toEqual({
      kind: "unbound",
      label: "Ctrl+K Alt+N",
    });
    // Option+N on macOS is a dead key; its place names it.
    expect(prefixStep(press("Dead", { altKey: true, code: "KeyN" }), true)).toEqual({
      kind: "unbound",
      label: "⌘K ⌥N",
    });
    expect(prefixStep(press("l", { ctrlKey: true }), true)).toEqual({ kind: "unbound", label: "⌘K ⌃L" });
    expect(prefixStep(press("L", { metaKey: true, shiftKey: true }), true)).toEqual({
      kind: "unbound",
      label: "⌘K ⌘⇧L",
    });
  });

  it("writes any other key by its name", () => {
    expect(prefixStep(press("5", { code: "Digit5" }), false)).toEqual({
      kind: "unbound",
      label: "Ctrl+K 5",
    });
    expect(prefixStep(press("ArrowDown"), false)).toEqual({ kind: "unbound", label: "Ctrl+K ArrowDown" });
    expect(prefixStep(press("Enter"), false)).toEqual({ kind: "unbound", label: "Ctrl+K Enter" });
    expect(prefixStep(press(" ", { code: "Space" }), false)).toEqual({
      kind: "unbound",
      label: "Ctrl+K Space",
    });
    expect(prefixStep(press("p", { ctrlKey: true, shiftKey: true }), false)).toEqual({
      kind: "unbound",
      label: "Ctrl+K Ctrl+Shift+P",
    });
  });
});

describe("the next keys", () => {
  const item = (id: string, name: string): Choice => ({ id, name, run: vi.fn() });

  it("lists the rows whose entry the prompt offers, in the order of the table", () => {
    const items = [
      item("close", "Close buffer"),
      item("go-to", "Go to element or buffer"),
      item("list-all", "List all elements"),
      item("command:element.create", "Create element"),
    ];
    const rows = nextKeys(items);
    expect(rows.map(({ key, name }) => [key, name])).toEqual([
      ["E", "Create element"],
      ["L", "List all elements"],
      ["B", "Close buffer"],
    ]);
    rows[1]?.run();
    expect(items[2]?.run).toHaveBeenCalledOnce();
  });

  it("lists none when the prompt offers none of them", () => {
    expect(nextKeys([item("go-to", "Go to element or buffer")])).toEqual([]);
  });
});
