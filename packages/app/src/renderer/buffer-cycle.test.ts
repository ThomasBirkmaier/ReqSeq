import { describe, expect, it } from "vitest";
import type { BufferAction, Buffers } from "./buffers.js";
import { elementBuffer, listBuffer, overviewBuffer, reduceBuffers, searchBuffer } from "./buffers.js";
import type { Walk } from "./buffer-cycle.js";
import { NO_WALK, cycleKey, cycleOrder } from "./buffer-cycle.js";

const overview = overviewBuffer();
const list = listBuffer("All elements");
const element = elementBuffer("u1", "spec", "SR-001 One");
const other = elementBuffer("u2", "spec", "SR-002 Two");
const search = searchBuffer("wind");

/** A step: a buffer action, or Alt+P (1) or Alt+N (-1) as the app runs them. */
type Step = BufferAction | 1 | -1;

/** The buffers and the order to walk after each step, as App keeps them. */
const run = (...steps: readonly Step[]): { shown: string | undefined; order: readonly string[] } => {
  let buffers: Buffers = [];
  let walk: Walk = NO_WALK;
  for (const step of steps) {
    if (typeof step === "number") {
      const key = cycleKey(walk.order, buffers[0]?.key, step);
      if (key !== undefined) {
        walk = { order: walk.order, cycled: key };
        buffers = reduceBuffers(buffers, { type: "switch", key });
      }
    } else {
      buffers = reduceBuffers(buffers, step);
    }
    walk = cycleOrder(walk, buffers);
  }
  return { shown: buffers[0]?.key, order: walk.order };
};

const open = (buffer: Buffers[number]): BufferAction => ({ type: "open", buffer });

describe("the order in which the buffers were shown (SR-115 AK5)", () => {
  it("[SR-115/AK5] Alt+P goes back to the buffer shown before, also when it was opened before others", () => {
    // Opened: overview, list, element, search; then back to the list and a reference followed.
    const start = [{ type: "reset", buffer: overview }, open(list), open(element), open(search)] as const;
    const back = [...start, { type: "switch", key: list.key }, open(other)] as const;
    expect(run(...back, 1).shown).toBe(list.key);
    expect(run(...back, 1, 1).shown).toBe(search.key);
    expect(run(...back, 1, 1, 1).shown).toBe(element.key);
    // Alt+N goes forward again in the same order.
    expect(run(...back, 1, 1, -1).shown).toBe(list.key);
    expect(run(...back, 1, 1, -1, -1).shown).toBe(other.key);
    // At the ends it wraps.
    expect(run(...back, -1).shown).toBe(overview.key);
    expect(run(...back, 1, 1, 1, 1, 1).shown).toBe(other.key);
  });

  it("[SR-115/AK5] walking keeps the order; showing a buffer otherwise puts it first", () => {
    const start = [{ type: "reset", buffer: overview }, open(list), open(element)] as const;
    const walked = run(...start, 1, 1);
    expect(walked.shown).toBe(overview.key);
    expect(walked.order).toEqual([element.key, list.key, overview.key]);
    const switched = run(...start, 1, 1, { type: "switch", key: list.key });
    expect(switched.order).toEqual([list.key, overview.key, element.key]);
    // Opened while walking: it comes first, and Alt+P goes back to where the walk was.
    expect(run(...start, 1, open(search), 1).shown).toBe(list.key);
  });

  it("[SR-115/AK5] a buffer closed while walking leaves the order, the others keep their places", () => {
    const start = [{ type: "reset", buffer: overview }, open(list), open(element), open(search)] as const;
    const closed = run(...start, 1, { type: "close", key: overview.key });
    expect(closed.order).toEqual([search.key, element.key, list.key]);
    expect(run(...start, 1, { type: "close", key: overview.key }, 1).shown).toBe(list.key);
  });

  it("[SR-115/AK5] buffers restored behind while walking end the walk", () => {
    const walk: Walk = { order: [list.key, element.key], cycled: list.key };
    expect(cycleOrder(walk, [list, element, search])).toEqual({
      order: [list.key, element.key, search.key],
      cycled: undefined,
    });
  });

  it("gives back the same walk when nothing changed, so that it can be kept as it is", () => {
    const walk = cycleOrder(NO_WALK, [element, list]);
    expect(cycleOrder(walk, [element, list])).toBe(walk);
    const walking: Walk = { order: walk.order, cycled: element.key };
    expect(cycleOrder(walking, [element, list])).toBe(walking);
    expect(cycleOrder(walk, [list, element])).not.toBe(walk);
    // Shown otherwise than by the keys: the walk ends, the order stays the order of use.
    expect(cycleOrder({ order: walk.order, cycled: list.key }, [element, list])).toEqual({
      order: walk.order,
      cycled: undefined,
    });
  });

  it("[SR-115/AK5] gives no buffer with fewer than two, or when the shown one is not in the order", () => {
    expect(cycleKey([overview.key], overview.key, 1)).toBeUndefined();
    expect(cycleKey([], undefined, -1)).toBeUndefined();
    expect(cycleKey([overview.key, list.key], other.key, 1)).toBeUndefined();
    expect(cycleKey([overview.key, list.key], undefined, 1)).toBeUndefined();
  });
});
