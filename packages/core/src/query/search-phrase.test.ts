// Phrases in a search (SR-068 AK4, SR-174 AK6, SR-216 AK1) through element.search, on
// fixtures/SR-174/snippets (SR a2 "Show a dial": the checks "The dial turns in hail." and "The dial
// warns before a hurricane arrives.", the Markdown notes "A *hail* sensor beside the dial.", the
// text "The dial shows the wind speed.", spec ID SR-202) and files of each case.
import { fileURLToPath } from "node:url";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { searchIndex } from "./search-state.js";

type Output = CommandOutput<"element.search">;
type Hit = Output["hits"][number];

const P = "17400000-0000-4000-8000-0000000000";
const A2 = `${P}a2`;

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-174/snippets", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** An element file of the fixture's type with `text` and more frontmatter lines. */
const element = (tail: string, title: string, text: string, more = ""): Record<string, string> => ({
  [`requirements/SR-0000000000${tail}.md`]: `---\nid: ${P}${tail}\ntype: system-requirement\nstatus: draft\ntitle: ${title}\n${more}---\n\n${text}`,
});

const search = async (
  workspace: Workspace,
  query: string,
  more: Record<string, unknown> = {},
): Promise<Output> =>
  (await invoke("element.search", { query, limit: 500, ...more }, { workspace })) as Output;

/** The tails of the UUIDs of the hits of `query`, sorted. */
const found = async (
  workspace: Workspace,
  query: string,
  more: Record<string, unknown> = {},
): Promise<string[]> => (await search(workspace, query, more)).hits.map((hit) => hit.id.slice(-2)).sort();

/** The one hit of `query` with the UUID tail `tail`. */
const hitOf = async (workspace: Workspace, query: string, tail: string): Promise<Hit> => {
  const hit = (await search(workspace, query)).hits.find((one) => one.id.endsWith(tail));
  if (hit === undefined) {
    throw new Error(`no hit ${tail} for ${query}`);
  }
  return hit;
};

/** The marked parts of a text. */
const marked = (text: string, marks: readonly { start: number; end: number }[] = []): string[] =>
  marks.map((mark) => text.slice(mark.start, mark.end));

const FILTERS = {
  ...element("d1", "Phrase one", "The **Filter** list shows rows.\nAnother list of filter items.\n"),
  ...element("d2", "Phrase two", "A list filter here, rows too.\n"),
  ...element("d3", "Phrase three", "Filterlist and filters list.\n"),
};

