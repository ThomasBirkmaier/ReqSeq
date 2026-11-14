// The layers of an area that hold a view (`BufferArea.tsx`): the shown buffer, and beside it, hidden, the
// buffers drawn in advance (SR-212 AK5, `neighbours.ts`). A hidden view reads and draws as a fresh view of its
// buffer would, and does nothing a reader would notice: it says nothing, takes no focus, starts no save and
// highlights nothing until it is shown. Its reads wait until the shown buffer is drawn (`ReadGate`), so none
// starts while the reader waits for a buffer; one already sent when the reader asks for another still runs.
import {
  createContext,
  startTransition,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { DRAW_DEADLINE_MS } from "./buffer-slide.js";
import type { Call } from "./call.js";
import type { BufferData } from "./modeline.js";

/**
 * What a view knows of its layer: whether it is hidden beside the shown buffer, and whether it draws all it
 * shows there. A view read for drawing in advance (`read`, `neighbours.ts`) reads no more than what a switch
 * needs, not the elements of a package page; one drawn from its record or for a swipe draws everything, as its
 * reads cost no read of the workspace or are what the reader waits for.
 */
export interface SlotState {
  readonly hidden: boolean;
  readonly whole: boolean;
}

export const SlotContext = createContext<SlotState>({ hidden: false, whole: true });

/** The view stands hidden beside the shown buffer (SR-212 AK5). */
export const useHidden = (): boolean => useContext(SlotContext).hidden;

/**
 * Applies the state a read gave: at once in a shown view; in a hidden one as a transition, which React renders
 * in slices and puts behind any input, so the draw of a long list or matrix drawn in advance never holds up a key
 * the reader presses meanwhile, such as Enter on a relation of the shown element (SR-082 AK3, SR-212 AK5). `then`
 * runs once the update is committed, so a view counts as drawn only when what it drew stands.
 */
export const useHiddenUpdate = (): ((update: () => void, then?: () => void) => void) => {
  const hidden = useRef(false);
  hidden.current = useHidden();
  const [applied, setApplied] = useState(0);
  const queued = useRef(0);
  const waiting = useRef<{ readonly at: number; readonly then: () => void }[]>([]);
  useEffect(() => {
    const due = waiting.current.filter(({ at }) => at <= applied);
    waiting.current = waiting.current.filter(({ at }) => at > applied);
    for (const { then } of due) {
      then();
    }
  }, [applied]);
  return (update, then) => {
    if (!hidden.current) {
      update();
      then?.();
      return;
    }
    queued.current += 1;
    const at = queued.current;
    if (then !== undefined) {
      waiting.current.push({ at, then });
    }
    startTransition(() => {
      update();
      setApplied(at);
    });
  };
};

/** The view draws all it shows: it is shown, or drawn from its record or for a swipe (`SlotState`). */
export const useWhole = (): boolean => useContext(SlotContext).whole;

/**
 * Runs `reveal` in a layout effect when the view's layer goes from hidden to shown: before the first frame of
 * the slide (a child's layout effect runs before the app's), and only then, as a fresh view does on its first
 * load.
 */
export const useReveal = (reveal: () => void): void => {
  const hidden = useHidden();
  const was = useRef(hidden);
  const latest = useRef(reveal);
  latest.current = reveal;
  useLayoutEffect(() => {
    if (was.current && !hidden) {
      latest.current();
    }
    was.current = hidden;
  }, [hidden]);
};

/**
 * The attribute by which focus, lookups and tests find the view of a buffer (`[data-buffer]`): only on a shown
 * view, never on one drawn hidden in advance.
 */
export const bufferMark = (hidden: boolean): { readonly "data-buffer"?: string } =>
  hidden ? {} : { "data-buffer": "" };

/**
 * What a view loaded counts as its drawing for the switch in motion (SR-212): data without rows. A list or a
 * search result (the data with its rows) says so itself (`onDrawn`), once its rows show their verification.
 */
export const drawnBy = (data: BufferData | undefined): boolean => data !== undefined && !("rows" in data);

/**
 * When the reads of the hidden views may go: once the buffer the active area shows has reported that it is
 * drawn (at least once since it was shown, or after `DRAW_DEADLINE_MS`), and not while a slide runs or a prompt
 * is open (the reader may be choosing the next buffer). So no read drawn in advance starts while the reader
 * waits for a buffer (SR-082 AK3); one sent before the reader asks still runs, and its time counts in the open
 * (`test/perf/neighbours.spec.ts`).
 */
export class ReadGate {
  private shown: string | undefined;
  private drawnShown = false;
  private sliding = false;
  private prompting = false;
  private releasing = false;
  /** A hidden read is sent and not yet answered: the next one waits for it. */
  private reading = false;
  /** Requests of the shown buffers sent and not yet answered: no hidden read is sent meanwhile. */
  private showing = 0;
  private readonly turns: (() => void)[] = [];
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private readonly wait: number;

  constructor(wait = DRAW_DEADLINE_MS) {
    this.wait = wait;
  }

  /** The reads may go now. */
  get open(): boolean {
    return this.drawnShown && !this.sliding && !this.prompting;
  }

  /** The active area shows `key`; `drawn` when its view reported its drawing already (it was drawn in advance). */
  show(key: string, drawn: boolean): void {
    if (key === this.shown && this.drawnShown) {
      return;
    }
    clearTimeout(this.deadline);
    this.shown = key;
    this.drawnShown = drawn;
    if (!drawn) {
      this.deadline = setTimeout(() => {
        this.drawn(key);
      }, this.wait);
    }
    this.release();
  }

  /** The view of `key` reported its drawing: when the active area shows it, the reads may go. */
  drawn(key: string): void {
    if (key !== this.shown || this.drawnShown) {
      return;
    }
    clearTimeout(this.deadline);
    this.drawnShown = true;
    this.release();
  }

  /** A slide is taken, waits or runs (`true`), or ended (`false`). */
  slide(busy: boolean): void {
    this.sliding = busy;
    this.release();
  }

  /** A prompt is open in the minibuffer (`true`), or none is (`false`). */
  prompt(open: boolean): void {
    this.prompting = open;
    this.release();
  }

  /**
   * Waits for the turn of one hidden read: the gate is open, no other hidden read is in flight and no request
   * of a shown buffer is, so at most one read drawn in advance is ahead of what the reader asks for. `turn`
   * resolves to the function that ends it (call it once the read answered); `cancel` leaves the queue, or ends
   * the turn when it was given already.
   */
  turn(): { readonly turn: Promise<() => void>; readonly cancel: () => void } {
    let given = false;
    let ended = false;
    const end = (): void => {
      if (!ended) {
        ended = true;
        this.reading = false;
        this.release();
      }
    };
    let take = (): void => undefined;
    const turn = new Promise<() => void>((resolve) => {
      take = () => {
        given = true;
        this.reading = true;
        resolve(end);
      };
      this.turns.push(take);
    });
    this.release();
    return {
      turn,
      cancel: () => {
        const at = this.turns.indexOf(take);
        if (at >= 0) {
          this.turns.splice(at, 1);
        } else if (given) {
          end();
        }
      },
    };
  }

  /** A request of a shown buffer is sent: no hidden read is sent until the returned function says it answered. */
  request(): () => void {
    this.showing += 1;
    let done = false;
    return () => {
      if (!done) {
        done = true;
        this.showing -= 1;
        this.release();
      }
    };
  }

  /** Lets nothing wait any longer: the window goes. */
  dispose(): void {
    clearTimeout(this.deadline);
    this.turns.length = 0;
  }

  /**
   * Gives the next hidden read its turn, in a microtask and only if the gate is still open then: a slide that ends and
   * the next that starts in the same task (a held Alt+P) lets nothing through.
   */
  private release(): void {
    if (!this.open || this.releasing) {
      return;
    }
    this.releasing = true;
    queueMicrotask(() => {
      this.releasing = false;
      if (!this.open) {
        return;
      }
      if (!this.reading && this.showing === 0) {
        this.turns.shift()?.();
      }
    });
  }
}

/**
 * The callbacks of a hidden view that act on the window, held until it is shown: the actions it dispatches
 * and the elements it found gone, in order, and the last message it would say. `flush` applies them, as a
 * fresh view at the switch would have done them.
 */
export class HeldCalls {
  private actions: (() => void)[] = [];
  private echo: string | undefined;

  /** Holds `run` until `flush`. */
  hold(run: () => void): void {
    this.actions.push(run);
  }

  /** Keeps `message` as the last one to say at `flush`. */
  say(message: string): void {
    this.echo = message;
  }

  /** Runs what was held, in order, then says the last message. */
  flush(echo: (message: string) => void): void {
    const { actions, echo: message } = this;
    this.actions = [];
    this.echo = undefined;
    for (const run of actions) {
      run();
    }
    if (message !== undefined) {
      echo(message);
    }
  }
}

/**
 * `call`, counting in `pending` each write (`element.update`) once it answered ok: the host posts that answer
 * and then the change of the workspace (`written`) on the window's channel, so the next `written` is this
 * write's, not another window's. The save of leaving an element counts to its switch only through such a
 * write (SR-212 AK5). A save with nothing to write sends none and counts nothing.
 */
export const countingWrites =
  (call: Call, pending: { current: number }): Call =>
  async (name, input) => {
    if (name !== "element.update") {
      return call(name, input);
    }
    const answer = await call(name, input);
    if (answer.ok) {
      pending.current += 1;
    }
    return answer;
  };

/**
 * The saves of elements (`element.update`) of the window not yet done: sent and not answered, or answered and
 * waiting for their change of the workspace (`written`, which the host posts right after the answer). While
 * one is, a buffer drawn from its record may be out of date at a switch (SR-212 AK5).
 */
export class WritesInFlight {
  private sent = 0;
  private answered = 0;

  /** No save is in flight. */
  get none(): boolean {
    return this.sent === 0 && this.answered === 0;
  }

  /** `call`, counting its saves. */
  counting(call: Call): Call {
    return async (name, input) => {
      if (name !== "element.update") {
        return call(name, input);
      }
      this.sent += 1;
      try {
        const answer = await call(name, input);
        if (answer.ok) {
          this.answered += 1;
        }
        return answer;
      } finally {
        this.sent -= 1;
      }
    };
  }

  /** A change of the workspace came: `written` ends the wait of one save answered; another workspace ends all. */
  changed(reason: string | undefined): void {
    if (reason === "opened") {
      this.answered = 0;
    } else if (reason === "written" && this.answered > 0) {
      this.answered -= 1;
    }
  }
}
