// What an element buffer knows of its file besides the input (SR-106), as pure functions: the bytes the
// input was typed on, a conflict with a change on disk, a file that is gone, and the first read that found
// it gone while the buffer asks again. `ElementView` keeps one `DiskState` in a ref, passes it in with the
// values of the moment (the time of a read, the read-only flag, the name) and applies what comes back in
// the order it always did; the timers, the echoes and the editors stay there (ADR-0016: the rules are
// covered here, the component only calls them).
// - A change on disk under the input stops saving until the user chooses (AK2, `outside-change.ts`).
// - A read that finds the file gone asks again after `GONE_CONFIRM_MS`, and only a file still gone then is
//   deleted: its content stays, read-only (AK3).
import type { ShownFile } from "./drafts.js";
import type { ConflictField, OutsideChange } from "./outside-change.js";
import { RESOLVE_FIRST, deletedOnDisk, goneWait, isGone, unreadable } from "./outside-change.js";

/** What the buffer knows of its file besides the input (SR-106). */
export interface DiskState {
  /** The bytes of the file the input was typed on: the file's bytes while there is no conflict. */
  readonly basis: string | undefined;
  /** The fields with input the file no longer agrees with (AK2): nothing is saved meanwhile. */
  readonly conflict: readonly ConflictField[] | undefined;
  /** The file is gone (AK3): the content stays, read-only. */
  readonly deleted: boolean;
  /** The first read that found the file gone, while the buffer asks again (`goneWait`). */
  readonly goneSince: number | undefined;
}

/** Before the first read. */
export const DISK_START: DiskState = {
  basis: undefined,
  conflict: undefined,
  deleted: false,
  goneSince: undefined,
};

/** The input is on the file with the bytes `sha`: nothing to resolve. `conflict` stays undefined when there was none. */
export const conflictEnded = (disk: DiskState, sha: string | undefined): DiskState => ({
  ...disk,
  basis: sha,
  conflict: undefined,
});

/**
 * What an outside change means for the buffer now: a conflict takes the change's fields (the same array)
 * and `begins` when there was none, so it is said once; without one, the input is on the file with the
 * bytes `heldSha`.
 */
export const decided = (
  disk: DiskState,
  change: OutsideChange,
  heldSha: string | undefined,
): { readonly disk: DiskState; readonly begins: boolean } =>
  change.kind === "conflict"
    ? { disk: { ...disk, conflict: change.fields }, begins: disk.conflict === undefined }
    : { disk: conflictEnded(disk, heldSha), begins: false };

/**
 * The file was read: it is there (again), so the buffer is editable as before. `back` when a read had
 * found it gone or it was deleted: input typed meanwhile is saved. `conflict` keeps its identity.
 */
export const fileRead = (disk: DiskState): { readonly disk: DiskState; readonly back: boolean } => ({
  disk: { ...disk, goneSince: undefined, deleted: false },
  back: disk.goneSince !== undefined || disk.deleted,
});

/** A read failed with `code`: only reads that keep finding the file gone count towards its deletion. */
export const readFailed = (disk: DiskState, code: string): DiskState =>
  isGone(code) ? disk : { ...disk, goneSince: undefined };

/**
 * Whether a failed first read shows the element the kept draft was typed on: a buffer shown again with a
 * draft after its file was deleted shows its input, as the shown buffer does. When true, `kept` is set.
 */
export const showsKept = (
  loadedOnce: boolean,
  code: string,
  kept: ShownFile | undefined,
): kept is ShownFile => !loadedOnce && isGone(code) && kept !== undefined;

/**
 * What a failed read does, with `loadedOnce` and `deleted` read after the kept element was shown: before
 * anything was shown the buffer says why (`error`); after, another failure is only echoed, and a file that
 * is gone follows the gone rule unless it is deleted already.
 */
export const failure = (
  loadedOnce: boolean,
  code: string,
  deleted: boolean,
): "error" | "echo" | "gone" | "none" => {
  if (!loadedOnce) {
    return "error";
  }
  if (!isGone(code)) {
    return "echo";
  }
  return deleted ? "none" : "gone";
};

/**
 * A read at `at` found the file gone: the first such read waits a batch of the watcher and asks again
 * (`wait` ms), and only a file still gone then is deleted (said once, by the caller).
 */
export const goneRead = (
  disk: DiskState,
  at: number,
):
  | { readonly kind: "wait"; readonly disk: DiskState; readonly wait: number }
  | { readonly kind: "deleted"; readonly disk: DiskState } => {
  const wait = goneWait(disk.goneSince, at);
  const next = { ...disk, goneSince: disk.goneSince ?? at };
  return wait > 0
    ? { kind: "wait", disk: next, wait }
    : { kind: "deleted", disk: { ...next, deleted: true } };
};

/**
 * Why the element cannot be changed now: it is read-only, or its file is gone, or a read found it gone and
 * the buffer asks again before it says so (nothing is written meanwhile).
 */
export const lockedNote = (disk: DiskState, readOnly: boolean, name: string): string | undefined => {
  if (readOnly) {
    return `${name} is read-only`;
  }
  if (disk.deleted) {
    return deletedOnDisk(name);
  }
  return disk.goneSince === undefined ? undefined : unreadable(name);
};

/** Why the input cannot be saved now: `lockedNote`, or a conflict (nothing is saved until the user chose). */
export const saveNote = (disk: DiskState, readOnly: boolean, name: string): string | undefined =>
  lockedNote(disk, readOnly, name) ?? (disk.conflict === undefined ? undefined : RESOLVE_FIRST);

/** Leaving the buffer saves its input (SR-105 AK1), unless the file changed under it, is gone, or cannot be read now. */
export const leaveSaves = (disk: DiskState): boolean =>
  disk.conflict === undefined && !disk.deleted && disk.goneSince === undefined;

/**
 * "Take the file": for each field in conflict, in conflict order, the file's value, put into its editor
 * or, for a choice or relation box (no editor holds it), set as its value.
 */
export const takeFileEdits = (
  conflict: readonly ConflictField[] | undefined,
  hasEditor: (label: string) => boolean,
): readonly { readonly label: string; readonly doc: string; readonly via: "editor" | "value" }[] =>
  (conflict ?? []).map((field) => ({
    label: field.label,
    doc: field.disk,
    via: hasEditor(field.label) ? "editor" : "value",
  }));
