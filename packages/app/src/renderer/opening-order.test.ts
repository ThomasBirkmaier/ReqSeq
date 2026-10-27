import { describe, expect, it } from "vitest";
import type { BufferAction, Buffers } from "./buffers.js";
import {
  MAX_BUFFERS,
  elementBuffer,
  filteredList,
  listBuffer,
  overviewBuffer,
  reduceBuffers,
  searchBuffer,
} from "./buffers.js";
import { cycleKey, openingOrder } from "./opening-order.js";

const overview = overviewBuffer();
const list = listBuffer("All elements");
const element = elementBuffer("u1", "spec", "SR-001 One");
const other = elementBuffer("u2", "spec", "SR-002 Two");
const search = searchBuffer("wind");

/** The opening order after each action, as App keeps it while the buffers change. */
const run = (...actions: readonly BufferAction[]): { buffers: Buffers; order: readonly string[] } => {
  let buffers: Buffers = [];
  let order: readonly string[] = [];
  for (const action of actions) {
    buffers = reduceBuffers(buffers, action);
    order = openingOrder(order, buffers);
  }
  return { buffers, order };
};

const open = (buffer: Buffers[number]): BufferAction => ({ type: "open", buffer });

describe("the order in which the buffers were opened (SR-115 AK5)", () => {
  it("[SR-115/AK5] keeps the order of opening, not the order of use", () => {
    const { buffers, order } = run(
      { type: "reset", buffer: overview },
      open(list),
      open(element),
      open(search),
      { type: "switch", key: element.key },
    );
    expect(buffers.map((buffer) => buffer.key)).toEqual([element.key, search.key, list.key, overview.key]);
    expect(order).toEqual([overview.key, list.key, element.key, search.key]);
  });

  it("[SR-115/AK5] a buffer replaced in place keeps its place; a closed one is dropped and appended when opened again", () => {
    const filtered = run(
      { type: "reset", buffer: overview },
      open(list),
      open(element),
      open(filteredList([{ label: "type: need", selection: { where: { type: ["need"] } } }])),
    );
    expect(filtered.order).toEqual([overview.key, list.key, element.key]);
    const reopened = run(
      { type: "reset", buffer: overview },
      open(list),
      open(element),
      { type: "close", key: list.key },
      open(list),
    );
    expect(reopened.order).toEqual([overview.key, element.key, list.key]);
  });

  it("[SR-115/AK5] appends buffers that came at once least recent first, and starts again after a reset", () => {
    expect(openingOrder([], [search, element, overview])).toEqual([overview.key, element.key, search.key]);
    const reset = run({ type: "reset", buffer: overview }, open(list), open(element), {
      type: "reset",
      buffer: overview,
    });
    expect(reset.order).toEqual([overview.key]);
    expect(run({ type: "reset" }).order).toEqual([]);
  });

  it("[SR-115/AK5] drops a buffer that the most kept buffers pushed out", () => {
    const many = Array.from({ length: MAX_BUFFERS + 1 }, (_, n) =>
      open(elementBuffer(`u${String(n)}`, "spec", `SR-${String(n)}`)),
    );
    const { buffers, order } = run(...many);
    expect(order).toHaveLength(MAX_BUFFERS);
    expect(order).not.toContain(elementBuffer("u0", "spec", "").key);
    expect(order).toEqual([...buffers].reverse().map((buffer) => buffer.key));
  });

  it("gives back the same order when nothing changed, so that it can be kept as it is", () => {
    const order = openingOrder([], [element, list]);
    expect(openingOrder(order, [list, element])).toBe(order);
    expect(openingOrder(order, [element])).not.toBe(order);
  });

  it("[SR-115/AK5] the next buffer follows the shown one, after the last comes the first; the previous goes back", () => {
    const order = [overview.key, list.key, element.key];
    expect(cycleKey(order, overview.key, 1)).toBe(list.key);
    expect(cycleKey(order, element.key, 1)).toBe(overview.key);
    expect(cycleKey(order, list.key, -1)).toBe(overview.key);
    expect(cycleKey(order, overview.key, -1)).toBe(element.key);
  });

  it("[SR-115/AK5] gives no buffer with fewer than two, or when the shown one is not in the order", () => {
    expect(cycleKey([overview.key], overview.key, 1)).toBeUndefined();
    expect(cycleKey([], undefined, -1)).toBeUndefined();
    expect(cycleKey([overview.key, list.key], other.key, 1)).toBeUndefined();
    expect(cycleKey([overview.key, list.key], undefined, 1)).toBeUndefined();
  });
});
