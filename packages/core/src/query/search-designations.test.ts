// A search finds an element by its other designations (SR-220), on fixtures/SR-220/designations:
// glossary terms d1 "Paket" (synonym "Bündel", English term "Package"), d2 "Freigegebene Fassung"
// ("Released version"), d3 "Anforderung" ("Requirement"), d4 "Zeitstempel" ("Timestamp", obsolete,
// a status the metamodel marks invalid), d5 "Freigegeben" ("Released"); system requirements c1
// "Paket laden" (text "Das Tool lädt ein Paket aus dem Ordner."), c2 "Pakete zeigen" (no text), c3
// "Package export" (identifier REQ-3, text "Exports a package as a file."), c4 "Ablage" (text "Die
// freigegebene Fassung bleibt gespeichert."), c5 "Prüfung" (text "Jede Anforderung hat einen
// Test."), c6 "Zeit" (text "Jeder Eintrag hat einen Zeitstempel."), c7 "Altes Paket" (obsolete), c8
// "Liste" (text "Siehe REQ-3 für das Paket."), c9 "Messung" (notes "Ein Paket je Messung.").
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { applyStoreChange, elementStoreState, updateElements } from "../model/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { parseQuery } from "./phrase-text.js";
import { designationRuns, designationTable } from "./search-designations.js";
import type { SearchElementsOptions, SearchIndex } from "./search-index.js";
import { matchingKeys, rankedHits, recordKey, searchElements } from "./search-index.js";
import { searchIndex } from "./search-state.js";

type Output = CommandOutput<"element.search">;

const ID = "22022000-0000-4000-8000-0000000000";

/** The metamodel of the fixture with `english-term` replaced by `line`. */
const METAMODEL = "metamodel/model.yaml";

const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ readonly fixture: FixtureWorkspace; readonly workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-220/designations", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

/** The fixture's metamodel with `from` replaced by `to`. */
const metamodelWith = async (from: string, to: string): Promise<string> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-220/designations" });
  onTestFinished(() => fixture.cleanup());
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(fixture.path(METAMODEL), "utf8");
  expect(text).toContain(from);
  return text.replace(from, to);
};

/** A glossary term with the frontmatter lines `lines`. */
const term = (tail: string, lines: readonly string[]): string =>
  ["---", `id: ${ID}${tail}`, "type: glossary-term", "status: approved", ...lines, "---", ""].join("\n");

/** A system requirement with the frontmatter lines `lines` and the text `text`. */
const requirement = (tail: string, lines: readonly string[], text = ""): string =>
  ["---", `id: ${ID}${tail}`, "type: system-requirement", "status: draft", ...lines, "---", "", text].join(
    "\n",
  );

const search = async (
  workspace: Workspace,
  query: string,
  more: Record<string, unknown> = {},
): Promise<Output> => (await invoke("element.search", { query, ...more }, { workspace })) as Output;

/** The UUID tails of the hits of `query` in their order. */
const order = async (
  workspace: Workspace,
  query: string,
  more: Record<string, unknown> = {},
): Promise<string[]> => (await search(workspace, query, more)).hits.map((hit) => hit.id.slice(-2));

/** The ranked hits of `query` as `tail`, `tail other` or `tail late`. */
const ranked = (index: SearchIndex, query: string, options: SearchElementsOptions = {}): string[] =>
  rankedHits(index, query, options).map(
    (hit) => `${hit.element.id.slice(-2)}${hit.late ? " late" : hit.other ? " other" : ""}`,
  );

/** The UUID tails `query` finds, sorted. */
const found = (index: SearchIndex, query: string, options: SearchElementsOptions = {}): string[] => {
  const keys = matchingKeys(index, query, options);
  return index.store.elements
    .filter((record) => keys.has(recordKey(record)))
    .map((r) => r.id.slice(-2))
    .sort();
};

/** Writes files as the user's editor does and applies them the way the watcher does (SR-007). */
const external = async (
  fixture: FixtureWorkspace,
  workspace: Workspace,
  files: Readonly<Record<string, string>>,
): Promise<void> => {
  for (const [file, text] of Object.entries(files)) {
    await fixture.write(file, text);
  }
  const layout = await workspace.get(workspaceLayoutState);
  await applyStoreChange(workspace, (store) =>
    updateElements(store, layout, new Map([["system", { paths: Object.keys(files) }]])),
  );
};

