import { describe, expect, it, vi } from "vitest";
import {
  USAGE_KEEP,
  USAGE_KEY,
  frecency,
  loadUsage,
  promptUse,
  queryKey,
  recordUse,
  rememberedFor,
  saveUsage,
} from "./usage.js";
import type { Usage, UsageStorage } from "./usage.js";
import { rankByUse } from "./usage.js";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 27, 12);

const COMMANDS = [
  { id: "type", name: "Filter list by type" },
  { id: "status", name: "Filter list by status" },
  { id: "property", name: "Filter list by property" },
  { id: "sort", name: "Sort list" },
  { id: "all", name: "List all elements" },
  { id: "close", name: "Close buffer" },
  { id: "close-all", name: "Close all buffers" },
];

/** A storage over a map, that survives "restarts" of the code under test. */
const memory = (
  initial: Record<string, string> = {},
): UsageStorage & { readonly data: Map<string, string> } => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
};

/** The usage of a storage after the choices `[query, id, days ago]`, oldest first. */
const used = (...choices: readonly (readonly [string, string, number])[]): UsageStorage => {
  const storage = memory();
  let usage = loadUsage(() => storage);
  for (const [query, id, ago] of choices) {
    usage = recordUse(usage, query, id, NOW - ago * DAY);
  }
  saveUsage(() => storage, usage);
  return storage;
};

const order = (query: string, storage: UsageStorage | undefined): string[] =>
  rankByUse(
    COMMANDS,
    (command) => command.name,
    query,
    storage === undefined
      ? undefined
      : promptUse(
          () => storage,
          () => NOW,
        ),
  ).map(({ item }) => item.id);

describe("ranking by use", () => {
  it("[SR-108/AK3] puts the command used more often first among equally good matches", () => {
    expect(order("cl", undefined)).toEqual(["close", "close-all"]);
    expect(order("cl", used(["", "close-all", 1], ["", "close-all", 1], ["", "close", 1]))).toEqual([
      "close-all",
      "close",
    ]);
  });

  it("[SR-108/AK3] puts the command used more recently first among equally good matches used equally often", () => {
    expect(order("cl", used(["", "close", 20], ["", "close-all", 2]))).toEqual(["close-all", "close"]);
    expect(order("cl", used(["", "close-all", 20], ["", "close", 2]))).toEqual(["close", "close-all"]);
  });

  it("[SR-108/AK3] weighs often and recently together: one use today is not worth twenty a year ago", () => {
    const storage = used(...Array.from({ length: 20 }, () => ["", "close-all", 365] as const), [
      "",
      "close",
      0,
    ]);
    expect(order("cl", storage)).toEqual(["close", "close-all"]);
  });

  it("[SR-108/AK3] never lets use lift a command above a better match", () => {
    const heavy = used(...Array.from({ length: 50 }, () => ["", "sort", 0] as const));
    // "Sort list" has no word that begins with "all": it is the weaker match for "list" and stays below.
    expect(order("list", undefined).slice(0, 2)).toEqual(["all", "sort"]);
    expect(order("list", heavy).slice(0, 2)).toEqual(["all", "sort"]);
    // Initials are the best match: "fl" finds the three filters first, whatever else is in use.
    expect(order("fl", heavy).slice(0, 3).sort()).toEqual(["property", "status", "type"]);
  });

  it("[SR-108/AK3] shows an empty text in the order of use, the unused in the given order", () => {
    expect(order("", undefined)).toEqual(COMMANDS.map(({ id }) => id));
    expect(order("", used(["", "close", 3], ["", "sort", 3], ["", "sort", 1]))).toEqual([
      "sort",
      "close",
      "type",
      "status",
      "property",
      "all",
      "close-all",
    ]);
  });

  it("[SR-108/AK3] keeps the plain order when the storage is missing, throws or holds something else", () => {
    const plain = order("cl", undefined);
    const throwing: UsageStorage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(order("cl", throwing)).toEqual(plain);
    for (const content of [
      "{",
      "null",
      "[]",
      '{"commands":5,"queries":"x"}',
      '{"commands":[[1,2,3],["a"]],"queries":[[1]]}',
    ]) {
      expect(order("cl", memory({ [USAGE_KEY]: content }))).toEqual(plain);
    }
    expect(() => {
      promptUse(() => throwing).record("cl", "close");
    }).not.toThrow();
  });

  it("[SR-121/AK2] puts the command chosen for a text first when the text is typed again", () => {
    // By match "Filter list by type" is first for "fl".
    expect(order("fl", undefined)[0]).toBe("type");
    const storage = memory();
    promptUse(
      () => storage,
      () => NOW,
    ).record("fl", "status");
    expect(order("fl", storage)[0]).toBe("status");
    expect(order("fl", storage).slice(1).sort()).toEqual(["property", "type"]);
  });

  it("[SR-121/AK2] keeps it after a restart, ignores case and spaces, and changes no other text", () => {
    const storage = memory();
    promptUse(
      () => storage,
      () => NOW,
    ).record("  FL  ", "status");
    // A new prompt reads what the storage holds: the app was started again.
    expect(order("fl", storage)[0]).toBe("status");
    expect(order("Fl ", storage)[0]).toBe("status");
    expect(order("flt", storage)[0]).toBe("type");
    expect(order("fil", storage)[0]).toBe("status");
  });

  it("[SR-121/AK2] remembers the newest choice for a text, and one choice per text", () => {
    const storage = memory();
    const use = promptUse(
      () => storage,
      () => NOW,
    );
    use.record("fl", "status");
    use.record("fl", "property");
    expect(order("fl", storage)[0]).toBe("property");
    expect(loadUsage(() => storage).queries).toEqual([["fl", "property"]]);
  });

  it("[SR-121/AK2] puts the remembered command first only when it is offered and matches now", () => {
    const storage = memory();
    promptUse(
      () => storage,
      () => NOW,
    ).record("fl", "gone");
    expect(order("fl", storage)[0]).toBe("type");
    promptUse(
      () => storage,
      () => NOW,
    ).record("zz", "sort");
    expect(order("zz", storage)).toEqual([]);
  });

  it("does not remember an empty text, but counts the choice", () => {
    const storage = memory();
    promptUse(
      () => storage,
      () => NOW,
    ).record("   ", "close-all");
    const usage = loadUsage(() => storage);
    expect(usage.queries).toEqual([]);
    expect(rememberedFor(usage, "")).toBeUndefined();
    expect(order("", storage)[0]).toBe("close-all");
  });

  it("reads the storage when the prompt opens, and a choice goes into what the storage holds then", () => {
    const storage = memory();
    const use = promptUse(
      () => storage,
      () => NOW,
    );
    use.record("a", "sort");
    // The prompt read the storage when it opened: what it knows is the state then.
    expect(use.score("sort")).toBe(0);
    expect(
      frecency(
        loadUsage(() => storage),
        "sort",
        NOW,
      ),
    ).toBe(1);
  });
});

