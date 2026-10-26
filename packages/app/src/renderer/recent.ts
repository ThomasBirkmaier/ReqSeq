// The elements opened last, for the overview (SR-118 AK1). They are display state of the app, like the
// open buffers: kept in the app's own local storage (Chromium's, in the user data folder of the OS), never
// in the files of the workspace (AK5) and not through a catalog command (SR-080 AK1: "außer reiner
// Darstellung der App"). Only the UUID and the repository are stored, never a title or a text.
import type { InvokeResult } from "../shared/protocol.js";

/** An element by what identifies it: a UUID may exist in several repositories. */
export interface RecentEntry {
  readonly id: string;
  readonly repository: string;
}

/** The part of `Storage` used here. */
export type RecentStorage = Pick<Storage, "getItem" | "setItem">;

/** The most elements the overview shows. */
export const RECENT_SHOWN = 5;
/** The most entries kept, so that five remain when some of them are gone (an element or a repository missing). */
export const RECENT_KEEP = 10;

/**
 * The storage key of a workspace: its name and its repositories (name and path as `workspace.status` gives
 * them). Two workspaces that look the same share a list. That is harmless: every entry is read with
 * `element.get` when the overview is shown, and one that fails is left out.
 */
export const recentKey = (status: InvokeResult): string | undefined => {
  if (!status.ok) {
    return undefined;
  }
  const { name, repositories } = status.output as {
    readonly name: string;
    readonly repositories?: readonly { readonly name: string; readonly path?: string }[];
  };
  const parts = (repositories ?? []).map((repository) => `${repository.name}=${repository.path ?? ""}`);
  return ["logreq.recent.v1", name, ...parts].join("\n");
};

/** `entry` first, once, and at most `max` entries. */
export const remember = (
  list: readonly RecentEntry[],
  entry: RecentEntry,
  max: number = RECENT_KEEP,
): readonly RecentEntry[] =>
  [entry, ...list.filter((known) => known.id !== entry.id || known.repository !== entry.repository)].slice(
    0,
    max,
  );

const isEntry = (value: unknown): value is RecentEntry =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>)["id"] === "string" &&
  typeof (value as Record<string, unknown>)["repository"] === "string";

/** The list stored under `key`; broken content, foreign content or a storage that throws give an empty list. */
export const loadRecent = (storage: () => RecentStorage, key: string): readonly RecentEntry[] => {
  try {
    const parsed: unknown = JSON.parse(storage().getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .filter(isEntry)
          .map(({ id, repository }) => ({ id, repository }))
          .slice(0, RECENT_KEEP)
      : [];
  } catch {
    return [];
  }
};

/** Stores the list. Remembering is a convenience: a storage that fails is ignored. */
export const saveRecent = (storage: () => RecentStorage, key: string, list: readonly RecentEntry[]): void => {
  try {
    storage().setItem(key, JSON.stringify(list));
  } catch {
    // Not remembered; the overview just shows fewer recent elements next time.
  }
};
