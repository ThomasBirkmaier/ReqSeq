// SR-129 AK1 (the entries and where the menu opens) and AK4 (what taking an entry writes): the pure part
// of the slash menu. The Markdown that results is parsed by micromark with the GitHub extensions, the
// independent reference parser (a dev dependency), as in `round-trip.test.ts`.
import { EditorState } from "@codemirror/state";
import { micromark } from "micromark";
import { gfm, gfmHtml } from "micromark-extension-gfm";
import { describe, expect, it } from "vitest";
import { markdownSupport } from "./markdown.js";
import { mathSyntax } from "./math-syntax.js";
import {
  SLASH_ENTRIES,
  applyEntry,
  asks,
  entriesFor,
  opensMenu,
  referenceMarkdown,
  slashRange,
} from "./slash-entries.js";
import type { AskingEntry, ReferenceTarget } from "./slash-entries.js";

const stateOf = (doc: string): EditorState => EditorState.create({ doc, extensions: [markdownSupport({})] });

const entry = (id: string): Exclude<(typeof SLASH_ENTRIES)[number], AskingEntry> => {
  const found = SLASH_ENTRIES.find((candidate) => candidate.id === id);
  if (found === undefined || asks(found)) {
    throw new Error(`no such entry: ${id}`);
  }
  return found;
};

/** The `/` of the text with its query (up to the next white space) is taken as `id`; the result shows the caret as ‸ and a selection as ‹…›. */
const taken = (text: string, id: string): string => {
  const slash = text.indexOf("/");
  const end = text.slice(slash).search(/\s/);
  const to = end === -1 ? text.length : slash + end;
  const state = stateOf(text);
  const next = state.update(applyEntry(state, slash, to, entry(id))).state;
  const { from, to: head } = next.selection.main;
  const doc = next.doc.toString();
  return from === head
    ? `${doc.slice(0, from)}‸${doc.slice(from)}`
    : `${doc.slice(0, from)}‹${doc.slice(from, head)}›${doc.slice(head)}`;
};

describe("the entries of the slash menu", () => {
  it("[SR-129/AK1] lists the elements of the criterion in its order, then bold and italic", () => {
    expect(SLASH_ENTRIES.map((candidate) => candidate.name)).toEqual([
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Heading 4",
      "Heading 5",
      "Heading 6",
      "Normal text",
      "Bullet list",
      "Numbered list",
      "Task list",
      "Quote",
      "Code block",
      "Table",
      "Link",
      "Reference to element",
      "Image",
      "Math block",
      "Diagram",
      "Bold",
      "Italic",
    ]);
    expect(new Set(SLASH_ENTRIES.map((candidate) => candidate.id)).size).toBe(SLASH_ENTRIES.length);
  });

  it("[SR-129/AK1] shows the Markdown of an entry as its detail", () => {
    expect(SLASH_ENTRIES.find((candidate) => candidate.id === "heading-2")?.detail).toBe("## ");
    expect(SLASH_ENTRIES.find((candidate) => candidate.id === "text")?.detail).toBe("");
  });

  it("[SR-129/AK1] offers only the inline entries, the reference and the image inside a table row", () => {
    expect(entriesFor(true).map((candidate) => candidate.name)).toEqual([
      "Link",
      "Reference to element",
      "Image",
      "Bold",
      "Italic",
    ]);
    expect(entriesFor(false)).toBe(SLASH_ENTRIES);
  });
});

describe("where the menu opens", () => {
  const opens = (text: string, at = text.indexOf("/")): boolean => opensMenu(stateOf(text), at);

  it("[SR-129/AK1] opens for a / at the start of a line, after a space, after a list marker and after a quote marker", () => {
    expect(opens("/")).toBe(true);
    expect(opens("text\n/")).toBe(true);
    expect(opens("text /")).toBe(true);
    expect(opens("- /")).toBe(true);
    expect(opens("> /")).toBe(true);
    expect(opens("1. /")).toBe(true);
  });

  it("[SR-129/AK1] does not open in a word, an address, a path or and/or", () => {
    expect(opens("a/b")).toBe(false);
    expect(opens("and/or")).toBe(false);
    expect(opens("see https://example.org")).toBe(false);
    expect(opens("src/renderer/", 12)).toBe(false);
  });

  it("[SR-129/AK1] does not open in code, a link, an image, an autolink or HTML", () => {
    expect(opens("```\n/\n```")).toBe(false);
    expect(opens("    /")).toBe(false);
    expect(opens("`code /`")).toBe(false);
    expect(opens("[label /](https://example.org)")).toBe(false);
    expect(opens("[label](https://example.org/ x)", 25)).toBe(false);
    expect(opens("![alt /](x.png)")).toBe(false);
    expect(opens("<https://example.org/ >", 21)).toBe(false);
    expect(opens("<div>\n/\n</div>")).toBe(false);
    expect(opens("<!-- /")).toBe(false);
  });

  it("does not open in a formula (SR-096)", () => {
    const withMath = (text: string, at = text.indexOf("/")): boolean =>
      opensMenu(
        EditorState.create({ doc: text, extensions: [markdownSupport({ markdown: [mathSyntax] })] }),
        at,
      );
    expect(withMath("$a /b$")).toBe(false);
    expect(withMath("$$\n/\n$$")).toBe(false);
    expect(withMath("$a$ /")).toBe(true);
  });

  it("[SR-129/AK1] finds the / with its query, up to the caret", () => {
    const state = stateOf("text /nl");
    expect(slashRange(state, 5, 8)).toEqual({ from: 5, to: 8, query: "nl", inTable: false });
    expect(slashRange(state, 5, 6)).toEqual({ from: 5, to: 6, query: "", inTable: false });
  });

  it("[SR-129/AK1] has no range when the / is gone, the caret is before it, on another line, or the query has white space or a /", () => {
    const state = stateOf("text /nl more\nnext");
    expect(slashRange(state, 4, 8)).toBeUndefined();
    expect(slashRange(state, 5, 5)).toBeUndefined();
    expect(slashRange(state, 5, 4)).toBeUndefined();
    expect(slashRange(state, 5, 14)).toBeUndefined();
    expect(slashRange(state, 5, 11)).toBeUndefined();
    expect(slashRange(stateOf("a /b/c"), 2, 6)).toBeUndefined();
  });

  it("[SR-129/AK1] knows a table row", () => {
    const text = "| a | b |\n| --- | --- |\n| x | /bo |";
    const slash = text.indexOf("/");
    expect(slashRange(stateOf(text), slash, slash + 3)?.inTable).toBe(true);
    expect(slashRange(stateOf("text /bo"), 5, 8)?.inTable).toBe(false);
  });
});

