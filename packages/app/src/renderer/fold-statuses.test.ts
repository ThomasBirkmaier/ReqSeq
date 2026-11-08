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
  it("folds the invalid statuses without a choice, the chosen ones with one, nothing for none", () => {
    expect(foldCondition(undefined)).toEqual({ invalid: true });
    expect(foldCondition(["obsolete"])).toEqual({ status: ["obsolete"] });
    expect(foldCondition([])).toBeUndefined();
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
    saveFoldChoice(() => storage, ["obsolete"]);
    expect(loadFoldChoice(() => storage)).toEqual(["obsolete"]);
    saveFoldChoice(() => storage, undefined);
    expect(storage.getItem(FOLD_KEY)).toBeNull();
    storage.setItem(FOLD_KEY, "{");
    expect(loadFoldChoice(() => storage)).toBeUndefined();
    storage.setItem(FOLD_KEY, "[1]");
    expect(loadFoldChoice(() => storage)).toBeUndefined();
    expect(loadFoldChoice(broken)).toBeUndefined();
    expect(() => {
      saveFoldChoice(broken, []);
    }).not.toThrow();
  });

  it("chooses and chooses away from what folds now, in metamodel order", () => {
    expect(foldedKeys(undefined, STATUSES)).toEqual(["obsolete"]);
    expect(toggledChoice(undefined, STATUSES, "draft")).toEqual(["draft", "obsolete"]);
    expect(toggledChoice(["draft", "obsolete"], STATUSES, "obsolete")).toEqual(["draft"]);
    expect(toggledChoice(["gone"], STATUSES, "approved")).toEqual(["approved", "gone"]);
  });
});
