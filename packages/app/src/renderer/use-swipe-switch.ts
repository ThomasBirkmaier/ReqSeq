// The swipe of the window (`App.tsx`, SR-163 AK4, SR-211): the buffer a swipe draws and its drag, the
// swipe macOS reports, the swipe of the wheel, and the layout effects that end a drag or a hold. `App` calls
// `useSwipeObjects` and `useSwipeSwitch` where their code stood, so the effects keep their order.
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { ReqSeqBridge } from "../shared/protocol.js";
import type { ActionContext, Prompt } from "./action-types.js";
import { mouseButtonAction, runAction, swipeAction } from "./actions.js";
import type { ReadGate } from "./area-slot.js";
import { cycleKey } from "./buffer-cycle.js";
import type { SlideController } from "./buffer-slide.js";
import { motionAllowed } from "./buffer-slide.js";
import type { SwipeWay } from "./buffer-swipe.js";
import { pastThird } from "./buffer-swipe.js";
import { bufferSwitchBlocked } from "./buffer-switch.js";
import { SwipeDrag } from "./swipe-drag.js";
import { SwipeDraw } from "./swipe-draw.js";
import type { SwipeHold } from "./swipe-hold.js";
import { holdWhenShown } from "./swipe-hold.js";
import type { ContextMenu } from "./use-context-menu.js";
import type { Prefix } from "./use-prefix.js";
import { useWheelSwipe } from "./use-wheel-swipe.js";
import type { Layout } from "./window-layout.js";

type Setter<T> = Dispatch<SetStateAction<T>>;

/** The buffer a swipe draws, its drag, and the part of the width a released swipe went. */
export interface SwipeObjects {
  readonly swipe: SwipeDraw;
  readonly swiped: string | undefined;
  readonly endSwipe: RefObject<() => void>;
  readonly drag: SwipeDrag;
  readonly releasedAt: RefObject<number | undefined>;
}

export const useSwipeObjects = (
  sheet: RefObject<HTMLElement | null>,
  gate: ReadGate,
  release: (key: string | undefined) => void,
): SwipeObjects => {
  // The buffer a swipe draws (SR-211 AK3, `swipe-draw.ts`): beside the shown one, read as a shown buffer.
  const [swipe] = useState(() => new SwipeDraw());
  const swiped = useSyncExternalStore(swipe.subscribe, () => swipe.key);
  // The shown buffer follows the swipe, the target at its edge (SR-211 AK3, AK4, `swipe-drag.ts`). Input during
  // the drag ends it at once without a switch, and the swipe with it (`endSwipe`, AK12).
  const endSwipe = useRef<() => void>(() => undefined);
  const [drag] = useState(
    () =>
      new SwipeDrag({
        view: window,
        root: () => sheet.current,
        busy: (busy) => {
          gate.drag(busy);
        },
        input: () => {
          endSwipe.current();
        },
        // A new swipe ended the drag before it, also its spring-back, whose end then calls nothing back.
        cancelled: (target) => {
          release(target);
        },
      }),
  );
  // The part of the width a released swipe went, for the switch it makes (`cycled`, SR-211 AK1, AK2).
  const releasedAt = useRef<number | undefined>(undefined);
  return { swipe, swiped, endSwipe, drag, releasedAt };
};

/** What the swipes take of the window. */
export interface SwitchParts extends SwipeObjects {
  readonly bridge: ReqSeqBridge;
  readonly slides: SlideController;
  readonly latest: RefObject<ActionContext>;
  readonly switchingNow: RefObject<boolean>;
  readonly openPrompt: RefObject<Prompt | undefined>;
  readonly contextMenu: ContextMenu;
  readonly aboutOpen: RefObject<boolean>;
  readonly prefix: Prefix;
  readonly sheet: RefObject<HTMLElement | null>;
  readonly layout: Layout;
  readonly release: (key: string | undefined) => void;
  readonly revisionNow: RefObject<number>;
  readonly hold: SwipeHold | undefined;
  readonly setHold: Setter<SwipeHold | undefined>;
  readonly shownKey: string | undefined;
}

