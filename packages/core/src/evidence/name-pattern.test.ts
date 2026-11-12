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
    expect(refusal("{prefix}_{id}_ak{ak}9")).toContain("has a letter or digit right after {ak}");
    expect(refusal("{prefix}_{id}_{ak}x")).toContain("has a letter or digit right after {ak}");
    expect(refusal("[{prefix}-{id}]")).toContain("has a square bracket");
  });

  it("takes {{ and }} as literal braces, joins literal text and keeps it in lower case", () => {
    expect(parseNamePattern("{{Test}}_{prefix}{id}AK{ak}_X").parts).toEqual([
      { kind: "literal", text: "{test}_" },
      { kind: "prefix" },
      { kind: "id" },
      { kind: "literal", text: "ak" },
      { kind: "ak" },
      { kind: "literal", text: "_x" },
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
    // The name is read in upper case, so a prefix with a lower case letter never fits; a repeated one is one.
    expect(matches("{prefix}_{id}", "Sr_123456 sr_123456", ["Sr", "SR", "SR"])).toEqual([
      "SR-123456",
      "SR-123456",
    ]);
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

  it("[SR-029/AK-zyp3] reads a criterion key as {ak}, all of the run of lower-case letters and digits, possessively", () => {
    const found = nameMatcher(parseNamePattern("{prefix}_{id}_ak_{ak}"), PREFIXES);
    expect(found("sr_348143_ak_k7f3 sr_348143_ak_m2x9")).toEqual([
      { shortId: "SR-348143", matched: "sr_348143_ak_k7f3", ak: "k7f3" },
      { shortId: "SR-348143", matched: "sr_348143_ak_m2x9", ak: "m2x9" },
    ]);
    // 4 to 16 characters, the first a lower-case letter; an upper-case letter ends the run.
    expect(matches("{prefix}_{id}_ak_{ak}", "sr_348143_ak_k7f")).toEqual([]);
    expect(matches("{prefix}_{id}_ak_{ak}", `sr_348143_ak_k${"7".repeat(16)}`)).toEqual([]);
    expect(matches("{prefix}_{id}_ak_{ak}", "sr_348143_ak_k7f3Max")).toEqual(["SR-348143"]);
    // Without a literal before it, `{ak}` reads a word as a key: `verify` then names no criterion.
    expect(nameMatcher(parseNamePattern("{prefix}_{id}_{ak}"), PREFIXES)("sr_348143_verify")).toEqual([
      { shortId: "SR-348143", matched: "sr_348143_verify", ak: "verify" },
    ]);
  });

  it("gives the digits of {ak} as written with each match (SR-029 AK10)", () => {
    const found = nameMatcher(parseNamePattern("{prefix}_{id}_ak{ak}"), PREFIXES);
    expect(found("sr_348143_ak2 sr_348143_ak03 sr_348143_ak0")).toEqual([
      { shortId: "SR-348143", matched: "sr_348143_ak2", ak: "2" },
      { shortId: "SR-348143", matched: "sr_348143_ak03", ak: "03" },
      { shortId: "SR-348143", matched: "sr_348143_ak0", ak: "0" },
    ]);
    expect(nameMatcher(parseNamePattern("{prefix}_{id}"), PREFIXES)("sr_348143")).toEqual([
      { shortId: "SR-348143", matched: "sr_348143" },
    ]);
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
    const adversarial = (scale: number): [string, string][] => [
      // Every position is a boundary, and 85 characters of literal text fit at each.
      [`${"_".repeat(85)}{prefix}_{id}`, "_".repeat(7_800 * scale)],
      // Each start tries 27 lengths of {id}, and 80 characters of literal text nearly fit after each.
      [`{prefix}{id}${"a".repeat(80)}!`, `_sr${"a".repeat(100)}`.repeat(150 * scale)],
      // Hex runs longer than 32 digits.
      ["{prefix}_{id}_{ak}", `_sr_${"f".repeat(40)}`.repeat(1_500 * scale)],
      ["{prefix}{id}_x", "_sr".padEnd(36, "a").repeat(1_880 * scale)],
    ];
    const millisecondsAt = (scale: number): number[] =>
      adversarial(scale).map(([pattern, name]) => {
        expect(pattern.length).toBeLessThanOrEqual(100);
        const started = performance.now();
        expect(matches(pattern, name)).toEqual([]);
        return performance.now() - started;
      });
    // Each case is timed at two sizes on the same runner, not against a fixed limit, so a slow or instrumented
    // runner does not fail the test (#1515), and each case on its own, so one slow case is not hidden by the
    // others. The runs alternate and the fastest of each size counts, so a pause of the runner and the
    // warm-up of the first run fall away.
    const runs = [1, 8, 1, 8, 1, 8, 1, 8].map((scale) => [scale, millisecondsAt(scale)] as const);
    const fastest = (size: number, index: number): number =>
      Math.min(...runs.filter(([scale]) => scale === size).map(([, ms]) => ms[index] ?? Infinity));
    const ratios = adversarial(1).map((_, index) => fastest(8, index) / fastest(1, index));
    // Eight times the input: a linear matcher takes at most about eight times as long, a quadratic one 64 times.
    expect(Math.max(...ratios)).toBeLessThan(24);
  });
});
