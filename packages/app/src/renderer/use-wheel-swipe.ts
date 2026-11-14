// The window's side of the swipe (SR-211, `buffer-swipe.ts`): one wheel listener on the sheet, not passive, so a
// swipe's events can be prevented. It answers the gesture's questions from the DOM: the pointer over the shown
// layer of the active area (AK9), content there that scrolls sideways first (AK5), the width of that area, and
// "Bewegung reduzieren" (AK13). What the window's state allows and what a switch does come from `App.tsx`.
import { useEffect, useRef, useState } from "react";
import { motionAllowed, shownLayer } from "./buffer-slide.js";
import type { SwipeHost, SwipeWay } from "./buffer-swipe.js";
import { SwipeGesture, windowTimers } from "./buffer-swipe.js";
import { scrollsFirst, verticalScroller, wheelPixels } from "./swipe-target.js";

export interface WheelSwipeOptions {
  /** A swipe switches nothing now: the window's state (AK11), no workspace, or no other buffer (AK8). */
  readonly blocked: () => boolean;
  /** The wheel event `event` closed a context menu (AK11). */
  readonly closedMenu: (event: WheelEvent) => boolean;
  readonly begin: (way: SwipeWay) => void;
  /** The swipe has gone `distance` px in `way`: the shown buffer follows it (AK3). */
  readonly move: (way: SwipeWay, distance: number) => void;
  /** The swipe switches at once, without motion (AK13). */
  readonly switch: (way: SwipeWay) => void;
  /** The swipe ended after `distance` px of `width`: true when the window switched (AK1, AK2, AK4). */
  readonly release: (way: SwipeWay, distance: number, width: number) => boolean;
  readonly end: () => void;
}

/** What the window may do to the swipe of the wheel. */
export interface WheelSwipe {
  /** Ends the swipe now without a switch by it: the rest of the gesture does nothing (SR-211 AK12). */
  readonly abort: () => void;
}

const activeArea = (sheet: HTMLElement | null): HTMLElement | null =>
  sheet?.querySelector<HTMLElement>("[data-area][data-active]") ?? null;

/** The element under `point` in the shown layer of `area`, if the pointer is over that area at all. */
const under = (area: HTMLElement, point: { readonly x: number; readonly y: number }): Element | undefined => {
  const main = shownLayer(area);
  const at = area.ownerDocument.elementsFromPoint(point.x, point.y);
  return main === null ? undefined : at.find((element) => main.contains(element));
};

/** Reads the wheel events over `sheet` as swipes. */
export const useWheelSwipe = (
  sheet: React.RefObject<HTMLElement | null>,
  options: WheelSwipeOptions,
): WheelSwipe => {
  const latest = useRef(options);
  latest.current = options;
  const current = useRef<SwipeGesture | undefined>(undefined);
  const [control] = useState<WheelSwipe>(() => ({
    abort: () => {
      current.current?.abort();
    },
  }));
  useEffect(() => {
    const root = sheet.current;
    if (root === null) {
      return undefined;
    }
    const view = root.ownerDocument.defaultView ?? window;
    let event: WheelEvent | undefined;
    const point = (): { readonly x: number; readonly y: number } => ({
      x: event?.clientX ?? 0,
      y: event?.clientY ?? 0,
    });
    const host: SwipeHost = {
      ignored: (sign) => {
        const area = activeArea(root);
        const now = event;
        if (area === null || now === undefined || now.buttons > 0 || latest.current.blocked()) {
          return true;
        }
        if (latest.current.closedMenu(now)) {
          return true;
        }
        // Over the active area: the inactive one, the modeline and the command prompt switch nothing (AK9).
        const box = area.getBoundingClientRect();
        const { x, y } = point();
        if (x < box.left || x >= box.right || y < box.top || y >= box.bottom) {
          return true;
        }
        const target = under(area, point());
        const main = shownLayer(area);
        return sign !== 0 && target !== undefined && main !== null && scrollsFirst(target, main, sign);
      },
      width: () => activeArea(root)?.clientWidth ?? 0,
      reduced: () => !motionAllowed(view),
      begin: (way) => {
        latest.current.begin(way);
      },
      move: (way, distance) => {
        latest.current.move(way, distance);
      },
      switch: (way) => {
        if (!latest.current.blocked()) {
          latest.current.switch(way);
        }
      },
      release: (way, distance) =>
        !latest.current.blocked() &&
        latest.current.release(way, distance, activeArea(root)?.clientWidth ?? 0),
      end: () => {
        latest.current.end();
      },
      scroll: (dy) => {
        const area = activeArea(root);
        const main = shownLayer(area);
        const target = area === null ? undefined : under(area, point());
        if (target !== undefined && main !== null) {
          verticalScroller(target, main)?.scrollBy({ top: dy });
        }
      },
    };
    const gesture = new SwipeGesture(host, windowTimers(view));
    current.current = gesture;
    const onWheel = (wheel: WheelEvent): void => {
      event = wheel;
      const { dx, dy } = wheelPixels(wheel, activeArea(root)?.clientWidth ?? 0);
      const prevent = gesture.wheel({
        dx,
        dy,
        modified: wheel.shiftKey || wheel.ctrlKey || wheel.metaKey || wheel.altKey,
        cancelable: wheel.cancelable,
        time: wheel.timeStamp,
      });
      if (prevent) {
        wheel.preventDefault();
      }
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      root.removeEventListener("wheel", onWheel);
      gesture.dispose();
      current.current = undefined;
    };
  }, [sheet]);
  return control;
};
