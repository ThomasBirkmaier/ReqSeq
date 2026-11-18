// Word parts (SR-221): a query word of at least 4 letters without a digit is also found inside a
// longer word, on fixtures/SR-221/word-parts: system requirements e1 "Paketseite zeigen", e2
// "Referenzen" (text "Die Referenzseiten nennen jedes Element."), e3 "Seitenleiste", e4 "Seite
// drucken" (text "Druckt das Blatt."), e5 "Startbild" (notes "Gilt auf jeder Startseite."), e7
// "Impressum" (status "Unterseite"), e8 "Werte" (text "Er zeigt seine Werte."), e9 "Umbau der Station"
// (text "Version 1036 gilt."), ea "Blatt" (synonym "Seite", text "Ein Wort für eine Seite."), eb
// "Hauptseite" (text "Die Hauptseite kommt vor der Seite."), ec "Fassade" (text "Die Hausfacade und
// die Übersicht.", the Ü decomposed); help page e6 "Kontakt" (type "Hilfeseite").
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../catalog.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { rankedHits } from "./search-index.js";
import { searchIndex } from "./search-state.js";

type Output = CommandOutput<"element.search">;
type Hit = Output["hits"][number];

const ID = "22122100-0000-4000-8000-0000000000";

const open = async (
  files: Readonly<Record<string, string>> = {},
): Promise<{ readonly fixture: FixtureWorkspace; readonly workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-221/word-parts", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const search = async (
  workspace: Workspace,
  query: string,
  more: Record<string, unknown> = {},
): Promise<Output> => (await invoke("element.search", { query, ...more }, { workspace })) as Output;

/** The UUID tails of the hits, in their order. */
const tails = (out: Output): string[] => out.hits.map((hit) => hit.id.slice(-2));

/** The hit of `tail`. */
const hitOf = (out: Output, tail: string): Hit => {
  const hit = out.hits.find((one) => one.id === `${ID}${tail}`);
  if (hit === undefined) {
    throw new Error(`no hit ${tail}`);
  }
  return hit;
};

/** The marked parts of a text. */
const marked = (text: string, marks: readonly { start: number; end: number }[] | undefined): string[] =>
  (marks ?? []).map((mark) => text.slice(mark.start, mark.end));

/** A system requirement with the title `title` and the text `text`. */
const requirement = (tail: string, title: string, text: string): string =>
  [
    "---",
    `id: ${ID}${tail}`,
    "type: system-requirement",
    "status: draft",
    `title: ${title}`,
    "---",
    "",
    text,
    "",
  ].join("\n");

