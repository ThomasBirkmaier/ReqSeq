import { stripVTControlCharacters, styleText } from "node:util";
import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMNS, PLAIN, cut, padTo, styleOf, terminalOf, widthOf } from "./style.js";

describe("style of the output for people (#988)", () => {
  it("styles for a terminal only, not for a pipe or with NO_COLOR", () => {
    expect(terminalOf({ isTTY: true, columns: 120 }, {})).toEqual({ columns: 120 });
    expect(terminalOf({ isTTY: true }, {})).toEqual({ columns: DEFAULT_COLUMNS });
    expect(terminalOf({ isTTY: true, columns: 0 }, {})).toEqual({ columns: DEFAULT_COLUMNS });
    // An empty NO_COLOR counts as not set (no-color.org).
    expect(terminalOf({ isTTY: true, columns: 120 }, { NO_COLOR: "" })).toEqual({ columns: 120 });
    expect(terminalOf({ isTTY: true, columns: 120 }, { NO_COLOR: "1" })).toBeUndefined();
    expect(terminalOf({ isTTY: false, columns: 120 }, {})).toBeUndefined();
    expect(terminalOf({}, {})).toBeUndefined();
  });

  it("leaves plain text as it is and never cuts it", () => {
    expect(styleOf(undefined)).toBe(PLAIN);
    expect(PLAIN.strong("a")).toBe("a");
    expect(PLAIN.faint("a")).toBe("a");
    expect(PLAIN.severity("error", "error")).toBe("error");
    expect(PLAIN.width).toBe(Number.POSITIVE_INFINITY);
  });

  it("styles with util.styleText on a terminal, whatever the stream of this process is", () => {
    const style = styleOf({ columns: 40 });
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