export const useSwipeSwitch = (parts: SwitchParts): void => {
  const { swipe, swiped, endSwipe, drag, releasedAt, bridge, slides, latest, switchingNow, openPrompt } =
    parts;
  const { contextMenu, aboutOpen, prefix, sheet, layout, release, revisionNow, hold, setHold } = parts;
  const { shownKey } = parts;
  // A swipe to the left or right that macOS reports to the window, as older mouse software sends the buttons
  // Back and Forward (SR-163 AK4): what the mouse button does, read from refs as `onMouse` does. It ends a
  // running slide first, as a key does (SR-212 AK2), also when it then switches nothing; it switches nothing
  // in the states of `bufferSwitchBlocked` and closes none of them; a waiting prefix key ends, as a press of a
  // mouse button ends it. It does not ask the swipe of the wheel (`useWheelSwipe` below), so it switches also
  // while a wheel still coasts.
  const prefixCardShown = prefix.cardShown;
  const cancelPrefix = prefix.cancel;
  useEffect(
    () =>
      bridge.on("swipe", ({ direction }) => {
        slides.interrupt();
        endSwipe.current();
        const now = latest.current;
        const blocked = bufferSwitchBlocked(
          {
            switching: switchingNow.current,
            prompting: openPrompt.current !== undefined,
            contextMenu: contextMenu.isOpen(),
            about: aboutOpen.current,
            nextKeys: prefixCardShown(),
          },
          document,
        );
        if (blocked || !now.workspace) {
          return;
        }
        cancelPrefix();
        const action = swipeAction(now, direction);
        if (action !== undefined) {
          runAction(action, now);
        }
      }),
    [bridge, slides, contextMenu.isOpen, prefixCardShown, cancelPrefix],
  );
  // A horizontal swipe on the trackpad, or the horizontal mouse wheel, switches as Alt+P and Alt+N do (SR-211,
  // `buffer-swipe.ts`): not in the states of `bufferSwitchBlocked`, without a workspace or without another
  // buffer. A swipe ends a running slide once it is a swipe (SR-212 AK2) and draws the buffer it would switch
  // to (SR-211 AK3, `swipe-draw.ts`), unless the other area shows it or nothing moves. The switch and the end
  // of the draw go into one commit, so the drawn layer becomes the shown one without being drawn again.
  const otherNow = useRef(layout.other);
  otherNow.current = layout.other;
  // The switch of a swipe, with the part of the width it went (a slide on from there), or none (AK13).
  const swipeSwitch = (way: SwipeWay, progress: number | undefined): void => {
    const now = latest.current;
    const action = mouseButtonAction(now, way === "back" ? 3 : 4);
    cancelPrefix();
    releasedAt.current = progress;
    const target = drag.of?.target;
    try {
      flushSync(() => {
        drag.handOff();
        if (action !== undefined) {
          runAction(action, now);
        }
        swipe.end();
      });
    } finally {
      releasedAt.current = undefined;
    }
    // The hold ends with the slide of the switch (`ended`); a switch that took no slide ends it now.
    if (!slides.busy) {
      release(target);
    }
  };
  const wheelSwipe = useWheelSwipe(sheet, {
    blocked: () => {
      const now = latest.current;
      return (
        !now.workspace ||
        mouseButtonAction(now, 3) === undefined ||
        bufferSwitchBlocked(
          {
            switching: switchingNow.current,
            prompting: openPrompt.current !== undefined,
            contextMenu: contextMenu.isOpen(),
            about: aboutOpen.current,
            nextKeys: prefixCardShown(),
          },
          document,
        )
      );
    },
    closedMenu: contextMenu.closedBy,
    begin: (way: SwipeWay) => {
      slides.interrupt();
      const now = latest.current;
      const target = cycleKey(now.cycleOrder, now.buffers[0]?.key, way === "back" ? 1 : -1);
      if (target === undefined || target === otherNow.current || !motionAllowed(window)) {
        return;
      }
      // A swipe that joins its segment again after a pause takes up its drag where it stands.
      if (drag.of?.target !== target || drag.of.side !== layout.active) {
        drag.start(
          layout.active,
          now.buffers[0]?.key,
          target,
          way,
          slides.drawnAt(target, revisionNow.current),
        );
      }
      const side = layout.active;
      void swipe.draw(target).then((drawn) => {
        if (drawn) {
          drag.drawn(target);
          if (drag.of?.target === target) {
            setHold({ side, key: target });
          }
        }
      });
    },
    move: (_way: SwipeWay, distance: number) => {
      drag.move(distance);
    },
    switch: (way: SwipeWay) => {
      swipeSwitch(way, undefined);
    },
    // Past a third the window switches from where the drag stands; a swipe that moved nothing (its target not
    // drawn yet) switches nothing. Without a drag (the other area shows the target) it switches past a third.
    release: (way: SwipeWay, distance: number, width: number) => {
      const progress = drag.active ? drag.progress : undefined;
      if (progress === undefined ? !pastThird(distance, width) : progress * 3 <= 1) {
        return false;
      }
      swipeSwitch(way, progress);
      return true;
    },
    // Not switched: the shown buffer springs back, and the draw ends after it (AK4).
    end: () => {
      const target = drag.of?.target;
      drag.springBack(() => {
        swipe.end();
        release(target);
      });
    },
  });
  endSwipe.current = () => {
    wheelSwipe.abort();
    if (drag.active) {
      const target = drag.of?.target;
      drag.cancel();
      swipe.end();
      release(target);
    }
  };
  // Another buffer shown in the area, another area active, or the target's draw ended (closed, or no longer
  // beside the shown one): the drag ends at once, without a switch, and the rest of the swipe does nothing
  // (SR-211 AK12). Before the paint, so no frame shows the old buffer moved.
  useLayoutEffect(() => {
    const of = drag.of;
    if (of !== undefined && (of.side !== layout.active || of.from !== shownKey || swiped !== of.target)) {
      endSwipe.current();
    }
  }, [drag, layout.active, shownKey, swiped]);
  // A held target shown while no drag or slide moves toward it (Ctrl+P, a click, a switch without motion) is held
  // no longer, so it reads as every shown buffer (SR-212 AK5). After the slide's own layout effect (`useSlides`),
  // so the slide of a swipe's switch counts as moving.
  useLayoutEffect(() => {
    setHold((now) =>
      holdWhenShown(now, layout.active, shownKey, slides.busy || drag.of?.target === shownKey),
    );
  }, [slides, drag, layout.active, shownKey, hold]);
};
