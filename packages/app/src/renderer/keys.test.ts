import { describe, expect, it } from "vitest";
import { isMac, listStep, matches, shortcutLabel } from "./keys.js";

const press = (
  key: string,
  extra: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> & {
    readonly code?: string;
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
    expect(matches(press("P", { ctrlKey: true, shiftKey: true }), palette)).toBe(true);
    expect(matches(press("p", { metaKey: true, shiftKey: true }), palette)).toBe(true);
    expect(matches(press("P", { shiftKey: true }), palette)).toBe(false);
    expect(matches(press("p", { ctrlKey: true }), palette)).toBe(false);
    expect(matches(press("p", { ctrlKey: true, shiftKey: true, altKey: true }), palette)).toBe(false);
    expect(matches(press("f", { ctrlKey: true, shiftKey: true }), palette)).toBe(false);
    expect(matches(press("p", { ctrlKey: true }), { mod: true, shift: false, key: "p" })).toBe(true);
  });

  it("matches Alt (Option) only when the shortcut has it; Cmd+Option counts the physical key, Ctrl+Alt (AltGr) does not", () => {
    const add = { mod: true, shift: false, alt: true, key: "a" };
    expect(matches(press("a", { ctrlKey: true, altKey: true }), add)).toBe(true);
    expect(matches(press("a", { metaKey: true, altKey: true }), add)).toBe(true);
    expect(matches(press("å", { metaKey: true, altKey: true, code: "KeyA" }), add)).toBe(true);
    expect(matches(press("ą", { ctrlKey: true, altKey: true, code: "KeyA" }), add)).toBe(false);
    expect(matches(press("å", { metaKey: true, altKey: true, code: "KeyB" }), add)).toBe(false);
    expect(matches(press("a", { ctrlKey: true }), add)).toBe(false);
    expect(matches(press("a", { ctrlKey: true, altKey: true, shiftKey: true }), add)).toBe(false);
    expect(
      matches(press("å", { metaKey: true, altKey: true, code: "KeyA" }), {
        mod: true,
        shift: false,
        key: "a",
      }),
    ).toBe(false);
  });

  it("knows macOS by the platform", () => {
    expect(isMac("MacIntel")).toBe(true);
    expect(isMac("Linux x86_64")).toBe(false);
    expect(isMac("Win32")).toBe(false);
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

  it("[SR-122/AK2] only the physical Ctrl key counts: Cmd+N/P, Alt, Shift or no modifier give no step", () => {
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
});
