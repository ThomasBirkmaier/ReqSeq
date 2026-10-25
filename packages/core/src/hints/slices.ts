// Work over many items in the thread that serves commands, in slices with a turn of the event loop
// between them, so that a server keeps answering while a check runs (SR-082, N-036), as the
// current versions are built (`model/current-versions.ts`).
import { setImmediate as nextTurn } from "node:timers/promises";

/** Blocking work before the event loop gets a turn, in ms. */
export const SLICE_MS = 20;

/** Calls `each` for every item in order, with a turn of the event loop after every `budget` ms. */
export const forEachSliced = async <T>(
  items: Iterable<T>,
  each: (item: T) => void,
  budget: number = SLICE_MS,
): Promise<void> => {
  let since = performance.now();
  for (const item of items) {
    each(item);
    if (performance.now() - since >= budget) {
      await nextTurn();
      since = performance.now();
    }
  }
};
