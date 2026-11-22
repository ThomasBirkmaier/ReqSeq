import { describe, expect, it } from "vitest";
import { allPages } from "./pages.js";

/** A list of `total` numbers, read `size` at a time. */
const list = (total: number, size: number) => {
  const offsets: number[] = [];
  const read = (offset: number): Promise<{ total: number; items: number[] }> => {
    offsets.push(offset);
    const items = Array.from({ length: Math.max(0, Math.min(size, total - offset)) }, (_, i) => offset + i);
    return Promise.resolve({ total, items });
  };
  return { read, offsets };
};

describe("allPages", () => {
  it("reads every page until the total", async () => {
    const { read, offsets } = list(12_001, 5000);
    const pages = await allPages(read, (p) => p.items.length);
    expect(offsets).toEqual([0, 5000, 10_000]);
    expect(pages.flatMap((p) => p.items)).toHaveLength(12_001);
  });

  it("reads one page when it holds all, or nothing", async () => {
    expect(await allPages(list(3, 5000).read, (p) => p.items.length)).toHaveLength(1);
    expect(await allPages(list(0, 5000).read, (p) => p.items.length)).toHaveLength(1);
  });
});
