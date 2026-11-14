// The shown buffer follows a swipe (SR-211 AK3): it is moved by the distance swiped, and the buffer the swipe
// would switch to joins at its edge, from its layer beside the shown one (drawn in advance, SR-212 AK5, or drawn
// for the swipe, `swipe-draw.ts`). The modeline and the command prompt are outside the area and do not move.
// A swipe that ends at a third or less springs back in at most 200 ms with its pause (AK4); one past a third hands
// its offset to the switch in motion (`buffer-slide.ts`, `SlideSpec.progress`), which slides on from there. Display
// state only (ADR-0002 rule 3): no catalog command, no React; it writes only the layers' `transform` and
// `data-peek`.
import { shownLayer, slideEase } from "./buffer-slide.js";
import type { SwipeWay } from "./buffer-swipe.js";
import { MODIFIERS } from "./modifier-keys.js";

/** The id of the animations of a spring-back, by which tests find them. */
export const SPRING_ID = "buffer-spring";

/** The time of a spring-back from a third of the width; less from less (AK4: at most 200 ms with the pause). */
export const SPRING_MS = 120;

/** The time of a spring-back from `progress` of the width. */
export const springDuration = (progress: number): number =>
  Math.round(SPRING_MS * Math.min(1, Math.max(0, 3 * progress)));

/**
 * The `translateX` in px of the shown layer and of the joining one when the shown buffer is moved `shift` px of
 * `width` in `way`: Previous buffer (`back`) moves it right, the joining buffer comes from the left.
 */
export const dragOffsets = (
  way: SwipeWay,
  shift: number,
  width: number,
): { readonly shown: number; readonly joining: number } => {
  const sign = way === "back" ? 1 : -1;
  return { shown: sign * shift, joining: sign * (shift - width) };
};

const px = (value: number): string => `translateX(${String(value)}px)`;

/** The input that ends a drag at once, without a switch (as `buffer-slide.ts` ends a slide). */
export const ENDING = ["keydown", "pointerdown", "mousedown", "mouseup"] as const;

/** What a drag needs of the page. */
export interface DragHost {
  readonly view: Window;
  readonly root: () => ParentNode | null | undefined;
  /** A drag or its spring-back runs (`true`) or ended: the reads drawn in advance wait meanwhile. */
  readonly busy?: (busy: boolean) => void;
  /** Input came during the drag: it ends at once (`cancel`), and the input then acts as without it. */
  readonly input?: () => void;
}

interface Drag {
  readonly side: string;
  readonly from: string | undefined;
  readonly target: string;
  readonly way: SwipeWay;
  readonly width: number;
  readonly main: HTMLElement;
  joining: HTMLElement | undefined;
  /** The distance at which the target was drawn: the shift counts from it; none while it is not drawn. */
  baseline: number | undefined;
  distance: number;
  shift: number;
  spring: readonly Animation[] | undefined;
}

/** The drag of one window, one at a time. */
export class SwipeDrag {
  private drag: Drag | undefined;
  private readonly host: DragHost;
  private readonly onInput = (input: Event): void => {
    // A modifier pressed alone is no input that ends the drag (as for the gesture, `use-wheel-swipe.ts`).
    if (this.drag !== undefined && !(input instanceof KeyboardEvent && MODIFIERS.has(input.key))) {
      this.host.input?.();
    }
  };

  constructor(host: DragHost) {
    this.host = host;
  }

  /** A drag or its spring-back runs. */
  get active(): boolean {
    return this.drag !== undefined;
  }

  /** The buffer the drag would switch to, the buffer it moves and the area it is in. */
  get of():
    { readonly target: string; readonly from: string | undefined; readonly side: string } | undefined {
    const drag = this.drag;
    return drag === undefined ? undefined : { target: drag.target, from: drag.from, side: drag.side };
  }

  /** The shift as a part of the width, 0 until the target is drawn. */
  get progress(): number {
    const drag = this.drag;
    return drag === undefined || drag.width <= 0 ? 0 : drag.shift / drag.width;
  }

  /**
   * Starts a drag of the area `side`, which shows `from`, toward `target`; `drawn` when the target is drawn
   * already, else the shown buffer stands until `drawn()` (AK3).
   */
  start(side: string, from: string | undefined, target: string, way: SwipeWay, drawn: boolean): void {
    this.cancel();
    const area = this.host.root()?.querySelector<HTMLElement>(`[data-area="${side}"]`);
    const main = shownLayer(area);
    if (area === null || area === undefined || main === null) {
      return;
    }
    this.drag = {
      side,
      from,
      target,
      way,
      width: area.clientWidth,
      main,
      joining: undefined,
      baseline: drawn ? 0 : undefined,
      distance: 0,
      shift: 0,
      spring: undefined,
    };
    this.listen(true);
    this.place();
  }

