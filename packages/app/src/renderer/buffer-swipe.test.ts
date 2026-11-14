// The gesture of a swipe (SR-211, `buffer-swipe.ts`), driven by streams shaped as the measurement of a macOS
// trackpad on #1612 describes them. `replay` takes a recorded stream (time, deltas, modifiers), so the raw
// events of that measurement can be added as a fixture.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SwipeHost, SwipeTimers, SwipeWay } from "./buffer-swipe.js";
import {
  DECIDE_PX,
  GESTURE_GAP_MS,
  SEGMENT_GAP_MS,
  SwipeGesture,
  pastThird,
  swipeDistance,
  windowTimers,
} from "./buffer-swipe.js";

/** One recorded wheel event: its time in ms, deltas in px, and the modifiers held. */
export interface Recorded {
  readonly t: number;
  readonly dx: number;
  readonly dy?: number;
  readonly shift?: boolean;
  readonly ctrl?: boolean;
  readonly cancelable?: boolean;
}

const timers: SwipeTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

interface Options {
  readonly width?: number;
  readonly reduced?: boolean;
  readonly ignored?: (sign: -1 | 0 | 1) => boolean;
}

const setup = (options: Options = {}) => {
  const log: string[] = [];
  const host: SwipeHost = {
    ignored: vi.fn(options.ignored ?? (() => false)),
    width: () => options.width ?? 600,
    reduced: () => options.reduced ?? false,
    begin: (way: SwipeWay) => log.push(`begin ${way}`),
    switch: (way: SwipeWay) => log.push(`switch ${way}`),
    end: () => log.push("end"),
    scroll: (dy: number) => log.push(`scroll ${String(dy)}`),
  };
  const gesture = new SwipeGesture(host, timers);
  let clock = 0;
  const prevented: boolean[] = [];
  /** Sends `events` at their times, then lets `after` ms pass. */
  const replay = (events: readonly Recorded[], after = GESTURE_GAP_MS): void => {
    for (const event of events) {
      vi.advanceTimersByTime(Math.max(0, event.t - clock));
      clock = Math.max(clock, event.t);
      prevented.push(
        gesture.wheel({
          dx: event.dx,
          dy: event.dy ?? 0,
          modified: event.shift === true || event.ctrl === true,
          cancelable: event.cancelable ?? true,
          time: event.t,
        }),
      );
    }
    vi.advanceTimersByTime(after);
    clock += after;
  };
  return { host, gesture, log, prevented, replay, at: () => clock };
};

/** A swipe of `steps` events `gap` ms apart from `start`, each `dx` (and `dy`) px. */
const swipe = (start: number, steps: number, dx: number, dy = 0, gap = 8): Recorded[] =>
  Array.from({ length: steps }, (_, index) => ({ t: start + index * gap, dx, dy }));

