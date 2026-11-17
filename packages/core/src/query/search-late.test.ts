// Hits found only through the name of their type or status come after the others (SR-068 AK5),
// through element.search and the ranked hits of the index, on fixtures/SR-068/late: packages a1
// "Sensors", a2 "Displays" (draft), a3 "Alarms" (obsolete), a4 "Package tools", a5 "Pakage list";
// system requirements b1 (notes "Each package of readings is kept."), b2 (text "The display shows
// the package of the sensors.", draft), b3 (text "An old package.", obsolete), b4 "Average wind"
// (in review), b5 "Check wind" (text "... stay in review for a week ...", draft).
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import type { SearchElementsOptions } from "./search-index.js";
import { rankedHits, searchElements } from "./search-index.js";
import { searchIndex } from "./search-state.js";

type Output = CommandOutput<"element.search">;

const open = async (): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-068/late" });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

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

/** The ranked hits of `query` as `tail` or `tail late`, with their rounded scores. */
const ranked = async (
  workspace: Workspace,
  query: string,
  options: Omit<SearchElementsOptions, "offset" | "limit"> = {},
): Promise<{ hits: string[]; scores: number[] }> => {
  const hits = rankedHits(await searchIndex(workspace), query, options);
  return {
    hits: hits.map((hit) => `${hit.element.id.slice(-2)}${hit.late ? " late" : ""}`),
    scores: hits.map((hit) => hit.score),
  };
};

/** Whether `scores` descend (equal ones allowed). */
const descending = (scores: readonly number[]): boolean =>
  scores.every((score, at) => at === 0 || score <= Number(scores[at - 1]));

