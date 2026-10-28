// The order in which the open buffers were opened (SR-115 AK5): "Next buffer" (Alt+N, Option+N on macOS)
// and "Previous buffer" (Alt+P, Option+P) walk it and wrap. It is kept apart from the buffers, which are
// ordered by use (the most recent first, for Ctrl/Cmd+P and the shown buffer). Pure display (ADR-0002
// rule 3): no catalog command, no React.
import type { Buffers } from "./buffers.js";

/**
 * The keys of `buffers` in the order of opening: those of `previous` that are still open keep their
 * place, and the new ones follow, the least recent first. A buffer replaced in place (a list filtered or
 * sorted, a neighbourhood with a row opened, the matrix mode) keeps its key and so its place; a closed one
 * is dropped, and opened again it comes last. `previous` itself when nothing changed.
 */
export const openingOrder = (previous: readonly string[], buffers: Buffers): readonly string[] => {
  const open = new Set(buffers.map((buffer) => buffer.key));
  const kept = previous.filter((key) => open.has(key));
  const known = new Set(kept);
  const added = buffers
    .map((buffer) => buffer.key)
    .filter((key) => !known.has(key))
    .reverse();
  return added.length === 0 && kept.length === previous.length ? previous : [...kept, ...added];
};

/**
 * The order of opening once buffers are restored (SR-115 AK4): the restored ones in their stored order
 * (`stored`), then those opened in this window that are not among them, in their order. `openingOrder`
 * then drops the keys that are not open.
 */
export const seedOrder = (stored: readonly string[], current: readonly string[]): readonly string[] => {
  const known = new Set(stored);
  return [...stored, ...current.filter((key) => !known.has(key))];
};

/**
 * The key of the buffer after (`step` 1) or before (-1) `shown` in `order`, wrapping at the ends;
 * undefined with fewer than two buffers or when `shown` is not in the order.
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