describe("the usage record", () => {
  it("normalizes a typed text", () => {
    expect(queryKey("  Fl   By  ")).toBe("fl by");
    expect(queryKey("")).toBe("");
  });

  it("scores by count and age, and an unknown command zero", () => {
    let usage: Usage = loadUsage(() => memory());
    usage = recordUse(usage, "", "a", NOW - DAY);
    usage = recordUse(usage, "", "a", NOW - DAY);
    expect(frecency(usage, "a", NOW)).toBe(1);
    expect(frecency(usage, "a", NOW - 2 * DAY)).toBe(2);
    expect(frecency(usage, "b", NOW)).toBe(0);
  });

  it("keeps at most USAGE_KEEP commands and texts, dropping the ones used longest ago", () => {
    let usage = loadUsage(() => memory());
    for (let n = 0; n < USAGE_KEEP + 5; n += 1) {
      usage = recordUse(usage, `q${String(n)}`, `c${String(n)}`, NOW + n);
    }
    expect(usage.commands.size).toBe(USAGE_KEEP);
    expect(usage.queries).toHaveLength(USAGE_KEEP);
    expect(usage.commands.has("c0")).toBe(false);
    expect(usage.commands.has(`c${String(USAGE_KEEP + 4)}`)).toBe(true);
    expect(usage.queries[0]).toEqual([`q${String(USAGE_KEEP + 4)}`, `c${String(USAGE_KEEP + 4)}`]);
    const storage = memory();
    saveUsage(() => storage, usage);
    expect(loadUsage(() => storage).commands.size).toBe(USAGE_KEEP);
    // A file with more is cut on loading.
    storage.data.set(
      USAGE_KEY,
      JSON.stringify({
        commands: Array.from({ length: USAGE_KEEP + 3 }, (_, n) => [`c${String(n)}`, 1, NOW]),
        queries: Array.from({ length: USAGE_KEEP + 3 }, (_, n) => [`q${String(n)}`, "c"]),
      }),
    );
    expect(loadUsage(() => storage).commands.size).toBe(USAGE_KEEP);
    expect(loadUsage(() => storage).queries).toHaveLength(USAGE_KEEP);
  });

  it("stores only command IDs, typed texts, counts and times, under a versioned key", () => {
    const storage = memory();
    promptUse(
      () => storage,
      () => NOW,
    ).record("fl", "status");
    expect([...storage.data.keys()]).toEqual(["logreq.usage.v1"]);
    expect(JSON.parse(storage.data.get(USAGE_KEY) ?? "null")).toEqual({
      commands: [["status", 1, NOW]],
      queries: [["fl", "status"]],
    });
  });

  it("does not throw when saving fails", () => {
    const setItem = vi.fn(() => {
      throw new Error("full");
    });
    expect(() => {
      saveUsage(
        () => ({ getItem: () => null, setItem }),
        loadUsage(() => memory()),
      );
    }).not.toThrow();
    expect(setItem).toHaveBeenCalled();
  });
});
