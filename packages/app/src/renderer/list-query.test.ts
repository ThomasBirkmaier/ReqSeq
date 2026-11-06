import { describe, expect, it } from "vitest";
import { DEFAULT_SORT, NO_ROW, filteredList, listOf, queryOf, withMatrix, withQuery } from "./buffers.js";
import { statusStep, typeStep } from "./list-filters.js";
import { changeQuery, fitsView, keptQuery, queryIn, supports } from "./list-query.js";

describe("the query of a list (#993)", () => {
  const steps = [typeStep("need")];
  const query = { steps, sort: DEFAULT_SORT, group: "status" };

  it("says per view which parts it shows: the matrix and a package page have no groups", () => {
    expect((["steps", "sort", "group"] as const).map((part) => supports("list", part))).toEqual([
      true,
      true,
      true,
    ]);
    expect(supports("matrix", "group")).toBe(false);
    expect(supports("members", "group")).toBe(false);
    expect(supports("members", "sort")).toBe(true);
    expect(queryIn(query, "list")).toEqual(query);
    expect(queryIn(query, "matrix")).toEqual({ steps, sort: DEFAULT_SORT });
    expect(fitsView(query, "list")).toBe(true);
    expect(fitsView(query, "matrix")).toBe(false);
    expect(fitsView({ steps, sort: DEFAULT_SORT }, "matrix")).toBe(true);
  });

  it("keeps the steps and the sort across a restart, not the grouping", () => {
    expect(keptQuery(query)).toEqual({ steps, sort: DEFAULT_SORT });
    expect(keptQuery({ steps: [] })).toEqual({ steps: [] });
  });

  it("changes only the parts given, removes one given as undefined, and drops what the view does not show", () => {
    expect(changeQuery(query, { steps: [] }, "list")).toEqual({
      steps: [],
      sort: DEFAULT_SORT,
      group: "status",
    });
    expect(changeQuery(query, { group: undefined, sort: undefined }, "list")).toEqual({ steps });
    expect(changeQuery({ steps }, { group: "type" }, "matrix")).toEqual({ steps });
  });

  it("builds the list of a query in a view, and every change of a list goes through its query", () => {
    const list = listOf(query, "list");
    expect(list).toEqual({ ...filteredList(steps, DEFAULT_SORT), group: "status" });
    expect(queryOf(list)).toEqual(query);
    expect(listOf(query, "matrix")).toEqual(filteredList(steps, DEFAULT_SORT, true));
    // Filtering a grouped list keeps its sort and grouping and names it by its steps.
    expect(withQuery({ ...list, cursor: 3 }, { steps: [...steps, statusStep("draft")] })).toEqual({
      ...filteredList([...steps, statusStep("draft")], DEFAULT_SORT),
      group: "status",
    });
    // A grouped list in the matrix has no group and starts from its first row; back as a list it stays so.
    const matrix = withMatrix({ ...list, cursor: 3 }, true);
    expect(matrix).toEqual({ ...filteredList(steps, DEFAULT_SORT, true), cursor: NO_ROW });
    expect(withQuery(matrix, { group: "type" })).toEqual(matrix);
  });
});
