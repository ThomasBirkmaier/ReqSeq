// The buffer a swipe shows beside the shown one, held as it is drawn while a change comes (SR-212 AK5): from
// the moment the drag shows it until the swipe springs back or is ended, or until the slide of its switch ended.
// Pure state; `App.tsx` keeps it and `BufferArea.tsx` holds the view of `key` in the area `side`.

/** The held target of a swipe and the area it is in. */
export interface SwipeHold {
  readonly side: string;
  readonly key: string;
}

/**
 * The hold after the swipe or the switch to `key` ended: released only when it holds `key`, so a late end of
 * an earlier switch does not release the target of a swipe after it.
 */
export const releaseHold = (hold: SwipeHold | undefined, key: string | undefined): SwipeHold | undefined =>
  hold !== undefined && hold.key === key ? undefined : hold;

/** What the area `side` holds: the key, or none. */
export const heldIn = (hold: SwipeHold | undefined, side: string): string | undefined =>
  hold?.side === side ? hold.key : undefined;
