// The record of a buffer's shown view (SR-212 AK5): it gives back what that view read, also a page put together
// from the pages it read, and nothing it did not read.
import { describe, expect, it } from "vitest";
import { AnswerRecord, AreaRecords, RECORD_MAX, pageFrom } from "./area-record.js";
import type { Call } from "./call.js";

const call: Call = () => Promise.resolve({ ok: false, code: "test", message: "not in this test" });
const other: Call = () => Promise.resolve({ ok: false, code: "test", message: "not in this test" });
const TAG = { seen: 3, call };

const rows = (from: number, count: number): { readonly id: string }[] =>
  Array.from({ length: count }, (_, at) => ({ id: `e${String(from + at)}` }));

const listPage = (offset: number, limit: number, total: number) => {
  const count = Math.max(0, Math.min(limit, total - offset));
  return {
    elements: rows(offset, count),
    rowVerification: rows(offset, count).map(({ id }) => ({ status: id })),
    total,
  };
};

describe("pageFrom", () => {
  it("[SR-212/AK-tfck] puts a page together from pages that cover it, each part with one entry per row", () => {
    const pieces = [
      { offset: 200, limit: 200, output: listPage(200, 200, 450) },
      { offset: 0, limit: 200, output: listPage(0, 200, 450) },
    ];
    const page = pageFrom("element.list", pieces, 0, 400);
    expect((page?.["elements"] as unknown[]).length).toBe(400);
    expect(page?.["elements"]).toEqual(rows(0, 400));
    expect(page?.["rowVerification"]).toEqual(rows(0, 400).map(({ id }) => ({ status: id })));
    expect(page?.["total"]).toBe(450);
    // From the middle of one page into the next.
    expect(pageFrom("element.list", pieces, 150, 100)?.["elements"]).toEqual(rows(150, 100));
  });

  it("[SR-212/AK-tfck] covers a page past the end of the list only when a page read before ended the list there", () => {
    const first = { offset: 0, limit: 200, output: listPage(0, 200, 250) };
    const ended = [first, { offset: 200, limit: 200, output: listPage(200, 200, 250) }];
    expect(pageFrom("element.list", ended, 0, 400)?.["elements"]).toEqual(rows(0, 250));
    expect(pageFrom("element.list", ended, 300, 100)?.["elements"]).toEqual([]);
    // A gap: rows 200 to 400 were never read.
    expect(pageFrom("element.list", [first], 0, 400)).toBeUndefined();
    expect(pageFrom("element.list", [], 0, 200)).toBeUndefined();
  });

  it("[SR-212/AK-tfck] gives a grouped page its own offset and the groups of the list, a search its hits, a matrix its rows and the elements named once", () => {
    const grouped = [
      { offset: 0, limit: 2, output: { elements: rows(0, 2), groups: ["g"], offset: 0, rows: 4, total: 4 } },
      { offset: 2, limit: 2, output: { elements: rows(2, 2), groups: ["g"], offset: 2, rows: 4, total: 4 } },
    ];
    expect(pageFrom("element.list", grouped, 1, 2)).toEqual({
      elements: rows(1, 2),
      groups: ["g"],
      offset: 1,
      rows: 4,
      total: 4,
    });
    const hits = [{ offset: 0, limit: 50, output: { hits: rows(0, 2), total: 2 } }];
    expect(pageFrom("element.search", hits, 0, 50)).toEqual({ hits: rows(0, 2), total: 2 });
    const matrix = [
      { offset: 0, limit: 1, output: { rows: rows(0, 1), columns: ["c"], names: [{ id: "v" }], total: 2 } },
      {
        offset: 1,
        limit: 1,
        output: { rows: rows(1, 1), columns: ["c"], names: [{ id: "v" }, { id: "w" }], total: 2 },
      },
    ];
    expect(pageFrom("trace.matrix", matrix, 0, 2)).toEqual({
      rows: rows(0, 2),
      columns: ["c"],
      names: [{ id: "v" }, { id: "w" }],
      total: 2,
    });
    const unnamed = [{ offset: 0, limit: 5, output: { rows: rows(0, 1), names: [], total: 1 } }];
    expect(pageFrom("trace.matrix", unnamed, 0, 5)).toEqual({ rows: rows(0, 1), total: 1 });
  });
});

