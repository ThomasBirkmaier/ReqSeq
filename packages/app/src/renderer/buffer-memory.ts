// What the app keeps of an element buffer besides its draft while the buffer is open (SR-105): the undo
// history of its editors and boxes ("since the element was opened" is since the buffer was opened, so
// showing another buffer and coming back keeps it), and the saves of the buffer that run, in order, so a
// buffer shown again while its save runs reads its element after that save (no false "changed on disk").
// Closing the buffer, the buffers pushed out by `MAX_BUFFERS` and another workspace drop it. Pure: the app
// holds the maps in refs.
import type { Draft } from "./drafts.js";
import type { ValueHistory } from "./value-history.js";

/** The undo history of one buffer. */
export interface UndoMemory {
  /**
   * The state of each editor with its history, by field ("Text", a box key), as `EditorState.toJSON`
   * gives it when the editor goes; an editor made again for the field starts from it.
   */
  readonly editors: Map<string, unknown>;
  /** The value history of each choice or relation box, by key. */
  readonly values: Map<string, ValueHistory>;
}

/** What the app keeps of the element buffer that is shown, and what it does for it once it is left. */
export interface BufferKeep {
  readonly memory: UndoMemory;
  /** Resolves when no save of the buffer runs (a save of it when it was left), with its draft then. */
  readonly ready: () => Promise<Draft | undefined>;
  /** Runs a save of the buffer in order with its other saves, so a save on leaving waits for it. */
  readonly save: <T>(job: () => Promise<T>) => Promise<T>;
  /** Changes the draft the app keeps (the answer of a save that came after the buffer was left). */
  readonly update: (change: (draft: Draft) => Draft | undefined) => void;
  /**
   * The buffer is no longer shown (another buffer, closed): the app saves its draft at once (SR-105 AK1),
   * unless `save` is false (a change on disk or a deleted file, SR-106: nothing is saved then).
   */
  readonly left: (save: boolean) => void;
}

/** The memory of the buffer with `key`, made empty when it has none yet. */
export const memoryOf = (all: Map<string, UndoMemory>, key: string): UndoMemory => {
  const kept = all.get(key);
  if (kept !== undefined) {
    return kept;
  }
  const made: UndoMemory = { editors: new Map(), values: new Map() };
  all.set(key, made);
  return made;
};

/** Drops what is kept of the buffers that are not `open` any more. */
export const forgetClosed = (all: Map<string, unknown>, open: readonly string[]): void => {
  for (const key of [...all.keys()]) {
    if (!open.includes(key)) {
      all.delete(key);
    }
  }
};

/**
 * Runs `job` after the saves of the buffer with `key` that run or wait, and keeps it as the last one until
 * it ends. Its result is the job's; a job that fails does not stop the ones after it.
 */
export const queueSave = <T>(
  queue: Map<string, Promise<unknown>>,
  key: string,
  job: () => Promise<T>,
): Promise<T> => {
  const before = queue.get(key) ?? Promise.resolve();
  const done = before.then(job);
  const settled = done.then(
    () => undefined,
    () => undefined,
  );
  queue.set(key, settled);
  void settled.then(() => {
    if (queue.get(key) === settled) {
      queue.delete(key);
    }
  });
  return done;
};

/** Resolves once no save of the buffer with `key` runs or waits. */
export const savesDone = async (queue: Map<string, Promise<unknown>>, key: string): Promise<void> => {
  for (let last = queue.get(key); last !== undefined; last = queue.get(key)) {
    await last;
  }
};
