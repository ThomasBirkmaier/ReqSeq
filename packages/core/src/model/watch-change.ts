// What a watcher batch changed, for the listeners of `WorkspaceWatcher.onChange` (#331, SR-007): the
// app's core process tells its windows, which refresh what they show and can mark the elements that
// changed outside the tool. Plain frozen data, so it can be posted over a `MessagePort` as it is.
import type { ElementStore } from "./store.js";
import { byPath, storeUpdate } from "./store.js";

/** The elements of a change by UUID, each list sorted (code units). */
export interface ChangedElements {
  /** UUIDs no record had before and one has now (a new file, a faulty file fixed, a new UUID). */
  readonly added: readonly string[];
  /** UUIDs that had and still have a record, now another one (content, a move, a copy of the file). */
  readonly changed: readonly string[];
  /** UUIDs no record has any more (a deleted file, a file no longer an element, a changed UUID). */
  readonly removed: readonly string[];
}

/**
 * What one watcher batch changed in the model of the workspace, once the change is in place.
 * - `elements`: the element store was updated; `elements` names every element that came, changed
 *   or went. The lists may all be empty when only a file that is no element changed (a faulty
 *   file: the findings may differ).
 * - `metamodel`: the metamodel is read again on its next use (types, statuses and properties may
 *   differ for every element); `elements` names the elements the same batch changed.
 * - `workspace`: the layout is read again (the workspace or local file changed, a repository
 *   folder is gone, a watch broke), the store was read in full, or it was reset after an update
 *   failed. Nothing names what changed: the lists are empty and everything is read again on its
 *   next use.
 *
 * A file read while it is being written (a pull still running when a batch is due) can count as no
 * element in one batch, its UUID `removed`, and be `added` again in a later one. A consumer must
 * therefore not drop or close an element for a single `removed`: what counts is the last list a UUID
 * appears in, or what the workspace holds when it is read.
 */
export interface WorkspaceChange {
  readonly scope: "elements" | "metamodel" | "workspace";
  readonly elements: ChangedElements;
}

/**
 * Called once per watcher batch that changed the model (`WorkspaceWatcher.onChange`). It may be
 * asynchronous; the watcher does not wait for it, and a rejection is dropped.
 */
export type WorkspaceChangeListener = (change: WorkspaceChange) => void | Promise<void>;

export const NO_ELEMENTS: ChangedElements = Object.freeze({
  added: Object.freeze([]),
  changed: Object.freeze([]),
  removed: Object.freeze([]),
});

/**
 * The elements whose records differ between two stores: the UUIDs of the records that are other
 * objects (`storeUpdate`, #184), each looked up before and after: one pass over the files of each
 * changed repository, as for the carry of the states built on the store, and one lookup per UUID.
 * Undefined when nothing tells which records are the same (a store without `repositories`, other
 * repositories): then every element may have changed.
 */
export const changedElements = (from: ElementStore, to: ElementStore): ChangedElements | undefined => {
  const ids = storeUpdate(from, to)?.ids;
  if (ids === undefined) {
    return undefined;
  }
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const id of ids) {
    const before = from.byId.get(id);
    const after = to.byId.get(id);
    if (before === undefined) {
      added.push(id);
    } else if (after === undefined) {
      removed.push(id);
    } else {
      // A record of a changed file is in one store only: the UUID has another list of records.
      changed.push(id);
    }
  }
  return Object.freeze({
    added: Object.freeze(added.sort(byPath)),
    changed: Object.freeze(changed.sort(byPath)),
    removed: Object.freeze(removed.sort(byPath)),
  });
};
