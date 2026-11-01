// The name pattern of evidence.enrichJunit (SR-029 AK5, name-pattern.ts): the checks of the template and
// the matcher, including names built to make a naive matcher slow.
import { describe, expect, it } from "vitest";
import { CommandError } from "../catalog.js";
import { nameMatcher, parseNamePattern } from "./name-pattern.js";

/** The prefixes of the spec's metamodel, plus N2 (a prefix with a digit) and DE (to show the retry). */
const PREFIXES = ["N", "N2", "UC", "SR", "D", "DE", "VAR", "PKG", "GL"];

const matches = (pattern: string, name: string, prefixes = PREFIXES): string[] =>
  nameMatcher(parseNamePattern(pattern), prefixes)(name).map((m) => m.shortId);

const refusal = (pattern: string): string => {
  try {
    parseNamePattern(pattern);
  } catch (error) {
    if (error instanceof CommandError) {
      expect([error.code, error.details?.["reason"], error.details?.["fields"]]).toEqual([
        "input.invalid",
        "name-pattern",
        ["namePattern"],
      ]);
      return error.message;
    }
    throw error;
  }
  throw new Error("expected a refusal");
};

describe("parseNamePattern", () => {
  it("refuses every pattern that is not a template of {prefix}, {id} and {ak}, one sentence per rule", () => {
    expect(refusal("{prefix}_{idx}")).toBe(
      'The name pattern "{prefix}_{idx}" has the unknown placeholder {idx}; known are {prefix}, {id} and {ak}',
    );
    expect(refusal("{prefix}_{id")).toContain("has a { without }; write {{ for a literal brace");
    expect(refusal("{prefix}_{ {id}")).toContain("has a { without }");
    expect(refusal("{prefix}_}{id}")).toContain("has a } without {; write }} for a literal brace");
    expect(refusal("sr_{id}")).toContain("must have {prefix} exactly once");
    expect(refusal("{prefix}{prefix}_{id}")).toContain("must have {prefix} exactly once");
    expect(refusal("{prefix}_ak{ak}")).toContain("must have {id} exactly once");
    expect(refusal("{prefix}_{id}_{id}")).toContain("must have {id} exactly once");
    expect(refusal("{prefix}_{id}_{ak}_{ak}")).toContain("may have {ak} once at most");
    expect(refusal("{prefix}_{id}{ak}")).toContain("has {id} and {ak} next to each other");
    expect(refusal("{prefix}_{ak}{id}")).toContain("has {id} and {ak} next to each other");
    expect(refusal("{prefix}_{id}_ak{ak}9")).toContain("has a digit right after {ak}");
    expect(refusal("[{prefix}-{id}]")).toContain("has a square bracket");
  });

  it("takes {{ and }} as literal braces, joins literal text and keeps it in lower case", () => {
    expect(parseNamePattern("{{Test}}_{prefix}{id}AK{ak}x").parts).toEqual([
      { kind: "literal", text: "{test}_" },
      { kind: "prefix" },
      { kind: "id" },
      { kind: "literal", text: "ak" },
      { kind: "ak" },
      { kind: "literal", text: "x" },
    ]);
    expect(matches("{{{prefix}_{id}}}", "t_{sr_348143}")).toEqual(["SR-348143"]);
  });
});

