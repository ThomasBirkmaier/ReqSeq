import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { Random } from "@reqseq/testkit";
import {
  doubleQuoted,
  isPlainByCharacters,
  isPlainSafe,
  isPlainSafeByProbe,
  PROBE_CACHE_SIZE,
  probeCacheSize,
  renderItem,
  renderKey,
  renderScalar,
  renderValue,
} from "./yaml-text.js";

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

const CONTEXTS = ["key", "value", "item", "flow-key", "flow-value"] as const;

// Pieces for generated strings: indicators at every place, YAML 1.1 and 1.2 look-alikes, spaces,
// line breaks, non-ASCII letters and digits (#696).
const PIECES = [
  ...Array.from("aZäßé1097 _.,()/'+-:#?![]{}&*%@`|>~<=\"\\\t\n\u00a0\u2028"),
  "Ⅻ",
  "٣",
  "🙂",
  " ",
  "  ",
  ": ",
  " #",
  "- ",
  "? ",
  "<<",
  "yes",
  "No",
  "ON",
  "off",
  "Y",
  "n",
  "true",
  "FALSE",
  "null",
  "Null",
  "~",
  ".inf",
  ".NaN",
  "0x1F",
  "0o17",
  "0b101",
  "1_000",
  "1e3",
  "12:30",
  "2026-10-24",
  "2026-10-24T10:00:00Z",
  "n1:",
  "878e339e-773f-4cd0-b414-825b7146fb54",
  "---",
  "...",
];

// Pieces near the edge of the characters check: its own set, `:`, `,`, spaces and look-alike letters.
const WORD_PIECES = [...Array.from("aZäeEyYnNoO1 _.,()/'+-:"), "e5", "on", "ull", "rue"];

/**
 * Strings of 2 to 8 pieces from a seeded generator (mulberry32), so a failure names a string that
 * comes back on every run.
 */
const generated = (count: number, pieces: readonly string[]): string[] => {
  const random = new Random(696);
  return Array.from({ length: count }, () =>
    Array.from({ length: 2 + random.below(7) }, () => random.pick(pieces)).join(""),
  );
};

// Strings the characters check accepts, at its edges: these must be plain for the probe too.
const ACCEPTED = [
  "Measure the wind 42",
  "REQ-1",
  "a",
  "Grüße aus Köln",
  "x1",
  "it's (nearly) done/finished",
  "a  b",
  "a, b",
  "n1:9b4c91f8cfbe62b7",
  "a:b:c",
  "C++",
  "e5x",
  "E-3x",
  "Yess",
  "nulls",
  "onion",
  "xⅫ",
  "00000000-0000-4000-8000-000000000001",
  "12345678-1234-1234-1234-123456789012",
  "1e000000-0000-0000-0000-000000000000",
  "ABCDEF01-2345-6789-ABCD-EF0123456789",
  "k".repeat(1000),
];
// Long texts: a key over YAML's limit goes to the probe, a long value does not.
const LONG = ["k".repeat(1001), "word ".repeat(300).trim()];

describe("isPlainSafe by characters (#696)", () => {
  const fromPieces = generated(3000, PIECES);
  const fromWordPieces = generated(3000, WORD_PIECES);
  const samples = [
    ...TRICKY,
    ...ACCEPTED,
    ...LONG,
    ...PIECES,
    ...WORD_PIECES,
    ...fromPieces,
    ...fromWordPieces,
  ];

  it("generates strings from every piece, mostly distinct", () => {
    for (const [strings, pieces] of [
      [fromPieces, PIECES],
      [fromWordPieces, WORD_PIECES],
    ] as const) {
      expect(pieces.filter((piece) => !strings.some((s) => s.includes(piece)))).toEqual([]);
      expect(new Set(strings).size).toBeGreaterThan(strings.length * 0.9);
    }
  });

  it("decides plain only where the probe in YAML 1.2 and 1.1 decides plain too", () => {
    const wrong = CONTEXTS.flatMap((context) =>
      samples
        .filter((s) => isPlainByCharacters(s, context) && !isPlainSafeByProbe(s, context))
        .map((s) => `${context}: ${JSON.stringify(s)}`),
    );
    expect(wrong).toEqual([]);
  });

  it("gives the probe's answer for every string and place, so files stay byte-identical", () => {
    for (const context of CONTEXTS) {
      const differ = samples.filter((s) => isPlainSafe(s, context) !== isPlainSafeByProbe(s, context));
      expect(differ.map((s) => JSON.stringify(s))).toEqual([]);
      // A second call reads the cache.
      expect(samples.filter((s) => isPlainSafe(s, context) !== isPlainSafeByProbe(s, context))).toEqual([]);
    }
  });

  it("decides the values of an imported element without the probe", () => {
    for (const s of ACCEPTED) {
      expect([s, isPlainByCharacters(s, "value")]).toEqual([s, true]);
    }
    expect(isPlainByCharacters("k".repeat(1001), "key")).toBe(false);
    expect(isPlainByCharacters("k".repeat(1001), "value")).toBe(true);
    expect(isPlainByCharacters("a, b", "flow-value")).toBe(false);
    expect(isPlainByCharacters("a ", "value")).toBe(false);
    expect(isPlainByCharacters("a:", "value")).toBe(false);
    expect(isPlainByCharacters("a: b", "value")).toBe(false);
    expect(isPlainByCharacters("On", "value")).toBe(false);
    expect(isPlainByCharacters("e5", "value")).toBe(false);
  });

  it("keeps its cache bounded and still answers after it is cleared", () => {
    let largest = 0;
    for (let i = 0; i < PROBE_CACHE_SIZE + 100; i++) {
      expect(isPlainSafe(`${String(i)}:x`, "item")).toBe(true);
      largest = Math.max(largest, probeCacheSize("item"));
    }
    expect(largest).toBe(PROBE_CACHE_SIZE);
    expect(probeCacheSize("item")).toBeLessThan(PROBE_CACHE_SIZE);
    expect(isPlainSafe("12:30", "item")).toBe(false);
    expect(isPlainSafe("0:x", "item")).toBe(true);
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

  it("renders one relation target as one flow mapping on the key line", () => {
    expect(renderValue({ id: "b", version: "n1:7d865e959b2466f0" }, "  ", "\n")).toBe(
      " { id: b, version: n1:7d865e959b2466f0 }",
    );
  });
});