describe("taking an entry", () => {
  it("[SR-129/AK4] sets a heading on an empty line, with the caret after the marker", () => {
    expect(taken("/h1", "heading-1")).toBe("# ‸");
    expect(taken("/h6", "heading-6")).toBe("###### ‸");
  });

  it("[SR-129/AK4] keeps the text of the line and moves the caret to where the query stood", () => {
    expect(taken("foo /h2", "heading-2")).toBe("## foo‸");
    expect(taken("foo /h2 bar", "heading-2")).toBe("## foo ‸bar");
    expect(taken("/h2 bar", "heading-2")).toBe("## ‸bar");
  });

  it("[SR-129/AK4] joins the text around a query that was cut short without doubling the space", () => {
    const state = stateOf("foo /h2");
    const at = (from: number, to: number): string =>
      state.update(applyEntry(state, from, to, entry("heading-2"))).state.doc.toString();
    expect(at(4, 6)).toBe("## foo 2");
    expect(at(3, 6)).toBe("## foo2");
  });

  it("[SR-129/AK4] replaces the block marker of the line and drops or keeps its indentation", () => {
    expect(taken("# foo /nt", "text")).toBe("foo‸");
    expect(taken("  - a /nl", "numbered-list")).toBe("  1. a‸");
    expect(taken("  - /tl", "task-list")).toBe("  - [ ] ‸");
    expect(taken("- [x] done /bl", "bullet-list")).toBe("- done‸");
    expect(taken("    /q", "quote")).toBe("> ‸");
    expect(taken("> /h1", "heading-1")).toBe("# ‸");
    expect(taken("> - /h3", "heading-3")).toBe("### ‸");
    expect(taken("2) item /bl", "bullet-list")).toBe("- item‸");
    expect(taken(">text /q", "quote")).toBe("> text‸");
  });

  it("[SR-129/AK4] puts a code block on an empty line with a blank line apart from its neighbours", () => {
    expect(taken("/cb", "code-block")).toBe("```\n‸\n```");
    expect(taken("para\n/cb\nnext", "code-block")).toBe("para\n\n```\n‸\n```\n\nnext");
    expect(taken("para\n\n/cb\n\nnext", "code-block")).toBe("para\n\n```\n‸\n```\n\nnext");
  });

  it("[SR-129/AK4] puts a block below a line that has text, and selects the first header of a table", () => {
    expect(taken("foo /tb", "table")).toBe("foo\n\n| ‹Column 1› | Column 2 |\n| --- | --- |\n|  |  |");
    expect(taken("# Title /tb\nnext", "table")).toBe(
      "# Title\n\n| ‹Column 1› | Column 2 |\n| --- | --- |\n|  |  |\n\nnext",
    );
    expect(taken("- [ ] task /cb", "code-block")).toBe("- [ ] task\n\n  ```\n  ‸\n  ```");
  });

  it("[SR-129/AK4] keeps a block inside a quote and inside a list item", () => {
    expect(taken("> a\n> /cb", "code-block")).toBe("> a\n>\n> ```\n> ‸\n> ```");
    expect(taken("> a\n> /cb\n> b", "code-block")).toBe("> a\n>\n> ```\n> ‸\n> ```\n>\n> b");
    expect(taken("- a\n- /cb", "code-block")).toBe("- a\n- ```\n  ‸\n  ```");
    expect(taken("1. a\n   /cb", "code-block")).toBe("1. a\n\n   ```\n   ‸\n   ```");
    expect(taken("- a /cb", "code-block")).toBe("- a\n\n  ```\n  ‸\n  ```");
    expect(taken("1. /dg\n2. b", "diagram")).toBe("1. ```mermaid\n   ‸\n   ```\n2. b");
  });

  it("[SR-129/AK4] writes math and diagram blocks", () => {
    expect(taken("/mb", "math-block")).toBe("$$\n‸\n$$");
    expect(taken("/dg", "diagram")).toBe("```mermaid\n‸\n```");
  });

  it("[SR-129/AK4] writes the inline entries in place of the / and its query", () => {
    expect(taken("see /lk now", "link")).toBe("see [‸]() now");
    expect(taken("see /bo", "bold")).toBe("see **‸**");
    expect(taken("see /it", "italic")).toBe("see *‸*");
    expect(taken("| x | /bo |", "bold")).toBe("| x | **‸** |");
  });

  it("[SR-129/AK4] replaces the / and its query in every entry", () => {
    for (const candidate of SLASH_ENTRIES.filter(
      (each) => each.kind !== "reference" && each.kind !== "image",
    )) {
      expect(taken("a\n\n/zzz\n\nb", candidate.id), candidate.id).not.toContain("/zzz");
    }
  });

  const MARKDOWN: readonly (readonly [string, string, RegExp])[] = [
    ["heading-1", "/q", /<h1>word<\/h1>/],
    ["heading-2", "/q", /<h2>word<\/h2>/],
    ["heading-3", "/q", /<h3>word<\/h3>/],
    ["heading-4", "/q", /<h4>word<\/h4>/],
    ["heading-5", "/q", /<h5>word<\/h5>/],
    ["heading-6", "/q", /<h6>word<\/h6>/],
    ["text", "# /q", /^<p>word<\/p>$/],
    ["bullet-list", "/q", /<ul>\n<li>word<\/li>\n<\/ul>/],
    ["numbered-list", "/q", /<ol>\n<li>word<\/li>\n<\/ol>/],
    ["task-list", "/q", /<li><input type="checkbox" disabled="" \/> word<\/li>/],
    ["quote", "/q", /<blockquote>\n<p>word<\/p>\n<\/blockquote>/],
    ["code-block", "/q", /<pre><code>word\n<\/code><\/pre>/],
    ["table", "/q", /<table>[\s\S]*<th>word<\/th>[\s\S]*<th>Column 2<\/th>[\s\S]*<\/table>/],
    ["link", "see /q", /<p>see <a href="">word<\/a><\/p>/],
    ["math-block", "/q", /<p>\$\$\nword\n\$\$<\/p>/],
    ["diagram", "/q", /<pre><code class="language-mermaid">word\n<\/code><\/pre>/],
    ["bold", "see /q", /<p>see <strong>word<\/strong><\/p>/],
    ["italic", "see /q", /<p>see <em>word<\/em><\/p>/],
  ];

  it.each(MARKDOWN)(
    "[SR-129/AK4] %s writes CommonMark with GitHub extensions (micromark)",
    (id, line, expected) => {
      const result = taken(line, id);
      // What the writer types where the caret (or the selection) is.
      const text = result.includes("‹")
        ? result.replace(/‹[^›]*›/, "word").replace("‸", "")
        : result.replace("‸", "word");
      const html = micromark(text, { extensions: [gfm()], htmlExtensions: [gfmHtml()] });
      expect(html.trim()).toMatch(expected);
    },
  );
});