describe("other designations (SR-220)", () => {
  it("[SR-220/AK-bfrh] finds the elements in which another designation of an element stands, inflected too, and still needs the other words", async () => {
    const { workspace } = await open();
    const index = await searchIndex(workspace);
    // `package` is the English term of d1: "Paket" and "Pakete" count, and so does its synonym.
    expect(found(index, "package")).toEqual(["c1", "c2", "c3", "c7", "c8", "c9", "d1"]);
    // Every designation finds the others: the title, a synonym and the translation, in any case.
    expect(found(index, "PAKET")).toEqual(found(index, "package"));
    expect(found(index, "bündel")).toEqual(found(index, "package"));
    // The other words of the query must still be found.
    expect(found(index, "package laden")).toEqual(["c1"]);
    expect(found(index, "Ordner package")).toEqual(["c1"]);
    // The designation itself is matched without a typo; a typo finds only the word itself.
    expect(found(index, "packge")).toEqual(["c3", "d1"]);
    // The longest designation at one place counts: "released version", not "released" and "version".
    expect(found(index, "released version")).toEqual(["c4", "d2"]);
    expect(found(index, "released")).toEqual(["c4", "d2", "d5"]);
    // Only consecutive words outside quotes: a phrase between them separates them.
    expect(found(index, 'released "bleibt" version')).toEqual([]);
    expect(found(index, 'released "bleibt"')).toEqual(["c4"]);
    // A phrase is never expanded.
    expect(found(index, '"package"')).toEqual(["c3", "d1"]);
    // Words without a letter or digit inside a run are left out, as the search leaves them out.
    expect(found(index, "released - version")).toEqual(["c4", "d2"]);
    // Each run of the query counts through its own designations; "requirement" is in the type name.
    expect(found(index, "bündel requirement")).toEqual(["c1", "c2", "c3", "c7", "c8", "c9"]);
    expect(found(index, "package exports anforderung")).toEqual(["c3"]);
    // With any word enough, the run is one part of the query.
    expect(found(index, "package zeit")).toEqual([]);
    expect(found(index, "package zeit", { combineWith: "or" })).toEqual(
      [...found(index, "package"), "c6", "d4"].sort(),
    );
  });

  it("[SR-220/AK-bfrh] matches the other designations as whole words without a typo, the last one as a word start, in any case", async () => {
    const { workspace } = await open({
      "requirements/SR-0000000000e1.md": requirement("e1", ["title: Ein Pakat"]),
      "requirements/SR-0000000000e2.md": requirement("e2", ["title: Die FREIGEGEBENE fassungen"]),
      "requirements/SR-0000000000e3.md": requirement("e3", ["title: Die Fassung freigegebene"]),
      "requirements/SR-0000000000e4.md": requirement("e4", ["title: Unfreigegebene Fassung"]),
    });
    const index = await searchIndex(workspace);
    expect(found(index, "released version")).toEqual(["c4", "d2", "e2"]);
    expect(found(index, "package")).not.toContain("e1");
  });

  it("[SR-220/AK-bfrh] takes the designations from every element of the workspace, whatever the selection and the fields, and of all elements that share one", async () => {
    const { workspace } = await open({
      "terms/GT-0000000000d6.md": term("d6", ["title: Lieferung", "english-term: Package"]),
      "requirements/SR-0000000000e1.md": requirement("e1", ["title: Lieferung prüfen"]),
    });
    const index = await searchIndex(workspace);
    // Both terms are "Package": their designations count for it, but not for each other's title.
    expect(found(index, "package")).toEqual(["c1", "c2", "c3", "c7", "c8", "c9", "d1", "d6", "e1"]);
    expect(found(index, "paket")).not.toContain("e1");
    // Within a selection without the glossary term, its designations still count (SR-068 AK3).
    expect(await order(workspace, "package", { selection: { ids: [`${ID}c1`, `${ID}c8`] } })).toEqual([
      "c1",
      "c8",
    ]);
    // In the title alone, also without the fields that hold the designations.
    expect(found(index, "package", { fields: ["title"] })).toEqual([
      "c1",
      "c2",
      "c3",
      "c7",
      "d1",
      "d6",
      "e1",
    ]);
  });

  it("[SR-216/AK-wf2k] finds through another designation only in the chosen fields, with every other word there", async () => {
    const { workspace } = await open();
    const index = await searchIndex(workspace);
    expect(found(index, "package", { propertyKeys: ["notes"] })).toEqual(["c9"]);
    expect(found(index, "package messung", { propertyKeys: ["notes"] })).toEqual(["c9"]);
    expect(found(index, "package messung", { fields: ["title"] })).toEqual([]);
    expect(found(index, "package", { fields: ["text"] })).toEqual(["c1", "c3", "c8"]);
    // Without a field of words there are no other designations.
    expect(found(index, "package", { fields: ["id"] })).toEqual([]);
    expect((await search(workspace, "package", { fields: ["notes"] })).hits.map((h) => h.fields)).toEqual([
      ["properties"],
    ]);
  });

  it("[SR-220/AK-z3ht] orders literal hits first, then hits through another designation, then those through a type or status name; ID matches stay first", async () => {
    const { workspace } = await open();
    const index = await searchIndex(workspace);
    expect(ranked(index, "package")).toEqual([
      "c3",
      "d1",
      "c1 other",
      "c7 other",
      "c9 other",
      "c2 other",
      "c8 other",
    ]);
    // "requirement" stands in the type name of every system requirement (SR-068 AK5): c5 holds
    // "Anforderung" in its text, so it is a hit through another designation, not a late one.
    expect(ranked(index, "requirement")).toEqual([
      "d3",
      "c5 other",
      "c1 late",
      "c2 late",
      "c4 late",
      "c6 late",
      "c7 late",
      "c8 late",
      "c3 late",
      "c9 late",
    ]);
    // A hit through another designation comes first when a word matches its ID (REQ-3 of c3).
    expect(await order(workspace, "paket REQ-3")).toEqual(["c3", "c8"]);
    expect(ranked(index, "paket REQ-3")).toEqual(["c3 other", "c8"]);
    // Any word enough: the ID match first, then the literal hits, then the others.
    expect(ranked(index, "paket SR-0000000000c6", { combineWith: "or" })).toEqual([
      "c6",
      "c1",
      "d1",
      "c7",
      "c9",
      "c2",
      "c8",
      "c3 other",
    ]);
    // A word that can match nothing in the fields searched still finds nothing.
    expect(ranked(index, "package", { fields: ["id"] })).toEqual([]);
    // The page and the grouped search keep the order.
    expect(await order(workspace, "package", { limit: 3 })).toEqual(["c3", "d1", "c1"]);
    const grouped = await search(workspace, "package", { group: "type" });
    expect(grouped.hits.map((hit) => hit.id.slice(-2))).toEqual(["d1", "c3", "c1", "c7", "c9", "c2", "c8"]);
  });

  it("[SR-220/AK-vh5r] marks the place of another designation as a whole, in the snippet at the first place and in the title; a hit only in the title has no snippet", async () => {
    const { workspace } = await open();
    const hits = new Map(
      (await search(workspace, "released version")).hits.map((hit) => [hit.id.slice(-2), hit]),
    );
    // The multi-word designation is one mark in the snippet, and one in the title.
    expect(hits.get("c4")?.snippet).toEqual({
      field: "text",
      text: "Die freigegebene Fassung bleibt gespeichert.",
      marks: [{ start: 4, end: 24 }],
    });
    expect(hits.get("c4")?.titleMarks).toBeUndefined();
    // A literal hit also marks the other designations it holds.
    expect(hits.get("d2")?.titleMarks).toEqual([{ start: 0, end: 20 }]);
    const words = new Map((await search(workspace, "package")).hits.map((hit) => [hit.id.slice(-2), hit]));
    // A one-word designation is a word of `terms`, marked in the title and the snippet, here an inflected one.
    expect(words.get("c2")).toMatchObject({ terms: ["pakete"], titleMarks: [{ start: 0, end: 6 }] });
    expect(words.get("c2")?.snippet).toBeUndefined();
    expect(words.get("c1")).toMatchObject({
      fields: ["title", "text"],
      titleMarks: [{ start: 0, end: 5 }],
      snippet: {
        field: "text",
        text: "Das Tool lädt ein Paket aus dem Ordner.",
        marks: [{ start: 18, end: 23 }],
      },
    });
    // The first place in reading order: the synonym comes before the English term (metamodel order).
    expect(words.get("d1")?.snippet).toEqual({
      field: "properties",
      property: "synonyms",
      propertyName: "Synonyms",
      text: "Bündel",
      marks: [{ start: 0, end: 6 }],
    });
  });

  it("[SR-220/AK-ps8z] leaves out the designations of an element with an invalid status, and applies a change at the next search, also from outside", async () => {
    const { fixture, workspace } = await open();
    const first = await searchIndex(workspace);
    // d4 "Zeitstempel" is obsolete: "timestamp" finds it by its own words only, not c6.
    expect(found(first, "timestamp")).toEqual(["d4"]);
    // c7 is obsolete too: still found, also through the designations of others.
    expect(found(first, "package")).toContain("c7");
    await invoke("element.setStatus", { refs: [`${ID}d4`], status: "approved" }, { workspace });
    const saved = await searchIndex(workspace);
    expect(found(saved, "timestamp")).toEqual(["c6", "d4"]);
    // The index before keeps its table.
    expect(found(first, "timestamp")).toEqual(["d4"]);
    // A change of the designations of an element through a save.
    await invoke("element.update", { ref: `${ID}d1`, set: { "english-term": "Parcel" } }, { workspace });
    const renamed = await searchIndex(workspace);
    expect(found(renamed, "package")).toEqual(["c3"]);
    expect(found(renamed, "parcel")).toEqual(["c1", "c2", "c7", "c8", "c9", "d1"]);
    // A change from outside: the title of an element with synonyms, and its status back to invalid.
    await external(fixture, workspace, {
      "terms/GT-0000000000d1.md": term("d1", ["title: Messung", "english-term: Parcel"]),
      "terms/GT-0000000000d4.md": term("d4", ["title: Zeitstempel", "english-term: Timestamp"]).replace(
        "status: approved",
        "status: obsolete",
      ),
    });
    const outside = await searchIndex(workspace);
    expect(found(outside, "parcel")).toEqual(["c9", "d1"]);
    expect(found(outside, "timestamp")).toEqual(["d4"]);
  });

  it("[SR-220/AK-zgz1] searches as without designations when the metamodel maps no synonyms and no translation, and reports nothing", async () => {
    const mapped = await open();
    const plain = await open({
      [METAMODEL]: (await metamodelWith("meaning: synonyms }", "}")).replace(
        ", meaning: translation }",
        " }",
      ),
    });
    const index = await searchIndex(plain.workspace);
    expect(found(index, "package")).toEqual(["c3", "d1"]);
    // Literal hits keep their scores and order: the designations change nothing for them.
    const before = searchElements(await searchIndex(mapped.workspace), "package").hits.slice(0, 2);
    const after = searchElements(index, "package").hits;
    expect(after.map((hit) => [hit.element.id, hit.score])).toEqual(
      before.map((hit) => [hit.element.id, hit.score]),
    );
    expect(after.map((hit) => [hit.terms, hit.phrases])).toEqual([
      [["package"], []],
      [["package"], []],
    ]);
    // No message: the output has what it has with the meanings mapped.
    expect(Object.keys(await search(plain.workspace, "package"))).toEqual(
      Object.keys(await search(mapped.workspace, "package")),
    );
    const check = (await invoke(
      "workspace.check",
      {},
      { workspace: plain.workspace },
    )) as CommandOutput<"workspace.check">;
    expect(check.problems.filter((problem) => problem.code.startsWith("metamodel."))).toEqual([]);
  });

  it("[SR-220/AK-dt3r] selects with the condition text the elements the search finds, in a filter, a saved filter and a perspective", async () => {
    const { workspace } = await open();
    const searched = (await search(workspace, 'package "aus dem"')).hits.map((hit) => hit.id).sort();
    expect(searched).toEqual([`${ID}c1`]);
    const all = (await search(workspace, "package")).hits.map((hit) => hit.id).sort();
    const ids = (out: unknown): string[] =>
      ((out as CommandOutput<"element.list">).elements ?? []).map((element) => element.id).sort();
    const list = (input: Record<string, unknown>): Promise<unknown> =>
      invoke("element.list", input, { workspace });
    expect(ids(await list({ selection: { where: { text: "package" } } }))).toEqual(all);
    expect(ids(await list({ selection: { where: { text: 'package "aus dem"' } } }))).toEqual(searched);
    await invoke("filter.save", { name: "parcels", where: { text: "package" } }, { workspace });
    expect(ids(await list({ selection: { filter: "parcels" } }))).toEqual(all);
    await invoke("perspective.save", { name: "Parcels", where: { text: "package" } }, { workspace });
    expect(ids(await list({ perspective: "Parcels" }))).toEqual(all);
    // The facets of a search count the same elements.
    const facets = (await invoke(
      "element.facets",
      { search: { query: "package" } },
      { workspace },
    )) as CommandOutput<"element.facets">;
    expect(facets.total).toBe(all.length);
  });
});

