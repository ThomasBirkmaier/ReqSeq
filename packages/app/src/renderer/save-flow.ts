// The decisions around a save of an element buffer (SR-105, SR-106), as pure functions: whether a save
// writes, what it says afterwards, what a refused write does next, which answer of a read is stale, and the
// draft that a save leaves when it answered after the buffer was left. `ElementView` keeps the writes, the
// awaits, the editors and what was said last in a ref, passes in what it read at the moment and applies what
// comes back where it always did (ADR-0016: the rules are covered here, the component only calls them).
// - A save writes only input, never over a change on disk, a deleted file or a read-only element (SR-106).
// - "Save element" says what happened; autosave and the other saves say only what went wrong, and an error
//   or a hint of core once while it stays the same (D-062).
import type { DataExportElement } from "@reqseq/core";
import type { Draft } from "./drafts.js";
import { rebased } from "./drafts.js";
import type { PropertyModel } from "./element-view.js";
import { isGone } from "./outside-change.js";
import type { BoxEdit } from "./property-edit.js";
import { fieldBoxes, storedDocs } from "./property-edit.js";

/** How a save speaks: "Save element" says what happened; autosave and the other saves only what went wrong. */
export type SaveMode = "asked" | "quiet";

/** What one write sent: the text, the boxes (the title among them), and the boxes that were added before it went. */
export interface SentWrite {
  readonly doc: string;
  readonly edits: readonly BoxEdit[];
  readonly added: readonly string[];
}

/** What a save does before it writes: nothing more (with its result and what to say), or the write. */
export type SaveDecision<E> =
  | { readonly kind: "done"; readonly result: boolean; readonly echo?: string }
  | { readonly kind: "write"; readonly editor: E };

/**
 * Whether a save writes (`saveInput`): not without a text editor (nothing is shown yet), not while a note
 * stops it (the result is then whether no input is lost: true without input), not without input. `editor`,
 * `input` and `note` are read when the save is asked.
 */
export const saveStep = <E>(o: {
  readonly editor: E | undefined;
  readonly input: boolean;
  readonly note: string | undefined;
  readonly mode: SaveMode;
}): SaveDecision<E> => {
  if (o.editor === undefined) {
    return { kind: "done", result: true };
  }
  const asked = o.mode === "asked";
  if (o.note !== undefined) {
    return { kind: "done", result: !o.input, ...(asked ? { echo: o.note } : {}) };
  }
  if (!o.input) {
    return { kind: "done", result: true, ...(asked ? { echo: "No changes to save" } : {}) };
  }
  return { kind: "write", editor: o.editor };
};

/** What was said last about saves: an error or a hint is said once while it stays the same (D-062). */
export interface Said {
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
}

/** What to echo, if anything, and what is said now. */
export interface Speech {
  readonly echo?: string;
  readonly said: Said;
}

/**
 * After a save that wrote: `Saved <name>` (with the hint of core) when asked; when quiet only a hint that
 * was not said last time. The error is said no more; the hint is what was said now.
 */
export const savedSpeech = (said: Said, mode: SaveMode, name: string, hint: string | undefined): Speech => {
  const now: Said = { ...said, error: undefined, hint };
  if (mode === "asked") {
    return { echo: hint === undefined ? `Saved ${name}` : `Saved ${name}. ${hint}`, said: now };
  }
  // Autosave is silent (D-062); a hint of core is said once, not after every pause.
  return hint !== undefined && hint !== said.hint
    ? { echo: `Saved ${name}. ${hint}`, said: now }
    : { said: now };
};

/** A save that went wrong (`notWritten`): its message when asked, or when it is not the error said last. */
export const failedSpeech = (said: Said, mode: SaveMode, message: string): Speech => {
  const now: Said = { ...said, error: message };
  return mode === "asked" || said.error !== message ? { echo: message, said: now } : { said: now };
};

/** A write core refused with `code`: a file changed on disk or gone is read once (`check`); anything else is said. */
export const afterRefusal = (code: string): "check" | "fail" =>
  code === "file.changed-on-disk" || isGone(code) ? "check" : "fail";

/**
 * After the read of a refused write: other bytes than the write expected follow the rule for a change from
 * outside (`apply`); the same bytes mean only core's store lagged behind, so the write goes again once
 * (`retry`), and a second refusal (`refused`, the message of the write it refused) is said.
 */
export const checkStep = (
  sha: string,
  expected: string | undefined,
  refused: string | undefined,
):
  | { readonly kind: "apply" }
  | { readonly kind: "retry" }
  | { readonly kind: "refused"; readonly message: string } => {
  if (sha !== expected) {
    return { kind: "apply" };
  }
  return refused === undefined ? { kind: "retry" } : { kind: "refused", message: refused };
};

/**
 * Whether the answer of a read is stale: it was asked when `askedAt` saves of the buffer had answered, and
 * another one answered since (`settled`), so that save's answer is newer.
 */
export const staleRead = (askedAt: number, settled: number): boolean => askedAt !== settled;

/**
 * The draft the app keeps after a save that answered when the buffer was no longer shown (SR-105 AK1):
 * input that is what was sent is in the file now; input typed while the save ran stays, on the bytes the
 * save wrote (`rebased`). `properties` is the model the save read before it wrote.
 */
export const leftDraft = (
  draft: Draft,
  sent: { readonly textDirty: boolean; readonly doc: string; readonly edits: readonly BoxEdit[] },
  saved: { readonly element: DataExportElement; readonly sha: string },
  properties: PropertyModel,
): Draft | undefined =>
  rebased(
    draft,
    {
      ...(sent.textDirty ? { text: sent.doc } : {}),
      boxes: new Map(sent.edits.map((edit) => [edit.key, edit.doc])),
    },
    {
      element: saved.element,
      sha: saved.sha,
      text: saved.element.text ?? "",
      docs: storedDocs(fieldBoxes(saved.element, properties)),
    },
  );
