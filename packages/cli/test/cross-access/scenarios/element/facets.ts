// Cross-access scenarios of element.facets, in addition to the default one (cross-access.test.ts).
import type { FixtureOptions } from "@reqseq/testkit";
import { expect } from "vitest";
import { scenariosOf } from "../../scenario.js";
import { FILTER } from "../../fixtures.js";

/** A text property, acceptance criteria and a relation kind (SR-216). */
const FIELDS: FixtureOptions = { fixture: "SR-216/fields" };

scenariosOf("element.facets", [
  {
    name: "values of a filtered list (ThomasBirkmaier/ReqSeq-archive#425)",
    fixture: FILTER,
    input: { selection: { where: { type: ["system-requirement"] } } },
    expect: "output",
  },
  {
    name: "free text with a low maxValues (ThomasBirkmaier/ReqSeq-archive#425)",
    fixture: FILTER,
    input: { maxValues: 1 },
    expect: "output",
  },
  {
    name: "a selection by a baseline that does not exist (ThomasBirkmaier/ReqSeq-archive#425)",
    fixture: FILTER,
    input: { selection: { baseline: "v1" } },
    expect: "error",
  },
  {
    tag: "[SR-124/AK-mtm9]",
    name: "the hits of a search in the acceptance criteria only (SR-216)",
    fixture: FIELDS,
    input: { search: { query: "gust", fields: ["acceptance-criteria"] } },
    expect: "output",
    check: (results) => {
      // The one hit of element.search with the same fields, not both elements "gust" is in.
      const totals = Object.values(results).map(
        (result) => (result.outcome as { readonly output: { readonly total: number } }).output.total,
      );
      expect(totals.length).toBeGreaterThan(0);
      expect(new Set(totals)).toEqual(new Set([1]));
    },
  },
  {
    name: "a search field that holds relations (SR-216 AK2)",
    fixture: FIELDS,
    input: { search: { query: "gust", fields: ["derives-from"] } },
    expect: "error",
  },
]);
