import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { doubleQuoted, isPlainSafe, renderItem, renderKey, renderScalar, renderValue } from "./yaml-text.js";

const read = (yaml: string): unknown => {
  const doc = parseDocument(yaml, { version: "1.2", schema: "core" });
  expect(doc.errors).toEqual([]);
  return doc.toJS();
};

// Strings that break naive plain writing: core-schema look-alikes, indicators, comments, spaces,
// control characters, line breaks and non-ASCII text.
const TRICKY = [
  "plain text",
  "Show wind speed in large digits",
  "WS-0815",
  "2026-10-24",
  "yes",
  "No",
  "on",
  "OFF",
  "y",
  "N",
  "1_000",
  "12:30",
  "190:20:30",
  "0b101",
  "+1",
  "n1:2c26b46b68ffc68f",
  "null",
  "Null",
  "~",
  "true",
  "False",
  "00815",
  "815",
  "1.0",
  "1e3",
  ".inf",
  "-.NaN",
  "0x1F",
  "0o17",
  "",
  " leading",
  "trailing ",
  "a: b",
  "a:b",
  "key:",
  "# comment",
  "a #b",
  "a#b",
  "- item",
  "-",
  "? key",
  "[x, y]",
  "{ a: 1 }",
  "a, b",
  "a]b",
  "a}b",
  "&anchor",
  "*alias",
  "!tag",
  "|",
  ">",
  "'quoted'",
  '"quoted"',
  "%YAML",
  "@at",
  "`tick",
  "---",
  "...",
  "line\nbreak",
  "cr\rhere",
  "tab\there",
  "\ttab first",
  "bell\x07",
  "nul\0",
  "esc\x1b",
  "del\x7f",
  "next line\x85",
  "nbsp\u00a0",
  "line sep\u2028",
  "para sep\u2029",
  "bom\ufeff",
  "nonchar\uffff",
  "lone \ud800 surrogate",
  'back\\slash "and" quote',
  "Grüße, Größe – „Zitat“",
  "emoji 🙂",
  "x".repeat(200),
];

describe("renderScalar", () => {
  it("writes strings so they read back unchanged in every place", () => {
    for (const s of TRICKY) {
      expect(read(`${renderScalar(s, "key")}: x\n`)).toEqual({ [s]: "x" });
      expect(read(`k: ${renderScalar(s, "value")}\n`)).toEqual({ k: s });
      expect(read(`- ${renderScalar(s, "item")}\n`)).toEqual([s]);
      expect(read(`- { ${renderScalar(s, "flow-key")}: ${renderScalar(s, "flow-value")} }\n`)).toEqual([
        { [s]: s },
      ]);
    }
  });

  it("writes plain where it is safe and double-quoted otherwise", () => {
    expect(renderScalar("Show wind speed", "value")).toBe("Show wind speed");
    expect(renderScalar("2026-10-24", "value")).toBe('"2026-10-24"');
    expect(renderScalar("yes", "value")).toBe('"yes"');
    expect(renderScalar("12:30", "item")).toBe('"12:30"');
    expect(renderScalar("a, b", "value")).toBe("a, b");
    expect(renderScalar("a, b", "flow-value")).toBe('"a, b"');
    expect(renderScalar("00815", "value")).toBe('"00815"');
    expect(renderScalar("null", "key")).toBe('"null"');
    expect(renderScalar("a: b", "value")).toBe('"a: b"');
    expect(renderScalar("", "value")).toBe('""');
  });

  it("never folds a long value", () => {
    const long = "word ".repeat(40).trim();
    expect(renderScalar(long, "value")).toBe(long);
    expect(renderScalar(`${long}\n${long}`, "value")).toBe(`"${long}\\n${long}"`);
  });

  it("writes numbers, booleans and null", () => {
    expect(renderScalar(42, "value")).toBe("42");
    expect(renderScalar(-1.5, "value")).toBe("-1.5");
    expect(renderScalar(1e21, "value")).toBe("1e+21");
    expect(read(`k: ${renderScalar(1e21, "value")}\n`)).toEqual({ k: 1e21 });
    expect(renderScalar(-0, "value")).toBe("0");
    expect(renderScalar(true, "value")).toBe("true");
    expect(renderScalar(null, "value")).toBe("null");
  });

  it("refuses numbers a file cannot hold", () => {
    for (const n of [Number.NaN, Infinity, -Infinity]) {
      expect(() => renderScalar(n, "value")).toThrow(expect.objectContaining({ code: "input.invalid" }));
    }
  });

  it("renders keys in key position", () => {
    expect(renderKey("derives-from")).toBe("derives-from");
    expect(renderKey("true")).toBe('"true"');
  });
});

describe("doubleQuoted", () => {
  it("escapes line breaks, controls and non-printable characters and keeps other text", () => {
    expect(doubleQuoted('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(doubleQuoted("\0\x07\b\t\n\v\f\r\x1b")).toBe('"\\0\\a\\b\\t\\n\\v\\f\\r\\e"');
    expect(doubleQuoted("\x01\x7f\x85")).toBe('"\\x01\\x7F\\x85"');
    expect(doubleQuoted("\u2028\ufeff\ud800")).toBe('"\\u2028\\uFEFF\\uD800"');
    expect(doubleQuoted("Größe 🙂")).toBe('"Größe 🙂"');
  });
});

describe("isPlainSafe", () => {
  it("rejects strings that read back as another value or another shape", () => {
    expect(isPlainSafe("x", "value")).toBe(true);
    expect(isPlainSafe("#x", "key")).toBe(false);
    expect(isPlainSafe("a, b", "flow-key")).toBe(false);
    expect(isPlainSafe("- a", "key")).toBe(false);
    expect(isPlainSafe("!x y", "value")).toBe(false);
  });
});

describe("renderItem and renderValue", () => {
  it("renders a relation target as one flow mapping", () => {
    expect(
      renderItem({
        id: "878e339e-773f-4cd0-b414-825b7146fb54",
        version: "n1:7d865e959b2466f0",
        title: "Wind, fast",
      }),
    ).toBe('{ id: 878e339e-773f-4cd0-b414-825b7146fb54, version: n1:7d865e959b2466f0, title: "Wind, fast" }');
    expect(renderItem({})).toBe("{}");
    expect(renderItem("- x")).toBe('"- x"');
  });

  it("renders scalars on the key line and lists as block sequences", () => {
    expect(renderValue("x", "  ", "\n")).toBe(" x");
    expect(renderValue([], "  ", "\n")).toBe(" []");
    expect(renderValue(["a", { id: "b" }], "  ", "\r\n")).toBe("\r\n  - a\r\n  - { id: b }");
  });
});
