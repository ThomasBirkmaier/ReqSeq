// `locateIn`: the lines of findings in a file at hand (the bytes element.bulkUpdate writes or
// previews); the files of a workspace are located with `locateFindings` (tested with each check).
import { describe, expect, it } from "vitest";
import type { Problem } from "../catalog.js";
import type { ParsedFile } from "../files/index.js";
import { parseFileBytes } from "../files/index.js";
import { classifyFile } from "./elements.js";
import { locateIn } from "./locate.js";

const TEXT =
  "---\nid: 0b7c6e1a-1111-4222-8333-444455556666\ntype: need\ntitle: A need\ntopic:\n  - one\n  - two\n---\n";

const parsed = (): ParsedFile => {
  const outcome = parseFileBytes("needs/N-444455556666.md", new TextEncoder().encode(TEXT));
  if (outcome.kind !== "parsed") {
    throw new Error("the text does not parse");
  }
  return {
    ...outcome.content,
    path: "needs/N-444455556666.md",
    snapshot: { path: "needs/N-444455556666.md", size: 0, mtimeMs: 0, sha256: "" },
  };
};

const PROBLEM: Problem = { code: "element.wrong-value-kind", severity: "warning", message: "m" };

describe("locateIn", () => {
  it("gives each finding the line of its path in the file, and none when the path is not there", () => {
    const file = parsed();
    const classified = classifyFile("system", file);
    if (classified.kind !== "element") {
      throw new Error("not an element");
    }
    const element = classified.element;
    expect(
      locateIn(file, [
        { element, path: ["topic", 1], problem: PROBLEM },
        { element, path: ["topic"], at: "key", problem: PROBLEM },
        { element, path: ["missing"], problem: PROBLEM },
      ]),
    ).toEqual([{ ...PROBLEM, line: 7 }, { ...PROBLEM, line: 5 }, PROBLEM]);
  });
});
