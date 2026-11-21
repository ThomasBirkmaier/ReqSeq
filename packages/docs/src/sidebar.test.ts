import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOW_TO_GROUPS, howToRank, howToSidebar } from "./sidebar.js";

describe("sidebar of the how-to guides", () => {
  it("puts every how-to page of docs/guide in exactly one topic group", async () => {
    const files = await readdir(fileURLToPath(new URL("../../../docs/guide/how-to/", import.meta.url)));
    const groups = howToSidebar(files);
    expect(groups.map((group) => group.label)).toEqual(HOW_TO_GROUPS.map((group) => group.label));
    expect(groups.flatMap((group) => group.items).sort()).toEqual(
      files
        .filter((file) => /\.mdx?$/.test(file))
        .map((file) => `how-to/${file.replace(/\.mdx?$/, "")}`)
        .sort(),
    );
  });

  it("gives the slugs of a group in its order, .md and .mdx alike, and ignores other files", () => {
    const groups = [
      { label: "One", pages: ["b", "a"] },
      { label: "Two", pages: ["c"] },
    ];
    expect(howToSidebar(["a.md", "c.mdx", "b.md", "image.png"], groups)).toEqual([
      { label: "One", items: ["how-to/b", "how-to/a"] },
      { label: "Two", items: ["how-to/c"] },
    ]);
  });

  it("refuses a page in no group, a page in two groups and a listed page that is not there", () => {
    const groups = [
      { label: "One", pages: ["a", "b"] },
      { label: "Two", pages: ["b", "gone"] },
    ];
    expect(() => howToSidebar(["a.md", "b.md", "new.md"], groups)).toThrow(
      "sidebar of how-to/: new in no group; b in two groups; gone listed but not there (packages/docs/src/sidebar.ts)",
    );
    expect(() => howToSidebar(["a.md"], [{ label: "One", pages: ["a"] }])).not.toThrow();
  });

  it("ranks a page of the content folder by its place in the groups", () => {
    expect(howToRank("how-to/install-reqseq.md")).toBe(0);
    expect(howToRank("how-to/write-the-text-of-an-element.mdx")).toBe(HOW_TO_GROUPS[0]?.pages.length);
    expect(howToRank("how-to/unknown.md")).toBeUndefined();
    expect(howToRank("start/get-started.md")).toBeUndefined();
  });
});
