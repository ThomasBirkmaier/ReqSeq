// The snippet of a search hit (SR-174) through element.search, on fixtures/SR-174/snippets: SR a1
// "Measure the wind" (a Markdown text with a heading, bold, a link with a title, an inline
// reference, inline code and a list; spec ID SR-201), a2 "Show a dial" (approved; the properties
// checks, notes and level in file order, the type lists level, notes, checks), a3 "Survive icing".
// Other cases add files of their own.
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { MAX, MAX_LINE, searchSnippet } from "./search-snippet.js";
import { searchIndex } from "./search-state.js";

type Output = CommandOutput<"element.search">;
type Hit = Output["hits"][number];

const P = "17400000-0000-4000-8000-0000000000";
const A1 = `${P}a1`;
const A2 = `${P}a2`;
const A3 = `${P}a3`;
const SNIPPETS: FixtureOptions = { fixture: "SR-174/snippets" };

const open = async (files: Readonly<Record<string, string>> = {}): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ ...SNIPPETS, files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const search = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("element.search", input, { workspace })) as Output;

/** The one hit of `query` with the UUID `id`. */
const hitOf = async (workspace: Workspace, query: string, id: string): Promise<Hit> => {
  const hit = (await search(workspace, { query, limit: 500 })).hits.find((one) => one.id === id);
  if (hit === undefined) {
    throw new Error(`no hit ${id} for ${query}`);
  }
  return hit;
};

/** The marked parts of a snippet. */
const marked = (snippet: {
  readonly text: string;
  readonly marks: readonly { start: number; end: number }[];
}): string[] => snippet.marks.map((mark) => snippet.text.slice(mark.start, mark.end));

/** An element file of the fixture's type with `text` and more frontmatter lines. */
const element = (tail: string, title: string, text: string, more = ""): Record<string, string> => ({
  [`requirements/SR-0000000000${tail}.md`]: `---\nid: ${P}${tail}\ntype: system-requirement\nstatus: draft\ntitle: ${title}\n${more}---\n\n${text}`,
});

const codePoints = (text: string): number => Array.from(text).length;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

