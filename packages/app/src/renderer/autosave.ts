// Saving without a save command (SR-105 AK1): the element buffer writes its input one second after the
// last change of a document, as one `element.update` with everything that differs. A scheduler without
// React; the buffer drives it (`input` on every change of a document) and gives it the save.
// - At most one save runs at a time. Input that comes while it runs waits for its answer: the next save
//   comes one second after the last input, or at once when that second has passed meanwhile.
// - A hold (`held`) is input that is still going on (an input method composing, an open slash menu, whose
//   query is in the text): the save waits until the hold ends (`release`), so nothing half typed is
//   written.
// - `now` saves at once, after the save that runs (leaving the element, "Save element", a prompt that
//   opens). Holds do not count then.
// Whether there is anything to save, and whether saving is allowed (a conflict, a deleted file, a
// read-only element: SR-106 AK2 „speichert das Tool nicht“), is the save's own decision.

/** The pause after the last input before the input is written (AK1: „eine Sekunde lang keine Eingabe“). */
export const AUTOSAVE_MS = 1000;

export interface AutosaveOptions {
  /** Writes the input that differs from the file; resolves when it was answered. Never rejects. */
  readonly save: () => Promise<unknown>;
  /** Input is still going on: the save waits. */
  readonly held: () => boolean;
  /** The pause; `AUTOSAVE_MS` by default. */
  readonly delay?: number;
}

export interface Autosave {
  /** A document changed: the save follows one second after the last such change. */
  readonly input: () => void;
  /** A hold may have ended: a save that is due runs now. */
  readonly release: () => void;
  /**
   * Runs `job` now (the save by default), after the save that runs, in place of a save that waits. Its
   * result is the job's.
   */
  readonly now: <T>(job: () => Promise<T>) => Promise<T>;
  /** Whether input waits for its save or a save runs. */
  readonly busy: () => boolean;
  /** The buffer is gone: no timer is left. A save that runs still finishes. */
  readonly dispose: () => void;
}

export const createAutosave = ({ save, held, delay = AUTOSAVE_MS }: AutosaveOptions): Autosave => {
  // The time of the last input, whether it waits for a save, the timer, and the save that runs.
  let last = 0;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<unknown> | undefined;
  let disposed = false;

  const stop = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };
  const arm = (wait: number): void => {
    stop();
    if (!disposed) {
      timer = setTimeout(fire, wait);
    }
  };
  // Runs `job` as the save that runs; when it ends, input that came meanwhile is scheduled.
  const run = <T>(job: () => Promise<T>): Promise<T> => {
    const done = job();
    const tracked = done.then(
      () => undefined,
      () => undefined,
    );
    running = tracked;
    // Registered before anyone can wait for `running`, so it runs first: a save asked for `now` meanwhile
    // waits for the save this schedules.
    void tracked.then(() => {
      running = undefined;
      if (pending) {
        fire();
      }
    });
    return done;
  };
  // The pause has passed: save, unless a save runs (its end comes back here) or a hold waits (its end
  // calls `release`).
  function fire(): void {
    stop();
    if (!pending || running !== undefined || disposed || held()) {
      return;
    }
    const wait = last + delay - Date.now();
    if (wait > 0) {
      arm(wait);
      return;
    }
    pending = false;
    void run(save);
  }

  return {
    input: () => {
      last = Date.now();
      pending = true;
      if (running === undefined) {
        arm(delay);
      }
    },
    release: () => {
      if (pending && timer === undefined) {
        fire();
      }
    },
    now: async <T>(job: () => Promise<T>): Promise<T> => {
      // The job takes the input that waits; input that comes while it waits schedules a save of its own.
      stop();
      pending = false;
      while (running !== undefined) {
        await running;
      }
      stop();
      pending = false;
      return run(job);
    },
    busy: () => pending || running !== undefined,
    dispose: () => {
      disposed = true;
      stop();
    },
  };
};