/** A falling momentum tail of `steps` events from `from` px, 33 ms apart (as measured at its end). */
const momentum = (start: number, from: number, steps: number, sign = 1): Recorded[] =>
  Array.from({ length: steps }, (_, index) => ({
    t: start + index * 30,
    dx: sign * Math.max(1, Math.round(from * (1 - index / steps))),
  }));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SwipeGesture", () => {
  it("a slow swipe past a third switches once, at its end: dX > 0 is Next, dX < 0 Previous", () => {
    const next = setup();
    next.replay(swipe(0, 60, 5, 1));
    expect(next.log).toEqual(["begin forward", "switch forward", "end"]);
    expect(next.prevented.every(Boolean)).toBe(true);
    const back = setup();
    back.replay(swipe(0, 60, -5, -1));
    expect(back.log).toEqual(["begin back", "switch back", "end"]);
  });

  it("switches at the end of the segment, not before; exactly a third switches nothing", () => {
    const run = setup();
    run.replay(swipe(0, 41, 5), SEGMENT_GAP_MS - 1);
    expect(run.log).toEqual(["begin forward"]);
    vi.advanceTimersByTime(1);
    expect(run.log).toEqual(["begin forward", "switch forward", "end"]);
    const third = setup();
    third.replay(swipe(0, 40, 5));
    // 200 px of 600: not more than a third.
    expect(third.log).toEqual(["begin forward", "end"]);
    expect(pastThird(200, 600)).toBe(false);
    expect(pastThird(201, 600)).toBe(true);
  });

  it("a reversal takes the distance back, never past the start", () => {
    expect(swipeDistance(-50, "forward")).toBe(0);
    const run = setup();
    run.replay([...swipe(0, 30, 10), ...swipe(240, 20, -10)]);
    expect(run.log).toEqual(["begin forward", "end"]);
  });

  it("a fast swipe with momentum switches once; the momentum after the switch is prevented and inert", () => {
    const run = setup();
    run.replay([...swipe(0, 20, 40, 10), ...momentum(160, 9, 10), { t: 500, dx: 5, dy: 3 }]);
    expect(run.log).toEqual(["begin forward", "switch forward", "end"]);
    expect(run.prevented.every(Boolean)).toBe(true);
  });

  it("the swipe's own momentum after a pause, diagonal and 3-9 px, neither begins nor scrolls (AK7)", () => {
    const run = setup();
    const tail = [9, 8, 7, 7, 6, 5, 5, 4, 4, 3, 3, 3].map((dx, index) => ({
      t: 200 + index * 30,
      dx,
      dy: dx / 2,
    }));
    run.replay([...swipe(0, 20, 20), ...tail]);
    expect(run.log).toEqual(["begin forward", "switch forward", "end"]);
    expect(run.prevented.every(Boolean)).toBe(true);
  });

  it("two quick swipes switch twice: the second rises again from 1 px in the first one's momentum", () => {
    const run = setup();
    const second = [1, 2, 4, 7, 11, 16, 22, 30, 30, 30, 30, 30, 30, 30].map((dx, index) => ({
      t: 330 + index * 8,
      dx,
    }));
    run.replay([...swipe(0, 20, 20), ...momentum(160, 9, 4), ...second]);
    expect(run.log).toEqual([
      "begin forward",
      "switch forward",
      "end",
      "begin forward",
      "switch forward",
      "end",
    ]);
  });

  it("a wheel notch repeating after a switch stays spent; notches below the third add up", () => {
    const run = setup({ width: 300 });
    const notches = (start: number, count: number): Recorded[] =>
      Array.from({ length: count }, (_, index) => ({ t: start + index * 60, dx: 40 }));
    run.replay(notches(0, 6));
    expect(run.log).toEqual([
      "begin forward",
      "end",
      "begin forward",
      "end",
      "begin forward",
      "switch forward",
      "end",
    ]);
  });

  it("a swipe that starts more vertical than horizontal only scrolls, also when it turns horizontal (AK6)", () => {
    const run = setup();
    run.replay([{ t: 0, dx: 1, dy: 3 }, { t: 8, dx: 1, dy: 4 }, ...swipe(16, 60, 10)]);
    expect(run.log).toEqual(["scroll 3"]);
    // Held back until it decides, then left to the browser.
    expect(run.prevented.slice(0, 2)).toEqual([true, false]);
    expect(run.prevented.slice(2).some(Boolean)).toBe(false);
  });

  it("a vertical wheel notch decides at once and is not prevented", () => {
    const run = setup();
    run.replay([{ t: 0, dx: 0, dy: 100 }]);
    expect(run.prevented).toEqual([false]);
    expect(run.log).toEqual([]);
  });

  it("a diagonal swipe up to 56 % vertical is a swipe; more than 2/3 is vertical", () => {
    const diagonal = setup();
    diagonal.replay(swipe(0, 30, 10, 5.6));
    expect(diagonal.log).toEqual(["begin forward", "switch forward", "end"]);
    const steep = setup();
    steep.replay(swipe(0, 30, 10, 7));
    expect(steep.log).toEqual([]);
  });

  it("holds back less than the decision, and scrolls it when the segment ends undecided", () => {
    const run = setup();
    run.replay([{ t: 0, dx: 1, dy: 2 }]);
    expect(DECIDE_PX).toBeGreaterThan(3);
    expect(run.log).toEqual(["scroll 2"]);
  });

  it("Shift, Ctrl, Meta or Alt: not read at all (AK10, a pinch)", () => {
    const run = setup();
    run.replay(swipe(0, 60, 10).map((event) => ({ ...event, shift: true })));
    run.replay(swipe(1000, 60, 10).map((event) => ({ ...event, ctrl: true })));
    expect(run.log).toEqual([]);
    expect(run.prevented.some(Boolean)).toBe(false);
    expect(run.host.ignored).not.toHaveBeenCalled();
  });

  it("a gesture the window ignores is never prevented, until its pause ends it", () => {
    const run = setup({ ignored: () => true });
    run.replay(swipe(0, 60, 10), GESTURE_GAP_MS - 1);
    expect(run.log).toEqual([]);
    expect(run.prevented.some(Boolean)).toBe(false);
    expect(run.host.ignored).toHaveBeenCalledTimes(1);
  });

  it("a first event that cannot be prevented ignores the gesture", () => {
    const run = setup();
    run.replay(swipe(0, 60, 10).map((event, index) => ({ ...event, cancelable: index > 0 })));
    expect(run.log).toEqual([]);
  });

  it("asks the window again with the direction once dX is not 0: content that scrolls first (AK5)", () => {
    const run = setup({ ignored: (sign) => sign === 1 });
    run.replay([{ t: 0, dx: 0, dy: 1 }, ...swipe(8, 60, 10)]);
    expect(run.host.ignored).toHaveBeenNthCalledWith(1, 0);
    expect(run.host.ignored).toHaveBeenNthCalledWith(2, 1);
    // Only the vertical px held back before the gesture was ignored are scrolled.
    expect(run.log).toEqual(["scroll 1"]);
  });

  it("the ignored state holds for the gesture: its momentum after the edge does not switch", () => {
    let calls = 0;
    const run = setup({ ignored: () => calls++ === 0 });
    run.replay([...swipe(0, 30, 20), ...momentum(270, 9, 5)]);
    expect(run.log).toEqual([]);
  });

  it("without motion it switches as soon as the distance passes a third, and below it does nothing (AK13)", () => {
    const run = setup({ reduced: true });
    run.replay(swipe(0, 21, 10), 0);
    expect(run.log).toEqual(["begin forward", "switch forward", "end"]);
    run.replay(swipe(170, 30, 10));
    expect(run.log).toEqual(["begin forward", "switch forward", "end"]);
    const short = setup({ reduced: true });
    short.replay(swipe(0, 20, 10));
    expect(short.log).toEqual(["begin forward", "end"]);
  });

  it("joins a segment its timer ended late: the next event came less than 35 ms after the last", () => {
    const run = setup({ width: 900 });
    run.replay(swipe(0, 30, 6), SEGMENT_GAP_MS);
    expect(run.log).toEqual(["begin forward", "end"]);
    // The events were held by a busy main thread: their times lie close to the last one.
    const late = run.at();
    run.gesture.wheel({ dx: 200, dy: 0, modified: false, cancelable: true, time: 29 * 8 + 10 });
    vi.advanceTimersByTime(SEGMENT_GAP_MS);
    expect(late).toBeGreaterThan(0);
    expect(run.log).toEqual(["begin forward", "end", "begin forward", "switch forward", "end"]);
  });

  it("dispose ends a swipe in progress and stops its timers", () => {
    const run = setup();
    run.replay(swipe(0, 5, 10), 0);
    run.gesture.dispose();
    vi.advanceTimersByTime(GESTURE_GAP_MS);
    expect(run.log).toEqual(["begin forward", "end"]);
    const idle = setup();
    idle.gesture.dispose();
    expect(idle.log).toEqual([]);
  });

  it("the window's timers are looked up at each call", () => {
    const view = { setTimeout: vi.fn(() => 7), clearTimeout: vi.fn() };
    const own = windowTimers(view as unknown as Window);
    const run = vi.fn();
    expect(own.set(run, 5)).toBe(7);
    own.clear(7);
    expect(view.setTimeout).toHaveBeenCalledWith(run, 5);
    expect(view.clearTimeout).toHaveBeenCalledWith(7);
  });
});
