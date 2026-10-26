import { describe, expect, it, vi } from "vitest";
import type { RecentStorage } from "./recent.js";
import { RECENT_KEEP, loadRecent, recentKey, remember, saveRecent } from "./recent.js";

const memory = (
  content: Record<string, string> = {},
): RecentStorage & { content: Record<string, string> } => ({
  content,
  getItem: (key) => content[key] ?? null,
  setItem: (key, value) => {
    content[key] = value;
  },
});

const entry = (n: number) => ({ id: `uuid-${String(n)}`, repository: "spec" });

describe("recent elements", () => {
  it("remembers an element first, once, and keeps at most ten", () => {
    expect(remember([entry(1), entry(2)], entry(3))).toEqual([entry(3), entry(1), entry(2)]);
    expect(remember([entry(1), entry(2), entry(3)], entry(2))).toEqual([entry(2), entry(1), entry(3)]);
    // The same UUID in another repository is another element.
    const other = { id: "uuid-1", repository: "other" };
    expect(remember([entry(1)], other)).toEqual([other, entry(1)]);
    const many = Array.from({ length: RECENT_KEEP }, (_, n) => entry(n));
    expect(remember(many, entry(99))).toHaveLength(RECENT_KEEP);
    expect(remember(many, entry(99))[0]).toEqual(entry(99));
    expect(remember(many, entry(99)).at(-1)).toEqual(entry(RECENT_KEEP - 2));
    expect(remember(many, entry(99), 2)).toEqual([entry(99), entry(0)]);
  });

  it("keys the list by the workspace: its name and its repositories", () => {
    const status = (name: string, repositories?: object[]) => ({
      ok: true as const,
      output: { name, readOnly: false, ...(repositories === undefined ? {} : { repositories }) },
    });
    const one = recentKey(status("Weather", [{ name: "spec", available: true, path: "." }]));
    expect(one).toContain("Weather");
    expect(one).toContain("spec=.");
    expect(recentKey(status("Weather", [{ name: "spec", available: true, path: "elsewhere" }]))).not.toBe(
      one,
    );
    expect(recentKey(status("Other", [{ name: "spec", available: true, path: "." }]))).not.toBe(one);
    expect(recentKey(status("Weather", [{ name: "spec", available: false }]))).toContain("spec=");
    expect(recentKey(status("Weather"))).toContain("Weather");
    expect(
      recentKey({ ok: false, error: { code: "workspace.not-found", message: "x" } as never }),
    ).toBeUndefined();
  });

  it("loads what was saved, and nothing from another key", () => {
    const storage = memory();
    saveRecent(() => storage, "k1", [entry(1), entry(2)]);
    expect(loadRecent(() => storage, "k1")).toEqual([entry(1), entry(2)]);
    expect(loadRecent(() => storage, "k2")).toEqual([]);
    // Only the UUID and the repository are stored, nothing of the element.
    expect(storage.content["k1"]).toBe(JSON.stringify([entry(1), entry(2)]));
  });

  it("ignores broken or foreign storage content, and drops entries of the wrong form", () => {
    const load = (stored: string) => loadRecent(() => memory({ k: stored }), "k");
    expect(load("not json")).toEqual([]);
    expect(load('{"id":"a","repository":"b"}')).toEqual([]);
    expect(load("null")).toEqual([]);
    expect(
      load('[1,"x",null,{"id":"a"},{"id":1,"repository":"r"},{"id":"a","repository":"r","title":"T"}]'),
    ).toEqual([{ id: "a", repository: "r" }]);
    const long = JSON.stringify(Array.from({ length: 30 }, (_, n) => entry(n)));
    expect(load(long)).toHaveLength(RECENT_KEEP);
  });

  it("ignores a storage that throws, when reading and when writing", () => {
    const broken = (): RecentStorage => {
      throw new Error("denied");
    };
    expect(loadRecent(broken, "k")).toEqual([]);
    expect(() => {
      saveRecent(broken, "k", [entry(1)]);
    }).not.toThrow();
    const full: RecentStorage = {
      getItem: () => null,
      setItem: vi.fn(() => {
        throw new Error("quota");
      }),
    };
    expect(() => {
      saveRecent(() => full, "k", [entry(1)]);
    }).not.toThrow();
  });
});
