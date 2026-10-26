// The unsaved text of element buffers (SR-065), kept by the app while another buffer is shown, and the
// question that "Close buffer" asks about it. Both live in refs: only the modeline needs a render, when a
// buffer gets its first unsaved change or loses its last one.
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/** The unsaved text of a buffer, and the file text it was typed on. */
export interface Draft {
  readonly text: string;
  /** The text of the file when the draft was last compared with it: a different file text later means the file changed. */
  readonly base: string;
}

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