describe("AnswerRecord", () => {
  it("[SR-212/AK-tfck] answers the reads it kept, and a page from its pages, and misses everything else", () => {
    const record = new AnswerRecord(TAG, "inputs");
    const element = { ok: true, output: { element: { id: "a" } } };
    record.add("element.get", { ref: "a" }, element);
    record.add(
      "element.list",
      { selection: { ids: ["x"] }, offset: 0, limit: 200 },
      {
        ok: true,
        output: listPage(0, 200, 300),
      },
    );
    record.add(
      "element.list",
      { selection: { ids: ["x"] }, offset: 200, limit: 200 },
      {
        ok: true,
        output: listPage(200, 200, 300),
      },
    );
    expect(record.answer("element.get", { ref: "a" })).toBe(element);
    expect(record.answer("element.get", { ref: "b" })).toBeUndefined();
    const page = record.answer("element.list", { selection: { ids: ["x"] }, offset: 0, limit: 400 });
    expect(page?.ok === true ? (page.output as { elements: unknown[] }).elements : []).toHaveLength(300);
    // Another selection is another list.
    expect(
      record.answer("element.list", { selection: { ids: ["y"] }, offset: 0, limit: 200 }),
    ).toBeUndefined();
    expect(record.answer("trace.graph", { ref: "a" })).toBeUndefined();
    // A page without a limit is answered only as it was asked, and never put together from pages.
    expect(record.answer("element.list", { selection: { ids: ["x"] }, offset: 0 })).toBeUndefined();
    const whole = { ok: true, output: listPage(0, 300, 300) };
    record.add("element.list", { selection: { ids: ["z"] } }, whole);
    expect(record.answer("element.list", { selection: { ids: ["z"] } })).toBe(whole);
    expect(
      record.answer("element.list", { selection: { ids: ["z"] }, offset: 0, limit: 10 }),
    ).toBeUndefined();
  });

  it("[SR-212/AK-tfck] keeps no write, no failure, and misses from the answer past its room on", () => {
    const record = new AnswerRecord(TAG, "inputs");
    record.add("element.update", { ref: "a" }, { ok: true });
    record.add("element.get", { ref: "b" }, { ok: false });
    expect(record.answer("element.update", { ref: "a" })).toBeUndefined();
    expect(record.answer("element.get", { ref: "b" })).toBeUndefined();
    for (let at = 0; at < RECORD_MAX; at += 1) {
      record.add("element.get", { ref: String(at) }, { ok: true, output: {} });
    }
    expect(record.answer("element.get", { ref: "0" })).toBeDefined();
    record.add("element.get", { ref: "more" }, { ok: true, output: {} });
    expect(record.answer("element.get", { ref: "0" })).toBeUndefined();
  });
});

describe("AreaRecords", () => {
  it("[SR-212/AK-tfck] gives a record only for its generation, call and inputs, and keeps only those of the buffers beside", () => {
    const records = new AreaRecords();
    const kept = records.take("a", TAG, "one");
    expect(records.take("a", TAG, "two")).toBe(kept);
    expect(records.get("a", TAG, "two")).toBe(kept);
    expect(records.get("a", TAG, "one")).toBeUndefined();
    expect(records.get("a", { seen: 4, call }, "two")).toBeUndefined();
    expect(records.get("a", { seen: 3, call: other }, "two")).toBeUndefined();
    // Another generation replaces it.
    expect(records.take("a", { seen: 4, call }, "two")).not.toBe(kept);
    records.take("b", { seen: 4, call }, "two");
    records.take("c", { seen: 4, call }, "two");
    records.prune(new Set(["a", "b"]), { seen: 4, call });
    expect(records.get("c", { seen: 4, call }, "two")).toBeUndefined();
    expect(records.get("b", { seen: 4, call }, "two")).toBeDefined();
    records.forget("b");
    expect(records.get("b", { seen: 4, call }, "two")).toBeUndefined();
    records.prune(new Set(["a"]), { seen: 5, call });
    expect(records.get("a", { seen: 4, call }, "two")).toBeUndefined();
  });
});