describe("the reference", () => {
  const target: ReferenceTarget = {
    id: "11111111-2222-4333-8444-555555555555",
    title: "The title",
    label: "SR-036",
    shortId: "SR-5555",
    repository: "main",
  };

  it("[SR-129/AK4] writes the title within the repository of the source", () => {
    expect(referenceMarkdown(target, "main")).toBe(`[The title](logreq:${target.id})`);
  });

  it("[SR-129/AK4] writes the short ID and the repository for a target in another repository (D-058)", () => {
    expect(referenceMarkdown(target, "other repo")).toBe(
      `[SR-5555](logreq:${target.id}?version=&repository=main)`,
    );
    expect(referenceMarkdown({ ...target, repository: "a b&c" }, "main")).toBe(
      `[SR-5555](logreq:${target.id}?version=&repository=a%20b%26c)`,
    );
  });

  it("[SR-129/AK4] falls back to the identifier for an empty title and escapes the label", () => {
    expect(referenceMarkdown({ ...target, title: "  " }, "main")).toBe(`[SR-036](logreq:${target.id})`);
    expect(referenceMarkdown({ ...target, title: "a [b] `c` \\d" }, "main")).toBe(
      `[a \\[b\\] \\\`c\\\` \\\\d](logreq:${target.id})`,
    );
    expect(
      micromark(referenceMarkdown({ ...target, title: "a [b] `c`" }, "main"), {
        allowDangerousProtocol: true,
      }),
    ).toBe(`<p><a href="logreq:${target.id}">a [b] \`c\`</a></p>`);
  });
});