describe("word parts (SR-221)", () => {
  it("[SR-221/AK-jq93] finds a word of 4 letters or more inside longer words of the title, the text, a property and the type and status names, in any case", async () => {
    const { workspace } = await open();
    const out = await search(workspace, "SEITE");
    // e1 title, e2 text, e5 notes, e6 type name, e7 status name, eb title and text: word parts; e3
    // a word start; e4, ea and eb the whole word; e8 the typo "seine".
    expect(tails(out).sort()).toEqual(["e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", "ea", "eb"]);
    expect(hitOf(out, "e1").fields).toEqual(["title"]);
    expect(hitOf(out, "e2").fields).toEqual(["text"]);
    expect(hitOf(out, "e5").fields).toEqual(["properties"]);
    // The word of the element, whole, as for a word start.
    expect(hitOf(out, "e1").terms).toEqual(["paketseite"]);
    expect(hitOf(out, "e2").terms).toEqual(["referenzseiten"]);
    // A hex word is a word too: its ID form changes nothing for its words.
    expect(tails(await search(workspace, "facade"))).toEqual(["ec"]);
  });

  it("[SR-221/AK-jq93] finds no part for 3 letters, a word with a digit, a typo, a phrase, an ID or another designation, and still needs every other word", async () => {
    const { workspace } = await open();
    // "Umbau" holds "bau", "1036" holds "036".
    expect(tails(await search(workspace, "bau"))).toEqual([]);
    expect(tails(await search(workspace, "036"))).toEqual([]);
    // "saite" is one edit from "Seite" (a typo of a whole word), never a typo of a part.
    expect(tails(await search(workspace, "saite")).sort()).toEqual(["e4", "ea", "eb"]);
    // A phrase, also of one word, takes whole words; an open phrase also word starts.
    expect(tails(await search(workspace, '"seite"')).sort()).toEqual(["e4", "ea", "eb"]);
    expect(tails(await search(workspace, '"seite')).sort()).toEqual(["e3", "e4", "ea", "eb"]);
    // "blatt" is a designation of ea, whose other designation "Seite" is found as a whole word or a
    // word start only (SR-220 AK1).
    expect(tails(await search(workspace, "blatt")).sort()).toEqual(["e3", "e4", "ea", "eb"]);
    // A UUID part is matched as an ID, never inside a longer one.
    expect(tails(await search(workspace, "0000000000e1"))).toEqual(["e1"]);
    expect(tails(await search(workspace, "00000000e1"))).toEqual(["e1"]);
    // The other words of the query must still be found.
    expect(tails(await search(workspace, "seite drucken"))).toEqual(["e4"]);
    expect(tails(await search(workspace, "seite zeigen"))).toEqual(["e1"]);
  });

  it("[SR-216/AK-wf2k] finds word parts only in the chosen fields", async () => {
    const { workspace } = await open();
    expect(tails(await search(workspace, "seite", { fields: ["notes"] }))).toEqual(["e5"]);
    // e4 (text "Blatt") and ea (title "Blatt") also through the synonym "Seite" of ea (SR-220).
    expect(tails(await search(workspace, "seite", { fields: ["text"] })).sort()).toEqual([
      "e2",
      "e4",
      "e8",
      "ea",
      "eb",
    ]);
    expect(tails(await search(workspace, "seite", { fields: ["title"] })).sort()).toEqual([
      "e1",
      "e3",
      "e4",
      "ea",
      "eb",
    ]);
    // Type and status names are in all properties only.
    expect(tails(await search(workspace, "seite", { fields: ["properties"] })).sort()).toEqual([
      "e5",
      "e6",
      "e7",
      "ea",
    ]);
  });

  it("[SR-068/AK-jxr3] finds the words a word of 2 letters begins, but no part of them", async () => {
    const { workspace } = await open();
    expect(tails(await search(workspace, "se")).sort()).toEqual(["e3", "e4", "e8", "ea", "eb"]);
    expect(tails(await search(workspace, "Seit")).sort()).toEqual([
      "e1",
      "e2",
      "e3",
      "e4",
      "e5",
      "e6",
      "e7",
      "ea",
      "eb",
    ]);
  });

  it("[SR-221/AK-z5cp] ranks a whole word or word start before a word part, also when the part's word is rare and the whole word common", async () => {
    // Six texts with "Status", one with "Verifikationsstatus", the same length; one rare word start
    // "Statusbericht" against six common parts "Prüfstatus".
    const files: Record<string, string> = {};
    for (const [n, tail] of ["f1", "f2", "f3", "f4", "f5", "f6"].entries()) {
      files[`requirements/SR-0000000000${tail}.md`] = requirement(
        tail,
        `Messung ${String(n)}`,
        "Der Status bleibt.",
      );
    }
    files["requirements/SR-0000000000f7.md"] = requirement(
      "f7",
      "Messung 7",
      "Der Verifikationsstatus bleibt.",
    );
    const { workspace } = await open(files);
    const status = tails(await search(workspace, "status", { fields: ["text"] }));
    expect(status).toHaveLength(7);
    expect(status.at(-1)).toBe("f7");
    const { workspace: other } = await open({
      ...Object.fromEntries(
        ["f1", "f2", "f3", "f4", "f5", "f6"].map((tail) => [
          `requirements/SR-0000000000${tail}.md`,
          requirement(tail, "Messung", "Der Prüfstatus bleibt."),
        ]),
      ),
      "requirements/SR-0000000000f7.md": requirement("f7", "Messung", "Der Statusbericht bleibt."),
    });
    expect(tails(await search(other, "status", { fields: ["text"] }))[0]).toBe("f7");
    // In the fixture: the word start e3 before the part e1 (both in the title), the whole word e4 first.
    const { workspace: fixture } = await open();
    const order = tails(await search(fixture, "seite", { fields: ["title"] }));
    expect(order.indexOf("e4")).toBeLessThan(order.indexOf("e3"));
    expect(order.indexOf("e3")).toBeLessThan(order.indexOf("e1"));
  });

  it("[SR-221/AK-z5cp] counts a word part as found by the word itself: late only in a type or status name, never through another designation", async () => {
    const { workspace } = await open();
    const ranked = rankedHits(await searchIndex(workspace), "seite");
    const flags = Object.fromEntries(
      ranked.map((hit) => [hit.element.id.slice(-2), `${hit.late ? "late" : ""}${hit.other ? "other" : ""}`]),
    );
    expect(flags).toMatchObject({ e1: "", e2: "", e5: "", e6: "late", e7: "late" });
    expect(
      ranked
        .slice(-2)
        .map((hit) => hit.element.id.slice(-2))
        .sort(),
    ).toEqual(["e6", "e7"]);
  });

  it("[SR-221/AK-z2nk] marks only the part found, also of a word start, and a typo whole, in the title and the snippet", async () => {
    const { workspace } = await open();
    const out = await search(workspace, "seite");
    const title = (tail: string): string[] => marked(hitOf(out, tail).title, hitOf(out, tail).titleMarks);
    const snippet = (tail: string): string[] =>
      marked(String(hitOf(out, tail).snippet?.text), hitOf(out, tail).snippet?.marks);
    expect(title("e1")).toEqual(["seite"]);
    expect(title("e3")).toEqual(["Seite"]);
    expect(title("e4")).toEqual(["Seite"]);
    expect(snippet("e2")).toEqual(["seite"]);
    expect(hitOf(out, "e2").snippet?.text).toBe("Die Referenzseiten nennen jedes Element.");
    expect(snippet("e5")).toEqual(["seite"]);
    expect(snippet("e8")).toEqual(["seine"]);
    // The first match in reading order is a part: the snippet stands there, and marks the whole word after it too.
    expect(snippet("eb")).toEqual(["seite", "Seite"]);
    // Two words of the query in one word: both parts, as one mark.
    const both = await search(workspace, "paket seite");
    expect(marked(hitOf(both, "e1").title, hitOf(both, "e1").titleMarks)).toEqual(["Paketseite"]);
    // A letter with its mark written apart: the part starts after both.
    const sicht = await search(workspace, "bersicht");
    expect(marked(String(hitOf(sicht, "ec").snippet?.text), hitOf(sicht, "ec").snippet?.marks)).toEqual([
      "bersicht",
    ]);
  });

  it("[SR-221/AK-z2nk] lays the snippet of a long text around the word of a part, and cuts a long word at its part", async () => {
    const long = `${"Vorher kommt ein langer Satz über das Wetter. ".repeat(3)}Hier die Wetterseite des Tages. ${"Danach folgt noch mehr Text zum Wind. ".repeat(3)}`;
    const word = `${"a".repeat(150)}seite${"b".repeat(20)}`;
    const { workspace } = await open({
      "requirements/SR-0000000000f9.md": requirement("f9", "Lang", long),
      "requirements/SR-0000000000fa.md": requirement("fa", "Wort", `Vor ${word}`),
    });
    const out = await search(workspace, "seite");
    const lang = hitOf(out, "f9").snippet;
    expect(lang?.text).toContain("Hier die Wetterseite des Tages.");
    expect(marked(String(lang?.text), lang?.marks)).toEqual(["seite"]);
    const cut = hitOf(out, "fa").snippet;
    expect(cut?.text.startsWith("…seite")).toBe(true);
    expect(marked(String(cut?.text), cut?.marks)).toEqual(["seite"]);
  });

  it("[SR-221/AK-z2nk] marks a word whole when another query word found it whole, and a query word given twice once", async () => {
    const { workspace } = await open();
    for (const query of ["paketseite seite", "seite paketseite", "seite seite"]) {
      const out = await search(workspace, query);
      expect(marked(hitOf(out, "e1").title, hitOf(out, "e1").titleMarks), query).toEqual(
        query === "seite seite" ? ["seite"] : ["Paketseite"],
      );
    }
  });

  it("[SR-221/AK-z2nk] marks a phrase and another designation whole, also as a word start", async () => {
    const { workspace } = await open();
    const open1 = await search(workspace, '"seite');
    expect(marked(hitOf(open1, "e3").title, hitOf(open1, "e3").titleMarks)).toEqual(["Seitenleiste"]);
    const designation = await search(workspace, "blatt");
    expect(marked(hitOf(designation, "e3").title, hitOf(designation, "e3").titleMarks)).toEqual([
      "Seitenleiste",
    ]);
  });

  it("[SR-221/AK-z2nk] marks the whole word where its letters do not map one by one onto the indexed word", async () => {
    // "Kİwi": the dotted İ is two characters in lower case; the jamo of "가나다" written apart join in NFC.
    const { workspace } = await open({
      "requirements/SR-0000000000f8.md": requirement("f8", "Kİwi", "가나다 hier."),
    });
    const kiwi = await search(workspace, "ki");
    expect(marked(hitOf(kiwi, "f8").title, hitOf(kiwi, "f8").titleMarks)).toEqual(["Kİwi"]);
    const hangul = await search(workspace, "가나");
    expect(marked(String(hitOf(hangul, "f8").snippet?.text), hitOf(hangul, "f8").snippet?.marks)).toEqual([
      "가나다",
    ]);
  });

  it("[SR-221/AK-cbz2] finds word parts in a filter, a saved filter, a perspective, a list and the search of title and IDs", async () => {
    const { workspace } = await open();
    const ids = (out: unknown): string[] =>
      ((out as CommandOutput<"element.list">).elements ?? []).map((element) => element.id.slice(-2)).sort();
    const list = (input: Record<string, unknown>): Promise<unknown> =>
      invoke("element.list", input, { workspace });
    const all = tails(await search(workspace, "seite")).sort();
    expect(all).toContain("e1");
    expect(ids(await list({ selection: { where: { text: "seite" } } }))).toEqual(all);
    await invoke("filter.save", { name: "pages", where: { text: "seite" } }, { workspace });
    expect(ids(await list({ selection: { filter: "pages" } }))).toEqual(all);
    await invoke("perspective.save", { name: "Pages", where: { text: "seite" } }, { workspace });
    expect(ids(await list({ perspective: "Pages" }))).toEqual(all);
    // The search in a list: within its elements.
    const within = await search(workspace, "seite", {
      selection: { where: { type: ["system-requirement"] } },
    });
    expect(tails(within)).not.toContain("e6");
    expect(tails(within)).toContain("e2");
    // "Go to", the link search and element arguments search title and IDs: parts only in the title.
    const prompt = tails(await search(workspace, "seite", { fields: ["id", "title"], limit: 20 })).sort();
    // ea through its synonym "Seite", whose other designation "Blatt" is its title (SR-220).
    expect(prompt).toEqual(["e1", "e3", "e4", "ea", "eb"]);
    // The facets of a search count the same elements.
    const facets = (await invoke(
      "element.facets",
      { search: { query: "seite" } },
      { workspace },
    )) as CommandOutput<"element.facets">;
    expect(facets.total).toBe(all.length);
  });
});
