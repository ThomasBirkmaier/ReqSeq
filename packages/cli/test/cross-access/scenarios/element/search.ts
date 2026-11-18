// Cross-access scenarios of element.search, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import type { Result } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";
import { DESIGNATIONS, FILTER, IDENTIFIERS, NO_DESIGNATIONS, SAVED } from "../../fixtures.js";

/** A Markdown text, a list property, a choice and spec IDs (SR-174). */
const SNIPPETS: FixtureOptions = { fixture: "SR-174/snippets" };

/** A text property, acceptance criteria and a relation kind (SR-216). */
const FIELDS: FixtureOptions = { fixture: "SR-216/fields" };

/** Word parts in title, text, a property and the type and status names (SR-221). */
const WORD_PARTS: FixtureOptions = { fixture: "SR-221/word-parts" };

/** The hits of the first access as `short ID score`; every access gave the same (compared before). */
const ranked = (results: Readonly<Record<string, Result>>): string[] => {
  const [first] = Object.values(results);
  const outcome = first?.outcome;
  const hits =
    outcome !== undefined && "output" in outcome
      ? (outcome.output as { hits: { shortId: string; score: number }[] }).hits
      : [];
  return hits.map((hit) => `${hit.shortId} ${String(hit.score)}`);
};

/** The snippets of the hits of the first access, by short ID; every access gave the same (compared before). */
const snippets = (results: Readonly<Record<string, Result>>): Record<string, unknown> => {
  const [first] = Object.values(results);
  const outcome = first?.outcome;
  const hits =
    outcome !== undefined && "output" in outcome
      ? (outcome.output as { hits: { shortId: string; snippet?: unknown; titleMarks?: unknown }[] }).hits
      : [];
  return Object.fromEntries(hits.map((hit) => [hit.shortId, [hit.snippet, hit.titleMarks]]));
};

