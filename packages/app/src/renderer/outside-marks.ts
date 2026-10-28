// Changes from outside the app (SR-116, SR-106): the CLI, the API, MCP, another editor or Git changed
// files of the workspace, and core's watcher reports the elements it reached (`workspace-changed` with the
// reason `external`, ADR-0010). The views read again, and an element that changed outside is highlighted
// briefly and quietly where it is shown: a grey tint that fades, no colour, no text, no control (D-062).
// What changed is compared from the outputs of the commands (ADR-0002): this module decides only what
// to tint and for how long.
import type { DataExportElement } from "@logreq/core";
import type { ChangedElements } from "../shared/protocol.js";
import { heading } from "./copy.js";
import { propertyBoxes, relationGroups } from "./element-view.js";

/** An element shown within this time after its change from outside is highlighted (SR-116 AK1: 2 s). */
export const FRESH_MS = 2000;

/** SR-116 AK2: „wenn 3 Sekunden vergangen sind, dann bleibt keine Markierung stehen.“ */
export const MARK_BOUND_MS = 3000;

/**
 * A highlight is removed this long after it was set: when its fade ends (styles.css, 2.5 s). One timer
 * removes it, and a timer can fire late on a busy machine; the half second to `MARK_BOUND_MS` is that
 * margin, so the product holds AK2 and not only its timer.
 */
export const MARK_MS = 2500;

/** The changes from outside, as the views get them. */
export interface OutsideChanges {
  /** Counts the changes from outside that named elements (scope `elements`): each makes the views read again. */
  readonly seq: number;
  /**
   * For each UUID, the `seq` of the last of them that added or changed it: an element buffer reads again
   * when its own was named after the change it saw last. A count is kept, not only the last batch: two
   * batches can arrive before the views render, and the buffer must not miss the first. Not the removed
   * ones: a file read while it is written counts as removed in one batch and added in the next (core's
   * `WorkspaceChange`), so the buffer keeps what it shows until its element is there again.
   */
  readonly named: ReadonlyMap<string, number>;
  /**
   * For each UUID, the `seq` of the last of them that removed it. An element buffer does not act on it
   * alone (the file may be written just then); it asks for its element once, and only `ref.unknown` says
   * the file is gone (SR-106 AK3).
   */
  readonly removed: ReadonlyMap<string, number>;
  /** Whether the element `id` was changed or added outside within `FRESH_MS`: a view that shows it now highlights it. */
  readonly fresh: (id: string) => boolean;
}

/** Before any change from outside. */
export const NO_CHANGES: OutsideChanges = {
  seq: 0,
  named: new Map(),
  removed: new Map(),
  fresh: () => false,
};

/** When each element changed outside last, kept for `FRESH_MS` only: what is not shown now is not shown later. */
export interface Arrivals {
  /** Notes the elements that were changed or added; removed ones are not highlighted. */
  readonly record: (elements: ChangedElements) => void;
  readonly fresh: (id: string) => boolean;
}

export const arrivals = (clock: () => number = () => Date.now()): Arrivals => {
  const at = new Map<string, number>();
  return {
    record: (elements) => {
      const now = clock();
      for (const [id, time] of at) {
        if (now - time > FRESH_MS) {
          at.delete(id);
        }
      }
      for (const id of [...elements.changed, ...elements.added]) {
        at.set(id, now);
      }
    },
    fresh: (id) => {
      const time = at.get(id);
      return time !== undefined && clock() - time <= FRESH_MS;
    },
  };
};

/** The next changes from outside after `before`, for a change that named `elements`; the views read again on each. */
export const nextChanges = (
  before: OutsideChanges,
  elements: ChangedElements,
  fresh: (id: string) => boolean,
): OutsideChanges => {
  const seq = before.seq + 1;
  const named = new Map(before.named);
  for (const id of [...elements.added, ...elements.changed]) {
    named.set(id, seq);
  }
  const removed = new Map(before.removed);
  for (const id of elements.removed) {
    removed.set(id, seq);
  }
  return { seq, named, removed, fresh };
};

/** Whether a change from outside after the change `seen` added or changed the element `id`. */
export const namedSince = (changes: OutsideChanges, id: string, seen: number): boolean =>
  (changes.named.get(id) ?? 0) > seen;

/** Whether a change from outside after the change `seen` removed the element `id`. */
export const removedSince = (changes: OutsideChanges, id: string, seen: number): boolean =>
  (changes.removed.get(id) ?? 0) > seen;

/**
 * Whether an element buffer that saw the change `seen` asks for its element `id` again: a later change
 * named or removed it. A removal asks too, and only the answer says whether the file is gone (SR-106 AK3).
 */
export const touchedSince = (changes: OutsideChanges, id: string, seen: number): boolean =>
  namedSince(changes, id, seen) || removedSince(changes, id, seen);

/**
 * What each field of the element buffer shows, by its label (`FieldBox`): the title, the text, each
 * property box and each relation group. Two answers differ in a field when its entry differs.
 */
export const fieldTexts = (element: DataExportElement): ReadonlyMap<string, string> =>
  new Map<string, string>([
    ["Title", heading(element)],
    ["Text", element.text ?? ""],
    ...propertyBoxes(element).map((box): [string, string] => [
      box.key,
      JSON.stringify([box.lines, box.relations ?? []]),
    ]),
    ...relationGroups(element.relations).map((group): [string, string] => [
      group.heading,
      JSON.stringify(group.relations),
    ]),
  ]);

/**
 * The fields to highlight in an element buffer after a change from outside: those that differ between
 * the answer shown before and the new one, except those with input (the input stays; the conflict rule
 * of SR-106 AK2 speaks there). The title when nothing that is still shown differs, or when nothing was
 * shown before (the buffer opened just after the change, as the follow mode of SR-117 opens it).
 */
export const changedFields = (
  before: ReadonlyMap<string, string> | undefined,
  after: ReadonlyMap<string, string>,
  input: ReadonlySet<string>,
): readonly string[] => {
  if (before === undefined) {
    return ["Title"];
  }
  const labels = new Set([...before.keys(), ...after.keys()]);
  const changed = [...labels].filter((label) => before.get(label) !== after.get(label));
  const shown = changed.filter((label) => after.has(label) && !input.has(label));
  // A field that is gone (an emptied box) has nothing left to tint: the title stands for it.
  return shown.length > 0 || changed.some((label) => input.has(label)) ? shown : ["Title"];
};

/**
 * The fields an element buffer highlights after a read of its element (SR-116 AK1): none unless the read
 * was asked within `FRESH_MS` of a change from outside (`fresh`) and the file has other bytes than the
 * answer shown before (`held`; the app's own save holds them already); then `changedFields`, without the
 * fields with input. `inputKeys` is asked only then.
 */
export const marksOnRead = (
  fresh: boolean,
  held: { readonly sha: string; readonly fields: ReadonlyMap<string, string> } | undefined,
  sha: string,
  fields: ReadonlyMap<string, string>,
  inputKeys: () => Iterable<string>,
): readonly string[] =>
  fresh && held?.sha !== sha ? changedFields(held?.fields, fields, new Set(inputKeys())) : [];