describe("phrases in a search (SR-068 AK4)", () => {
  it("[SR-068/AK-p5h7] finds words in quotes only one after the other in this order, in any case, as whole words, without a typo", async () => {
    const ws = await open(FILTERS);
    expect(await found(ws, "filter list")).toEqual(["d1", "d2", "d3"]);
    expect(await found(ws, '"filter list"')).toEqual(["d1"]);
    expect(await found(ws, '"FILTER LIST"')).toEqual(["d1"]);
    expect(await found(ws, '"list filter"')).toEqual(["d2"]);
    // No typo, no prefix, whole words only.
    expect(await found(ws, '"filtr list"')).toEqual([]);
    expect(await found(ws, '"filter lis"')).toEqual([]);
    expect(await found(ws, '"filters"')).toEqual(["d3"]);
    expect(await found(ws, '"filter"')).toEqual(["d1", "d2"]);
    // Words outside the quotes are searched as before, with a typo too.
    expect(await found(ws, '"filter list" shws')).toEqual(["d1"]);
    expect(await found(ws, '"list filter" shows')).toEqual([]);
    // Every phrase must be found.
    expect((await search(ws, '"list filter" "filter list"')).total).toBe(0);
  });

  it("[SR-068/AK-p5h7] lets non-letters and a line break within a paragraph stand between the words, never a border of a paragraph, list item, table cell, heading, value or field", async () => {
    const text = [
      "Wind—speed, _here_.",
      "",
      "Gust",
      "rate is high.",
      "",
      "Storm",
      "",
      "front arrives.",
      "",
      "- calm",
      "- breeze now",
      "  goes on",
      "1. ebb",
      "2. flow",
      "",
      "| sea | level \\| tide |",
      "| --- | --- |",
      "| tide | pool |",
      "",
      "# Heading cloud",
      "burst below",
      "",
      "Setext dawn",
      "===",
      "dusk falls",
      "",
      "```",
      "code frost",
      "bite hard",
      "```",
      "",
      "> quoted rain",
      "> drops",
    ].join("\n");
    const ws = await open(element("e1", "Borders", `${text}\n`));
    for (const [phrase, hit] of [
      ["wind speed here", true],
      ["gust rate", true],
      ["now goes", true],
      ["level tide", true],
      ["quoted rain drops", true],
      ["code frost", true],
      ["storm front", false],
      ["calm breeze", false],
      ["ebb flow", false],
      ["1 ebb", false],
      ["sea level", false],
      ["tide tide", false],
      ["tide pool", false],
      ["cloud burst", false],
      ["dawn dusk", false],
      ["frost bite", false],
      ["dusk falls code", false],
    ] as const) {
      expect(await found(ws, `"${phrase}"`), phrase).toEqual(hit ? ["e1"] : []);
    }
    // A table or a block quote that starts in a block without a blank line before it.
    const starts = await open({
      ...element("f1", "Table start", "Intro line\n| foo | bar |\n| - | - |\n"),
      ...element("f2", "Quote start", "Intro foo\n> bar here\n"),
      ...element("f3", "Quote in item", "- foo\n> bar\n"),
      ...element("f4", "Lazy quote", "> foo\nbar lazy\n"),
    });
    expect(await found(starts, '"foo bar"')).toEqual(["f4"]);
    expect(await found(starts, '"intro line foo"')).toEqual([]);
    expect(await found(starts, '"bar here"')).toEqual(["f2"]);
    // A Markdown value by its units: across a line break of a paragraph, never across list items.
    const notes = await open(
      element("f5", "Notes", "Nothing.\n", "notes: |\n  A sleet\n  squall here.\n\n  - gale\n  - force\n"),
    );
    expect(await found(notes, '"sleet squall"')).toEqual(["f5"]);
    expect(await found(notes, '"gale force"')).toEqual([]);
    // A Markdown value without the destinations of its links: before, around and after a link.
    const links = await open({
      ...element("c1", "Before", "Nothing.\n", "notes: A rain gauge, see [it](https://x.test/a).\n"),
      ...element("c2", "Around", "Nothing.\n", "notes: A [rain](https://x.test/b) gauge.\n"),
      ...element("c3", "Inside", "Nothing.\n", "notes: See [it](https://x.test/rain-gauge).\n"),
      ...element("c4", "After", "Nothing.\n", "notes: See [it](https://x.test/c), no gauge.\n"),
    });
    expect(await found(links, '"rain gauge"')).toEqual(["c1", "c2"]);
    expect(await found(links, '"no gauge"')).toEqual(["c4"]);
    // In one value of a property, never across two values, the title and the text, or two properties.
    const dial = await open();
    expect(await found(dial, '"dial turns"')).toEqual(["a2"]);
    expect(await found(dial, '"hail the dial"')).toEqual([]);
    expect(await found(dial, '"show a dial the dial"')).toEqual([]);
    // In the title of a2, and in a link label of a1.
    expect(await found(dial, '"show a dial"')).toEqual(["a1", "a2"]);
    expect(await found(dial, '"hail sensor"')).toEqual(["a2"]);
    expect(await found(dial, '"sr 202 gale"')).toEqual([]);
    // The name of a choice and the name of the type are values too.
    expect(await found(dial, '"gale warning"')).toEqual(["a2"]);
    expect((await found(dial, '"system requirement"')).length).toBeGreaterThan(1);
  });

  it("[SR-068/AK-p5h7] takes the four quote characters only at the start or after a blank; an open phrase runs to the end, its last word a word start", async () => {
    const ws = await open(FILTERS);
    for (const query of [
      "„filter list“",
      "“filter list”",
      "”filter list”",
      '"filter list„',
      "“filter list”",
    ]) {
      expect(await found(ws, query), query).toEqual(["d1"]);
    }
    // A quote after another character is no phrase: its words are searched as before.
    expect(await found(ws, 'rows"filter list"')).toEqual(["d1", "d2"]);
    // After a closing quote the query goes on outside the phrase.
    expect(await found(ws, '"filter"list')).toEqual(["d1", "d2"]);
    // An open phrase: its last word also begins words, from one letter on.
    expect(await found(ws, '"filter li')).toEqual(["d1"]);
    expect(await found(ws, '"the filter l')).toEqual(["d1"]);
    expect(await found(ws, '"filter l')).toEqual(["d1"]);
    expect(await found(ws, '"filte')).toEqual(["d1", "d2", "d3"]);
    // Quotes without a word between them count for nothing.
    expect(await found(ws, '"" filter list')).toEqual(["d1", "d2", "d3"]);
    expect((await search(ws, '""')).total).toBe(0);
    expect((await search(ws, '" - "')).total).toBe(0);
  });

  it("[SR-068/AK-p5h7] finds the element of a UUID, short ID or identifier in quotes by the ID, first", async () => {
    const ws = await open(element("e2", "Mentions", "See SR 202 and sr-0000a2.\n"));
    for (const query of ['"SR-202"', '"sr-0000a2"', `"${A2}"`, '" SR-202 "']) {
      const { hits } = await search(ws, query);
      expect(hits[0]?.id, query).toBe(A2);
      expect(hits[0]?.fields, query).toContain("id");
    }
    // The text alternative of a quoted ID is the phrase: its words one after the other.
    expect(await found(ws, '"SR-202"')).toEqual(["a2", "e2"]);
    // Without the IDs searched it is a phrase only.
    expect(await found(ws, '"SR-202"', { fields: ["text"] })).toEqual(["e2"]);
    expect(await found(ws, '"SR-202"', { fields: ["id"] })).toEqual(["a2"]);
    expect(await found(ws, '"dial turns"', { fields: ["id"] })).toEqual([]);
  });
});

