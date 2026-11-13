// The layers of an area that hold a view (`BufferArea.tsx`): the shown buffer, and beside it, hidden, the
// buffers drawn in advance (SR-212 AK5, `neighbours.ts`). A hidden view reads and draws as a fresh view of its
// buffer would, and does nothing a reader would notice: it says nothing, takes no focus, starts no save and
// highlights nothing until it is shown. Its reads wait until the shown buffer is drawn (`ReadGate`), so they
// never delay the buffer the reader waits for.
import { createContext, useContext, useLayoutEffect, useRef } from "react";
import { DRAW_DEADLINE_MS } from "./buffer-slide.js";
import type { BufferData } from "./modeline.js";

/** What a view knows of its layer: whether it is hidden beside the shown buffer. */
export interface SlotState {
  readonly hidden: boolean;
}

export const SlotContext = createContext<SlotState>({ hidden: false });

/** The view stands hidden beside the shown buffer (SR-212 AK5). */
export const useHidden = (): boolean => useContext(SlotContext).hidden;

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
 * is open (the reader may be choosing the next buffer). So a read drawn in advance never delays the buffer the
 * reader waits for (SR-082 AK3).
 */
export class ReadGate {
  private shown: string | undefined;
  private drawnShown = false;
  private sliding = false;
  private prompting = false;
  private releasing = false;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private readonly waiting = new Set<() => void>();
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

  /** Resolves when the reads may go: at once when they may now. */
  pass(): Promise<void> {
    if (this.open) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiting.add(resolve);
    });
  }

  /** Lets nothing wait any longer: the window goes. */
  dispose(): void {
    clearTimeout(this.deadline);
    this.waiting.clear();
  }

  /**
   * Lets the waiting reads go, in a microtask and only if the gate is still open then: a slide that ends and
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
      const go = [...this.waiting];
      this.waiting.clear();
      for (const resolve of go) {
        resolve();
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
