// The name pattern of `evidence.enrichJunit` (SR-029 AK5, ADR-0012 "Enriching"): a template such as
// `{prefix}_{id}_ak{ak}` that finds a short ID written in another form in a test case name
// (`sr_348143_ak1` gives SR-348143). The pattern arrives through every access, so it never reaches
// `RegExp`: it is compiled into the own matcher below, whose cost is linear in the name.
//
// - `{prefix}`: a type prefix of the metamodel, ASCII case-insensitive; the longest that fits first,
//   then the shorter ones (`DE`, then `D`).
// - `{id}`: 6 to 32 hex digits, the longest first, down to 6, until the rest of the pattern fits; so
//   `{id}AK` reads `348143` from `348143AK1`. The digits end where a camel case word starts (an upper
//   case letter after a lower case one, or before one), so `2f95e9Add` gives `2f95e9`.
// - `{ak}`: 1 to 9 digits, all of the run (a longer run does not match). It plays no part in the
//   assignment: evidence counts per requirement.
// - Anything else is literal text, ASCII case-insensitive; `{{` and `}}` are literal braces.
// - A match starts and ends at a word boundary: the start or end of the name, a character that is
//   not a letter or digit, or the start of a camel case word. Matches do not overlap.
// - The name is read outside `[...]` only: brackets are the bracket form's (`[SR-348143]`), and a
//   pytest parameter list such as `test_parse[sr_abcdef]` is test data.
import { CommandError } from "../catalog.js";
import { shown } from "../files/index.js";

type Placeholder = "prefix" | "id" | "ak";

export type NamePatternPart =
  { readonly kind: "literal"; readonly text: string } | { readonly kind: Placeholder };

/** A checked name pattern; literal text is in ASCII lower case. */
export interface NamePattern {
  readonly parts: readonly NamePatternPart[];
}

/** One match in a test case name. */
export interface NameMatch {
  /** `<PREFIX>-<id>`: the prefix in upper case, the hex digits in lower case. */
  readonly shortId: string;
  /** The matched text as written. */
  readonly matched: string;
}

const PLACEHOLDERS: readonly Placeholder[] = ["prefix", "id", "ak"];
const ID_MIN = 6;
const ID_MAX = 32;
const AK_MAX = 9;

const refuse = (pattern: string, why: string): CommandError =>
  new CommandError("input.invalid", `The name pattern "${shown(pattern)}" ${why}`, {
    command: "evidence.enrichJunit",
    fields: ["namePattern"],
    reason: "name-pattern",
  });

const isPlaceholder = (name: string): name is Placeholder =>
  (PLACEHOLDERS as readonly string[]).includes(name);

const lowerAscii = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase());
const upperAscii = (text: string): string => text.replace(/[a-z]/g, (c) => c.toUpperCase());

/** The parts of `pattern` in order, consecutive literal text joined; throws on a brace that is not one. */
const partsOf = (pattern: string): NamePatternPart[] => {
  const parts: NamePatternPart[] = [];
  let literal = "";
  const flush = (): void => {
    if (literal !== "") {
      parts.push({ kind: "literal", text: lowerAscii(literal) });
      literal = "";
    }
  };
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern.charAt(i);
    if ((c === "{" || c === "}") && pattern.charAt(i + 1) === c) {
      literal += c;
      i += 1;
    } else if (c === "}") {
      throw refuse(pattern, "has a } without {; write }} for a literal brace");
    } else if (c === "{") {
      const close = pattern.indexOf("}", i);
      const name = close < 0 ? "" : pattern.slice(i + 1, close);
      if (close < 0 || name.includes("{")) {
        throw refuse(pattern, "has a { without }; write {{ for a literal brace");
      }
      if (!isPlaceholder(name)) {
        throw refuse(
          pattern,
          `has the unknown placeholder {${shown(name)}}; known are {prefix}, {id} and {ak}`,
        );
      }
      flush();
      parts.push({ kind: name });
      i = close;
    } else {
      literal += c;
    }
  }
  flush();
  return parts;
};

/**
 * Checks `pattern` (see the file comment) and gives its parts. Throws `input.invalid` with
 * `details.reason: "name-pattern"` and one sentence per rule: a brace that is no placeholder,
 * `{prefix}` or `{id}` not exactly once, `{ak}` more than once, `{id}` and `{ak}` next to each other or
 * `{ak}` before a digit (where one ends would be unclear), or a square bracket.
 */