describe("search hit snippet (SR-174)", () => {
  it("[SR-174/AK1] names the text and shows one line of its visible text without Markdown characters, the match marked", async () => {
    const ws = await open();
    const storm = await hitOf(ws, "storm", A1);
    expect(storm.fields).toEqual(["text"]);
    expect(storm.snippet).toEqual({
      field: "text",
      text: "It warns of a storm above 20 m/s.",
      marks: [{ start: 14, end: 19 }],
    });
    // The words of the link label, the inline code and the inline reference are text, not the
    // link destination; the snippet is from the paragraph of the first match.
    const words = await hitOf(ws, "gusts pulse", A1);
    expect(words.snippet?.text).toBe(
      "The anemometer measures gusts with pulse counting, as Show a dial shows.",
    );
    expect(marked(words.snippet ?? { text: "", marks: [] })).toEqual(["gusts", "pulse"]);
    expect((await hitOf(ws, "anemometer", A1)).snippet?.text).toBe("Anemometer");
    for (const hit of [storm, words]) {
      expect(hit.snippet?.text).not.toMatch(/[*#[\]()`]|https|reqseq:/u);
      expect(codePoints(String(hit.snippet?.text))).toBeLessThanOrEqual(MAX);
    }
  });

  it("[SR-174/AK1] gives no snippet for a match the reader does not see: a link title, HTML, an entity", async () => {
    const ws = await open(
      element(
        "b1",
        "Hidden words",
        'A <span class="secret">calm</span> day &copy; [here](x "Hidden page") ok.\n',
      ),
    );
    for (const query of ["secret", "copy", "page"]) {
      const hit = await hitOf(ws, query, `${P}b1`);
      expect(hit.fields, query).toEqual(["text"]);
      expect(hit.snippet, query).toBeUndefined();
    }
    // Also in a text with other than ASCII characters, which is split into words to compare.
    const other = await open(element("b3", "Andere", 'Ein <b class="geheim">Wort</b> für dich.\n'));
    expect((await hitOf(other, "geheim", `${P}b3`)).snippet).toBeUndefined();
    // The visible word of the same text is found.
    expect((await hitOf(ws, "calm", `${P}b1`)).snippet?.text).toBe("A calm day © here ok.");
  });

  it("[SR-174/AK2] names the property and shows the list item, the nested value and the choice name with the match", async () => {
    const ws = await open(
      element(
        "b2",
        "Nested values",
        "Nothing here.\n",
        "measured:\n  range:\n    top: up to forty knots\n    low: calm\n",
      ),
    );
    const hurricane = await hitOf(ws, "hurricane", A2);
    expect(hurricane.snippet).toEqual({
      field: "properties",
      property: "checks",
      propertyName: "Checks",
      text: "The dial warns before a hurricane arrives.",
      marks: [{ start: 24, end: 33 }],
    });
    // A choice by its name.
    expect((await hitOf(ws, "gale", A2)).snippet).toEqual({
      field: "properties",
      property: "level",
      propertyName: "Level",
      text: "Gale warning",
      marks: [{ start: 0, end: 4 }],
    });
    // A value of a nested mapping, of a property the metamodel does not define: named by its key.
    expect((await hitOf(ws, "knots", `${P}b2`)).snippet).toEqual({
      field: "properties",
      property: "measured",
      propertyName: "measured",
      text: "up to forty knots",
      marks: [{ start: 12, end: 17 }],
    });
  });

  it("[SR-174/AK3] shows one snippet, in the text when a word is found there, else in the first property in metamodel order", async () => {
    const ws = await open();
    // "dial" is in the title, the text and two properties of a2: the text wins.
    const dial = await hitOf(ws, "dial", A2);
    expect(dial.fields).toEqual(["title", "text", "properties"]);
    expect(dial.snippet).toEqual({
      field: "text",
      text: "The dial shows the wind speed.",
      marks: [{ start: 4, end: 8 }],
    });
    // "hail" is in checks (first in the file) and in notes (first in the type): notes, read as Markdown.
    expect((await hitOf(ws, "hail", A2)).snippet).toEqual({
      field: "properties",
      property: "notes",
      propertyName: "Notes",
      text: "A hail sensor beside the dial.",
      marks: [{ start: 2, end: 6 }],
    });
    // Two words: the first place in reading order where one of them is found.
    expect((await hitOf(ws, "speed turns", A2)).snippet?.text).toBe("The dial shows the wind speed.");
  });

  it("[SR-174/AK4] shows no snippet for a match only in the title or an ID, and marks the title", async () => {
    const ws = await open();
    const icing = await hitOf(ws, "icing", A3);
    expect(icing.fields).toEqual(["title"]);
    expect(icing.snippet).toBeUndefined();
    expect(icing.titleMarks).toEqual([{ start: 8, end: 13 }]);
    // The short ID, the identifier (also its words), and the status name.
    for (const [query, id] of [
      ["SR-0000a3", A3],
      ["SR-203", A3],
      ["Approved", A2],
      ["System Requirement", A3],
    ] as const) {
      const hit = await hitOf(ws, query, id);
      expect(hit.snippet, query).toBeUndefined();
      expect(hit.titleMarks, query).toBeUndefined();
    }
    // A word in the title and in the text: the snippet from the text, the title marked as well.
    const wind = await hitOf(ws, "wind", A1);
    expect(wind.titleMarks).toEqual([{ start: 12, end: 16 }]);
  });

  it("reads no file for a search of the title and the IDs only (the [[ search, SR-066)", async () => {
    const ws = await open();
    const out = await search(ws, { query: "dial", fields: ["title", "id"] });
    expect(out.hits.map((hit) => [hit.id, hit.fields, hit.snippet, hit.titleMarks])).toEqual([
      [A2, ["title"], undefined, [{ start: 7, end: 11 }]],
    ]);
  });

  it("compares words as the index does: another Unicode form, another case", async () => {
    const ws = await open(element("c1", "Forms", "We drink Café au lait.\n"));
    const hit = await hitOf(ws, "CAFÉ", `${P}c1`);
    expect(hit.snippet).toEqual({
      field: "text",
      text: "We drink Café au lait.",
      marks: [{ start: 9, end: 14 }],
    });
  });

  it("makes one line: line breaks of any kind and tabs are one space", async () => {
    // A property value as written; in the text the line of the match, which CR, LF or CRLF ends.
    const value = String.raw`"One\r\ntwo\rthree\tfour\u2028five squall."`;
    const ws = await open(
      element("c2", "Lines", "One\r\ntwo\rthree\tfour five gust.\r\n", `remark: ${value}\n`),
    );
    expect((await hitOf(ws, "squall", `${P}c2`)).snippet?.text).toBe("One two three four five squall.");
    expect((await hitOf(ws, "gust", `${P}c2`)).snippet?.text).toBe("three four five gust.");
  });

  it("cuts a long text at word boundaries around the match, within 120 code points, never inside a surrogate pair", async () => {
    const before = Array.from({ length: 30 }, (_, n) => `w${String(n)}𝔸`).join(" ");
    const after = Array.from({ length: 30 }, (_, n) => `v${String(n)}𝔸`).join(" ");
    const ws = await open(element("c3", "Long", `${before} needle ${after}\n`));
    const hit = await hitOf(ws, "needle", `${P}c3`);
    const text = String(hit.snippet?.text);
    expect(text.startsWith("…") && text.endsWith("…")).toBe(true);
    expect(codePoints(text)).toBeLessThanOrEqual(MAX);
    expect(codePoints(text)).toBeGreaterThan(MAX - 8);
    expect(text).not.toMatch(LONE_SURROGATE);
    // Whole words at both ends.
    expect(`${before} needle ${after}`).toContain(text.slice(1, -1));
    expect(text.slice(1, -1)).toMatch(/^w\d+𝔸 .* v\d+𝔸$/u);
    expect(marked(hit.snippet ?? { text: "", marks: [] })).toEqual(["needle"]);
  });

  it("cuts at the start of a long text only at its end, shrinking long words to whole ones", async () => {
    const words = Array.from({ length: 40 }, (_, n) => `abcdefg${String(n)}`).join(" ");
    const ws = await open(
      element("c6", "Start", `needle ${words}\n\n${words} pin ${words}\n\n${words} haven\n`),
    );
    const start = String((await hitOf(ws, "needle", `${P}c6`)).snippet?.text);
    expect(start).toMatch(/^needle abcdefg0 .* abcdefg\d+…$/u);
    expect(codePoints(start)).toBeLessThanOrEqual(MAX);
    const middle = String((await hitOf(ws, "pin", `${P}c6`)).snippet?.text);
    expect(middle).toMatch(/^…abcdefg\d+ .* pin .* abcdefg\d+…$/u);
    expect(codePoints(middle)).toBeLessThanOrEqual(MAX);
    const end = String((await hitOf(ws, "haven", `${P}c6`)).snippet?.text);
    expect(end).toMatch(/^…abcdefg\d+ .* abcdefg39 haven$/u);
    expect(codePoints(end)).toBeLessThanOrEqual(MAX);
  });

  it("reads properties in file order when the metamodel is not valid, an unknown type's too, and shows an unknown choice by its key", async () => {
    const ws = await open(element("f2", "Odd level", "Nothing.\n", "level: medium\n"));
    expect((await hitOf(ws, "medium", `${P}f2`)).snippet).toMatchObject({
      property: "level",
      text: "medium",
    });
    const broken = await open({ "metamodel/broken.yaml": "reqseq-metamodel: [\n" });
    expect((await hitOf(broken, "hail", A2)).snippet).toMatchObject({
      property: "checks",
      propertyName: "Checks",
    });
    const unknown = await open({
      "requirements/G-0000000000f3.md": `---\nid: ${P}f3\ntype: gadget\ntitle: Gadget\ncolour: crimson\n---\n`,
    });
    expect((await hitOf(unknown, "crimson", `${P}f3`)).snippet).toMatchObject({
      property: "colour",
      text: "crimson",
    });
  });

  it("cuts a word longer than the window hard and clips its mark: a sentence of 200 CJK characters", async () => {
    const sentence = "気象観測所は風速を毎秒測定し".repeat(15).slice(0, 200);
    const ws = await open(element("c4", "CJK", `前 ${sentence}\n`));
    const hit = await hitOf(ws, "気象", `${P}c4`);
    const text = String(hit.snippet?.text);
    expect(codePoints(text)).toBe(MAX);
    expect(text).toBe(`…${sentence.slice(0, MAX - 2)}…`);
    expect(hit.snippet?.marks).toEqual([{ start: 1, end: MAX - 1 }]);
    // Never before a combining mark.
    const marks = "e\u0301".repeat(100);
    const ws2 = await open(element("c5", "Marks", `${marks}\n`));
    const cut = String((await hitOf(ws2, marks.normalize("NFC").slice(0, 3), `${P}c5`)).snippet?.text);
    expect(cut.endsWith("́…")).toBe(true);
    expect(codePoints(cut)).toBeLessThanOrEqual(MAX);
  });

  it("reads the visible text of code, image alt texts, tables and reference links, and skips HTML blocks", async () => {
    const ws = await open(
      element(
        "d1",
        "Blocks",
        [
          "<div>",
          "html block",
          "</div>",
          "",
          "```",
          "fenced radar code",
          "",
          "more code",
          "```",
          "![radar picture](radar.png) ![](empty.png)",
          "",
          "| Sensor | Unit |",
          "| --- | --- |",
          "| thermometer | kelvin |",
          "",
          "See the [manual][guide].",
          "",
          "[guide]: https://example.com/manual",
          "",
        ].join("\n"),
      ),
    );
    const radar = await hitOf(ws, "radar", `${P}d1`);
    expect(radar.snippet?.text).toBe("fenced radar code");
    expect((await hitOf(ws, "picture", `${P}d1`)).snippet?.text).toBe("radar picture");
    expect((await hitOf(ws, "kelvin", `${P}d1`)).snippet?.text).toBe("Sensor Unit thermometer kelvin");
    expect((await hitOf(ws, "manual", `${P}d1`)).snippet?.text).toBe("See the manual.");
    expect((await hitOf(ws, "block", `${P}d1`)).snippet).toBeUndefined();
  });

  it("parses the line of the match only, a long one cut around it", async () => {
    // A paragraph of many lines: the snippet is the line of the match.
    const lines = Array.from({ length: 400 }, (_, n) => `line ${String(n)} of *text*`);
    lines[300] = "the *buoy* line";
    const long = `${"x ".repeat(MAX_LINE)}the *mooring* word ${"y ".repeat(MAX_LINE)}`;
    const ws = await open(element("e1", "Long block", `${lines.join("\n")}\n\n${long}\n`));
    expect((await hitOf(ws, "buoy", `${P}e1`)).snippet?.text).toBe("the buoy line");
    const mooring = String((await hitOf(ws, "mooring", `${P}e1`)).snippet?.text);
    expect(mooring).toMatch(/^…x x .* the mooring word y .* y…$/u);
    expect(codePoints(mooring)).toBeLessThanOrEqual(MAX);
    // A match in the last line of a text without a line break after it, and in a fence without its end.
    const ws2 = await open(element("e2", "Last", "~~~\nfence pier\n\n~~~\nend of the *pier*"));
    expect((await hitOf(ws2, "pier", `${P}e2`)).snippet?.text).toBe("fence pier");
    const ws3 = await open(element("e3", "Last", "```pier\n```\nend of the *pier*\n\n~~~\nfirst\nlast quay"));
    expect((await hitOf(ws3, "pier", `${P}e3`)).snippet?.text).toBe("end of the pier");
    expect((await hitOf(ws3, "quay", `${P}e3`)).snippet?.text).toBe("last quay");
  });

  it("reads indented code, a table head and rows after CRLF, a paragraph with a bar, and skips a long HTML block", async () => {
    const html = `<div>\n${"<p>filler</p>\n".repeat(MAX_LINE)}harbour\n</div>\n`;
    const ws = await open(
      element(
        "9a",
        "More blocks",
        `    indented gauge code\n\n| Wharf | Unit |\r\n| --- | --- |\r\n| x | y |\r\n\nwind | gale\nwith *jetty*\n\n${html}`,
      ),
    );
    expect((await hitOf(ws, "gauge", `${P}9a`)).snippet?.text).toBe("indented gauge code");
    expect((await hitOf(ws, "wharf", `${P}9a`)).snippet?.text).toBe("Wharf Unit");
    expect((await hitOf(ws, "jetty", `${P}9a`)).snippet?.text).toBe("with jetty");
    expect((await hitOf(ws, "harbour", `${P}9a`)).snippet).toBeUndefined();
  });

  it("gives the properties as the index read them when the file no longer holds the element", async () => {
    const fixture = await createFixtureWorkspace(SNIPPETS);
    onTestFinished(() => fixture.cleanup());
    const ws = new Workspace(fixture.root);
    onTestFinished(() => ws.close());
    expect((await hitOf(ws, "hurricane", A2)).snippet).toMatchObject({ property: "checks" });
    // Another element in the file now: the text is not read, the record's properties still are.
    const index = await searchIndex(ws);
    await fixture.write(
      "requirements/SR-0000000000a2.md",
      "---\nid: 17400000-0000-4000-8000-0000000000ff\ntype: system-requirement\ntitle: Other\n---\n",
    );
    const record = index.store.elements.find((one) => one.id === A2);
    expect(
      record === undefined
        ? undefined
        : searchSnippet(index, { element: record, fields: ["text", "properties"], terms: ["hurricane"] }),
    ).toMatchObject({ property: "checks", text: "The dial warns before a hurricane arrives." });
    expect(
      record === undefined
        ? undefined
        : searchSnippet(index, { element: record, fields: ["text"], terms: ["dial"] }),
    ).toBeUndefined();
  });
});
