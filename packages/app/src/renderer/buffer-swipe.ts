// A horizontal swipe with two fingers on the trackpad, or the horizontal mouse wheel, switches to the previous or
// next buffer as Alt+P and Alt+N do (SR-211). The app sees only wheel events, so this reads them: pure state over
// the deltas and two pauses, with no DOM (ADR-0002 rule 3: no catalog command). The window (`App.tsx`) says what
// is under the pointer (`SwipeHost.ignored`) and does the switch.
//
// The numbers come from a measurement of a macOS trackpad (#1612): between the events of one swipe the gaps are
// under 35 ms but in its momentum; a gap of 35 ms or more lies only in the momentum, and after it come at most
// 5 px; two quick swipes are 42-83 ms apart, the second starting again from 1 px while the first one's momentum
// still falls; diagonal swipes reach |dY| = 56 % of |dX|; a pinch sends `ctrlKey`.
//
// - A *gesture* ends after a pause of `GESTURE_GAP_MS`; a *segment* of it after `SEGMENT_GAP_MS`. A segment
//   ended by its timer is joined again when its next event came less than `SEGMENT_GAP_MS` after the last one
//   (the timer fired late, the main thread was busy), or, below the third, when it goes on in its direction
//   with a step of a wheel notch.
// - An event with Shift, Ctrl, Meta or Alt held is not read at all (AK10: Shift+wheel only scrolls).
// - The first event of a gesture asks the window whether it switches nothing (`ignored`): then nothing of the
//   gesture is prevented or counted. The window asks again with the direction once dX is not 0 (AK5).
// - Until a segment decides, its events are prevented: Chromium may send the rest of a scroll sequence without
//   `cancelable` once its first event scrolled. Once `|ΣdX| + |ΣdY|` reaches `DECIDE_PX` it is vertical, when
//   `|ΣdX| <= VERTICAL_RATIO * |ΣdY|`, for the rest of the gesture (AK6): the held-back distance is scrolled by
//   the window; or it is the swipe, in the direction of ΣdX, and its events stay prevented.
// - The swipe switches when its distance passes a third of the width of its area (AK1, AK2, AK9), at its end,
//   or at once without motion (AK13). Then the gesture is spent (AK7): its rest, momentum included, is
//   prevented and does nothing; only a segment that starts like a new swipe (a small first step, then rising)
//   is a new swipe, and one clearly vertical scrolls again.

/** A gesture ends after this pause. */
export const GESTURE_GAP_MS = 150;
/** A segment of a gesture ends after this pause: no gap inside a swipe is as long, but in its momentum. */
export const SEGMENT_GAP_MS = 35;
/** The distance after which a segment is vertical or the swipe. */
export const DECIDE_PX = 8;
/** The distance after which a segment of a spent gesture is a new swipe, vertical, or more of the old one. */
export const SPENT_DECIDE_PX = 25;
/** A segment is vertical when its horizontal distance is at most this many times its vertical one. */
export const VERTICAL_RATIO = 1.5;
/** A step this large is a notch of a horizontal mouse wheel, not the start of a swipe on a trackpad. */
export const NOTCH_PX = 20;
/** A segment after a switch is a new swipe only once a step reaches this: the momentum after a pause is smaller. */
export const RISE_PX = 12;

/** The way of the switch: `back` is Previous buffer (content pushed right, dX < 0), `forward` Next buffer. */
export type SwipeWay = "back" | "forward";

/** One wheel event, in px. */
export interface WheelStep {
  readonly dx: number;
  readonly dy: number;
  /** Shift, Ctrl, Meta or Alt is held. */
  readonly modified: boolean;
  readonly cancelable: boolean;
  /** `Event.timeStamp`, in ms. */
  readonly time: number;
}

/** What the window does for a swipe. */
export interface SwipeHost {
  /**
   * Whether the gesture switches nothing: the window's state, the pointer, no other buffer (AK8, AK9, AK11),
   * and for `sign` -1 or 1 content under the pointer that scrolls that way first (AK5).
   */
  readonly ignored: (sign: -1 | 0 | 1) => boolean;
  /** The width of the area the swipe is over. */
  readonly width: () => number;
  /** "Bewegung reduzieren" is set. */
  readonly reduced: () => boolean;
  /** A segment is the swipe in `way`: a running slide ends (SR-212 AK2), the target is drawn (SR-211 AK3). */
  readonly begin: (way: SwipeWay) => void;
  /** The swipe switches. */
  readonly switch: (way: SwipeWay) => void;
  /** The swipe's segment ended, with or after its switch. */
  readonly end: () => void;
  /** Scrolls what a vertical segment held back. */
  readonly scroll: (dy: number) => void;
}

