import { describe, expect, it } from "vitest";
import { handOverView, recordsById } from "./by-id.js";
import type { ElementRecord } from "./elements.js";
import { PatchedMap } from "./patched-map.js";

const record = (id: string, file: string): ElementRecord =>
  ({ id, file, repository: "system" }) as unknown as ElementRecord;

const ids = Array.from({ length: 20 }, (_, i) => `id-${String(i)}`);

describe("recordsById (#215)", () => {
  it("reads a plain map as it is, and a patched one through base and overlay until it was looked up often", () => {
    const plain = new Map(
      ids.map((id): [string, readonly ElementRecord[]] => [id, [record(id, `${id}.md`)]]),
    );
    expect(recordsById(plain, "id-1")).toBe(plain.get("id-1"));
    expect(recordsById(plain, "none")).toBeUndefined();
    const patched = PatchedMap.patch<string, readonly ElementRecord[]>(plain, [
      ["id-1", [record("id-1", "moved.md")]],
      ["id-2", undefined],
    ]);
    // Below 1,024 lookups: the patched map's own lists.
    for (let i = 1; i < 1_024; i++) {
      expect(recordsById(patched, "id-1")).toBe(patched.get("id-1"));
    }
    // From then on a plain view with copies of the lists, built once.
    const viewed = recordsById(patched, "id-1");
    expect(viewed).toEqual(patched.get("id-1"));
    expect(viewed).not.toBe(patched.get("id-1"));
    expect(recordsById(patched, "id-2")).toBeUndefined();
    expect(recordsById(patched, "id-1")).toBe(viewed);
    // Another map in between: the view is kept for the patched one.
    expect(recordsById(plain, "id-2")).toBe(plain.get("id-2"));
    expect(recordsById(patched, "id-1")).toBe(viewed);
  });

  it("hands a built view over to the next patch, and builds one again for the map it came from", () => {
    const plain = new Map(
      ids.map((id): [string, readonly ElementRecord[]] => [id, [record(id, `${id}.md`)]]),
    );
    const first = PatchedMap.patch<string, readonly ElementRecord[]>(plain, [
      ["id-0", [record("id-0", "a.md")]],
    ]);
    // No view yet: nothing is handed over, and the next map is read as it is.
    const changes: [string, readonly ElementRecord[] | undefined][] = [
      ["id-3", [record("id-3", "b.md")]],
      ["id-4", undefined],
    ];
    const unviewed = PatchedMap.patch(first, changes);
    handOverView(first, unviewed, changes);
    expect(recordsById(unviewed, "id-3")).toBe(unviewed.get("id-3"));
    for (let i = 0; i < 1_024; i++) {
      recordsById(first, "id-0");
    }
    const second = PatchedMap.patch(first, changes);
    handOverView(first, second, changes);
    // The view of `first`, changed in place: `second` reads it without building one.
    expect(recordsById(second, "id-3")).toBe(second.get("id-3"));
    expect(recordsById(second, "id-4")).toBeUndefined();
    expect(recordsById(second, "id-0")).toEqual(first.get("id-0"));
    expect(recordsById(second, "id-0")).not.toBe(first.get("id-0"));
    // `first` keeps its own records: its next hot read builds a new view.
    expect(recordsById(first, "id-3")).toEqual(plain.get("id-3"));
    expect(recordsById(first, "id-4")).toEqual(plain.get("id-4"));
    expect(recordsById(second, "id-4")).toBeUndefined();
  });
});
