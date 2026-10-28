// The question for the element of an inline reference (ADR-0004), shared by the slash menu's "Reference to
// element" (SR-129) and the `[[` search (SR-066, `reference-search.ts`): the editor keeps what was typed (the
// `/` and its query, or the `[[`) while the app asks for an element in the prompt "Insert reference", and
// writes `referenceMarkdown` in its place once one is picked. One place writes the reference (#576).
import { isolateHistory } from "@codemirror/commands";
import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { referenceMarkdown, slashRange } from "./slash-entries.js";
import type { ReferenceTarget } from "./slash-entries.js";

/** What the editor hands to the app when it asks for an element. */
export interface ReferenceRequest {
  /** An element was picked: its reference replaces what was typed, and the editor gets the focus. */
  readonly insert: (target: ReferenceTarget) => void;
  /** The question was cancelled: the editor gets the focus, what was typed stays. */
  readonly cancel: () => void;
}

export interface PickOptions {
  /** Asks the app for an element ("Insert reference" prompt). */
  readonly pickElement: (request: ReferenceRequest) => void;
  /** The repository of the element being edited (D-058: the label of a reference to another one is its short ID). */
  readonly repository: () => string;
}

/** What waits for the element: a `/` with its query, or the two `[` typed (SR-066). */
export type Held = "slash" | "brackets";

interface Pending {
  readonly from: number;
  readonly to: number;
  readonly held: Held;
}

export const setPending = StateEffect.define<Pending | null>();

/**
 * What was typed while the app asks for an element: mapped through changes. Text typed right
 * after it stays outside (`to` keeps to the left), so a fast `[[ab` keeps the `ab` after the reference.
 * Module level, so an editor configured again keeps it.
 */
export const pendingField = StateField.define<Pending | null>({
  create: () => null,
  update: (value, transaction) => {
    let next = value;
    if (next !== null && transaction.docChanged) {
      const from = transaction.changes.mapPos(next.from, 1);
      next = { from, to: Math.max(from, transaction.changes.mapPos(next.to, -1)), held: next.held };
    }
    for (const effect of transaction.effects) {
      if (effect.is(setPending)) {
        next = effect.value;
      }
    }
    return next;
  },
});

/**
 * Whether the editor waits for the element the app asks for: what was typed is still in the text, so
 * autosave waits (SR-105, `autosave.ts`). False for a state without the slash menu or the `[[` search.
 */
export const awaitingReference = (state: EditorState): boolean =>
  (state.field(pendingField, false) ?? null) !== null;

/** Whether the text still holds what waits: the `/` and its query, or exactly the two `[`. */
const holds = (state: EditorState, pending: Pending): boolean =>
  pending.held === "slash"
    ? slashRange(state, pending.from, pending.to) !== undefined
    : state.sliceDoc(pending.from, pending.to) === "[[";

/** Writes the reference in place of what was typed, or at the caret when it is gone. One undo step. */
export const insertReference = (view: EditorView, target: ReferenceTarget, repository: string): void => {
  // The buffer may have been left while the question was open: the editor is gone then.
  if (!view.dom.isConnected) {
    return;
  }
  const pending = view.state.field(pendingField);
  const { from, to } = pending !== null && holds(view.state, pending) ? pending : view.state.selection.main;
  const insert = referenceMarkdown(target, repository);
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    effects: setPending.of(null),
    userEvent: "input.complete",
    annotations: isolateHistory.of("full"),
    scrollIntoView: true,
  });
  view.focus();
};

/** Asks the app for an element for what waits in `view` (set with `setPending` before). */
export const askReference = (view: EditorView, options: PickOptions): void => {
  options.pickElement({
    insert: (target) => {
      insertReference(view, target, options.repository());
    },
    cancel: () => {
      view.dispatch({ effects: setPending.of(null) });
      view.focus();
    },
  });
};