/** The timers of the window, looked up at each call so a test clock controls them. */
export interface SwipeTimers {
  readonly set: (run: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

export const windowTimers = (view: Window): SwipeTimers => ({
  set: (run, ms) => view.setTimeout(run, ms),
  clear: (handle) => {
    view.clearTimeout(handle as number);
  },
});

type Mode =
  /** Not yet vertical or the swipe. */
  | "open"
  | "swipe"
  /** The swipe that switched. */
  | "spent"
  /** A segment of a spent gesture, not yet decided. */
  | "after";

interface Segment {
  mode: Mode;
  sx: number;
  sy: number;
  /** The vertical distance held back while open. */
  held: number;
  way: SwipeWay | undefined;
  /** The first and the largest |dX| of the segment, and the last one. */
  first: number;
  top: number;
  last: number;
  time: number;
}

interface Gesture {
  ignored: boolean;
  /** The window was asked with a direction. */
  sided: boolean;
  vertical: boolean;
  spent: boolean;
  /** The last |dX| of the swipe that switched. */
  tail: number;
}

const signOf = (value: number): -1 | 0 | 1 => (value < 0 ? -1 : value > 0 ? 1 : 0);
const wayOf = (dx: number): SwipeWay => (dx < 0 ? "back" : "forward");
const sideOf = (way: SwipeWay): number => (way === "back" ? -1 : 1);
const vertical = (sx: number, sy: number): boolean => Math.abs(sx) <= VERTICAL_RATIO * Math.abs(sy);

/** The distance a segment went in its way. */
export const swipeDistance = (sx: number, way: SwipeWay): number => Math.max(0, sideOf(way) * sx);

/** Whether `distance` passes a third of `width` (AK1: "mehr als ein Drittel"). */
export const pastThird = (distance: number, width: number): boolean => distance * 3 > width;

/** The gesture of one window: `wheel` for each event, which says whether to prevent it. */
export class SwipeGesture {
  private readonly host: SwipeHost;
  private readonly timers: SwipeTimers;
  private gesture: Gesture | undefined;
  private segment: Segment | undefined;
  // The swipe the timer ended below the third, and its way, which the next event may join again.
  private ended: { readonly segment: Segment; readonly way: SwipeWay } | undefined;
  private segmentTimer: unknown;
  private gestureTimer: unknown;

  constructor(host: SwipeHost, timers: SwipeTimers) {
    this.host = host;
    this.timers = timers;
  }

  /** Reads one wheel event: true when it is to be prevented. */
  wheel(step: WheelStep): boolean {
    if (step.modified) {
      return false;
    }
    this.restart();
    let gesture = this.gesture;
    if (gesture === undefined) {
      const sign = signOf(step.dx);
      gesture = {
        ignored: !step.cancelable || this.host.ignored(sign),
        sided: sign !== 0,
        vertical: false,
        spent: false,
        tail: 0,
      };
      this.gesture = gesture;
    } else if (!gesture.ignored && !gesture.sided && step.dx !== 0) {
      gesture.sided = true;
      gesture.ignored = this.host.ignored(signOf(step.dx));
    }
    if (gesture.ignored || gesture.vertical) {
      return false;
    }
    const segment = this.segmentFor(step, gesture);
    segment.sx += step.dx;
    segment.sy += step.dy;
    const size = Math.abs(step.dx);
    segment.top = Math.max(segment.top, size);
    segment.last = size;
    segment.time = step.time;
    switch (segment.mode) {
      case "open":
        return this.decide(segment, gesture, step, DECIDE_PX);
      case "after":
        return this.decide(segment, gesture, step, SPENT_DECIDE_PX);
      case "swipe":
        this.reducedSwitch(segment, gesture);
        return true;
      case "spent":
        return true;
    }
  }

  /** Stops the timers: the window goes. */
  dispose(): void {
    this.timers.clear(this.segmentTimer);
    this.timers.clear(this.gestureTimer);
    if (this.segment?.mode === "swipe") {
      this.host.end();
    }
    this.gesture = undefined;
    this.segment = undefined;
    this.ended = undefined;
  }

  private restart(): void {
    this.timers.clear(this.segmentTimer);
    this.timers.clear(this.gestureTimer);
    this.segmentTimer = this.timers.set(() => {
      this.endSegment();
    }, SEGMENT_GAP_MS);
    this.gestureTimer = this.timers.set(() => {
      this.endSegment();
      this.gesture = undefined;
      this.ended = undefined;
    }, GESTURE_GAP_MS);
  }

  private segmentFor(step: WheelStep, gesture: Gesture): Segment {
    if (this.segment !== undefined) {
      return this.segment;
    }
    const ended = this.ended;
    this.ended = undefined;
    if (ended !== undefined && this.joins(ended.segment, ended.way, step)) {
      this.segment = ended.segment;
      this.host.begin(ended.way);
      return ended.segment;
    }
    const segment: Segment = {
      mode: gesture.spent ? "after" : "open",
      sx: 0,
      sy: 0,
      held: 0,
      way: undefined,
      first: Math.abs(step.dx),
      top: 0,
      last: 0,
      time: step.time,
    };
    this.segment = segment;
    return segment;
  }

  private joins(ended: Segment, way: SwipeWay, step: WheelStep): boolean {
    return (
      step.time - ended.time < SEGMENT_GAP_MS || (Math.abs(step.dx) >= NOTCH_PX && wayOf(step.dx) === way)
    );
  }

  private decide(segment: Segment, gesture: Gesture, step: WheelStep, after: number): boolean {
    if (Math.abs(segment.sx) + Math.abs(segment.sy) < after) {
      segment.held += step.dy;
      return true;
    }
    if (vertical(segment.sx, segment.sy)) {
      gesture.vertical = true;
      gesture.spent = false;
      // This event scrolls itself; what was held back before it is scrolled by the window.
      if (segment.held !== 0) {
        this.host.scroll(segment.held);
      }
      this.segment = undefined;
      return false;
    }
    if (segment.mode === "after" && !this.startsAgain(segment, gesture)) {
      // Still the momentum of the swipe that switched, until it rises as a new swipe does.
      return true;
    }
    gesture.spent = false;
    segment.mode = "swipe";
    segment.way = wayOf(segment.sx);
    this.host.begin(segment.way);
    this.reducedSwitch(segment, gesture);
    return true;
  }

  // A segment after a switch is a new swipe when it starts as a swipe on a trackpad starts, with a small step,
  // and then rises to twice its first step, to `RISE_PX` and past the last step of the swipe that switched:
  // momentum only falls (its steps after a pause were 3-9 px), and a notch of a wheel that repeats starts large.
  private startsAgain(segment: Segment, gesture: Gesture): boolean {
    return (
      segment.first < NOTCH_PX &&
      segment.top >= 2 * segment.first &&
      segment.top >= RISE_PX &&
      segment.top > gesture.tail
    );
  }

  private reducedSwitch(segment: Segment, gesture: Gesture): void {
    const way = this.passed(segment);
    if (way !== undefined && this.host.reduced()) {
      this.switchNow(segment, gesture, way);
    }
  }

  /** The way of `segment` once its distance passed a third of the width. */
  private passed(segment: Segment): SwipeWay | undefined {
    const way = segment.way;
    return way !== undefined && pastThird(swipeDistance(segment.sx, way), this.host.width())
      ? way
      : undefined;
  }

  private switchNow(segment: Segment, gesture: Gesture, way: SwipeWay): void {
    segment.mode = "spent";
    gesture.spent = true;
    gesture.tail = segment.last;
    this.host.switch(way);
    this.host.end();
  }

  private endSegment(): void {
    const segment = this.segment;
    this.segment = undefined;
    if (segment === undefined) {
      return;
    }
    if (segment.mode === "open" && segment.held !== 0 && this.gesture?.spent !== true) {
      this.host.scroll(segment.held);
      segment.held = 0;
    }
    if (segment.mode !== "swipe" || segment.way === undefined) {
      return;
    }
    const gesture = this.gesture;
    const way = this.passed(segment);
    if (gesture !== undefined && way !== undefined) {
      this.switchNow(segment, gesture, way);
      return;
    }
    this.host.end();
    this.ended = { segment, way: segment.way };
  }
}
