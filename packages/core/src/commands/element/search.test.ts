// element.search (SR-068) on fixtures/SR-069/filter (see list.test.ts for its elements) and on
// fixtures/enabler-305/identifiers (spec IDs in the property spec-id, meaning identifier, #305):
// - SR b1 "Measure wind speed" (approved, topic Wind), b2 "Measure every second" (draft, valid for
//   V1 Coastal), b3 "Survive icing" (valid for V2 Mountain), b4 "Show a dial" (obsolete, unknown
//   property owner: Dana), b5 "Send data to the cloud" (source: Supplier A); SWR f1, f2; needs N1
//   "See the wind", N2 "Warn of storms".
// The search index itself (words, fuzzy and prefix, IDs, carries) is tested in
// query/search-index.test.ts; here the command: selection, fields, page and output.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions } from "@logreq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Output = CommandOutput<"element.search">;

const P = "69069069-0000-4000-8000-0000000000";
const [N1, N2, B1, B2, B3, B4, B5, F1, F2] = ["a1", "a2", "b1", "b2", "b3", "b4", "b5", "f1", "f2"].map(
  (tail) => `${P}${tail}`,
) as [string, string, string, string, string, string, string, string, string];

const FILTER: FixtureOptions = { fixture: "SR-069/filter" };
const IDENTIFIERS: FixtureOptions = { fixture: "enabler-305/identifiers" };
const SR036 = "30500000-0000-4000-8000-0000000b0036";
const SR037 = "30500000-0000-4000-8000-0000000b0037";
const CLASH = "30500000-0000-4000-8000-0000000c0048";

const open = async (options: FixtureOptions = FILTER): Promise<Workspace> => {
  const fixture = await createFixtureWorkspace(options);
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const search = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("element.search", input, { workspace })) as Output;

/** The UUIDs of the hits of `query`, best first. */
const hits = async (
  workspace: Workspace,
  query: string,
  extra: Record<string, unknown> = {},
): Promise<string[]> => (await search(workspace, { query, ...extra, limit: 500 })).hits.map((hit) => hit.id);