describe("hits found only through a type or status name (SR-068 AK5)", () => {
  it("[SR-068/AK-rbwp] lists the hits of a word only in the type name after all others, each group by relevance, and finds them all", async () => {
    const ws = await open();
    const out = await search(ws, "package");
    // The packages a1 to a3 hold "package" only in their type name; their score is higher than that
    // of b1, which holds it in a property.
    expect(out.hits.map((hit) => [hit.id.slice(-2), hit.score])).toEqual([
      ["a4", 6.60802],
      ["a5", 3.09078],
      ["b3", 2.23633],
      ["b2", 1.82767],
      ["b1", 0.559403],
      ["a1", 0.882281],
      ["a2", 0.882281],
      ["a3", 0.882281],
    ]);
    // Hits by the type name stay hits: the total and the text filter count them.
    expect(out.total).toBe(8);
    const filtered = (await invoke(
      "element.list",
      { selection: { where: { text: "package" } } },
      { workspace: ws },
    )) as CommandOutput<"element.list">;
    expect(filtered.total).toBe(8);
    // a4 holds the word in its title and its type name, a5 a typo of it in its title (AK2): not late.
    expect((await ranked(ws, "package")).hits).toEqual([
      "a4",
      "a5",
      "b3",
      "b2",
      "b1",
      "a1 late",
      "a2 late",
      "a3 late",
    ]);
    expect((await ranked(ws, "pakage")).hits).toEqual([
      "a5",
      "a4",
      "b3",
      "b2",
      "b1",
      "a1 late",
      "a2 late",
      "a3 late",
    ]);
    // A word in quotes alone is the word without a typo.
    expect((await ranked(ws, '"package"')).hits).toEqual([
      "a4",
      "b3",
      "b2",
      "b1",
      "a1 late",
      "a2 late",
      "a3 late",
      "a5 late",
    ]);
  });

  it("[SR-068/AK-rbwp] puts a hit after the others when one of its words, or one part of a word, is only in the type or status name", async () => {
    const ws = await open();
    // a1: "sensors" in the title, "package" only in the type name.
    const two = await ranked(ws, "sensors package");
    expect(two.hits).toEqual(["b2", "a1 late"]);
    expect(Number(two.scores[1])).toBeGreaterThan(Number(two.scores[0]));
    // b4: "wind" in the title, "review" only in the status name "In review".
    const parts = await ranked(ws, "wind-review");
    expect(parts.hits).toEqual(["b5", "b4 late"]);
    expect(Number(parts.scores[1])).toBeGreaterThan(Number(parts.scores[0]));
    // A status name alone, as a word and as a phrase.
    expect((await ranked(ws, "review")).hits).toEqual(["b5", "b4 late"]);
    expect((await ranked(ws, '"in review"')).hits).toEqual(["b5", "b4 late"]);
    expect((await ranked(ws, "draft")).hits).toEqual(["a2 late", "b2 late", "b5 late"]);
  });

  it("[SR-068/AK-rbwp] keeps an ID hit first, and orders any word with or without the type or status name", async () => {
    const ws = await open();
    const index = await searchIndex(ws);
    const tails = (query: string, options: SearchElementsOptions = {}): string[] =>
      searchElements(index, query, options).hits.map((hit) => hit.element.id.slice(-2));
    expect(tails("package PKG-0000a2")).toEqual(["a2"]);
    expect(tails("package PKG-0000a2", { combineWith: "or" })).toEqual([
      "a2",
      "a4",
      "a5",
      "b3",
      "b2",
      "b1",
      "a1",
      "a3",
    ]);
    // With any word: late when a word that found it found it only through the type name.
    expect((await ranked(ws, "sensors package", { combineWith: "or" })).hits).toEqual([
      "b2",
      "a4",
      "a5",
      "b3",
      "b1",
      "a1 late",
      "a2 late",
      "a3 late",
    ]);
    // a1 is found by "sensors" in its title, not by "review"; b4 by "review" only in its status name.
    const any = (await ranked(ws, "sensors review", { combineWith: "or" })).hits;
    expect([...any].sort()).toEqual(["a1", "b2", "b4 late", "b5"]);
    expect(any.at(-1)).toBe("b4 late");
  });

  it("[SR-068/AK-rbwp] counts the type and status names only where all properties are searched (SR-216 AK2)", async () => {
    const ws = await open();
    expect((await ranked(ws, "package", { fields: ["properties"] })).hits).toEqual([
      "b1",
      "a1 late",
      "a2 late",
      "a3 late",
      "a4 late",
      "a5 late",
    ]);
    const words = await ranked(ws, "package", { fields: ["title", "text"] });
    expect(words.hits).toEqual(["a4", "b3", "a5", "b2"]);
    expect(descending(words.scores)).toBe(true);
    expect((await ranked(ws, "package", { propertyKeys: ["notes"] })).hits).toEqual(["b1"]);
    expect(await order(ws, "review", { fields: ["title", "text"] })).toEqual(["b5"]);
  });
});

describe("the order of late hits in lists of hits", () => {
  it("[SR-149/AK-byyt] keeps the late hits after the others inside each group", async () => {
    const ws = await open();
    const out = await search(ws, "package", { group: "status" });
    const groups = (out.groups ?? []).map(
      ({ value, count, offset }) =>
        `${String(value ?? "-")}: ${out.hits
          .slice(offset, offset + count)
          .map((hit) => hit.id.slice(-2))
          .join(" ")}`,
    );
    expect(groups).toEqual(["draft: b2 a2", "approved: a4 a5 b1 a1", "obsolete: b3 a3"]);
  });

  it("[SR-201/AK-d03x] orders the hits in place and those of the section at the end each with the late hits last", async () => {
    const ws = await open();
    const folded = { status: ["obsolete"] };
    expect(await order(ws, "package", { selection: { where: { not: folded } } })).toEqual([
      "a4",
      "a5",
      "b2",
      "b1",
      "a1",
      "a2",
    ]);
    expect(await order(ws, "package", { selection: { where: folded } })).toEqual(["b3", "a3"]);
  });

  it("[SR-183/AK-qq2p] gives the first hits of a page in the order of the whole list, late hits last", async () => {
    const ws = await open();
    const all = await order(ws, "package");
    for (const limit of [1, 5, 6, 7]) {
      expect(await order(ws, "package", { limit })).toEqual(all.slice(0, limit));
    }
    expect(await order(ws, "package", { limit: 2, offset: 5 })).toEqual(["a1", "a2"]);
  });
});