scenariosOf("element.search", [
  {
    name: "a word only in a property, with a typo, in another case (SR-068 AK1, AK2)",
    fixture: FILTER,
    input: { query: "SUPLIER" },
    expect: "output",
  },
  {
    name: "within a view and a filter, one page (SR-068 AK3)",
    fixture: FILTER,
    input: {
      query: "measure",
      selection: { view: "VAR-0000c1", where: { status: ["approved", "draft"] } },
      limit: 1,
      offset: 1,
    },
    expect: "output",
  },
  {
    name: "a short ID in lower case, in title and IDs only (SR-068 AK1, SR-066)",
    fixture: FILTER,
    input: { query: "sr-0000B2", fields: ["title", "id"] },
    expect: "output",
  },
  {
    name: "an identifier, first, with the words of its property (ThomasBirkmaier/ReqSeq-archive#305)",
    fixture: IDENTIFIERS,
    input: { query: "sr-036" },
    expect: "output",
  },
  {
    name: "within a saved filter with its view (SR-068 AK3, SR-070)",
    fixture: SAVED,
    input: { query: "measure", selection: { filter: "mountain" } },
    expect: "output",
  },
  {
    tag: "[SR-174/AK-rfbg]",
    name: "a snippet of a Markdown text: heading, bold, link, inline reference and code are plain words",
    fixture: SNIPPETS,
    input: { query: "gusts pulse" },
    expect: "output",
    check: (results) => {
      expect(snippets(results)).toEqual({
        "SR-0000a1": [
          {
            field: "text",
            text: "The anemometer measures gusts with pulse counting, as Show a dial shows.",
            marks: [
              { start: 24, end: 29 },
              { start: 35, end: 40 },
            ],
          },
          undefined,
        ],
      });
    },
  },
  {
    tag: "[SR-174/AK-rfbg]",
    name: "a snippet of a list property: the item with the match",
    fixture: SNIPPETS,
    input: { query: "hurricane" },
    expect: "output",
    check: (results) => {
      expect(snippets(results)).toEqual({
        "SR-0000a2": [
          {
            field: "properties",
            property: "checks",
            propertyName: "Checks",
            text: "The dial warns before a hurricane arrives.",
            marks: [{ start: 24, end: 33 }],
          },
          undefined,
        ],
      });
    },
  },
  {
    tag: "[SR-174/AK-rfbg]",
    name: "a phrase across bold and a link label, marked whole in the snippet (SR-068 AK4, SR-174 AK6)",
    fixture: SNIPPETS,
    input: { query: '"anemometer measures gusts"' },
    expect: "output",
    check: (results) => {
      expect(snippets(results)).toEqual({
        "SR-0000a1": [
          {
            field: "text",
            text: "The anemometer measures gusts with pulse counting, as Show a dial shows.",
            marks: [{ start: 4, end: 29 }],
          },
          undefined,
        ],
      });
    },
  },
  {
    tag: "[SR-174/AK-rfbg]",
    name: "no snippet for a title-only hit, its title marked",
    fixture: SNIPPETS,
    input: { query: "icing" },
    expect: "output",
    check: (results) => {
      expect(snippets(results)).toEqual({ "SR-0000a3": [undefined, [{ start: 8, end: 13 }]] });
    },
  },
  {
    tag: "[SR-174/AK-rfbg]",
    name: "no snippet for a status-name hit",
    fixture: SNIPPETS,
    input: { query: "approved" },
    expect: "output",
    check: (results) => {
      expect(snippets(results)).toEqual({ "SR-0000a2": [undefined, undefined] });
    },
  },
  {
    name: "with the verification of the hits: status and progress ring as the graph's nodes (SR-137)",
    fixture: { fixture: "SR-136/graph", git: true },
    input: { query: "need", withVerification: true },
    expect: "output",
  },
  {
    name: "a selection by a baseline that does not exist",
    fixture: FILTER,
    input: { query: "wind", selection: { baseline: "v1" } },
    expect: "error",
  },
  {
    name: "a target of a chosen relation kind: only its target types (SR-067 AK2)",
    fixture: FILTER,
    input: {
      query: "draft",
      selection: {
        where: { type: ["software-requirement", "need", "use-case", "system-requirement"] },
      },
    },
    expect: "output",
  },
  {
    tag: "[SR-149/AK-byyt]",
    name: "grouped by package: the hits of each group in relevance order, a hit in two packages twice",
    fixture: { fixture: "SR-149/group" },
    input: { query: "wind", group: "package" },
    expect: "output",
    check: (results) => {
      const [first] = Object.values(results);
      const outcome = first?.outcome;
      const output = (outcome !== undefined && "output" in outcome ? outcome.output : {}) as {
        hits: { shortId: string }[];
        groups: { value?: string; count: number; offset: number }[];
      };
      expect(
        output.groups.map(
          ({ value, count, offset }) =>
            `${value ?? "-"}: ${output.hits
              .slice(offset, offset + count)
              .map((hit) => hit.shortId)
              .join(" ")}`,
        ),
      ).toEqual([
        "PKG-0000d2: SR-0000b1",
        "PKG-0000d1: SR-0000b2 SR-0000b1",
        "-: PKG-0000d1 N-0000a1 SR-0000b3",
      ]);
    },
  },
  {
    tag: "[SR-216/AK-dhq2]",
    name: "in the acceptance criteria only: the hit, its snippet from them, no title marks",
    fixture: FIELDS,
    input: { query: "gust", fields: ["acceptance-criteria"] },
    expect: "output",
    check: (results) => {
      expect(snippets(results)).toEqual({
        "SR-0000c1": [
          {
            field: "properties",
            property: "acceptance-criteria",
            propertyName: "Acceptance Criteria",
            text: "Given a gust, then the alarm sounds.",
            marks: [{ start: 8, end: 12 }],
          },
          undefined,
        ],
      });
    },
  },
  {
    tag: "[SR-216/AK-dhq2]",
    name: "in the text and a property: the snippet from the text, else from the property",
    fixture: FIELDS,
    input: { query: "mast", fields: ["text", "rationale"] },
    expect: "output",
    check: (results) => {
      expect(snippets(results)).toEqual({
        "SR-0000c1": [
          {
            field: "properties",
            property: "rationale",
            propertyName: "Rationale",
            text: "Gusts shake the mast.",
            marks: [{ start: 16, end: 20 }],
          },
          undefined,
        ],
        "SR-0000c2": [
          {
            field: "text",
            text: "The mast holds every gust and stands in the wind.",
            marks: [{ start: 4, end: 8 }],
          },
          undefined,
        ],
      });
    },
  },
  {
    tag: "[SR-216/AK-r9jg]",
    name: "in a single property: only the hits of its words (SR-216 AK2)",
    fixture: FIELDS,
    input: { query: "storm", fields: ["rationale"] },
    expect: "output",
    check: (results) => {
      expect(Object.keys(snippets(results))).toEqual(["SR-0000c2"]);
    },
  },
  {
    tag: "[SR-216/AK-r9jg]",
    name: "a key that holds relations, refused with a message naming it (SR-216 AK2, AK11)",
    fixture: FIELDS,
    input: { query: "gust", fields: ["derives-from"] },
    expect: "error",
    check: (results) => {
      for (const { outcome } of Object.values(results)) {
        const error = "error" in outcome ? (outcome.error as { code?: string; message?: string }) : {};
        expect(error.code).toBe("input.invalid");
        expect(error.message).toContain('"derives-from"');
      }
    },
  },
  {
    name: "a key it cannot group by (SR-149 AK6)",
    fixture: { fixture: "SR-149/group" },
    input: { query: "wind", group: "title" },
    expect: "error",
  },
  {
    tag: "[SR-124/AK-mtm9]",
    name: "within a status filter: the hits left in their relevance order",
    fixture: { fixture: "SR-149/group" },
    input: { query: "wind", selection: { where: { status: ["draft"] } } },
    expect: "output",
    check: (results) => {
      const [first] = Object.values(results);
      const outcome = first?.outcome;
      const output = (outcome !== undefined && "output" in outcome ? outcome.output : {}) as {
        hits: { shortId: string }[];
      };
      // Without the filter the order is b2, b1, d1, a1, b3 (search-group.test.ts): b1 before b3 stays.
      expect(output.hits.map((hit) => hit.shortId)).toEqual(["SR-0000b1", "SR-0000b3"]);
    },
  },
  {
    tag: "[SR-068/AK-rbwp]",
    name: "a word only in the type name of some hits: they come after all others, each group by relevance",
    fixture: { fixture: "SR-068/late" },
    input: { query: "package" },
    expect: "output",
    check: (results) => {
      const [first] = Object.values(results);
      const outcome = first?.outcome;
      const output = (outcome !== undefined && "output" in outcome ? outcome.output : {}) as {
        hits: { shortId: string; score: number }[];
        total: number;
      };
      // The packages a1 to a3 hold "package" only in their type name, yet score above SR-0000b1.
      expect(output.hits.map((hit) => `${hit.shortId} ${String(hit.score)}`)).toEqual([
        "PKG-0000a4 6.60802",
        "PKG-0000a5 3.09078",
        "SR-0000b3 2.23633",
        "SR-0000b2 1.82767",
        "SR-0000b1 0.559403",
        "PKG-0000a1 0.882281",
        "PKG-0000a2 0.882281",
        "PKG-0000a3 0.882281",
      ]);
      expect(output.total).toBe(8);
    },
  },
  {
    tag: "[SR-220/AK-bfrh]",
    name: "a designation finds the elements in which another designation of its element stands, inflected too",
    fixture: DESIGNATIONS,
    input: { query: "package" },
    expect: "output",
    check: (results) => {
      expect(
        ranked(results)
          .map((hit) => hit.split(" ")[0])
          .sort(),
      ).toEqual(["GT-0000d1", "SR-0000c1", "SR-0000c2", "SR-0000c3", "SR-0000c7", "SR-0000c8", "SR-0000c9"]);
    },
  },
  {
    tag: "[SR-220/AK-bfrh]",
    name: "the longest designation at a place, its other designation as whole words, and the other words still needed",
    fixture: DESIGNATIONS,
    input: { query: "released version" },
    expect: "output",
    check: (results) => {
      expect(ranked(results).map((hit) => hit.split(" ")[0])).toEqual(["GT-0000d2", "SR-0000c4"]);
    },
  },
  {
    tag: "[SR-220/AK-bfrh]",
    name: "a designation counts inside a hyphenated query word, as the search splits it",
    fixture: DESIGNATIONS,
    input: { query: "Paket-Export" },
    expect: "output",
    check: (results) => {
      expect(ranked(results).map((hit) => hit.split(" ")[0])).toEqual(["SR-0000c3"]);
    },
  },
  {
    tag: "[SR-220/AK-z3ht]",
    name: "literal hits first, then hits through another designation, then those through a type name",
    fixture: DESIGNATIONS,
    input: { query: "requirement" },
    expect: "output",
    check: (results) => {
      // SR-0000c5 holds "Anforderung", whose English term is "Requirement": not late, though "requirement"
      // is in the type name of every system requirement.
      expect(ranked(results)).toEqual([
        "GT-0000d3 0.535012",
        "SR-0000c5 3.51394",
        "SR-0000c1 0.572651",
        "SR-0000c2 0.572651",
        "SR-0000c4 0.572651",
        "SR-0000c6 0.572651",
        "SR-0000c7 0.572651",
        "SR-0000c8 0.572651",
        "SR-0000c3 0.503933",
        "SR-0000c9 0.436457",
      ]);
    },
  },
  {
    tag: "[SR-220/AK-z3ht]",
    name: "another designation only in the type name: those hits come last, as hits through a type name",
    fixture: DESIGNATIONS,
    input: { query: "anforderung" },
    expect: "output",
    check: (results) => {
      // "requirement", the English term of "Anforderung", stands only in the type name of SR-0000c1 to c9.
      expect(ranked(results).map((hit) => hit.split(" ")[0])).toEqual([
        "GT-0000d3",
        "SR-0000c5",
        "SR-0000c1",
        "SR-0000c2",
        "SR-0000c4",
        "SR-0000c6",
        "SR-0000c7",
        "SR-0000c8",
        "SR-0000c3",
        "SR-0000c9",
      ]);
    },
  },
  {
    tag: "[SR-220/AK-z3ht]",
    name: "an ID match first, also when it is found through another designation",
    fixture: DESIGNATIONS,
    input: { query: "paket REQ-3" },
    expect: "output",
    check: (results) => {
      expect(ranked(results).map((hit) => hit.split(" ")[0])).toEqual(["SR-0000c3", "SR-0000c8"]);
    },
  },
  {
    tag: "[SR-220/AK-vh5r]",
    name: "another designation of several words marked whole in the snippet and the title",
    fixture: DESIGNATIONS,
    input: { query: "released version" },
    expect: "output",
    check: (results) => {
      expect(snippets(results)).toEqual({
        "GT-0000d2": [
          {
            field: "properties",
            property: "english-term",
            propertyName: "English Term",
            text: "Released version",
            marks: [
              { start: 0, end: 8 },
              { start: 9, end: 16 },
            ],
          },
          [{ start: 0, end: 20 }],
        ],
        "SR-0000c4": [
          {
            field: "text",
            text: "Die freigegebene Fassung bleibt gespeichert.",
            marks: [{ start: 4, end: 24 }],
          },
          undefined,
        ],
      });
    },
  },
  {
    tag: "[SR-220/AK-vh5r]",
    name: "another designation of one word marked in the title and the snippet; a title-only hit has no snippet",
    fixture: DESIGNATIONS,
    input: { query: "package", fields: ["title", "text"] },
    expect: "output",
    check: (results) => {
      expect(snippets(results)).toEqual({
        "SR-0000c3": [
          { field: "text", text: "Exports a package as a file.", marks: [{ start: 10, end: 17 }] },
          [{ start: 0, end: 7 }],
        ],
        "GT-0000d1": [undefined, [{ start: 0, end: 5 }]],
        "SR-0000c1": [
          { field: "text", text: "Das Tool lädt ein Paket aus dem Ordner.", marks: [{ start: 18, end: 23 }] },
          [{ start: 0, end: 5 }],
        ],
        "SR-0000c7": [undefined, [{ start: 6, end: 11 }]],
        "SR-0000c2": [undefined, [{ start: 0, end: 6 }]],
        "SR-0000c8": [
          { field: "text", text: "Siehe REQ-3 für das Paket.", marks: [{ start: 20, end: 25 }] },
          undefined,
        ],
      });
    },
  },
  {
    tag: "[SR-220/AK-ps8z]",
    name: "the designations of an element with an invalid status do not count; the element itself is found",
    fixture: DESIGNATIONS,
    input: { query: "timestamp" },
    expect: "output",
    check: (results) => {
      expect(ranked(results).map((hit) => hit.split(" ")[0])).toEqual(["GT-0000d4"]);
    },
  },
  {
    tag: "[SR-220/AK-zgz1]",
    name: "without the meanings in the metamodel: the search of SR-068, no other designations",
    fixture: NO_DESIGNATIONS,
    input: { query: "package" },
    expect: "output",
    check: (results) => {
      expect(ranked(results)).toEqual(["SR-0000c3 9.14371", "GT-0000d1 3.25324"]);
    },
  },
  {
    tag: "[SR-221/AK-jq93]",
    name: "a word of 4 letters or more found inside longer words of the title, the text, a property and the type and status names",
    fixture: WORD_PARTS,
    input: { query: "seite" },
    expect: "output",
    check: (results) => {
      expect(
        ranked(results)
          .map((hit) => hit.split(" ")[0])
          .sort(),
      ).toEqual([
        "HS-0000e6",
        "SR-0000e1",
        "SR-0000e2",
        "SR-0000e3",
        "SR-0000e4",
        "SR-0000e5",
        "SR-0000e7",
        "SR-0000e8",
        "SR-0000ea",
        "SR-0000eb",
      ]);
    },
  },
  {
    tag: "[SR-221/AK-z5cp]",
    name: "a whole word before a word start before a word part; a part only in the type or status name last",
    fixture: WORD_PARTS,
    input: { query: "seite", fields: ["title", "properties"] },
    expect: "output",
    check: (results) => {
      const order = ranked(results).map((hit) => hit.split(" ")[0]);
      expect(order.indexOf("SR-0000e4")).toBeLessThan(order.indexOf("SR-0000e3"));
      expect(order.indexOf("SR-0000e3")).toBeLessThan(order.indexOf("SR-0000e1"));
      expect(order.slice(-2).sort()).toEqual(["HS-0000e6", "SR-0000e7"]);
    },
  },
  {
    tag: "[SR-221/AK-z2nk]",
    name: "only the part found is marked, also of a word start, a typo whole, the snippet at the first part",
    fixture: WORD_PARTS,
    input: { query: "seite", fields: ["title", "text"] },
    expect: "output",
    check: (results) => {
      expect(snippets(results)).toMatchObject({
        "SR-0000e1": [undefined, [{ start: 5, end: 10 }]],
        "SR-0000e2": [
          {
            field: "text",
            text: "Die Referenzseiten nennen jedes Element.",
            marks: [{ start: 12, end: 17 }],
          },
          undefined,
        ],
        "SR-0000e3": [undefined, [{ start: 0, end: 5 }]],
        "SR-0000e8": [
          { field: "text", text: "Er zeigt seine Werte.", marks: [{ start: 9, end: 14 }] },
          undefined,
        ],
        "SR-0000eb": [
          {
            field: "text",
            text: "Die Hauptseite kommt vor der Seite.",
            marks: [
              { start: 9, end: 14 },
              { start: 29, end: 34 },
            ],
          },
          [{ start: 5, end: 10 }],
        ],
      });
    },
  },
  {
    tag: "[SR-221/AK-cbz2]",
    name: "the search of title and IDs that Go to, the link search and element arguments send finds parts only in the title",
    fixture: WORD_PARTS,
    input: { query: "seite", fields: ["id", "title"], limit: 20 },
    expect: "output",
    check: (results) => {
      expect(
        ranked(results)
          .map((hit) => hit.split(" ")[0])
          .sort(),
      ).toEqual(["SR-0000e1", "SR-0000e3", "SR-0000e4", "SR-0000ea", "SR-0000eb"]);
    },
  },
]);