describe("nameMatcher (SR-029 AK5)", () => {
  it("finds the short ID in snake case, upper case and camel case names of Rust, Go and Java", () => {
    expect(matches("{prefix}_{id}_ak{ak}", "tests::sr_348143_ak1_max_mass")).toEqual(["SR-348143"]);
    expect(matches("{prefix}_{id}_ak{ak}", "SR_348143_AK1")).toEqual(["SR-348143"]);
    // Go and Java: `{id}` gives back hex digits until `AK` fits (B1 of the plan review).
    expect(matches("Test{prefix}{id}AK{ak}", "TestSR348143AK1")).toEqual(["SR-348143"]);
    expect(matches("{prefix}{id}Ak{ak}", "sr348143Ak1")).toEqual(["SR-348143"]);
    expect(matches("{prefix}{id}ak{ak}", "sr2f95e9ak1")).toEqual(["SR-2f95e9"]);
    // The digits end where a camel case word starts.
    expect(matches("Test{prefix}{id}", "TestSR2f95e9Add")).toEqual(["SR-2f95e9"]);
    expect(matches("Test{prefix}{id}", "TestSRABCDEF")).toEqual(["SR-abcdef"]);
  });

  it("takes any type prefix, with digits too, the longest first and then the shorter ones", () => {
    expect(matches("{prefix}_{id}", "n2_123456 n_123456 var_abcdef pkg_0000a1")).toEqual([
      "N2-123456",
      "N-123456",
      "VAR-abcdef",
      "PKG-0000a1",
    ]);
    // DE fits first, but 12345 is too short: retried with D, which gives e12345 (S1).
    expect(matches("{prefix}{id}", "de12345")).toEqual(["D-e12345"]);
    expect(matches("{prefix}{id}", "de123456")).toEqual(["DE-123456"]);
    expect(matches("{prefix}_{id}", "test_123456 x_123456")).toEqual([]);
    expect(matches("{prefix}_{id}", "sr_123456", [])).toEqual([]);
  });

  it("matches 6 to 32 hex digits and nothing shorter or longer", () => {
    expect(matches("{prefix}_{id}", "sr_12345")).toEqual([]);
    expect(matches("{prefix}_{id}", `sr_${"a".repeat(32)}`)).toEqual([`SR-${"a".repeat(32)}`]);
    expect(matches("{prefix}_{id}", `sr_${"a".repeat(33)}`)).toEqual([]);
    expect(matches("{prefix}_{id}", "sr_029_check")).toEqual([]);
  });

  it("reads {ak} as 1 to 9 digits, all of the run", () => {
    expect(matches("{prefix}_{id}_ak{ak}", "sr_348143_ak123456789")).toEqual(["SR-348143"]);
    expect(matches("{prefix}_{id}_ak{ak}", "sr_348143_ak1234567890")).toEqual([]);
    expect(matches("{prefix}_{id}_ak{ak}", "sr_348143_ak")).toEqual([]);
  });

  it("starts and ends a match only at a word boundary (B2 of the plan review)", () => {
    // Inside a word nothing matches: D-ed123456, D-41d8cd98f00 and SR-348143 would be wrong.
    expect(matches("{prefix}{id}", "loaded123456")).toEqual([]);
    expect(matches("{prefix}_{id}", "xsr_348143 sr_348143x")).toEqual([]);
    // A start after a lower case letter turning upper, or after a character that is no letter or digit.
    expect(matches("{prefix}{id}", "checkSR348143 x.sr348143")).toEqual(["SR-348143", "SR-348143"]);
    // Literal text that is no letter or digit may stand at either end.
    expect(matches("_{prefix}_{id}_", "test_sr_348143_ak1")).toEqual(["SR-348143"]);
    // A character beyond ASCII counts as a letter.
    expect(matches("{prefix}_{id}", "ésr_348143")).toEqual([]);
  });

  it("finds every match left to right without overlap, and none inside [...] (S2)", () => {
    expect(matches("{prefix}_{id}", "sr_348143_and_sr_2f95e9")).toEqual(["SR-348143", "SR-2f95e9"]);
    expect(matches("{prefix}_{id}", "test_parse[sr_abcdef] sr_123456")).toEqual(["SR-123456"]);
    expect(nameMatcher(parseNamePattern("{prefix}_{id}"), PREFIXES)("x Sr_ABCDEF_1")).toEqual([
      { shortId: "SR-abcdef", matched: "Sr_ABCDEF" },
    ]);
  });

  it("stays linear on names built against it: a long near match everywhere, long hex runs, long prefixes (S4)", () => {
    const adversarial: [string, string][] = [
      // Every position is a boundary, and 85 characters of literal text fit at each.
      [`${"_".repeat(85)}{prefix}_{id}`, "_".repeat(1_000_000)],
      // Each start tries 27 lengths of {id}, and 80 characters of literal text nearly fit after each.
      [`{prefix}{id}${"a".repeat(80)}!`, `_sr${"a".repeat(100)}`.repeat(9_700)],
      // Hex runs longer than 32 digits.
      ["{prefix}_{id}_{ak}", `_sr_${"f".repeat(40)}`.repeat(25_000)],
      ["{prefix}{id}_x", "_sr".padEnd(36, "a").repeat(30_000)],
    ];
    const started = performance.now();
    for (const [pattern, name] of adversarial) {
      expect(pattern.length).toBeLessThanOrEqual(100);
      expect(matches(pattern, name)).toEqual([]);
    }
    // About 1 MB per name; a quadratic matcher takes hours, this one well under a second each.
    expect(performance.now() - started).toBeLessThan(20_000);
  });
});
