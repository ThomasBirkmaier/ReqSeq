import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SORT,
  filteredList,
  listBuffer,
  listSort,
  searchBuffer,
  withGroup,
  withMatrix,
} from "./buffers.js";
import { sessionText } from "./buffer-session.js";
import { STEP_LIST_LABEL } from "./list-actions.js";
import { savedStep, statusStep, textStep, typeStep } from "./list-filters.js";
import { flush, setup, action, filterBy, list, filtered, element, titles } from "./actions.test-helper.js";

describe("list actions", () => {
  it("list all elements keeps the sort, and from an element starts without one", () => {
    const first = setup([filtered]);
    action("list-all").run(first.context);
    expect(first.dispatched).toEqual([
      { type: "open", buffer: listBuffer("All elements", undefined, [{ by: "title", order: "asc" }]) },
    ]);
    const second = setup([element]);
    action("list-all").run(second.context);
    expect(second.dispatched).toEqual([{ type: "open", buffer: listBuffer("All elements") }]);
  });

  it("list all elements from a next step of element.list lists with the step's selection (SR-226 AK5)", () => {
    const selection = { where: { verification: ["open"] } } as const;
    const { context, dispatched } = setup([element]);
    const given = { "element.list": [{ field: "selection", value: selection, label: "" }] };
    action("list-all").run({ ...context, given });
    expect(dispatched).toEqual([{ type: "open", buffer: listBuffer(STEP_LIST_LABEL, selection) }]);
    // Given inputs of another command, or a selection that is no object, list every element.
    const other = setup([element]);
    action("list-all").run({
      ...other.context,
      given: { "relation.add": [{ field: "selection", value: selection, label: "" }] },
    });
    for (const value of ["open", ["open"], null]) {
      action("list-all").run({
        ...other.context,
        given: { "element.list": [{ field: "selection", value, label: "" }] },
      });
    }
    expect(other.dispatched).toHaveLength(4);
    expect(new Set(other.dispatched.map((d) => JSON.stringify(d)))).toEqual(
      new Set([JSON.stringify({ type: "open", buffer: listBuffer("All elements") })]),
    );
  });

  it("filters by a type of the metamodel and keeps the sort", async () => {
    const { context, asked, dispatched, call } = setup([filtered], {
      "metamodel.get": {
        types: [
          { key: "need", name: "Need" },
          { key: "system-requirement", name: "System Requirement" },
        ],
        statuses: [{ key: "draft" }],
      },
    });
    filterBy(context, asked, "Type");
    await flush();
    expect(call).toHaveBeenCalledWith("metamodel.get", {});
    expect(asked[1]?.label).toBe("Type");
    const types = await asked[1]?.fill;
    expect(types?.items?.map((item) => [item.name, item.hint])).toEqual([
      ["Need", "need"],
      ["System Requirement", "system-requirement"],
    ]);
    types?.items?.[1]?.run();
    // The type goes into the mark; "Take 1 type" adds the step (SR-124 AK7).
    expect(dispatched).toEqual([]);
    (await asked[2]?.fill)?.items?.[0]?.run();
    expect(dispatched).toEqual([
      {
        type: "open",
        // The list was filtered by type need already: the new step narrows it (SR-124 AK1).
        buffer: filteredList(
          [typeStep("need"), typeStep("system-requirement")],
          [{ by: "title", order: "asc" }],
        ),
      },
    ]);
  });

  it("filters by a status the elements of the list have", async () => {
    const { context, asked, dispatched, call } = setup([list], {
      "element.facets": {
        statuses: [
          { key: "draft", count: 3 },
          { key: "accepted", count: 1 },
        ],
      },
      "metamodel.get": { statuses: [{ key: "draft", name: "Draft" }] },
    });
    filterBy(context, asked, "Status");
    await flush();
    expect(call).toHaveBeenCalledWith("element.facets", {});
    expect(asked[1]?.items.map((item) => item.name)).toEqual(["Draft", "accepted"]);
    asked[1]?.items[0]?.run();
    expect(dispatched).toEqual([
      { type: "open", buffer: listBuffer("status: draft", { where: { status: ["draft"] } }) },
    ]);
  });

  it("filters by a saved filter", async () => {
    const { context, asked, dispatched, call } = setup([list], {
      "filter.list": { filters: [{ name: "open-needs" }] },
    });
    filterBy(context, asked, "Saved filter");
    await flush();
    expect(call).toHaveBeenCalledWith("filter.list", {});
    asked[1]?.items[0]?.run();
    expect(dispatched).toEqual([
      { type: "open", buffer: listBuffer("filter: open-needs", { filter: "open-needs" }) },
    ]);
  });

  it("says why there is nothing to choose from", async () => {
    const empty = setup([list], {
      "metamodel.get": { types: [], statuses: [] },
      "element.facets": { statuses: [] },
      "filter.list": { filters: [] },
    });
    for (const kind of ["Type", "Status", "Saved filter"]) {
      filterBy(empty.context, empty.asked, kind);
    }
    await flush();
    expect(empty.asked.map((prompt) => prompt.label)).toEqual(["Filter by", "Filter by", "Filter by"]);
    expect([...empty.echoed].sort()).toEqual([
      "The elements of this list have no status.",
      "The metamodel has no types.",
      "The workspace has no saved filters.",
    ]);
    const failing = setup([list], {
      "metamodel.get": new Error("The metamodel is not valid"),
      "element.facets": new Error("The facets failed"),
      "filter.list": new Error("No filters"),
    });
    for (const kind of ["Type", "Status", "Saved filter"]) {
      filterBy(failing.context, failing.asked, kind);
    }
    await flush();
    expect([...failing.echoed].sort()).toEqual([
      "No filters",
      "The facets failed",
      "The metamodel is not valid",
    ]);
  });

  it("clears the filter and keeps the sort", () => {
    const { context, dispatched } = setup([filtered]);
    expect(action("clear-filter").available(setup([list]).context)).toBe(false);
    expect(action("clear-filter").available(context)).toBe(true);
    action("clear-filter").run(context);
    expect(dispatched).toEqual([
      { type: "open", buffer: listBuffer("All elements", undefined, [{ by: "title", order: "asc" }]) },
    ]);
  });

  it("sorts by type and ID, ID, title, type, status or hierarchy, or the workspace order, and keeps the filter", () => {
    const { context, asked, dispatched } = setup([filtered]);
    action("sort").run(context);
    const names = asked[0]?.items.map((item) => item.name);
    expect(names).toEqual([
      "Type and ID",
      "Workspace order",
      "ID",
      "Title",
      "Type",
      "Status",
      "Hierarchy (tree)",
    ]);
    const first = asked[0];
    first?.items[0]?.run();
    first?.items[1]?.run();
    // A key with a direction asks for it next ("Order"); the first list names each key once.
    for (const key of [2, 3, 4, 5]) {
      for (const order of [0, 1]) {
        first?.items[key]?.run();
        asked.at(-1)?.items[order]?.run();
      }
    }
    first?.items[6]?.run();
    const selection = { where: { type: ["need"] } };
    const by = (key: "identifier" | "title" | "type" | "status") =>
      (["asc", "desc"] as const).map((order) => ({
        type: "open",
        buffer: listBuffer("type: need", selection, [{ by: key, order }]),
      }));
    // "Type and ID" is the default sent explicitly, "Workspace order" is `[]`, "ID" sorts by `identifier`
    // (what the rows show), so each holds on a list with a saved filter too.
    expect(dispatched).toEqual([
      { type: "open", buffer: listBuffer("type: need", selection, DEFAULT_SORT) },
      { type: "open", buffer: listBuffer("type: need", selection, []) },
      ...by("identifier"),
      ...by("title"),
      ...by("type"),
      ...by("status"),
      { type: "open", buffer: listBuffer("type: need", selection, [{ by: "hierarchy", order: "asc" }]) },
    ]);
  });

  it("asks for ascending or descending after a key with a direction", () => {
    const { context, asked } = setup([filtered]);
    action("sort").run(context);
    asked[0]?.items[3]?.run();
    expect(asked[1]?.label).toBe("Order");
    expect(asked[1]?.items.map((item) => item.name)).toEqual(["ascending", "descending"]);
  });

  it("sorting a list with a saved filter by type and ID asks for the default, by workspace order for none", () => {
    const saved = filteredList([savedStep("open")]);
    const { context, asked, dispatched } = setup([saved]);
    action("sort").run(context);
    asked[0]?.items[0]?.run();
    asked[0]?.items[1]?.run();
    const [first, second] = dispatched.map((d) =>
      d.type === "open" && d.buffer.kind === "list" ? listSort(d.buffer) : "?",
    );
    expect(first).toBe(DEFAULT_SORT);
    expect(second).toEqual([]);
  });

  describe("grouping a list (SR-149)", () => {
    const facets = {
      total: 3,
      types: [],
      statuses: [{ key: "draft", count: 3 }],
      properties: [
        {
          key: "topic",
          name: "Topic",
          kind: "text",
          count: 2,
          missing: 1,
          distinct: 2,
          values: [
            { value: "A", count: 1 },
            { value: "B", count: 1 },
          ],
        },
        {
          key: "rationale",
          name: "Rationale",
          kind: "text",
          count: 3,
          missing: 0,
          distinct: 31,
          distinctCapped: true,
        },
        {
          key: "packages",
          name: "Packages",
          kind: "relation",
          count: 3,
          missing: 0,
          distinct: 1,
          values: [{ value: "PKG-1", count: 3 }],
        },
        { key: "priority", name: "Priority", kind: "choice", count: 0, missing: 3, distinct: 0, values: [] },
        {
          key: "verification-method",
          name: "Method",
          kind: "choice",
          count: 3,
          missing: 0,
          distinct: 1,
          values: [{ value: "test", count: 3 }],
        },
      ],
    };
    const metamodel = { meanings: { packages: ["packages"] } };
    const steps = [statusStep("draft")];
    const sort = [{ by: "title" as const, order: "asc" as const }];
    const sorted = filteredList(steps, sort);

    it("[SR-149/AK-mfr6] the command line offers type, status, package and the properties with values to choose of the listed elements", async () => {
      const { context, asked, call } = setup([sorted], {
        "element.facets": facets,
        "metamodel.get": metamodel,
      });
      action("group").run(context);
      await flush();
      expect(call).toHaveBeenCalledWith("element.facets", { selection: sorted.selection });
      expect(asked[0]?.label).toBe("Group by");
      // Free text without values (rationale), a property without values among these elements (priority)
      // and the property of the packages, which "Package" groups by, are not offered.
      expect(asked[0]?.items.map((item) => [item.name, item.hint])).toEqual([
        ["Type", undefined],
        ["Status", undefined],
        ["Package", undefined],
        ["Topic", "2"],
        ["Method", "1"],
      ]);
    });

    it("[SR-149/AK-mfr6] offers no package but the packages property when the metamodel cannot be read or names none, and says why facets fail", async () => {
      const failing = setup([list], { "element.facets": facets, "metamodel.get": new Error("no metamodel") });
      action("group").run(failing.context);
      await flush();
      expect(failing.call).toHaveBeenCalledWith("element.facets", {});
      expect(failing.asked[0]?.items.map((item) => item.name)).toEqual([
        "Type",
        "Status",
        "Topic",
        "Packages",
        "Method",
      ]);
      const unassigned = setup([list], { "element.facets": facets, "metamodel.get": { meanings: {} } });
      action("group").run(unassigned.context);
      await flush();
      expect(unassigned.asked[0]?.items.map((item) => item.name)).not.toContain("Package");
      expect(unassigned.asked[0]?.items.map((item) => item.name)).toContain("Packages");
      const broken = setup([list], {
        "element.facets": new Error("facets failed"),
        "metamodel.get": metamodel,
      });
      action("group").run(broken.context);
      await flush();
      expect(broken.asked).toEqual([]);
      expect(broken.echoed).toEqual(["facets failed"]);
    });

    it("[SR-149/AK-pd1k] choosing another grouping or ungrouping keeps the filter steps and the sort", async () => {
      const { context, asked, dispatched } = setup([sorted], {
        "element.facets": facets,
        "metamodel.get": metamodel,
      });
      action("group").run(context);
      await flush();
      asked[0]?.items[2]?.run();
      asked[0]?.items[3]?.run();
      expect(dispatched).toEqual([
        { type: "open", buffer: { ...sorted, group: "package" } },
        { type: "open", buffer: { ...sorted, group: "topic" } },
      ]);
      const grouped = withGroup(sorted, "topic");
      const again = setup([grouped]);
      expect(action("ungroup").available(again.context)).toBe(true);
      action("ungroup").run(again.context);
      expect(again.dispatched).toEqual([{ type: "open", buffer: sorted }]);
    });

    it("[SR-149/AK-pd1k] filtering and sorting a grouped list keep the grouping", () => {
      const grouped = withGroup(sorted, "status");
      const { context, asked, dispatched } = setup([grouped]);
      action("sort").run(context);
      asked[0]?.items[0]?.run();
      action("clear-filter").run(context);
      expect(dispatched).toEqual([
        { type: "open", buffer: { ...filteredList(steps, DEFAULT_SORT), group: "status" } },
        { type: "open", buffer: { ...filteredList([], sort), group: "status" } },
      ]);
    });

    it("is offered on a list, not on a matrix or an element; ungrouping only on a grouped list", () => {
      expect(action("group").available(setup([list]).context)).toBe(true);
      expect(action("group").available(setup([withMatrix(list, true)]).context)).toBe(false);
      expect(action("group").available(setup([element]).context)).toBe(false);
      expect(action("ungroup").available(setup([list]).context)).toBe(false);
      expect(action("ungroup").available(setup([withMatrix(withGroup(list, "type"), true)]).context)).toBe(
        false,
      );
      const { context, dispatched } = setup([element]);
      action("group").run(context);
      action("ungroup").run(context);
      expect(dispatched).toEqual([]);
    });

    it("[SR-149/AK-rdmd] choosing a grouping only reads, and the grouping is not kept with the buffers", async () => {
      const { context, asked, call, dispatched } = setup([list], {
        "element.facets": facets,
        "metamodel.get": metamodel,
      });
      action("group").run(context);
      await flush();
      asked[0]?.items[0]?.run();
      expect(call.mock.calls.map(([name]) => name)).toEqual(["element.facets", "metamodel.get"]);
      const [opened] = dispatched;
      expect(opened?.type === "open" ? sessionText([opened.buffer]) : "?").toBe(sessionText([list]));
    });
  });

  describe("on a package page (SR-112)", () => {
    const page = {
      save: vi.fn(),
      edit: vi.fn(),
      follow: vi.fn(),
      copy: vi.fn(),
      addProperty: vi.fn(),
      clearProperty: vi.fn(),
      insertImage: vi.fn(),
      listValue: vi.fn(),
      flush: vi.fn(() => Promise.resolve(true)),
      prompting: vi.fn(),
      members: true,
    };
    const tree = [{ by: "hierarchy" as const, order: "asc" as const }];

    it('[SR-112/AK-vv6f] "Sort list" and the filters are offered on a package page and not on another element', () => {
      const onPage = setup([element, list], {}, true, { element: page }).context;
      expect(action("sort").available(onPage)).toBe(true);
      expect(titles(onPage)).toContain("Sort list");
      expect(action("filter").available(onPage)).toBe(true);
      // Nothing to clear before a filter is chosen.
      expect(action("clear-filter").available(onPage)).toBe(false);
      expect(action("clear-filters").available(onPage)).toBe(false);
      const other = { ...page, members: false };
      expect(action("sort").available(setup([element], {}, true, { element: other }).context)).toBe(false);
      expect(action("filter").available(setup([element], {}, true, { element: other }).context)).toBe(false);
      expect(action("sort").available(setup([element]).context)).toBe(false);
      // The controls of an element that is no longer shown do not make a search a package page.
      expect(
        action("sort").available(setup([searchBuffer("wind")], {}, true, { element: page }).context),
      ).toBe(false);
    });

    it("[SR-112/AK-vv6f] a filter on a package page narrows its elements step by step and keeps the element buffer", async () => {
      const metamodel = { statuses: [] };
      const first = setup(
        [element],
        { "element.facets": { statuses: [{ key: "draft", count: 2 }] }, "metamodel.get": metamodel },
        true,
        { element: page },
      );
      filterBy(first.context, first.asked, "Status");
      await flush();
      // The values are those of the package's elements.
      expect(first.call).toHaveBeenCalledWith("element.facets", { selection: { where: { package: "u1" } } });
      first.asked[1]?.items[0]?.run();
      const once = { ...element, memberSteps: [statusStep("draft")], memberCursor: 0 };
      expect(first.dispatched).toEqual([{ type: "open", buffer: once }]);
      // A second step: the facets of the package and the first step together; the sort stays.
      const sorted = { ...once, memberSort: [{ by: "title" as const, order: "asc" as const }] };
      const second = setup(
        [sorted],
        { "element.facets": { statuses: [] }, "metamodel.get": metamodel },
        true,
        { element: page },
      );
      filterBy(second.context, second.asked, "Text search");
      second.asked[1]?.text?.("wind");
      expect(second.dispatched).toEqual([
        { type: "open", buffer: { ...sorted, memberSteps: [statusStep("draft"), textStep("wind")] } },
      ]);
      filterBy(second.context, second.asked, "Status");
      await flush();
      expect(second.call).toHaveBeenCalledWith("element.facets", {
        selection: { where: { all: [{ package: "u1" }, { status: ["draft"] }] } },
      });
    });

    it("[SR-112/AK-vv6f] clearing the filters of a package page takes back the last step, then all", () => {
      const twice = { ...element, memberSteps: [statusStep("draft"), typeStep("need")], memberCursor: 3 };
      const { context, dispatched } = setup([twice], {}, true, { element: page });
      expect(action("clear-filters").available(context)).toBe(true);
      action("clear-filter").run(context);
      action("clear-filters").run(context);
      expect(dispatched).toEqual([
        { type: "open", buffer: { ...element, memberSteps: [statusStep("draft")], memberCursor: 0 } },
        { type: "open", buffer: { ...element, memberCursor: 0 } },
      ]);
    });

    it("[SR-112/AK-vv6f] the matrix of a filtered package page shows the elements its list shows", () => {
      const once = { ...element, memberSteps: [statusStep("draft")] };
      const { context, dispatched } = setup([once], {}, true, { element: page });
      action("matrix").run(context);
      const shown = dispatched[0];
      expect(shown?.type === "open" ? shown.buffer : undefined).toMatchObject({
        kind: "list",
        matrix: true,
        selection: { where: { all: [{ package: "u1" }, { status: ["draft"] }] } },
      });
    });

    it("[SR-112/AK-vv6f] sorting on a package page sorts its elements and keeps the element buffer", () => {
      const { context, asked, dispatched } = setup([element], {}, true, { element: page });
      action("sort").run(context);
      expect(asked[0]?.label).toBe("Sort by");
      asked[0]?.items[6]?.run();
      asked[0]?.items[1]?.run();
      asked[0]?.items[0]?.run();
      expect(dispatched).toEqual([
        { type: "open", buffer: { ...element, memberSort: tree, memberCursor: 0 } },
        { type: "open", buffer: { ...element, memberSort: [], memberCursor: 0 } },
        { type: "open", buffer: { ...element, memberSort: DEFAULT_SORT, memberCursor: 0 } },
      ]);
      expect(dispatched.map((d) => (d.type === "open" ? d.buffer.key : ""))).toEqual([
        element.key,
        element.key,
        element.key,
      ]);
    });

    it("[SR-112/AK-vv6f] the sort prompt on a package page offers the same choices as on a list", () => {
      const onList = setup([filtered]);
      action("sort").run(onList.context);
      const onPage = setup([element], {}, true, { element: page });
      action("sort").run(onPage.context);
      expect(onPage.asked[0]?.items.map((item) => item.name)).toEqual(
        onList.asked[0]?.items.map((item) => item.name),
      );
      expect(onPage.asked[0]?.label).toBe(onList.asked[0]?.label);
    });
  });

  it("do nothing when the shown buffer is no list", async () => {
    const { context, asked, dispatched, echoed, call } = setup([element]);
    for (const id of ["filter", "clear-filter", "clear-filters", "sort"]) {
      expect(action(id).available(context)).toBe(false);
      action(id).run(context);
    }
    await flush();
    expect([asked, dispatched, echoed, call.mock.calls]).toEqual([[], [], [], []]);
  });
});
