// The unsaved text of element buffers (SR-065), kept by the app while another buffer is shown, and the
// question that "Close buffer" asks about it. Both live in refs: only the modeline needs a render, when a
// buffer gets its first unsaved change or loses its last one.
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DataExportElement } from "@logreq/core";

/** The unsaved document of a property box, and the stored document it was typed on. */
export interface BoxDraft {
  readonly doc: string;
  /** The stored document when the draft was last compared with it: a different one later means the file changed. */
  readonly base: string;
}

/** The unsaved text and boxes of a buffer, and the file they were typed on. */
export interface Draft {
  /** The text; the file text when only boxes have unsaved changes. */
  readonly text: string;
  /** The text of the file when the draft was last compared with it: the text was typed in when it differs. */
  readonly base: string;
  /** The boxes with unsaved changes (SR-104), by property key. */
  readonly boxes?: ReadonlyMap<string, BoxDraft>;
  /**
   * The bytes of the file the input was typed on (`fileSha256` of `element.get`): a buffer shown again on
   * other bytes follows the rule for a file changed outside (SR-106, `outside-change.ts`).
   */
  readonly sha?: string;
  /**
   * The element as the buffer showed it, with the bytes of its file: a buffer shown again after its file
   * was deleted shows it with the input, read-only (SR-106 AK3), instead of an error.
   */
  readonly shown?: ShownFile;
}

/** An answer of `element.get` that a buffer showed: the element and the bytes of its file. */
export interface ShownFile {
  readonly element: DataExportElement;
  readonly sha: string;
}

/** The draft of a buffer: its text and the boxes that differ from what is stored; none when nothing does. */
export const makeDraft = (
  text: { readonly doc: string; readonly base: string },
  boxes: readonly (readonly [string, BoxDraft])[],
  sha?: string,
): Draft | undefined => {
  const changed = boxes.filter(([, box]) => box.doc !== box.base);
  if (text.doc === text.base && changed.length === 0) {
    return undefined;
  }
  return {
    text: text.doc,
    base: text.base,
    ...(changed.length === 0 ? {} : { boxes: new Map(changed) }),
    ...(sha === undefined ? {} : { sha }),
  };
};

/** The draft with the element the buffer shows, so it can be shown again without its file. */
export const withShown = (draft: Draft | undefined, shown: ShownFile | undefined): Draft | undefined =>
  draft === undefined || shown === undefined ? draft : { ...draft, shown };

/** Whether two drafts hold the same input on the same file. */
export const sameDraft = (a: Draft | undefined, b: Draft | undefined): boolean =>
  JSON.stringify(a === undefined ? null : [a.text, a.base, a.sha, [...(a.boxes ?? [])]]) ===
  JSON.stringify(b === undefined ? null : [b.text, b.base, b.sha, [...(b.boxes ?? [])]]);

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
