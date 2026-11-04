import { describe, expect, it } from "vitest";
import { recordsById } from "./by-id.js";
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
});
