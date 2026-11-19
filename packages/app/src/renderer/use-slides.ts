// The motion of a switch in the window (`App.tsx`, SR-212): the slide controller of the active area, and
// the buffers drawn in advance that a change dropped. `App` calls both where their code stood, so their
// hooks keep their order.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReadGate } from "./area-slot.js";
import type { Buffer } from "./buffers.js";
import { SlideController } from "./buffer-slide.js";

/**
 * The switch to the previous or next buffer in motion (SR-212): one at a time, taken in the keydown (`cycled`),
 * started by the commit that shows its buffer in the active area `side`, and ended by any other change of it.
 */
export const useSlides = (
  sheet: React.RefObject<HTMLElement | null>,
  side: string,
  shown: Buffer | undefined,
  gate: ReadGate,
  ended: (to: string) => void,
): SlideController => {
  const slides = useRef<SlideController | undefined>(undefined);
  const endedNow = useRef(ended);
  endedNow.current = ended;
  slides.current ??= new SlideController({
    view: window,
    root: () => sheet.current,
    busy: (busy) => {
      gate.slide(busy);
    },
    ended: (to) => {
      endedNow.current(to);
    },
  });
  const controller = slides.current;
  const key = shown?.key;
  useLayoutEffect(() => {
    controller.settle(side, key);
  }, [controller, side, key]);
  useEffect(
    () => () => {
      controller.finish();
      gate.dispose();
    },
    [controller],
  );
  return controller;
};

const NONE: ReadonlySet<string> = new Set();

/**
 * The buffers drawn in advance that a change dropped since the shown `buffer` was switched to: they are
 * not read again in the background, and drawn in advance again only after the next switch (SR-212 AK5).
 */
export const useDropped = (
  buffer: Buffer | undefined,
): {
  readonly dropped: ReadonlySet<string>;
  readonly drop: (key: string) => void;
  /** Takes `key` out of them again: a swipe draws it (SR-211 AK3). */
  readonly undrop: (key: string) => void;
} => {
  const shown = buffer?.key;
  const switches = useRef({ key: shown, count: 0 });
  if (switches.current.key !== shown) {
    switches.current = { key: shown, count: switches.current.count + 1 };
  }
  const [dropped, setDropped] = useState({ at: 0, keys: NONE });
  const drop = useCallback((key: string): void => {
    const at = switches.current.count;
    setDropped((before) => ({ at, keys: new Set([...(before.at === at ? before.keys : []), key]) }));
  }, []);
  const undrop = useCallback((key: string): void => {
    setDropped((before) =>
      before.keys.has(key)
        ? { at: before.at, keys: new Set([...before.keys].filter((one) => one !== key)) }
        : before,
    );
  }, []);
  return { dropped: dropped.at === switches.current.count ? dropped.keys : NONE, drop, undrop };
};
