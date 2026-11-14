// The decisions around a save of an element buffer (SR-105, SR-106), as pure functions: whether a save
// writes, what it says afterwards, what a refused write does next, which answer of a read is stale, and the
// draft that a save leaves when it answered after the buffer was left. `ElementView` keeps the writes, the
// awaits, the editors and what was said last in a ref, passes in what it read at the moment and applies what
// comes back where it always did (ADR-0016: the rules are covered here, the component only calls them).
// - A save writes only input, never over a change on disk, a deleted file or a read-only element (SR-106).
// - "Save element" says what happened; autosave and the other saves say only what went wrong, and an error,
//   a hint of core or the number of directly affected elements once while it stays the same (D-062, SR-024 AK2).
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
  /**
   * "Save element" was asked while a save ran (#563): when that save left no input, the input is saved, so
   * it says `Saved <name>` with core's hint, as a save it wrote says it (`savedSpeech`), not that there was
   * nothing to save.
   */
  readonly afterWrite?:
    | { readonly name: string; readonly hint: string | undefined; readonly affected?: number | undefined }
    | undefined;
}): SaveDecision<E> => {
  if (o.editor === undefined) {
    return { kind: "done", result: true };
  }
  const asked = o.mode === "asked";
  if (o.note !== undefined) {
    return { kind: "done", result: !o.input, ...(asked ? { echo: o.note } : {}) };
  }
  if (!o.input) {
    const after = o.afterWrite;
    const echo =
      after === undefined ? "No changes to save" : savedLine(after.name, after.hint, after.affected);
    return { kind: "done", result: true, ...(asked ? { echo } : {}) };
  }
  return { kind: "write", editor: o.editor };
};

/**
 * What was said last about saves: an error, a hint or the number of directly affected elements (SR-024 AK2)
 * is said once while it stays the same (D-062).
 */
export interface Said {
  readonly error?: string | undefined;
  readonly hint?: string | undefined;
  /** The `affected` of `element.update` that was said last; undefined when it was 0. */
  readonly affected?: number | undefined;
}

/**
 * The line after a save: `Saved <name>`, the number of directly affected elements that `element.update`
 * gave when it is above 0 (SR-024 AK2; 0 says nothing, D-062, also for a change of only status or title,
 * AK3), and the hint of core.
 */
export const savedLine = (name: string, hint: string | undefined, affected = 0): string => {
  const count =
    affected === 0
      ? ""
      : `: ${String(affected)} ${affected === 1 ? "element" : "elements"} directly affected`;
  return hint === undefined ? `Saved ${name}${count}` : `Saved ${name}${count}. ${hint}`;
};

/** What to echo, if anything, and what is said now. */
export interface Speech {
  readonly echo?: string;
  readonly said: Said;
}

/**
 * After a save that wrote: `Saved <name>` (with the number of directly affected elements and the hint of
 * core, `savedLine`) when asked; when quiet only a hint or a number that was not said last time (also a
 * number back at 0). The error is said no more; the hint and the number are what was said now.
 */
export const savedSpeech = (
  said: Said,
  mode: SaveMode,
  name: string,
  hint: string | undefined,
  affected = 0,
): Speech => {
  const now: Said = { ...said, error: undefined, hint, affected: affected === 0 ? undefined : affected };
  const echo = savedLine(name, hint, affected);
  if (mode === "asked") {
    return { echo, said: now };
  }
  // Autosave is silent (D-062); a hint of core or the number of directly affected elements is said once,
  // not after every pause. A number that was said and is 0 now is replaced by `Saved <name>`, so the
  // command prompt does not keep it after a change of only the title or status (AK3).
  const news = (hint !== undefined && hint !== said.hint) || now.affected !== said.affected;
  return news ? { echo, said: now } : { said: now };
};

/**
 * A save that went wrong (`notWritten`): its message when asked, or when it is not the error said last. The
 * message replaces a number of affected elements said before, so the next save that writes says it again.
 */
export const failedSpeech = (said: Said, mode: SaveMode, message: string): Speech => {
  const now: Said = { ...said, error: message, affected: undefined };
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
