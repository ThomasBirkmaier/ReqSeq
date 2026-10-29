// The line of a relation value in the YAML text of a frontmatter, read from the text without
// parsing it (ADR-0008, N-036). ReqSeq writes a relation target as one flow mapping per line
// (ADR-0004, SR-102), under a top-level key at the start of a line; for that layout the line is
// found by a scan of the lines. Parsing the YAML of every file with a finding again (`lineOf`) cost
// about 28 s at 50,000 files on the main thread; the scan reads only text.
//
// The scan gives the line `lineOf` gives (line 1 is the opening `---`), or undefined when the text
// is written in another way it does not follow: the key not plain at the start of a line, a value
// on the next line, a flow sequence (`[...]`), an anchor, alias, tag or block scalar, an empty item,
// a tab in the indentation. Then the caller parses the YAML. One case the scan does not see: a
// quoted scalar of an earlier key continued over several lines, one of which starts with the key
// and a colon; a YAML parse would not read that line as a key.

/** The first character of a value the scan reads: plain, quoted or a flow collection; not `#`, `&`, `!`, `*`, `|`, `>`. */
const VALUE_START = /^[^\s#&!*|>]/;

/** A line that holds only white space or a comment. */
const isBlankOrComment = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
};

/** The line (from 0) of the `index`-th item of the block sequence that starts after line `at`, or undefined. */
const itemLine = (lines: readonly string[], at: number, index: number): number | undefined => {
  let indent: number | undefined;
  let count = -1;
  for (const [offset, line] of lines.slice(at + 1).entries()) {
    const j = at + 1 + offset;
    if (isBlankOrComment(line)) {
      continue;
    }
    // Not blank, so it has a character other than a space.
    const spaces = line.search(/[^ ]/);
    const item = /^ *-( |$)/.test(line);
    if (line.charAt(spaces) === "\t" || (indent === undefined && !item)) {
      return undefined;
    }
    indent ??= spaces;
    if (spaces < indent || (spaces === indent && !item)) {
      return undefined;
    }
    if (spaces === indent) {
      count += 1;
      if (count === index) {
        return VALUE_START.test(line.slice(spaces + 1).trim()) ? j : undefined;
      }
    }
  }
  return undefined;
};

/** The lines of `frontmatter` (the YAML text) without line ends: split once per file for `textLineOf`. */
export const frontmatterLines = (frontmatter: string): string[] =>
  frontmatter.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));

/**
 * The line of the value at `path` (`[key]` or `[key, index]`) in the frontmatter of `lines`
 * (`frontmatterLines`; the YAML text starts at line 2 of the file) as `lineOf` gives it, when the
 * text is written as ReqSeq writes relations; undefined otherwise (see the file comment).
 */
export const textLineOf = (
  lines: readonly string[],
  path: readonly (string | number)[],
): number | undefined => {
  const [key, index] = path;
  if (typeof key !== "string" || path.length > 2) {
    return undefined;
  }
  const at = lines.findIndex(
    (line) => line.startsWith(`${key}:`) && /^(\s|$)/.test(line.slice(key.length + 1)),
  );
  const keyLine = lines[at];
  if (keyLine === undefined) {
    return undefined;
  }
  const value = keyLine.slice(key.length + 1).trim();
  if (index === undefined) {
    return VALUE_START.test(value) ? at + 2 : undefined;
  }
  const found = typeof index === "number" && value === "" ? itemLine(lines, at, index) : undefined;
  return found === undefined ? undefined : found + 2;
};
