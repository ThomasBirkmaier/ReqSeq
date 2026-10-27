// How the command prompt remembers what was chosen (SR-108 AK3, SR-121 AK2). Like the recent elements
// (SR-118) this is display state of the app: kept in the app's own local storage, never in the files of
// the workspace and not through a catalog command (SR-080 AK1: "außer reiner Darstellung der App"). It is
// not per workspace: the commands are the same in every workspace. Only command IDs, the typed text of the
// command prompt, counts and times are stored; nothing is recorded for "Go to", argument steps or elements.
import { rank } from "./fuzzy.js";
import type { Ranked } from "./fuzzy.js";

/** The storage key; the version lets a later format start empty instead of misreading this one. */
export const USAGE_KEY = "logreq.usage.v1";
/** The most commands and the most typed texts kept; the ones used longest ago go first. */
export const USAGE_KEEP = 500;

const DAY_MS = 86_400_000;

/** The part of `Storage` used here. */
export type UsageStorage = Pick<Storage, "getItem" | "setItem">;

interface Use {
  readonly count: number;
  /** When the command was chosen last, in milliseconds since 1970. */
  readonly last: number;
}

/** What was chosen: uses per command, and the command chosen last for each typed text (newest first). */
export interface Usage {
  readonly commands: ReadonlyMap<string, Use>;
  readonly queries: readonly (readonly [query: string, id: string])[];
}

const EMPTY: Usage = { commands: new Map(), queries: [] };

/** A typed text as it is compared: no case, no space at the ends, one space between words. */
export const queryKey = (query: string): string => query.trim().toLowerCase().split(/\s+/).join(" ");

/** The longest typed text that is remembered for its command (SR-121 AK2). */
export const MAX_QUERY_LENGTH = 200;

/** `usage` after the command `id` was chosen at `now` for the typed text `query`. */
export const recordUse = (usage: Usage, query: string, id: string, now: number): Usage => {
  const known = usage.commands.get(id);
  // The command just used goes first, so a use in the same millisecond as an older one still counts as
  // the newer (the sort is stable).
  const commands: [string, Use][] = [
    [id, { count: (known?.count ?? 0) + 1, last: now }],
    ...[...usage.commands].filter(([other]) => other !== id),
  ];
  const kept = commands.sort(([, a], [, b]) => b.last - a.last).slice(0, USAGE_KEEP);
  const key = queryKey(query);
  return {
    commands: new Map(kept),
    // An empty text counts for the command but is no text to remember, nor is a text too long to be
    // typed again (it would only fill the storage).
    queries:
      key === "" || key.length > MAX_QUERY_LENGTH
        ? usage.queries
        : [[key, id] as const, ...usage.queries.filter(([old]) => old !== key)].slice(0, USAGE_KEEP),
  };
};

/** How much the command is in use: the more often, the higher; a use long ago counts less. */
export const frecency = (usage: Usage, id: string, now: number): number => {
  const use = usage.commands.get(id);
  return use === undefined ? 0 : use.count / (1 + Math.max(0, now - use.last) / DAY_MS);
};

/** The command that was chosen last for exactly this typed text. */
export const rememberedFor = (usage: Usage, query: string): string | undefined => {
  const key = queryKey(query);
  return usage.queries.find(([known]) => known === key)?.[1];
};

const isUse = (value: unknown): value is [string, number, number] =>
  Array.isArray(value) &&
  value.length === 3 &&
  typeof value[0] === "string" &&
  Number.isFinite(value[1]) &&
  Number.isFinite(value[2]);

const isQuery = (value: unknown): value is [string, string] =>
  Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === "string");

/** The usage stored under `USAGE_KEY`; broken content, foreign content or a storage that throws give none. */
export const loadUsage = (storage: () => UsageStorage): Usage => {
  try {
    const parsed = JSON.parse(storage().getItem(USAGE_KEY) ?? "null") as {
      readonly commands?: unknown;
      readonly queries?: unknown;
    } | null;
    const commands: unknown = parsed?.commands;
    const queries: unknown = parsed?.queries;
    return {
      commands: new Map(
        (Array.isArray(commands) ? commands.filter(isUse) : [])
          .slice(0, USAGE_KEEP)
          .map(([id, count, last]) => [id, { count, last }]),
      ),
      queries: (Array.isArray(queries) ? queries.filter(isQuery) : []).slice(0, USAGE_KEEP),
    };
  } catch {
    return EMPTY;
  }
};

/** Stores the usage. Remembering is a convenience: a storage that fails is ignored. */
export const saveUsage = (storage: () => UsageStorage, usage: Usage): void => {
  try {
    storage().setItem(
      USAGE_KEY,
      JSON.stringify({
        commands: [...usage.commands].map(([id, { count, last }]) => [id, count, last]),
        queries: usage.queries,
      }),
    );
  } catch {
    // Not remembered; the prompt just orders by match next time.
  }
};

/** What a prompt knows about use: how much a command is in use, the one chosen for a text, and a choice to record. */
export interface PromptUse {
  readonly score: (id: string) => number;
  readonly remembered: (query: string) => string | undefined;
  readonly record: (query: string, id: string) => void;
}

/**
 * The use for one prompt: read once when it opens, so that typing does not read the storage again;
 * a choice is added to what the storage holds then.
 */
export const promptUse = (storage: () => UsageStorage, now: () => number = Date.now): PromptUse => {
  const usage = loadUsage(storage);
  const opened = now();
  return {
    score: (id) => frecency(usage, id, opened),
    remembered: (query) => rememberedFor(usage, query),
    record: (query, id) => {
      saveUsage(storage, recordUse(loadUsage(storage), query, id, now()));
    },
  };
};

/**
 * The items that match `query`, the best match first (`rank`). Two equally good matches, and the items
 * when nothing is typed, go first by fit: the ones that fit the shown view first (SR-133); then by use:
 * the one in use more and more recently first (SR-108 AK3); a better match is never overtaken. The item
 * chosen the last time for exactly this text comes first when it matches now (SR-121 AK2).
 */
export const rankByUse = <T extends { readonly id: string; readonly fits?: boolean }>(
  items: readonly T[],
  name: (item: T) => string,
  query: string,
  use: PromptUse | undefined,
): Ranked<T>[] => {
  // `rank` keeps the order it is given among equal matches, so this order is the tie-breaker.
  const ordered = items
    .map((item) => ({ item, fits: item.fits === true ? 1 : 0, score: use?.score(item.id) ?? 0 }))
    .sort((a, b) => b.fits - a.fits || b.score - a.score)
    .map(({ item }) => item);
  const ranked = rank(ordered, name, query);
  const remembered = use?.remembered(query);
  const first = ranked.findIndex(({ item }) => item.id === remembered);
  return first <= 0
    ? ranked
    : [...ranked.slice(first, first + 1), ...ranked.slice(0, first), ...ranked.slice(first + 1)];
};
