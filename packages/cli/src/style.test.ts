import { stripVTControlCharacters, styleText } from "node:util";
import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMNS, PLAIN, cut, padTo, styleOf, terminalOf, widthOf } from "./style.js";

describe("style of the output for people (#988)", () => {
  it("styles for a terminal only, not for a pipe or with NO_COLOR", () => {
    const hasColors = (): boolean => true;
    expect(terminalOf({ isTTY: true, columns: 120, hasColors }, {})).toEqual({ columns: 120, colors: true });
    expect(terminalOf({ isTTY: true }, {})).toEqual({ columns: DEFAULT_COLUMNS, colors: false });
    expect(terminalOf({ isTTY: true, columns: 0 }, {})).toEqual({ columns: DEFAULT_COLUMNS, colors: false });
    // An empty NO_COLOR counts as not set (no-color.org).
    expect(terminalOf({ isTTY: true, columns: 120, hasColors }, { NO_COLOR: "" })).toEqual({
      columns: 120,
      colors: true,
    });
    expect(terminalOf({ isTTY: true, columns: 120, hasColors }, { NO_COLOR: "1" })).toBeUndefined();
    expect(terminalOf({ isTTY: true, columns: 120, hasColors }, { TERM: "dumb" })).toBeUndefined();
    expect(terminalOf({ isTTY: false, columns: 120, hasColors }, {})).toBeUndefined();
    expect(terminalOf({}, {})).toBeUndefined();
  });

  it("decides the colours apart from the layout, by what the terminal has for the environment", () => {
    // Node's hasColors reads FORCE_COLOR, NODE_DISABLE_COLORS and TERM from the env it is given.
    const seen: unknown[] = [];
    const none = (env: unknown): boolean => {
      seen.push(env);
      return false;
    };
    const env = { FORCE_COLOR: "0" };
    expect(terminalOf({ isTTY: true, columns: 50, hasColors: none }, env)).toEqual({
      columns: 50,
      colors: false,
    });
    expect(seen).toEqual([env]);
    // The switch for NO_COLOR: the layout without colours.
    expect(terminalOf({ isTTY: true, columns: 50, hasColors: () => true }, { NO_COLOR: "1" }, true)).toEqual({
      columns: 50,
      colors: false,
    });
    // Without colours the style lays out only.
    const plain = styleOf({ columns: 50, colors: false });
    expect(plain.width).toBe(50);
    expect(plain.strong("a")).toBe("a");
    expect(plain.faint("a")).toBe("a");
    expect(plain.severity("error", "e")).toBe("e");
  });

  it("leaves plain text as it is and never cuts it", () => {
    expect(styleOf(undefined)).toBe(PLAIN);
    expect(PLAIN.strong("a")).toBe("a");
    expect(PLAIN.faint("a")).toBe("a");
    expect(PLAIN.severity("error", "error")).toBe("error");
    expect(PLAIN.width).toBe(Number.POSITIVE_INFINITY);
  });

  it("styles with util.styleText on a terminal, whatever the stream of this process is", () => {
    const style = styleOf({ columns: 40, colors: true });
    const styled = (format: Parameters<typeof styleText>[0], text: string): string =>
      styleText(format, text, { validateStream: false });
    expect(style.width).toBe(40);
    expect(style.strong("a")).toBe(styled("bold", "a"));
    expect(style.strong("a")).not.toBe("a");
    expect(style.faint("a")).toBe(styled("dim", "a"));
    expect(style.faint("")).toBe("");
    expect(style.severity("error", "e")).toBe(styled(["bold", "red"], "e"));
    expect(style.severity("warning", "w")).toBe(styled("yellow", "w"));
    expect(style.severity("info", "i")).toBe(styled("cyan", "i"));
    expect(style.severity("toString", "t")).toBe("t");
  });

  it("measures and cuts text by the characters a reader sees", () => {
    expect(widthOf(styleText("bold", "abc", { validateStream: false }))).toBe(3);
    expect(widthOf("a👍🏽b")).toBe(3);
    expect(cut("abcdef", 6)).toBe("abcdef");
    expect(cut("abcdef", 4)).toBe("abc…");
    expect(cut("abcdef", 0)).toBe("…");
    expect(cut("a👍🏽bcd", 3)).toBe("a👍🏽…");
    // Longer in UTF-16 units than the room, but not in graphemes.
    expect(cut("👍🏽👍🏽", 2)).toBe("👍🏽👍🏽");
    expect(stripVTControlCharacters(padTo(styleText("dim", "ab", { validateStream: false }), 4))).toBe(
      "ab  ",
    );
    expect(padTo("abcdef", 4)).toBe("abcdef");
  });
});