describe("element.search (SR-068)", () => {
  it("[SR-068/AK1] finds an element by a word that occurs only in one of its properties", async () => {
    const ws = await open();
    // `source` of b5, the unknown property `owner` of b4 (SR-016), a choice by its name.
    const supplier = await search(ws, { query: "supplier" });
    expect(supplier).toEqual({
      hits: [
        {
          id: B5,
          repository: "system",
          shortId: "SR-0000b5",
          type: "system-requirement",
          status: "approved",
          title: "Send data to the cloud",
          score: expect.any(Number) as number,
          fields: ["properties"],
          terms: ["supplier"],
        },
      ],
      total: 1,
      incomplete: false,
    });
    // "data" in the title of b5 is one edit from "dana" (AK2), with a lower score.
    expect(await hits(ws, "Dana")).toEqual([B4, B5]);
    expect(await hits(ws, "interface")).toEqual([B5]);
    // Type and status are found by their names too (#80).
    expect(await hits(ws, "obsolete")).toEqual([B4]);
    expect(await hits(ws, "Software Requirement")).toEqual([F1, F2]);
  });

  it("[SR-068/AK1] finds an element by its short ID only, in any case, also by a longer tail", async () => {
    const ws = await open();
    const out = await search(ws, { query: "sr-0000B3" });
    expect(out.hits.map((hit) => [hit.id, hit.shortId, hit.fields, hit.terms, hit.score])).toEqual([
      [B3, "SR-0000b3", ["id"], [], 0],
    ]);
    expect(await hits(ws, "SR-0000000000b3")).toEqual([B3]);
    expect(await hits(ws, "N-0000a2")).toEqual([N2]);
  });

  it("[SR-068/AK1] finds an element by its identifier only (a spec ID, #305), first, in any case", async () => {
    const ws = await open(IDENTIFIERS);
    const out = await search(ws, { query: "sr-036" });
    expect(out.hits.map((hit) => [hit.id, hit.shortId, hit.identifier, hit.fields])).toEqual([
      [SR036, "SR-0b0036", "SR-036", ["properties", "id"]],
    ]);
    // Its words are words of a property too: an ID match comes first.
    expect(await hits(ws, "SR-036 SR-037")).toEqual([]);
    expect(await hits(ws, "037")).toEqual([SR037]);
  });

  it("[SR-068/AK1] finds every element with an identifier: types may share one (#305)", async () => {
    const ws = await open({
      ...IDENTIFIERS,
      files: {
        "decisions/D-0000000c0036.md":
          "---\nid: 30500000-0000-4000-8000-0000000c0036\ntype: decision\nstatus: draft\ntitle: Shared\nspec-id: SR-036\n---\n",
        // Without an identifier: no ID match.
        "decisions/D-0000000c0049.md":
          "---\nid: 30500000-0000-4000-8000-0000000c0049\ntype: decision\nstatus: draft\ntitle: No spec ID for SR-036\n---\n",
      },
    });
    const out = await search(ws, { query: "SR-036" });
    expect(out.hits.map((hit) => [hit.shortId, hit.fields])).toEqual([
      ["D-0c0036", ["properties", "id"]],
      ["SR-0b0036", ["properties", "id"]],
      // Its words in a title: found as words, after the ID matches.
      ["D-0c0049", ["title"]],
    ]);
  });

  it("[SR-068/AK1] finds both the element with a short ID and the one with it as identifier (#305)", async () => {
    const ws = await open({
      ...IDENTIFIERS,
      files: {
        "decisions/D-0000000c0048.md":
          "---\nid: 30500000-0000-4000-8000-0000000c0048\ntype: decision\nstatus: draft\ntitle: Clash\nspec-id: SR-0b0037\n---\n",
      },
    });
    const out = await search(ws, { query: "SR-0B0037" });
    expect(out.hits.map((hit) => [hit.id, hit.fields])).toEqual([
      [CLASH, ["properties", "id"]],
      [SR037, ["id"]],
    ]);
  });

  it("[SR-068/AK2] finds the elements despite a typo or another case", async () => {
    const ws = await open();
    // One edit in a word of 4 to 7 letters, two from 8 (ADR-0008).
    expect(await hits(ws, "Mesure")).toEqual([B1, B2]);
    expect(await hits(ws, "SUPLIER")).toEqual([B5]);
    expect(await hits(ws, "dAnA")).toEqual([B4, B5]);
    expect(await hits(ws, "survve ICNG")).toEqual([B3]);
    // In any case the same hits, scores and order.
    expect(await search(ws, { query: "WIND" })).toEqual(await search(ws, { query: "wind" }));
    expect(await hits(ws, "wind")).toEqual([B1, N1]);
  });

  it("[SR-068/AK3] searches only within an active view", async () => {
    const ws = await open();
    // b2 is valid for V1 only; b1 has no validity and applies everywhere (SR-040).
    expect(await hits(ws, "measure", { selection: { view: "VAR-0000c1" } })).toEqual([B1, B2]);
    expect(await hits(ws, "measure", { selection: { view: "VAR-0000c2" } })).toEqual([B1]);
    expect(await hits(ws, "measure", { selection: { view: "core" } })).toEqual([B1]);
    // Also an ID outside the view is no hit; N1, whose text names it, is in the view.
    expect(await hits(ws, "SR-0000b2")).toEqual([B2, N1]);
    expect(await hits(ws, "SR-0000b2", { selection: { view: "VAR-0000c2" } })).toEqual([N1]);
  });

  it("[SR-068/AK3] searches only within an active filter, package or list of elements", async () => {
    const ws = await open();
    expect(await hits(ws, "measure", { selection: { where: { status: ["draft"] } } })).toEqual([B2]);
    expect(await hits(ws, "measure", { selection: { package: "PKG-0000d2" } })).toEqual([B2]);
    expect(await hits(ws, "measure", { selection: { ids: ["SR-0000b2", "N-0000a1"] } })).toEqual([B2]);
    const filtered = await search(ws, { query: "wind", selection: { where: { type: ["need"] } } });
    expect([filtered.hits.map((hit) => hit.id), filtered.total]).toEqual([[N1], 1]);
    // A view and a filter at once: both hold.
    expect(
      await hits(ws, "measure", { selection: { view: "VAR-0000c2", where: { status: ["draft"] } } }),
    ).toEqual([]);
  });

  it("[SR-068/AK3] the condition text selects in element.list what element.search finds", async () => {
    const ws = await open();
    const listed = async (where: unknown): Promise<string[]> => {
      const out = (await invoke(
        "element.list",
        { selection: { where } },
        { workspace: ws },
      )) as CommandOutput<"element.list">;
      return out.elements.map((element) => element.id);
    };
    // In workspace order, as every list.
    expect(await listed({ text: "Mesure" })).toEqual([B1, B2]);
    expect(await listed({ text: "Mesure" })).toEqual((await hits(ws, "Mesure")).sort());
    expect(await listed({ all: [{ text: "wind" }, { not: { type: ["need"] } }] })).toEqual([B1]);
    expect(await listed({ any: [{ text: "sr-0000b4" }, { text: "storms" }] })).toEqual([N2, B4]);
    // Whose parent mentions the wind: children of b1 and of N1.
    expect(
      await listed({
        relation: { meaning: "derivation", direction: "up", to: { text: "wind" } },
        exists: true,
      }),
    ).toEqual([B1, B2, B3, F1]);
    // A query without a word matches nothing.
    expect(await listed({ text: " " })).toEqual([]);
    expect(await listed({ not: { text: "" } })).toHaveLength(14);
  });

  it("[SR-068/AK3] searches only within a saved filter, by name, with its view and its own text condition (SR-070)", async () => {
    const ws = await open({
      ...FILTER,
      files: {
        "filters/drafts.yaml": "logreq-filter: 1\nname: Drafts\nwhere: { status: [draft] }\n",
        "filters/mountain.yaml": "logreq-filter: 1\nname: Mountain\nview: VAR-0000c2\nwhere: { all: [] }\n",
        "filters/windy.yaml": "logreq-filter: 1\nname: Windy\nwhere: { text: wind }\n",
      },
    });
    expect(await hits(ws, "measure", { selection: { filter: "drafts" } })).toEqual([B2]);
    expect(await hits(ws, "measure", { selection: { filter: "Mountain" } })).toEqual([B1]);
    // A filter that is itself a full-text condition, searched again within.
    expect(await hits(ws, "measure", { selection: { filter: "Windy" } })).toEqual([B1]);
    expect(await hits(ws, "see", { selection: { filter: "Windy" } })).toEqual([N1]);
    expect(await hits(ws, "storms", { selection: { filter: "Windy" } })).toEqual([]);
    // A saved filter and another part of the selection: both hold.
    expect(await hits(ws, "wind", { selection: { filter: "Windy", where: { type: ["need"] } } })).toEqual([
      N1,
    ]);
  });

  it("[SR-066/AK1] (search scope) the link search finds by title and IDs only: a short ID and a title word, not a text word", async () => {
    const ws = await open();
    expect(await hits(ws, "supplier", { fields: ["title", "id"] })).toEqual([]);
    expect(await hits(ws, "SR-0000b5", { fields: ["title", "id"] })).toEqual([B5]);
    expect(await hits(ws, "cloud", { fields: ["title", "id"] })).toEqual([B5]);
    expect(await hits(ws, "derives", { fields: ["text"] })).toEqual([F1, F2, B5, B1, B3, B2]);
    expect(await hits(ws, "derives", { fields: ["title"] })).toEqual([]);
  });

  it("gives one page of the hits, the best first, with the total of all", async () => {
    const ws = await open();
    const all = await search(ws, { query: "approved" });
    expect(all.total).toBe(7);
    expect(all.hits).toHaveLength(7);
    const page = await search(ws, { query: "approved", offset: 2, limit: 3 });
    expect(page).toEqual({ hits: all.hits.slice(2, 5), total: 7, incomplete: false });
    // Hits are sorted by score, equal ones in workspace order.
    const scores = all.hits.map((hit) => hit.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    // Rounded to 6 significant digits, so every access gives and orders the same (SR-080).
    expect(scores.map((score) => Number(score.toPrecision(6)))).toEqual(scores);
    // The default page has 50 hits at most.
    expect((await search(ws, { query: "derives" })).hits).toHaveLength(6);
  });

  it("finds nothing for a query without a word", async () => {
    const ws = await open();
    expect(await search(ws, { query: "" })).toEqual({ hits: [], total: 0, incomplete: false });
    expect(await search(ws, { query: " -- " })).toEqual({ hits: [], total: 0, incomplete: false });
  });

  it("gives an empty title to an element without one, and no status when it has none", async () => {
    const ws = await open({
      ...FILTER,
      files: {
        "needs/N-0000000000a3.md":
          "---\nid: 69069069-0000-4000-8000-0000000000a3\ntype: need\ntopic: Untitled\n---\n",
      },
    });
    const out = await search(ws, { query: "untitled" });
    expect(out.hits.map((hit) => [hit.shortId, hit.title, hit.status])).toEqual([
      ["N-0000a3", "", undefined],
    ]);
  });

  it("gives empty titles without a property with the meaning title, and finds the title as a property (SR-013 AK3)", async () => {
    const model = await fs.readFile(
      new URL("../../../../../fixtures/enabler-305/identifiers/metamodel/model.yaml", import.meta.url),
      "utf8",
    );
    const ws = await open({
      ...IDENTIFIERS,
      files: { "metamodel/model.yaml": model.replace(", meaning: title }", " }") },
    });
    const out = await search(ws, { query: "accept identifiers" });
    expect(out.hits.map((hit) => [hit.id, hit.title, hit.fields])).toEqual([
      [SR036, "", ["text", "properties"]],
    ]);
  });

  it("finds what a save changed: the index is carried over the write", async () => {
    const ws = await open();
    expect(await hits(ws, "anemometer")).toEqual([]);
    await invoke("element.update", { ref: "SR-0000b2", text: "With an anemometer.\n" }, { workspace: ws });
    expect(await hits(ws, "anemometer")).toEqual([B2]);
    expect(await hits(ws, "anemometer", { selection: { where: { status: ["draft"] } } })).toEqual([B2]);
  });

  it("is incomplete while the workspace file lists a repository that is not on this machine (SR-006 AK2)", async () => {
    const ws = await open({
      ...FILTER,
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: Weather station\nrepositories:\n" +
          '  - { name: system, url: "ssh://example.com/system.git", main: true }\n' +
          '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
          "metamodel: { repository: system, path: metamodel }\n",
      },
    });
    const out = await search(ws, { query: "storms" });
    expect([out.hits.map((hit) => hit.id), out.incomplete]).toEqual([[N2], true]);
  });

  it("refuses a selection it cannot resolve, naming the field", async () => {
    const ws = await open();
    const error = await search(ws, { query: "wind", selection: { baseline: "v1" } }).catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).details?.["fields"]).toEqual(["selection.baseline"]);
  });
});
