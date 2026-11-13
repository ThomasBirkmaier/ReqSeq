// When a list or a search result is drawn, for the switch in motion (SR-212, `buffer-slide.ts`): once its first
// rows show their verification and, for a list of its own, its line of coverage stands. A list view is not keyed
// by its buffer (a list shown after another one updates in place), so what is drawn is kept per buffer, and a
// part that arrives for another buffer than the shown one counts for nothing.
import { useMemo } from "react";

/** A part of the drawing: the first rows with their verification, or the line of coverage. */
export type DrawnPart = "rows" | "line";

/**
 * Notes the parts of the drawing of the buffer `key`; `onDrawn` hears once both stand. A search result and the
 * elements of a package page (`part`) have no line. The function it gives takes the part and the buffer it
 * belongs to.
 */
export const useDrawnParts = (
  key: string,
  kind: "list" | "search",
  part: boolean,
  onDrawn: ((key: string) => void) | undefined,
): ((which: DrawnPart, of: string) => void) => {
  const drawn = useMemo(() => ({ rows: false, line: part || kind !== "list" }), [key, kind, part]);
  return (which, of) => {
    if (of !== key) {
      return;
    }
    drawn[which] = true;
    if (drawn.rows && drawn.line) {
      onDrawn?.(key);
    }
  };
};
