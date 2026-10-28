// Saving the unsaved input of the window before another workspace opens in it (SR-131 AK3): main asks
// (bridge `onSave`) before every switch, from "Open workspace" and from File > Open Workspace, and opens
// the other workspace only when everything is saved. Each element buffer with a draft is saved with
// `element.update`, as "Save element" saves it (`property-edit.ts`): the text that was typed, and the
// boxes whose document differs from what the file stores. One after the other; the first that cannot be
// saved stops the switch (spec question #523): its draft stays, the minibuffer names the element, and
// the open workspace stays. A draft whose file changed outside since it was typed on is not saved over
// that change: the rule of SR-106 (`outside-change.ts`) finds a conflict, and it stops the switch as well.
// Every write carries the bytes it was made on (`expectedFileSha256`).
import type { BoxEdit } from "./property-edit.js";
import { editableBoxes, storedDocs, updateInput } from "./property-edit.js";
import type { Buffers, ElementBuffer } from "./buffers.js";
import type { Call } from "./call.js";
import type { Draft } from "./drafts.js";
import type { PropertyModel } from "./element-view.js";
import { TEXT_FIELD, draftInput, keptBoxes, outsideChange } from "./outside-change.js";

export interface SaveContext {
  readonly call: Call;
  /** The open buffers, the shown one first. */
  readonly buffers: Buffers;
  /** The unsaved input by buffer key, as it is now. */
  readonly drafts: ReadonlyMap<string, Draft>;
  /** The properties of each type, to know how a box is stored (as the element buffer knows it). */
  readonly properties: PropertyModel;
  /** A draft is saved, or holds nothing that differs from the file: it is dropped. */
  readonly saved: (key: string) => void;
}

/** Everything is saved, or the element that could not be, and why. */
export type SaveResult =
  { readonly ok: true } | { readonly ok: false; readonly name: string; readonly message: string };

/** What the minibuffer says when input could not be saved before a switch. */
export const notSaved = (result: Extract<SaveResult, { readonly ok: false }>): string =>
  `${result.name} could not be saved (${result.message}); the workspace was not changed`;

/** What the minibuffer says when the input of a buffer that was left could not be saved (SR-105). */
export const leftUnsaved = (result: Extract<SaveResult, { readonly ok: false }>): string =>
  `${result.name} could not be saved (${result.message}); its input stays in its buffer`;

/**
 * What the minibuffer says when input could not be saved before the window closes (SR-105 AK1): the
 * window stays open, and closing it again discards the input.
 */
export const closeUnsaved = (result: Extract<SaveResult, { readonly ok: false }>): string =>
  `${result.name} could not be saved (${result.message}): close the window again to discard the unsaved input`;

/** What the minibuffer says when main gave up waiting for the save before the window closes. */
export const CLOSE_NOT_IN_TIME =
  "Saving before the window closes took longer than 2 s; the window stays open, and closing it again within 10 s closes it without waiting";

/** The key of the question "close the window again to discard" in the place of a buffer's key. */
export const CLOSE_WINDOW = "logreq:close-window";

/** Why a draft is not saved over its file. */
export const CHANGED_ON_DISK = "its file changed on disk since it was typed on";

/** Why a switch stops when the input changed while it was saved: the newer input is not in the file. */
export const CHANGED_WHILE_SAVING = "it was changed while it was saved";

/** What the minibuffer says when main gave up waiting for the save (a timeout). */
export const notSavedInTime = (open: string | undefined): string =>
  `The unsaved input was not saved in time; ${open === undefined ? "no workspace is open" : `${open} stays open`}`;

const failed = (buffer: ElementBuffer, message: string): SaveResult => ({
  ok: false,
  name: buffer.name,
  message,
});

/**
 * Saves the draft of one element buffer that is not shown: before a switch, and when the buffer was left
 * (SR-105 AK1).
 */
export const saveOne = async (
  context: SaveContext,
  buffer: ElementBuffer,
  kept: Draft,
): Promise<SaveResult> => {
  const read = await context.call("element.get", { ref: buffer.id, repository: buffer.repository });
  if (!read.ok) {
    return failed(buffer, read.message);
  }
  const { element, fileSha256 } = read.output;
  const boxes = editableBoxes(element, context.properties);
  const docs = storedDocs(boxes);
  const change = outsideChange(draftInput(kept), kept.sha, {
    sha: fileSha256,
    docs: new Map([[TEXT_FIELD, element.text ?? ""], ...docs]),
  });
  if (change.kind === "conflict") {
    return failed(buffer, CHANGED_ON_DISK);
  }
  const type = context.properties.get(element.type);
  const edits: BoxEdit[] = [];
  for (const [key, box] of keptBoxes(kept, change.dropped, docs)) {
    const info = boxes.get(key)?.info ?? type?.get(key);
    if (info === undefined) {
      return failed(buffer, `its type has no property ${key}`);
    }
    edits.push({ key, info, base: box.base, doc: box.doc });
  }
  // The text when it was typed in and the file does not hold it yet.
  const text = kept.text !== kept.base && !change.dropped.includes(TEXT_FIELD) ? kept.text : undefined;
  if (text !== undefined || edits.length > 0) {
    const written = await context.call("element.update", {
      ...updateInput(buffer.id, text, edits),
      expectedFileSha256: fileSha256,
    });
    if (!written.ok) {
      return failed(buffer, written.message);
    }
  }
  // Typed meanwhile: the newer draft is kept, and the switch stops (it would drop it).
  if (context.drafts.get(buffer.key) !== kept) {
    return failed(buffer, CHANGED_WHILE_SAVING);
  }
  context.saved(buffer.key);
  return { ok: true };
};

/**
 * Saves the draft of every element buffer, the shown one last (so a failure before it leaves the shown
 * editor as it is). Stops at the first that cannot be saved; the drafts saved before it are dropped.
 */
export const saveDrafts = async (context: SaveContext): Promise<SaveResult> => {
  const [shown, ...rest] = context.buffers;
  for (const buffer of [...rest, ...(shown === undefined ? [] : [shown])]) {
    const draft = context.drafts.get(buffer.key);
    if (buffer.kind !== "element" || draft === undefined) {
      continue;
    }
    const result = await saveOne(context, buffer, draft);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true };
};
