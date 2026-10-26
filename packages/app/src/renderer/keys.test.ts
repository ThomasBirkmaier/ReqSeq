import { describe, expect, it } from "vitest";
import { isMac, matches, shortcutLabel } from "./keys.js";

const press = (
  key: string,
  extra: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {},
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
  });
});
