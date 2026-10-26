import { describe, expect, it } from "vitest";
import {
  MAX_BUFFERS,
  bufferName,
  elementBuffer,
  elementBufferOf,
  listBuffer,
  reduceBuffers,
  searchBuffer,
  sortLabel,
} from "./buffers.js";
import type { Buffers } from "./buffers.js";

const a = elementBuffer("id-a", "repo", "SR-1 Alpha");
const b = elementBuffer("id-b", "repo", "SR-2 Beta");
const list = listBuffer("All elements");

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
    expect(sortLabel([])).toBe("");
    expect(sortLabel([{ by: "hierarchy", order: "asc" }])).toBe(" · tree");
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

  it("closes a buffer: the next most recent one is shown; the last one leaves the sheet empty", () => {
    expect(reduceBuffers([b, a, list], { type: "close", key: b.key }).map((buffer) => buffer.key)).toEqual([
      a.key,
      list.key,
    ]);
    expect(reduceBuffers([b, a, list], { type: "close", key: a.key })[0]).toBe(b);
    expect(reduceBuffers([list], { type: "close", key: list.key })).toEqual([]);
  });

  it("resets to one buffer, or to none", () => {
    expect(reduceBuffers([b, a], { type: "reset", buffer: list })).toEqual([list]);
    expect(reduceBuffers([b, a], { type: "reset" })).toEqual([]);
  });

  it("moves the cursor of a list or a search, not of an element", () => {
    const search = searchBuffer("wind");
    const moved = reduceBuffers([a, search, list], { type: "cursor", key: search.key, cursor: 7 });
    expect(moved[1]).toEqual({ ...search, cursor: 7 });
    expect(moved[2]).toBe(list);
    expect(reduceBuffers([a, list], { type: "cursor", key: a.key, cursor: 3 })[0]).toBe(a);
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
