// The highlight of what changed outside the app (SR-116): a view marks the fields or rows it shows, each
// mark is gone `MARK_MS` after it was set, well within the 3 s of AK2, and a mark that is on is not set again, so an element
// flashes once. The class `outside-change` (styles.css) is the tint.
import { useCallback, useEffect, useRef, useState } from "react";
import { MARK_MS } from "./outside-marks.js";

/** The class of a field or a row that changed outside. */
export const OUTSIDE_CHANGE = "outside-change";

const NONE: ReadonlySet<string> = new Set();

export interface OutsideMarks {
  /** The keys (field labels, element UUIDs) that are highlighted now. */
  readonly marked: ReadonlySet<string>;
  /** Highlights `keys` for `MARK_MS`; a key that is highlighted already keeps its time. */
  readonly mark: (keys: Iterable<string>) => void;
}

export const useOutsideMarks = (): OutsideMarks => {
  const [marked, setMarked] = useState(NONE);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(
    () => () => {
      for (const timer of timers.current.values()) {
        clearTimeout(timer);
      }
    },
    [],
  );
  const mark = useCallback((keys: Iterable<string>): void => {
    const added = [...new Set(keys)].filter((key) => !timers.current.has(key));
    if (added.length === 0) {
      return;
    }
    for (const key of added) {
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          setMarked((now) => new Set([...now].filter((other) => other !== key)));
        }, MARK_MS),
      );
    }
    setMarked((now) => new Set([...now, ...added]));
  }, []);
  return { marked, mark };
};

/** The class names of a row, with the highlight when `id` is marked. */
export const rowClass = (base: string, marks: ReadonlySet<string>, id: string): string =>
  marks.has(id) ? `${base} ${OUTSIDE_CHANGE}` : base;
