import { describe, expect, it } from "vitest";
import { listBuffer, bufferName, withGroup, withMatrix, withQuery, filteredList, NO_ROW } from "./buffers.js";
import { groupCount, groupName, groupSections } from "./list-groups.js";

describe("the groups of a list (SR-149)", () => {
  it("names a group by its display name, a package by ID and title, else by its value, the last one as no value", () => {
    expect(groupName({ value: "draft", name: "Draft", count: 2, offset: 0 })).toBe("Draft");
    expect(groupName({ value: "PKG-0000d1", title: "Wind", identifier: "R1", count: 1, offset: 2 })).toBe(
      "R1 Wind",
    );
    expect(groupName({ value: "PKG-0000d2", title: "Sun", count: 1, offset: 3 })).toBe("PKG-0000d2 Sun");
    expect(groupName({ value: 3, count: 1, offset: 4 })).toBe("3");
    expect(groupName({ count: 4, offset: 5 })).toBe("(no value)");
  });

  it("counts a group, and in the last group of a relation the elements whose targets are not available", () => {
    expect(groupCount({ value: "a", count: 2, offset: 0 })).toBe("2");
    expect(groupCount({ count: 4, offset: 2, unavailable: 1 })).toBe("4 · 1 with targets not available");
  });

  it("puts the loaded rows under their groups; a group without loaded rows is not shown yet", () => {
    const groups = [
      { value: "a", count: 2, offset: 0 },
      { value: "b", count: 3, offset: 2 },
      { count: 1, offset: 5 },
    ];
    expect(groupSections(groups, 6).map(({ from, to }) => [from, to])).toEqual([
      [0, 2],
      [2, 5],
      [5, 6],
    ]);
    expect(groupSections(groups, 3).map(({ from, to }) => [from, to])).toEqual([
      [0, 2],
      [2, 3],
    ]);
  });

  it("keeps the grouping on the list buffer next to the sort; its name says it", () => {
    const sort = [{ by: "title" as const, order: "asc" as const }];
    const list = { ...listBuffer("All elements", undefined, sort), cursor: 4 };
    const grouped = withGroup(list, "topic");
    expect(grouped).toEqual({ ...list, group: "topic", cursor: NO_ROW });
    expect(bufferName(grouped)).toBe("All elements · sorted by title · grouped by topic");
    expect(withGroup(grouped, undefined)).toEqual({ ...list, cursor: NO_ROW });
    // Other steps or another sort keep the grouping.
    expect(withQuery(grouped, { steps: [] })).toEqual({ ...filteredList([], sort), group: "topic" });
    expect(withQuery(grouped, { sort: [] })).toEqual({ ...list, sort: [], group: "topic", cursor: NO_ROW });
  });

  it("enters the matrix without the grouping and from the first row, since the matrix shows no groups", () => {
    const grouped = { ...withGroup(listBuffer("All elements"), "package"), cursor: 3 };
    const matrix = withMatrix(grouped, true);
    expect(matrix).toEqual({ ...listBuffer("All elements"), matrix: true, cursor: NO_ROW });
    expect(bufferName(matrix)).toBe("All elements · matrix");
    expect(withMatrix(matrix, false)).toEqual({ ...listBuffer("All elements"), cursor: NO_ROW });
  });
});
