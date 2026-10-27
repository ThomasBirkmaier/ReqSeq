import { describe, expect, it } from "vitest";
import {
  DEFAULT_SORT,
  MAX_BUFFERS,
  OVERVIEW_KEY,
  bufferName,
  elementBuffer,
  elementBufferOf,
  filteredList,
  listBuffer,
  listSort,
  onlyOverview,
  overviewBuffer,
  reduceBuffers,
  relationBuffer,
  searchBuffer,
  selectionOf,
  sortLabel,
} from "./buffers.js";
import type { Buffers, FilterStep } from "./buffers.js";
import { savedStep, typeStep } from "./list-filters.js";

const a = elementBuffer("id-a", "repo", "SR-1 Alpha");
const b = elementBuffer("id-b", "repo", "SR-2 Beta");
const list = listBuffer("All elements");

describe("the default sort of the lists (#418)", () => {
  it("is by type, then by identifier, and says nothing in the label", () => {
    expect(DEFAULT_SORT).toEqual([
      { by: "type", order: "asc" },
      { by: "identifier", order: "asc" },
    ]);
    expect(Object.isFrozen(DEFAULT_SORT)).toBe(true);
    expect(sortLabel(DEFAULT_SORT)).toBe("");
    // The same keys as another object, as the sort menu sends them, read the same.
    expect(
      sortLabel([
        { by: "type", order: "asc" },
        { by: "identifier", order: "asc" },
      ]),
    ).toBe("");
    // Not the default: another key, another order, another length.
    expect(sortLabel([{ by: "type", order: "asc" }])).toBe(" · sorted by type");
    expect(
      sortLabel([
        { by: "type", order: "asc" },
        { by: "identifier", order: "desc" },
      ]),
    ).toBe(" · sorted by type");
    expect(
      sortLabel([
        { by: "type", order: "asc" },
        { by: "title", order: "asc" },
      ]),
    ).toBe(" · sorted by type");
    expect(bufferName(listBuffer("All elements", undefined, DEFAULT_SORT))).toBe("All elements");
    expect(bufferName(listBuffer("All elements", undefined, []))).toBe("All elements · workspace order");
  });

  it("asks for the default when nothing is chosen, for the choice otherwise, and keeps a saved filter's sort", () => {
    expect(listSort(listBuffer("All elements"))).toBe(DEFAULT_SORT);
    expect(listSort(filteredList([typeStep("need")]))).toBe(DEFAULT_SORT);
    // `[]` is a choice (the workspace order), not "nothing chosen".
    expect(listSort(listBuffer("All elements", undefined, []))).toEqual([]);
    const title = [{ by: "title", order: "asc" }] as const;
    expect(listSort(listBuffer("All elements", undefined, title))).toBe(title);
    // A saved filter holds its own sort until a sort is chosen (SR-070 AK3).
    expect(listSort(filteredList([savedStep("open")]))).toBeUndefined();
    expect(listSort(filteredList([typeStep("need"), savedStep("open")]))).toBeUndefined();
    // "Type and ID" chosen on a list with a saved filter is asked for.
    expect(listSort(filteredList([savedStep("open")], DEFAULT_SORT))).toBe(DEFAULT_SORT);
    expect(listSort(filteredList([savedStep("open")], []))).toEqual([]);
  });
});