describe("designationTable and designationRuns", () => {
  const tableOf = async (files: Readonly<Record<string, string>>) => {
    const { workspace } = await open(files);
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    return designationTable(store.elements, metamodel);
  };

  it("[SR-220/AK-bfrh] reads every value of a text property, a Markdown one by its visible words, and no value without a letter or digit", async () => {
    const markdown = await metamodelWith(
      "{ key: english-term, name: English Term, kind: text, meaning: translation }",
      "{ key: english-term, name: English Term, kind: text, many: true, markdown: true, meaning: translation }",
    );
    const table = await tableOf({
      [METAMODEL]: markdown,
      "terms/GT-0000000000d1.md": term("d1", [
        "title: Paket",
        "synonyms: [Bündel, '--', 2026, true]",
        "english-term: ['[Package](https://example.com/x)', '**Parcel**']",
      ]),
      "terms/GT-0000000000d7.md": term("d7", ["synonyms: [Ohne Titel]"]),
      "terms/GT-0000000000d8.md": term("d8", ["title: Allein", "synonyms: [Allein]"]),
    });
    expect([...(table?.others.get("paket") ?? [])].map((phrase) => phrase.words.join(" "))).toEqual([
      "bündel",
      "2026",
      "package",
      "parcel",
    ]);
    // An element without a title and with one designation, and one whose designations are one, add none.
    expect(table?.others.has("ohne titel")).toBe(false);
    expect(table?.others.has("allein")).toBe(false);
    expect(table?.others.get("2026")).toContainEqual({ words: ["paket"], prefix: true });
    // The same designation is one phrase in the whole table.
    const parcel = (key: string) => table?.others.get(key)?.find((phrase) => phrase.words[0] === "parcel");
    expect(parcel("bündel")).toBe(parcel("paket"));
  });

  it("[SR-220/AK-bfrh] has none for a property of another kind, a metamodel without a title, or no element with a designation", async () => {
    const wrongKind = await metamodelWith(
      "{ key: english-term, name: English Term, kind: text, meaning: translation }",
      "{ key: english-term, name: English Term, kind: number, meaning: translation }",
    );
    const english = (await tableOf({ [METAMODEL]: wrongKind }))?.others;
    expect(english?.has("package")).toBe(false);
    expect(english?.get("paket")?.map((phrase) => phrase.words.join(" "))).toEqual(["bündel"]);
    const noTitle = await metamodelWith(
      "{ key: title, name: Title, kind: text, meaning: title }",
      "{ key: title, name: Title, kind: text }",
    );
    const untitled = (await tableOf({ [METAMODEL]: noTitle }))?.others;
    expect(untitled?.get("package")?.map((phrase) => phrase.words.join(" "))).toEqual(["bündel"]);
    expect(untitled?.has("paket")).toBe(false);
    // No element with a synonym or a translation: no table.
    const none = await tableOf(
      Object.fromEntries(
        ["d1", "d2", "d3", "d4", "d5"].map((tail) => [
          `terms/GT-0000000000${tail}.md`,
          term(tail, ["title: T"]),
        ]),
      ),
    );
    expect(none).toBeUndefined();
  });

  it("[SR-220/AK-bfrh] takes the longest designation at each place, left to right, and never one across a phrase", () => {
    const phrase = (text: string) => ({ words: text.split(" "), prefix: true });
    const table = {
      others: new Map([
        ["a b", [phrase("x")]],
        ["b c d", [phrase("y")]],
        ["a", [phrase("z")]],
      ]),
      longest: 3,
    };
    const runs = (query: string) => {
      const { runs: found, rest } = designationRuns(table, parseQuery(query).segments);
      return { runs: found.map((run) => run.words.join(" ")), rest };
    };
    // Overlapping designations: left to right, the longest at each place (assumption of #1817).
    expect(runs("a b c d")).toEqual({ runs: ["a b"], rest: ["c", "d"] });
    expect(runs("A b-c d a")).toEqual({ runs: ["A", "b-c d", "a"], rest: [] });
    expect(runs('a "b" c d')).toEqual({ runs: ["a"], rest: ["c", "d"] });
    expect(runs("a ! b e")).toEqual({ runs: ["a b"], rest: ["!", "e"] });
  });
});