describe("phrases in the snippet and the title (SR-174 AK6)", () => {
  it("[SR-174/AK-nyfq] marks the phrase as a whole where it stands, across emphasis and a line break, and none of its words elsewhere", async () => {
    const ws = await open({
      ...FILTERS,
      ...element("d4", "Filter list editor", "The list of a filter.\n"),
      ...element("d5", "Gusts", "The **gust\nrate** of the gust and the rate.\n"),
      ...element("d6", "Hard break", "A storm\\\nfront and a storm  \nsurge.\n"),
    });
    const one = await hitOf(ws, '"filter list"', "d1");
    expect(one.snippet?.text).toBe("The Filter list shows rows.");
    expect(marked(String(one.snippet?.text), one.snippet?.marks)).toEqual(["Filter list"]);
    expect(one.titleMarks).toBeUndefined();
    // A word outside the quotes is marked too; inside the phrase it is part of its mark.
    const words = await hitOf(ws, '"filter list" rows filter', "d1");
    expect(marked(String(words.snippet?.text), words.snippet?.marks)).toEqual(["Filter list", "rows"]);
    const wrapped = await hitOf(ws, '"gust rate"', "d5");
    expect(wrapped.snippet?.text).toBe("The gust rate of the gust and the rate.");
    expect(marked(String(wrapped.snippet?.text), wrapped.snippet?.marks)).toEqual(["gust rate"]);
    // Across a hard line break.
    for (const phrase of ["storm front", "storm surge"]) {
      const hard = await hitOf(ws, `"${phrase}"`, "d6");
      expect(marked(String(hard.snippet?.text), hard.snippet?.marks)).toEqual([phrase]);
    }
    // In the title: marked whole; the text, which holds its words apart, gives no snippet.
    const title = await hitOf(ws, '"filter list"', "d4");
    expect(title.fields).toEqual(["title"]);
    expect(marked("Filter list editor", title.titleMarks)).toEqual(["Filter list"]);
    expect(title.snippet).toBeUndefined();
    // Overlapping phrases are one mark.
    const overlap = await hitOf(ws, '"filter list" "list editor"', "d4");
    expect(marked("Filter list editor", overlap.titleMarks)).toEqual(["Filter list editor"]);
    // An open phrase: its last word marked whole.
    const typing = await hitOf(ws, '"filter li', "d4");
    expect(marked("Filter list editor", typing.titleMarks)).toEqual(["Filter list"]);
  });

  it("[SR-174/AK-nyfq] takes the snippet from the first place where the phrase stands whole: a property value, Markdown too", async () => {
    const ws = await open(element("e3", "Links", "Read [the filter](https://example.com/f) list now.\n"));
    // The text holds "dial", but not "dial warns": the value that holds the phrase.
    const warns = await hitOf(ws, '"dial warns"', "a2");
    expect(warns.fields).toEqual(["properties"]);
    expect(warns.snippet).toMatchObject({
      property: "checks",
      text: "The dial warns before a hurricane arrives.",
    });
    expect(marked(String(warns.snippet?.text), warns.snippet?.marks)).toEqual(["dial warns"]);
    const sensor = await hitOf(ws, '"hail sensor"', "a2");
    expect(sensor.snippet).toMatchObject({ property: "notes", text: "A hail sensor beside the dial." });
    expect(marked(String(sensor.snippet?.text), sensor.snippet?.marks)).toEqual(["hail sensor"]);
    // A choice found by its name, marked whole.
    const gale = await hitOf(ws, '"gale warning"', "a2");
    expect(gale.snippet).toMatchObject({ property: "level", text: "Gale warning" });
    expect(marked("Gale warning", gale.snippet?.marks)).toEqual(["Gale warning"]);
    // A phrase across a link: its destination is not read.
    const link = await hitOf(ws, '"filter list"', "e3");
    expect(link.snippet?.text).toBe("Read the filter list now.");
    expect(marked(String(link.snippet?.text), link.snippet?.marks)).toEqual(["filter list"]);
  });
});