describe("buffers", () => {
  it("names a buffer for the minibuffer and the sheet", () => {
    expect(bufferName(list)).toBe("All elements");
    expect(
      bufferName(listBuffer("type: need", { where: { type: ["need"] } }, [{ by: "title", order: "asc" }])),
    ).toBe("type: need · sorted by title");
    expect(bufferName(searchBuffer("wind"))).toBe("Search: wind");
    expect(bufferName(a)).toBe("SR-1 Alpha");
  });

  it("describes the sort of a list", () => {
    expect(sortLabel(undefined)).toBe("");
    expect(sortLabel([])).toBe(" · workspace order");
    expect(sortLabel([{ by: "hierarchy", order: "asc" }])).toBe(" · tree");
    expect(sortLabel([{ by: "identifier", order: "asc" }])).toBe(" · sorted by ID");
    expect(sortLabel([{ by: "identifier", order: "desc" }])).toBe(" · sorted by ID descending");
    expect(sortLabel([{ by: "id", order: "desc" }])).toBe(" · sorted by ID descending");
    expect(sortLabel([{ by: "effort", order: "asc" }])).toBe(" · sorted by effort");
  });

  it("builds the buffer of an element from what a row shows", () => {
    expect(
      elementBufferOf({ id: "u", repository: "r", shortId: "SR-0000b1", identifier: "SR-036", title: "T" }),
    ).toEqual(elementBuffer("u", "r", "SR-036 T"));
    expect(elementBufferOf({ id: "u", repository: "r", shortId: "SR-0000b1", title: "" }).name).toBe(
      "SR-0000b1",
    );
    expect(elementBuffer("u", "r", "x").key).not.toBe(elementBuffer("u", "other", "x").key);
  });

  it("opens a relation target by UUID and the repository of the target (#416)", () => {
    expect(
      relationBuffer({
        id: "u",
        repository: "platform",
        shortId: "N-0000b1",
        identifier: "N-001",
        title: "Need",
      }),
    ).toEqual(elementBuffer("u", "platform", "N-001 Need"));
    expect(relationBuffer({ id: "u", repository: "platform", shortId: "N-0000b1" })).toEqual(
      elementBuffer("u", "platform", "N-0000b1"),
    );
    expect(relationBuffer({ id: "u", repository: "platform" })).toEqual(elementBuffer("u", "platform", "u"));
    expect(relationBuffer({ id: "u" })).toBeUndefined();
  });

  it("opens a new buffer in front, and an open one moves to the front, replaced", () => {
    let buffers: Buffers = [];
    buffers = reduceBuffers(buffers, { type: "open", buffer: list });
    buffers = reduceBuffers(buffers, { type: "open", buffer: a });
    buffers = reduceBuffers(buffers, { type: "open", buffer: b });
    expect(buffers.map((buffer) => buffer.key)).toEqual([b.key, a.key, list.key]);
    const filtered = listBuffer("type: need");
    buffers = reduceBuffers(buffers, { type: "open", buffer: filtered });
    expect(buffers.map((buffer) => buffer.key)).toEqual([list.key, b.key, a.key]);
    expect(buffers[0]).toBe(filtered);
  });

  it("switches to an open buffer, and ignores one that is not open", () => {
    const buffers: Buffers = [b, a, list];
    expect(reduceBuffers(buffers, { type: "switch", key: list.key }).map((buffer) => buffer.key)).toEqual([
      list.key,
      b.key,
      a.key,
    ]);
    expect(reduceBuffers(buffers, { type: "switch", key: "gone" })).toBe(buffers);
  });

  it("closes a buffer: the next most recent one is shown; the last one gives the overview", () => {
    expect(reduceBuffers([b, a, list], { type: "close", key: b.key }).map((buffer) => buffer.key)).toEqual([
      a.key,
      list.key,
    ]);
    expect(reduceBuffers([b, a, list], { type: "close", key: a.key })[0]).toBe(b);
    expect(reduceBuffers([list], { type: "close", key: list.key })).toEqual([overviewBuffer()]);
    // The lone overview stays, and a key that is not open changes nothing.
    const only = [overviewBuffer()];
    expect(reduceBuffers(only, { type: "close", key: OVERVIEW_KEY })).toBe(only);
    expect(reduceBuffers([b, list], { type: "close", key: "nothing" })).toEqual([b, list]);
    expect(reduceBuffers([], { type: "close", key: "nothing" })).toEqual([]);
  });

  it("names the overview and finds out whether it is the only buffer", () => {
    expect(bufferName(overviewBuffer())).toBe("Overview");
    expect(onlyOverview([overviewBuffer()])).toBe(true);
    expect(onlyOverview([overviewBuffer(), list])).toBe(false);
    expect(onlyOverview([list])).toBe(false);
    expect(onlyOverview([])).toBe(false);
  });

  it("moves the cursor of the overview", () => {
    expect(reduceBuffers([overviewBuffer()], { type: "cursor", key: OVERVIEW_KEY, cursor: 2 })).toEqual([
      { ...overviewBuffer(), cursor: 2 },
    ]);
  });

  it("resets to one buffer, or to none", () => {
    expect(reduceBuffers([b, a], { type: "reset", buffer: list })).toEqual([list]);
    expect(reduceBuffers([b, a], { type: "reset" })).toEqual([]);
  });

  it("moves the cursor of a list or a search; an element keeps the row of its package page apart", () => {
    const search = searchBuffer("wind");
    const moved = reduceBuffers([a, search, list], { type: "cursor", key: search.key, cursor: 7 });
    expect(moved[1]).toEqual({ ...search, cursor: 7 });
    expect(moved[2]).toBe(list);
    const onPage = reduceBuffers([a, list], { type: "cursor", key: a.key, cursor: 3 });
    expect(onPage[0]).toEqual({ ...a, memberCursor: 3 });
    expect(onPage[1]).toBe(list);
    expect(reduceBuffers([list], { type: "cursor", key: list.key, cursor: 3 })[0]).toEqual({
      ...list,
      cursor: 3,
    });
  });

  it("keeps at most MAX_BUFFERS, dropping the least recent", () => {
    let buffers: Buffers = [];
    for (let i = 0; i < MAX_BUFFERS + 5; i += 1) {
      buffers = reduceBuffers(buffers, { type: "open", buffer: elementBuffer(`id-${String(i)}`, "r", "x") });
    }
    expect(buffers).toHaveLength(MAX_BUFFERS);
    expect(buffers[0]?.key).toBe(`element:r:id-${String(MAX_BUFFERS + 4)}`);
  });
});

