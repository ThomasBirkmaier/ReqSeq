// Cross-access scenarios of element.search, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import type { Result } from "../../scenario.js";
import { scenariosOf } from "../../scenario.js";
import { FILTER, IDENTIFIERS, SAVED } from "../../fixtures.js";

/** A Markdown text, a list property, a choice and spec IDs (SR-174). */
const SNIPPETS: FixtureOptions = { fixture: "SR-174/snippets" };

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
    tag: "[SR-174/AK5]",
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
    tag: "[SR-174/AK5]",
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
    tag: "[SR-174/AK5]",
    name: "no snippet for a title-only hit, its title marked",
    fixture: SNIPPETS,
    input: { query: "icing" },
    expect: "output",
    check: (results) => {
      expect(snippets(results)).toEqual({ "SR-0000a3": [undefined, [{ start: 8, end: 13 }]] });
    },
  },
  {
    tag: "[SR-174/AK5]",
    name: "no snippet for a status-name hit",
    fixture: SNIPPETS,
    input: { query: "approved" },
    expect: "output",
    check: (results) => {
      expect(snippets(results)).toEqual({ "SR-0000a2": [undefined, undefined] });
    },
  },
  {
    name: "a selection that is not there yet",
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
    tag: "[SR-149/AK6]",
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
    name: "a key it cannot group by (SR-149 AK6)",
    fixture: { fixture: "SR-149/group" },
    input: { query: "wind", group: "title" },
    expect: "error",
  },
]);
