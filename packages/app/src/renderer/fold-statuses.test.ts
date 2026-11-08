// What folds in lists (SR-201): the conditions, the stored choice and the choice after a status is chosen.
import { describe, expect, it } from "vitest";
import {
  FOLD_KEY,
  foldCondition,
  foldedKeys,
  foldedSelections,
  folds,
  loadFoldChoice,
  saveFoldChoice,
  toggledChoice,
} from "./fold-statuses.js";

const STATUSES = [
  { key: "draft", name: "Draft" },
  { key: "approved", name: "Approved" },
  { key: "obsolete", name: "Obsolete", invalid: true },
];

const memory = () => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
};

const broken = () => {
  throw new Error("no storage");
};

describe("fold-statuses", () => {
  it("folds the invalid statuses without a choice, changed by the choice, nothing when no status folds", () => {
    expect(foldCondition(undefined, STATUSES)).toEqual({ status: ["obsolete"] });
    expect(foldCondition({ fold: ["draft"], unfold: ["obsolete"] }, STATUSES)).toEqual({ status: ["draft"] });
    expect(foldCondition({ fold: [], unfold: ["obsolete"] }, STATUSES)).toBeUndefined();
    expect(foldCondition(undefined, [])).toBeUndefined();
  });

  it("splits a selection into the rows in place and the folded ones, and folds nothing in a tree", () => {
    expect(foldedSelections(undefined, { invalid: true })).toEqual({
      shown: { where: { not: { invalid: true } } },
      folded: { where: { invalid: true } },
    });
    expect(foldedSelections({ filter: "Open", where: { type: ["need"] } }, { invalid: true }).folded).toEqual(
      {
        filter: "Open",
        where: { all: [{ type: ["need"] }, { invalid: true }] },
      },
    );
    expect(folds([{ by: "hierarchy", order: "asc" }])).toBe(false);
    expect(folds(undefined)).toBe(true);
  });

  it("keeps the choice, drops it again, and ignores broken content and a broken storage", () => {
    const storage = memory();
    expect(loadFoldChoice(() => storage)).toBeUndefined();
    saveFoldChoice(() => storage, { fold: ["draft"], unfold: [] });
    expect(loadFoldChoice(() => storage)).toEqual({ fold: ["draft"], unfold: [] });
    saveFoldChoice(() => storage, undefined);
    expect(storage.getItem(FOLD_KEY)).toBeNull();
    storage.setItem(FOLD_KEY, "{");
    expect(loadFoldChoice(() => storage)).toBeUndefined();
    storage.setItem(FOLD_KEY, '{"fold":[1],"unfold":[]}');
    expect(loadFoldChoice(() => storage)).toBeUndefined();
    storage.setItem(FOLD_KEY, "[]");
    expect(loadFoldChoice(() => storage)).toBeUndefined();
    expect(loadFoldChoice(broken)).toBeUndefined();
    expect(() => {
      saveFoldChoice(broken, undefined);
    }).not.toThrow();
  });

  it("chooses and chooses away as a change of the default, and keeps the keys of other workspaces", () => {
    expect(foldedKeys(undefined, STATUSES)).toEqual(["obsolete"]);
    expect(toggledChoice(undefined, STATUSES, "draft")).toEqual({ fold: ["draft"], unfold: [] });
    expect(toggledChoice({ fold: ["draft"], unfold: [] }, STATUSES, "draft")).toBeUndefined();
    expect(toggledChoice(undefined, STATUSES, "obsolete")).toEqual({ fold: [], unfold: ["obsolete"] });
    expect(
      toggledChoice({ fold: ["rejected-elsewhere"], unfold: ["obsolete"] }, STATUSES, "obsolete"),
    ).toEqual({
      fold: ["rejected-elsewhere"],
      unfold: [],
    });
  });
});