export const parseNamePattern = (pattern: string): NamePattern => {
  if (/[[\]]/.test(pattern)) {
    throw refuse(
      pattern,
      "has a square bracket; names are read outside [...], which the bracket form [SR-…] covers",
    );
  }
  const parts = partsOf(pattern);
  const count = (kind: Placeholder): number => parts.filter((p) => p.kind === kind).length;
  for (const kind of ["prefix", "id"] as const) {
    if (count(kind) !== 1) {
      throw refuse(pattern, `must have {${kind}} exactly once`);
    }
  }
  if (count("ak") > 1) {
    throw refuse(pattern, "may have {ak} once at most");
  }
  parts.forEach((part, i) => {
    const next = parts[i + 1];
    if ((part.kind === "id" && next?.kind === "ak") || (part.kind === "ak" && next?.kind === "id")) {
      throw refuse(pattern, "has {id} and {ak} next to each other; put text between them");
    }
    if (part.kind === "ak" && next?.kind === "literal" && /^[0-9]/.test(next.text)) {
      throw refuse(pattern, "has a digit right after {ak}, which {ak} would read as its own");
    }
  });
  return { parts };
};

const code = (name: string, i: number): number => (i >= 0 && i < name.length ? name.charCodeAt(i) : -1);
const isUpper = (c: number): boolean => c >= 0x41 && c <= 0x5a;
const isLower = (c: number): boolean => c >= 0x61 && c <= 0x7a;
const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
/** Letters and digits; any character beyond ASCII counts as a letter, so it is no boundary. */
const isWordChar = (c: number): boolean => isUpper(c) || isLower(c) || isDigit(c) || c >= 0x80;
const isHex = (c: number): boolean => isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);

/** An upper case letter that starts a camel case word: after a lower case letter, or before one. */
const camelStart = (name: string, i: number): boolean =>
  isUpper(code(name, i)) && (isLower(code(name, i - 1)) || isLower(code(name, i + 1)));

/** Whether a word boundary lies between the characters `i - 1` and `i`. */
const boundary = (name: string, i: number): boolean =>
  !isWordChar(code(name, i - 1)) || !isWordChar(code(name, i)) || camelStart(name, i);

/** The hex digits from `at`, at most `ID_MAX`, up to the start of a camel case word. */
const hexRun = (name: string, at: number): number => {
  let n = 0;
  while (n < ID_MAX && isHex(code(name, at + n)) && (n === 0 || !camelStart(name, at + n))) {
    n += 1;
  }
  return n;
};

const digitRun = (name: string, at: number): number => {
  let n = 0;
  // One more than AK_MAX tells a run that is too long.
  while (n <= AK_MAX && isDigit(code(name, at + n))) {
    n += 1;
  }
  return n;
};

/** Whether `text` (ASCII lower case) stands at `at`, ASCII case-insensitive. */
const literalAt = (name: string, at: number, text: string): boolean => {
  if (at + text.length > name.length) {
    return false;
  }
  for (let i = 0; i < text.length; i += 1) {
    const c = name.charCodeAt(at + i);
    if ((isUpper(c) ? c + 0x20 : c) !== text.charCodeAt(i)) {
      return false;
    }
  }
  return true;
};

/**
 * The matches of `pattern` in a name (see the file comment), left to right, without overlap. `prefixes`:
 * the type prefixes of the metamodel. Per start of a match at most (longest prefix) × 27 tries, each
 * as long as the pattern, so a name costs O(name length × pattern length).
 */
export const nameMatcher = (
  pattern: NamePattern,
  prefixes: readonly string[],
): ((name: string) => readonly NameMatch[]) => {
  const known = new Set(prefixes);
  const longest = Math.max(0, ...prefixes.map((p) => p.length));
  const { parts } = pattern;
  return (whole) => {
    const matches: NameMatch[] = [];
    for (const name of whole.split(/\[[^[\]]*\]/)) {
      let prefix = "";
      let id = "";
      /** The end of a match of `parts[k..]` from `at`, or -1. */
      const step = (k: number, at: number): number => {
        const part = parts[k];
        if (part === undefined) {
          return boundary(name, at) ? at : -1;
        }
        switch (part.kind) {
          case "literal":
            return literalAt(name, at, part.text) ? step(k + 1, at + part.text.length) : -1;
          case "ak": {
            const n = digitRun(name, at);
            return n >= 1 && n <= AK_MAX ? step(k + 1, at + n) : -1;
          }
          case "prefix":
            for (let n = Math.min(longest, name.length - at); n >= 1; n -= 1) {
              const candidate = upperAscii(name.slice(at, at + n));
              const end = known.has(candidate) ? step(k + 1, at + n) : -1;
              if (end >= 0) {
                prefix = candidate;
                return end;
              }
            }
            return -1;
          case "id":
            for (let n = hexRun(name, at); n >= ID_MIN; n -= 1) {
              const end = step(k + 1, at + n);
              if (end >= 0) {
                id = lowerAscii(name.slice(at, at + n));
                return end;
              }
            }
            return -1;
        }
      };
      for (let start = 0; start < name.length;) {
        const end = boundary(name, start) ? step(0, start) : -1;
        if (end > start) {
          matches.push({ shortId: `${prefix}-${id}`, matched: name.slice(start, end) });
          start = end;
        } else {
          start += 1;
        }
      }
    }
    return matches;
  };
};
