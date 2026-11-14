// The draw a swipe asks for (SR-211 AK3): when a swipe starts toward a buffer that is not drawn in advance
// (SR-212 AK5), the app draws it at once, hidden beside the shown one, and the shown buffer waits until it is
// drawn. The swipe (#1612) calls `draw` when it starts and `end` when it ends; meanwhile the buffer's layer
// reads as a shown buffer does (`BufferArea.tsx`, `swipe`), whatever its kind, and what it reads goes into its
// record, so after a swipe that springs back it stays drawn while it stays beside the shown buffer. Pure state
// (ADR-0002 rule 3): no catalog command, no React.

/** What the window gives the draw: the buffer is drawn in advance now, and it is no longer dropped. */
export interface SwipeHost {
  /** The buffer `key` is drawn in advance in the current generation: the draw resolves at once. */
  readonly ready: (key: string) => boolean;
  /** Takes `key` out of the buffers a change dropped until the next switch (SR-212 AK5). */
  readonly undrop: (key: string) => void;
}

const NO_HOST: SwipeHost = { ready: () => false, undrop: () => undefined };

/** The buffer a swipe draws, one at a time. */
export class SwipeDraw {
  private wanted: { readonly key: string; settle: ((drawn: boolean) => void) | undefined } | undefined;
  private readonly listeners = new Set<() => void>();
  private host: SwipeHost = NO_HOST;

  /** The buffer drawn for a swipe now; none without a swipe. */
  get key(): string | undefined {
    return this.wanted?.key;
  }

  /** The window that shows the buffers. */
  attach(host: SwipeHost): void {
    this.host = host;
  }

  /** Calls `listener` when `key` changes; gives the function that stops it (`useSyncExternalStore`). */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Draws the buffer `key` for a swipe: resolves `true` once it is drawn (at once when it is drawn in advance
   * already), `false` when the swipe ends first, another draw takes its place, or the buffer is closed. The
   * buffer stays drawn for the swipe until `end`.
   */
  draw(key: string): Promise<boolean> {
    this.settle(false);
    this.host.undrop(key);
    return new Promise<boolean>((resolve) => {
      this.wanted = { key, settle: resolve };
      if (this.host.ready(key)) {
        this.settle(true);
      }
      this.notify();
    });
  }

  /** The layer of `key` is drawn with no read pending. */
  ready(key: string): void {
    if (this.wanted?.key === key) {
      this.settle(true);
    }
  }

  /** The open buffers are `keys`: a draw for a buffer closed meanwhile ends (SR-211 AK12). */
  open(keys: readonly string[]): void {
    if (this.wanted !== undefined && !keys.includes(this.wanted.key)) {
      this.end();
    }
  }

  /**
   * The buffers drawn beside the shown one are `keys`: a draw whose buffer is not among them any more (the
   * other area shows it, or it was dropped for another reason) ends, so its promise settles.
   */
  beside(keys: readonly string[]): void {
    if (this.wanted !== undefined && !keys.includes(this.wanted.key)) {
      this.end();
    }
  }

  /** The swipe ended: the buffer is drawn in advance again only by the rules of SR-212 AK5. */
  end(): void {
    if (this.wanted === undefined) {
      return;
    }
    this.settle(false);
    this.wanted = undefined;
    this.notify();
  }

  private settle(drawn: boolean): void {
    const settle = this.wanted?.settle;
    if (this.wanted !== undefined) {
      this.wanted.settle = undefined;
    }
    settle?.(drawn);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
