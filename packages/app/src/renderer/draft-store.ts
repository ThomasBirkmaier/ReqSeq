// The drafts of the window (`drafts.ts`) also kept outside the page, so that a page loaded again after
// its renderer crashed gets them back (#270, `main/renderer-gone.ts`). They are in the window's session
// storage, which Chromium holds outside the renderer process: it lasts while the window is open, also
// across a crash and a reload, and goes with the window. So a draft that a close let go (`close.ts`)
// never comes back at the next start. Display state of the app like the open buffers
// (`buffer-session.ts`), never in the files of the workspace and not through a catalog command (SR-080
// AK1, ADR-0002 rule 3).
//
// One entry, written on every change of a draft: the storage key of the workspace the drafts were typed
// in (`sessionKey`), the buffer shown, and every draft with the element it shows. A page that starts
// takes the drafts only for the same workspace; each buffer compares its draft with its file as it is
// now, as a buffer shown again does (SR-106, `restore` in `ElementView.tsx`).
import { useCallback, useEffect, useRef } from "react";
import type { DataExportElement } from "@reqseq/core";
import type { BoxDraft, Draft, Drafts } from "./drafts.js";
import { useDrafts } from "./drafts.js";

/** The part of `Storage` used here. */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The key of the entry (literal, like the other keys of the app). */
export const DRAFTS_KEY = "reqseq.drafts.v1";

/** The drafts of a window as kept. */
export interface KeptDrafts {
  /** The storage key of the workspace (`sessionKey`). */
  readonly workspace: string;
  /** The buffer shown when the drafts were kept. */
  readonly shown?: string;
  readonly drafts: ReadonlyMap<string, Draft>;
}

/** One draft as stored: the boxes as pairs. */
interface StoredDraft {
  readonly text: string;
  readonly base: string;
  readonly boxes?: readonly (readonly [string, BoxDraft])[];
  readonly sha?: string;
  readonly shown?: { readonly element: DataExportElement; readonly sha: string };
}

interface StoredDrafts {
  readonly workspace: string;
  readonly shown?: string;
  readonly drafts: readonly (readonly [string, StoredDraft])[];
}

const stored = (draft: Draft): StoredDraft => ({
  text: draft.text,
  base: draft.base,
  ...(draft.boxes === undefined ? {} : { boxes: [...draft.boxes] }),
  ...(draft.sha === undefined ? {} : { sha: draft.sha }),
  ...(draft.shown === undefined ? {} : { shown: draft.shown }),
});

const isText = (value: unknown): value is string => typeof value === "string";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isBox = (value: unknown): value is readonly [string, BoxDraft] =>
  Array.isArray(value) &&
  value.length === 2 &&
  isText(value[0]) &&
  isRecord(value[1]) &&
  isText(value[1]["doc"]) &&
  isText(value[1]["base"]);

const isShown = (value: unknown): value is StoredDraft["shown"] =>
  isRecord(value) && isRecord(value["element"]) && isText(value["sha"]);

/** Whether `value` is a draft as stored (not an older or a broken entry). */
const isStoredDraft = (value: unknown): value is StoredDraft =>
  isRecord(value) &&
  isText(value["text"]) &&
  isText(value["base"]) &&
  (value["boxes"] === undefined || (Array.isArray(value["boxes"]) && value["boxes"].every(isBox))) &&
  (value["sha"] === undefined || isText(value["sha"])) &&
  (value["shown"] === undefined || isShown(value["shown"]));

/** The draft of a stored one. */
const draftOf = (value: StoredDraft): Draft => ({
  text: value.text,
  base: value.base,
  ...(value.boxes === undefined ? {} : { boxes: new Map(value.boxes) }),
  ...(value.sha === undefined ? {} : { sha: value.sha }),
  ...(value.shown === undefined ? {} : { shown: value.shown }),
});