describe("phrases in a search restricted to fields (SR-216 AK1)", () => {
  it("[SR-216/AK-wf2k] finds a phrase only in a chosen field, scored by the chosen fields only", async () => {
    const ws = await open(element("e4", "Dial warns", "Nothing.\n"));
    expect(await found(ws, '"dial warns"')).toEqual(["a2", "e4"]);
    expect(await found(ws, '"dial warns"', { fields: ["text"] })).toEqual([]);
    expect(await found(ws, '"dial warns"', { fields: ["title"] })).toEqual(["e4"]);
    expect(await found(ws, '"dial warns"', { fields: ["checks"] })).toEqual(["a2"]);
    expect(await found(ws, '"dial warns"', { fields: ["notes"] })).toEqual([]);
    expect(await found(ws, '"dial warns"', { fields: ["properties"] })).toEqual(["a2"]);
    // The hit names only the fields the phrase stands in, and is scored by them.
    const all = (await search(ws, '"dial warns"')).hits.find((hit) => hit.id === A2);
    const checks = (await search(ws, '"dial warns"', { fields: ["checks"] })).hits[0];
    expect(all?.fields).toEqual(["properties"]);
    expect(checks?.fields).toEqual(["properties"]);
    expect(checks?.score).toBeGreaterThan(0);
    // In the title and the text: both fields, the scores of both added.
    const both = await open(element("e5", "Gust rate", "The gust rate rises.\n"));
    const [inBoth] = (await search(both, '"gust rate"')).hits;
    const inTitle = (await search(both, '"gust rate"', { fields: ["title"] })).hits[0]?.score;
    const inText = (await search(both, '"gust rate"', { fields: ["text"] })).hits[0]?.score;
    expect(inBoth?.fields).toEqual(["title", "text"]);
    expect(inBoth?.score).toBeCloseTo(Number(inTitle) + Number(inText), 4);
    // Every word must be found in a chosen field: the phrase in one, the word in another.
    expect(await found(ws, '"dial turns" shows', { fields: ["checks", "text"] })).toEqual(["a2"]);
    expect(await found(ws, '"dial turns" shows', { fields: ["checks"] })).toEqual([]);
  });
});

describe("phrases over the workspace of the specification", () => {
  it("[SR-174/AK-nyfq] marks one place of the whole phrase in the snippet of every hit the index finds in a text", async () => {
    // Phrases of three words from lines of the texts in spec/: whatever the index finds them in, the
    // snippet shows the phrase whole (the index and the snippet draw the same borders).
    const workspace = new Workspace(fileURLToPath(new URL("../../../../spec", import.meta.url)));
    onTestFinished(() => workspace.close());
    const index = await searchIndex(workspace);
    const phrases = new Set<string>();
    [...index.engine.documents.values()].forEach((document, at) => {
      // The words of the first line of five or more words, as a reader of the line sees them.
      const words = document.text
        .split("\n")
        .map((line) => line.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== ""))
        .find((line) => line.length >= 5);
      if (at % 4 === 0 && words !== undefined) {
        phrases.add(words.slice(1, 4).join(" "));
      }
    });
    expect(phrases.size).toBeGreaterThan(30);
    let hits = 0;
    for (const phrase of phrases) {
      const out = await search(workspace, `"${phrase}"`, { fields: ["text"] });
      expect(out.total, phrase).toBeGreaterThan(0);
      for (const hit of out.hits) {
        const { snippet } = hit;
        const shown = marked(String(snippet?.text), snippet?.marks).map((one) =>
          one
            .toLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .join(" "),
        );
        expect(shown, `${phrase} in ${hit.shortId}`).toContain(phrase.toLowerCase());
        hits++;
      }
    }
    expect(hits).toBeGreaterThan(phrases.size);
  }, 60_000);
});