  /** The target is drawn: from now on the shown buffer follows the distance swiped (AK3). */
  drawn(target: string): void {
    const drag = this.drag;
    if (drag?.target === target && drag.baseline === undefined && drag.spring === undefined) {
      drag.baseline = drag.distance;
      this.place();
    }
  }

  /** The swipe has gone `distance` px. */
  move(distance: number): void {
    const drag = this.drag;
    if (drag === undefined) {
      return;
    }
    this.stopSpring(drag);
    drag.distance = distance;
    this.place();
  }

  /** The swipe ended at a third or less: back to the start, then `done` (AK4). */
  springBack(done: () => void): void {
    const drag = this.drag;
    if (drag === undefined) {
      done();
      return;
    }
    if (drag.spring !== undefined) {
      return;
    }
    const duration = springDuration(this.progress);
    const joining = drag.joining;
    if (duration === 0 || typeof drag.main.animate !== "function") {
      this.cancel();
      done();
      return;
    }
    const at = dragOffsets(drag.way, drag.shift, drag.width);
    const home = dragOffsets(drag.way, 0, drag.width);
    const timing: KeyframeAnimationOptions = {
      id: SPRING_ID,
      duration,
      easing: slideEase(this.host.view),
      fill: "forwards",
    };
    const animations = [
      drag.main.animate([{ transform: px(at.shown) }, { transform: px(home.shown) }], timing),
      ...(joining === undefined
        ? []
        : [joining.animate([{ transform: px(at.joining) }, { transform: px(home.joining) }], timing)]),
    ];
    for (const animation of animations) {
      animation.id = SPRING_ID;
      animation.finished.catch(() => undefined);
    }
    drag.spring = animations;
    drag.shift = 0;
    animations[0]?.finished.then(
      () => {
        if (this.drag === drag) {
          this.cancel();
          done();
        }
      },
      () => undefined,
    );
  }

  /**
   * The swipe switches from where it stands: the layers lose what the drag gave them, in the task of the switch
   * (no frame is painted between), and the slide goes on from the returned part of the width.
   */
  handOff(): number {
    const progress = this.progress;
    this.cancel();
    return progress;
  }

  /** Ends the drag at once in place, without motion: nothing moved by it is left moved. */
  cancel(): void {
    const drag = this.drag;
    if (drag === undefined) {
      return;
    }
    this.drag = undefined;
    for (const animation of drag.spring ?? []) {
      animation.cancel();
    }
    drag.main.style.removeProperty("transform");
    drag.main.style.removeProperty("will-change");
    if (drag.joining !== undefined) {
      drag.joining.style.removeProperty("transform");
      drag.joining.style.removeProperty("will-change");
      drag.joining.removeAttribute("data-peek");
    }
    this.listen(false);
  }

  private stopSpring(drag: Drag): void {
    if (drag.spring === undefined) {
      return;
    }
    for (const animation of drag.spring) {
      animation.cancel();
    }
    drag.spring = undefined;
  }

  // The layer of the target, once it is in the page: a layer drawn for the swipe mounts after the draw began.
  private joiningOf(drag: Drag): HTMLElement | undefined {
    if (drag.joining?.isConnected === true) {
      return drag.joining;
    }
    const area = drag.main.parentElement;
    const found = [...(area?.querySelectorAll<HTMLElement>(':scope > [data-layer="neighbour"]') ?? [])].find(
      (layer) => layer.dataset["key"] === drag.target,
    );
    drag.joining = found;
    return found;
  }

  private place(): void {
    const drag = this.drag;
    if (drag?.baseline === undefined) {
      return;
    }
    const joining = this.joiningOf(drag);
    if (joining === undefined) {
      return;
    }
    drag.shift = Math.min(Math.max(drag.distance - drag.baseline, 0), drag.width);
    const { shown, joining: edge } = dragOffsets(drag.way, drag.shift, drag.width);
    // Each its own compositor layer while it follows, so a move repaints neither (a matrix at 50,000 would).
    drag.main.style.willChange = "transform";
    joining.style.willChange = "transform";
    drag.main.style.transform = px(shown);
    joining.style.transform = px(edge);
    joining.setAttribute("data-peek", "");
  }

  private listen(on: boolean): void {
    this.host.busy?.(on);
    for (const type of ENDING) {
      if (on) {
        this.host.view.addEventListener(type, this.onInput, { capture: true });
      } else {
        this.host.view.removeEventListener(type, this.onInput, { capture: true });
      }
    }
  }
}