const TYPE: FilterStep = {
  label: "type: system-requirement",
  selection: { where: { type: ["system-requirement"] } },
};
const STATUS: FilterStep = { label: "status: draft", selection: { where: { status: ["draft"] } } };
const TOPIC: FilterStep = {
  label: "topic: Bearbeiten und Finden",
  selection: { where: { property: "topic", op: "eq", value: "Bearbeiten und Finden" } },
};
const SAVED: FilterStep = { label: "filter: open", selection: { filter: "open" } };

describe("the steps of a list filter (SR-124)", () => {
  it("[SR-124/AK1] a list without steps is the list of all elements", () => {
    const sort = [{ by: "title", order: "asc" }] as const;
    expect(filteredList([], sort)).toEqual(listBuffer("All elements", undefined, sort));
    expect(filteredList([]).steps).toEqual([]);
  });

  it("[SR-124/AK1] one step selects its own condition, several select all of theirs, a saved filter stays a filter", () => {
    expect(selectionOf([])).toBeUndefined();
    expect(selectionOf([TYPE])).toEqual({ where: { type: ["system-requirement"] } });
    expect(selectionOf([TYPE, STATUS, TOPIC])).toEqual({
      where: { all: [TYPE.selection.where, STATUS.selection.where, TOPIC.selection.where] },
    });
    expect(selectionOf([SAVED])).toEqual({ filter: "open" });
    expect(selectionOf([SAVED, TYPE])).toEqual({ filter: "open", where: { type: ["system-requirement"] } });
    expect(selectionOf([TYPE, SAVED, STATUS])).toEqual({
      filter: "open",
      where: { all: [TYPE.selection.where, STATUS.selection.where] },
    });
  });

  it("[SR-124/AK1] the label shows the chain of steps", () => {
    const chain = filteredList([TYPE, STATUS, TOPIC], [{ by: "title", order: "asc" }]);
    expect(chain.label).toBe("type: system-requirement · status: draft · topic: Bearbeiten und Finden");
    expect(bufferName(chain)).toBe(
      "type: system-requirement · status: draft · topic: Bearbeiten und Finden · sorted by title",
    );
    expect(chain.steps).toEqual([TYPE, STATUS, TOPIC]);
    expect(chain.cursor).toBe(0);
  });

  it("a list built with a selection is one step", () => {
    const selection = { where: { type: ["need"] } };
    expect(listBuffer("type: need", selection).steps).toEqual([{ label: "type: need", selection }]);
    expect(filteredList([{ label: "type: need", selection }])).toEqual(listBuffer("type: need", selection));
  });
});
