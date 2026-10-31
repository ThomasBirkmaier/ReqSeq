// The order "Next buffer" (Alt+N, Option+N on macOS) and "Previous buffer" (Alt+P, Option+P) walk
// (SR-115 AK5): the order in which the buffers were shown last, like back and forward. Switching with
// these keys does not change it, so pressing Alt+P again goes further back. It is the order of use of
// the buffers (the most recent first), frozen while the keys walk it. Pure display (ADR-0002 rule 3): no
// catalog command, no React.
import type { Buffers } from "./buffers.js";

const same = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((key, at) => key === right[at]);

/** The order to walk, the most recently shown first, and the buffer the keys switched to last. */
export interface Walk {
  readonly order: readonly string[];
  readonly cycled: string | undefined;
}

export const NO_WALK: Walk = { order: [], cycled: undefined };

/**
 * The walk after `buffers` changed. While `cycled` is shown and no buffer came since, the order stays
 * (without the closed ones); otherwise the walk ends: the order is the order of use of `buffers`, and
 * nothing is cycled. `walk` itself when nothing changed.
 */
export const cycleOrder = (walk: Walk, buffers: Buffers): Walk => {
  const keys = buffers.map((buffer) => buffer.key);
  if (walk.cycled !== undefined && keys[0] === walk.cycled) {
    const open = new Set(keys);
    const kept = walk.order.filter((key) => open.has(key));
    if (kept.length === keys.length) {
      return kept.length === walk.order.length ? walk : { order: kept, cycled: walk.cycled };
    }
  }
  return walk.cycled === undefined && same(walk.order, keys) ? walk : { order: keys, cycled: undefined };
};

/**
 * The key of the buffer shown before (`step` 1, Previous buffer) or after (-1, Next buffer) `shown` in
 * `order`, wrapping at the ends; undefined with fewer than two buffers or when `shown` is not in the order.
 */
export const cycleKey = (
  order: readonly string[],
  shown: string | undefined,
  step: 1 | -1,
): string | undefined => {
  const at = shown === undefined ? -1 : order.indexOf(shown);
  if (order.length < 2 || at < 0) {
    return undefined;
  }
  return order[(at + step + order.length) % order.length];
};
