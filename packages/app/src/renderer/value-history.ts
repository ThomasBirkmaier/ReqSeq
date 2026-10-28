// The undo history of a choice or relation box (SR-105 AK2): its value is set in the minibuffer, so no
// editor keeps a history for it. Each box keeps the documents it had before each change since the buffer
// was opened; Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z on the box step back and forth through them. An undo or
// redo is input like any other: the box shows that document, and autosave writes it. Pure; the buffer
// keeps one per box, and the app keeps them with the buffer (dropped when the buffer closes).

/** The documents before the changes that can be undone (the newest last), and those undone since. */
export interface ValueHistory {
  readonly done: readonly string[];
  readonly undone: readonly string[];
}

export const NO_HISTORY: ValueHistory = { done: [], undone: [] };

/** A change from `before` to `after`: it can be undone, and nothing undone can be redone any more. */
export const record = (history: ValueHistory, before: string, after: string): ValueHistory =>
  before === after ? history : { done: [...history.done, before], undone: [] };

/** What one step back or forth gives: the document the box shows then, and the history after it. */
export interface Step {
  readonly doc: string;
  readonly history: ValueHistory;
}

/** One step back from `current`; none when nothing is left to undo. */
export const undo = (history: ValueHistory, current: string): Step | undefined => {
  const doc = history.done.at(-1);
  return doc === undefined
    ? undefined
    : { doc, history: { done: history.done.slice(0, -1), undone: [...history.undone, current] } };
};

/** One step forth from `current`; none when nothing was undone. */
export const redo = (history: ValueHistory, current: string): Step | undefined => {
  const doc = history.undone.at(-1);
  return doc === undefined
    ? undefined
    : { doc, history: { done: [...history.done, current], undone: history.undone.slice(0, -1) } };
};
