// The unsaved text of element buffers (SR-065), kept by the app while another buffer is shown, and the
// question that "Close buffer" asks about it. Both live in refs: only the modeline needs a render, when a
// buffer gets its first unsaved change or loses its last one.
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/** The unsaved document of a property box, and the stored document it was typed on. */
export interface BoxDraft {
  readonly doc: string;
  /** The stored document when the draft was last compared with it: a different one later means the file changed. */
  readonly base: string;
}

/** The unsaved text and boxes of a buffer, and the file text it was typed on. */
export interface Draft {
  /** The text; the file text when only boxes have unsaved changes. */
  readonly text: string;
  /** The text of the file when the draft was last compared with it: a different file text later means the file changed. */
  readonly base: string;
  /** The boxes with unsaved changes (SR-104), by property key. */
  readonly boxes?: ReadonlyMap<string, BoxDraft>;
}

/** The draft of a buffer: its text and the boxes that differ from what is stored; none when nothing does. */
export const makeDraft = (
  text: { readonly doc: string; readonly base: string },
  boxes: readonly (readonly [string, BoxDraft])[],
): Draft | undefined => {
  const changed = boxes.filter(([, box]) => box.doc !== box.base);
  if (text.doc === text.base && changed.length === 0) {
    return undefined;
  }
  return { text: text.doc, base: text.base, ...(changed.length === 0 ? {} : { boxes: new Map(changed) }) };
};

/** The text of a draft that was typed on; none for a draft of boxes alone (its text is the file text). */
export const typedText = (draft: Draft | undefined): string | undefined =>
  draft !== undefined && draft.text !== draft.base ? draft.text : undefined;

/** The boxes with what their editors hold, each with the stored document it was typed on (a box without one is not shown). */
export const boxDrafts = (
  stored: ReadonlyMap<string, string>,
  docs: ReadonlyMap<string, string>,
): [string, BoxDraft][] =>
  [...docs].flatMap(([key, doc]): [string, BoxDraft][] => {
    const base = stored.get(key);
    return base === undefined ? [] : [[key, { doc, base }]];
  });

/**
 * A draft kept for a buffer that is shown again, compared with the file as it is now: what the file now
 * holds is no longer unsaved, and a draft typed on other stored values is rebased on the new ones with
 * `changed` set (the interim "changed on disk" echo, until #401 and #402 decide). `draft` is `kept`
 * itself when nothing differs.
 */
export const reconcile = (
  kept: Draft,
  text: string,
  stored: ReadonlyMap<string, string>,
): { readonly draft: Draft | undefined; readonly changed: boolean } => {
  // Only text that was typed on can have been changed under the user's hands.
  const typed = kept.text !== kept.base;
  let changed = typed && kept.text !== text && kept.base !== text;
  const boxes = [...(kept.boxes ?? [])].flatMap(([key, box]): [string, BoxDraft][] => {
    const now = stored.get(key);
    if (now === undefined || now === box.doc) {
      // The property is gone, or the file now holds the draft.
      changed ||= now === undefined;
      return [];
    }
    changed ||= now !== box.base;
    return [[key, { doc: box.doc, base: now }]];
  });
  const draft = makeDraft({ doc: typed ? kept.text : text, base: text }, boxes);
  const same =
    draft?.text === kept.text &&
    draft.base === kept.base &&
    boxes.length === (kept.boxes?.size ?? 0) &&
    boxes.every(([key, box]) => kept.boxes?.get(key)?.base === box.base);
  return { draft: same ? kept : draft, changed };
};

export interface Drafts {
  /** The unsaved text by buffer key. */
  readonly drafts: RefObject<Map<string, Draft>>;
  /** The key of the buffer that "Close buffer" asked about. */
  readonly armed: RefObject<string | undefined>;
  /** The text of a buffer has unsaved changes (the draft), or none (undefined). */
  readonly onDraft: (key: string, draft: Draft | undefined) => void;
  /** Drops all drafts: another workspace was opened. */
  readonly reset: () => void;
}

export const useDrafts = (shownKey: string | undefined): Drafts => {
  // The unsaved text by buffer key.
  const drafts = useRef(new Map<string, Draft>());
  // The key of the buffer that "Close buffer" asked about; closing it again discards its draft.
  const armed = useRef<string | undefined>(undefined);
  const [, setCount] = useState(0);

  const onDraft = useCallback((key: string, draft: Draft | undefined): void => {
    const had = drafts.current.has(key);
    if (draft === undefined) {
      drafts.current.delete(key);
    } else {
      drafts.current.set(key, draft);
    }
    // More input ends a question about closing.
    armed.current = undefined;
    if (had !== (draft !== undefined)) {
      setCount((count) => count + 1);
    }
  }, []);

  // Another workspace was opened: nothing is kept.
  const reset = useCallback((): void => {
    drafts.current.clear();
    armed.current = undefined;
  }, []);

  // Another buffer is shown: a question about closing the former one is over.
  useEffect(() => {
    armed.current = undefined;
  }, [shownKey]);

  return { drafts, armed, onDraft, reset };
};