/** Keeps the drafts of the window; without a draft the entry goes. A storage that refuses keeps nothing. */
export const keepDrafts = (storage: () => DraftStorage, kept: KeptDrafts): void => {
  try {
    if (kept.drafts.size === 0) {
      storage().removeItem(DRAFTS_KEY);
      return;
    }
    const entry: StoredDrafts = {
      workspace: kept.workspace,
      ...(kept.shown === undefined ? {} : { shown: kept.shown }),
      drafts: [...kept.drafts].map(([key, draft]) => [key, stored(draft)]),
    };
    storage().setItem(DRAFTS_KEY, JSON.stringify(entry));
  } catch {
    // Full or not there: the drafts stay in the page, as before #270. An older entry goes, so a page
    // loaded again never takes input back that was saved since.
    dropDrafts(storage);
  }
};

/** Drops the kept drafts: another workspace opens, or none are left. */
export const dropDrafts = (storage: () => DraftStorage): void => {
  try {
    storage().removeItem(DRAFTS_KEY);
  } catch {
    // Not there: nothing is kept.
  }
};

/**
 * The drafts kept for `workspace` (`sessionKey`); none for another workspace, without an entry, or when
 * the entry cannot be read. A draft that cannot be read is left out.
 */
export const takeDrafts = (storage: () => DraftStorage, workspace: string): KeptDrafts | undefined => {
  let parsed: unknown;
  try {
    const text = storage().getItem(DRAFTS_KEY);
    if (text === null) {
      return undefined;
    }
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed["workspace"] !== workspace || !Array.isArray(parsed["drafts"])) {
    return undefined;
  }
  const drafts = new Map<string, Draft>();
  for (const pair of parsed["drafts"] as unknown[]) {
    if (Array.isArray(pair) && pair.length === 2 && isText(pair[0]) && isStoredDraft(pair[1])) {
      drafts.set(pair[0], draftOf(pair[1]));
    }
  }
  if (drafts.size === 0) {
    return undefined;
  }
  const { shown } = parsed;
  return { workspace, ...(isText(shown) ? { shown } : {}), drafts };
};

/** The drafts of the window (`useDrafts`), kept in `storage` too, and the workspace they belong to. */
export interface WindowDrafts extends Drafts {
  /**
   * The storage key of the workspace open in the window (`sessionKey`) is `key` now: the drafts are kept
   * under it from now on, at once when there are any (its name or repositories changed).
   */
  readonly rescope: (key: string | undefined) => void;
}

/**
 * `useDrafts` for the buffer `shownKey`, with every change of the drafts kept in `storage`, with the
 * workspace (`rescope`) and the buffer shown, also when only the buffer shown changes. Before the page
 * knows its workspace nothing is written or dropped: the entry of the page before stays until the page
 * has taken it (`takeDrafts`), also when its first status finds no workspace (core restarting).
 */
export const useWindowDrafts = (shownKey: string | undefined, storage: () => DraftStorage): WindowDrafts => {
  const scope = useRef<string | undefined>(undefined);
  const shown = useRef(shownKey);
  shown.current = shownKey;
  const store = useCallback(
    (all: ReadonlyMap<string, Draft>): void => {
      const workspace = scope.current;
      if (workspace === undefined) {
        return;
      }
      if (all.size === 0) {
        dropDrafts(storage);
        return;
      }
      keepDrafts(storage, {
        workspace,
        ...(shown.current === undefined ? {} : { shown: shown.current }),
        drafts: all,
      });
    },
    [storage],
  );
  const drafts = useDrafts(shownKey, store);
  const all = drafts.drafts;
  useEffect(() => {
    if (all.current.size > 0) {
      store(all.current);
    }
  }, [shownKey, all, store]);
  const rescope = useCallback(
    (key: string | undefined): void => {
      scope.current = key;
      if (all.current.size > 0) {
        store(all.current);
      }
    },
    [all, store],
  );
  return { ...drafts, rescope };
};
