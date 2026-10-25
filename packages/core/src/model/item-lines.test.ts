// The line of a relation value from the frontmatter text (`textLineOf`): wherever it gives a line, it
// is the line the YAML parse gives (`lineOf`); where the text is written in another layout it gives
// none, and the caller parses.
import { describe, expect, it } from "vitest";
import type { ParsedFile } from "../files/index.js";
import { parseFileBytes } from "../files/index.js";
import { lineOf } from "./elements.js";
import { frontmatterLines, textLineOf } from "./item-lines.js";

const T = "{ id: 5e025a7d-2b4f-4c61-9d08-0a0000000001, version: n1:4a120bac998acdc8 }";

/** The file of `frontmatter` as the store parses it. */
const parsed = (frontmatter: string): ParsedFile => {
  const outcome = parseFileBytes("a.md", new TextEncoder().encode(`---\n${frontmatter}---\n`));
  if (outcome.kind !== "parsed") {
    throw new Error(`not parsed: ${JSON.stringify(outcome)}`);
  }
  return { ...outcome.content, path: "a.md" } as ParsedFile;
};

/** Both lines of `path`: from the text and from the YAML parse. */
const both = (
  frontmatter: string,
  path: readonly (string | number)[],
): [number | undefined, number | undefined] => [
  textLineOf(frontmatterLines(frontmatter), path),
  lineOf(parsed(frontmatter), path),
];

describe("lines of relation values from the frontmatter text", () => {
  it.each([
    ["an item of a block sequence", `id: x\nderives-from:\n  - ${T}\n  - ${T}\n`, ["derives-from", 1], 5],
    ["an item at indentation 0", `derives-from:\n- ${T}\n- ${T}\ntitle: t\n`, ["derives-from", 1], 4],
    [
      "an item after comments and blank lines",
      `derives-from:\n  # c\n\n  - ${T}\n  - ${T}\n`,
      ["derives-from", 1],
      6,
    ],
    [
      "an item over two lines",
      `derives-from:\n  - { id: a,\n      version: b }\n  - ${T}\n`,
      ["derives-from", 1],
      5,
    ],
    [
      "an item as a block mapping",
      `derives-from:\n  - id: a\n    version: b\n  - id: c\n`,
      ["derives-from", 1],
      5,
    ],
    ["one target", `title: t\nbased-on: ${T}\n`, ["based-on"], 3],
    ["an item with CRLF", `derives-from:\r\n  - ${T}\r\n  - ${T}\r\n`, ["derives-from", 1], 4],
  ])("finds %s as the YAML parse does", (_case, frontmatter, path, line) => {
    expect(both(frontmatter, path)).toEqual([line, line]);
  });

  it.each([
    ["a flow sequence", `derives-from: [${T}, ${T}]\n`, ["derives-from", 1]],
    ["a value on the next line", `based-on:\n  ${T}\n`, ["based-on"]],
    ["an anchor", `derives-from:\n  - &a ${T}\n`, ["derives-from", 0]],
    ["an empty item", `derives-from:\n  -\n    id: a\n`, ["derives-from", 0]],
    ["an item with a comment only", `derives-from:\n  - # c\n    id: a\n`, ["derives-from", 0]],
    ["a key that is not there", `title: t\n`, ["derives-from", 0]],
    ["a key that only starts the same", `derives-from-x:\n  - ${T}\n`, ["derives-from", 0]],
    ["fewer items", `derives-from:\n  - ${T}\ntitle: t\n`, ["derives-from", 1]],
    ["the end of the text", `derives-from:\n  - ${T}\n`, ["derives-from", 3]],
    ["a mapping where a sequence belongs", `derives-from:\n  id: a\n`, ["derives-from", 0]],
    ["a tab in the indentation", `derives-from:\n\t- ${T}\n`, ["derives-from", 0]],
    ["a path that is no key", `title: t\n`, [0]],
    ["a deeper path", `derives-from:\n  - ${T}\n`, ["derives-from", 0, "id"]],
    ["an index that is no number", `derives-from:\n  - ${T}\n`, ["derives-from", "x"]],
  ])("gives no line for %s", (_case, frontmatter, path) => {
    expect(textLineOf(frontmatterLines(frontmatter), path)).toBeUndefined();
  });
});
