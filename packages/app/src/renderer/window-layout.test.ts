// The areas of the window (SR-115 AK3): "Split window" shows two buffers side by side, the active area
// takes what is opened and switched to, and the layout follows every buffer action in the same step.
import { describe, expect, it } from "vitest";
import type { AgentActivity } from "../shared/protocol.js";
import type { Buffer, BufferAction, ElementBuffer } from "./buffers.js";
import {
  MAX_BUFFERS,
  elementBuffer,
  graphBuffer,
  listBuffer,
  overviewBuffer,
  readOnlyBuffer,
  resultBuffer,
} from "./buffers.js";
import { FOLLOW_OFF, onAccess, place, startFollowing } from "./follow.js";
import type { WindowAction, WindowState } from "./window-layout.js";
import { EMPTY_WINDOW, ONE_AREA, areas, isSplit, reduceWindow } from "./window-layout.js";

const element = (n: number): ElementBuffer =>
  elementBuffer(`uuid-${String(n)}`, "spec", `SR-${String(n)} Title ${String(n)}`);
const graph = graphBuffer("uuid-1", "spec", "SR-1 Title 1");
const list = listBuffer("All elements");
const overview = overviewBuffer();

const run = (state: WindowState, ...actions: readonly WindowAction[]): WindowState =>
  actions.reduce(reduceWindow, state);

/** The window after opening the buffers in this order: the last one is shown. */
const opened = (...buffers: readonly Buffer[]): WindowState =>
  run(
    EMPTY_WINDOW,
    { type: "reset", buffer: overview },
    ...buffers.map((buffer): WindowAction => ({ type: "open", buffer })),
  );

/** What the areas show, left to right: the key, and `*` on the active one. */
const shown = (state: WindowState): string[] =>
  areas(state).map((area) => `${area.buffer.key}${area.active ? "*" : ""}`);

/** A buffer is never in both areas, and `other` is open and not the shown one. */
const sound = (state: WindowState): void => {
  const keys = areas(state).map((area) => area.buffer.key);
  expect(new Set(keys).size).toBe(keys.length);
  const { other } = state.layout;
  if (other !== undefined) {
    expect(state.buffers.some((buffer) => buffer.key === other)).toBe(true);
    expect(state.buffers[0]?.key).not.toBe(other);
  }
};

describe("window layout (SR-115 AK3)", () => {
  it("[SR-115/AK3] Split window shows the shown buffer and the one used before side by side; the shown one stays active", () => {
    const state = run(opened(element(1), graph), { type: "split" });
    expect(isSplit(state.layout)).toBe(true);
    expect(shown(state)).toEqual([`${graph.key}*`, element(1).key]);
    expect(state.buffers[0]).toEqual(graph);
    // Split again changes nothing; the order of use is unchanged.
    expect(reduceWindow(state, { type: "split" })).toBe(state);
    expect(state.buffers.map((buffer) => buffer.key)).toEqual([graph.key, element(1).key, overview.key]);
  });

  it("[SR-115/AK3] with one buffer open the other area shows the overview; with only the overview nothing splits", () => {
    const one = run(EMPTY_WINDOW, { type: "reset", buffer: element(1) }, { type: "split" });
    expect(shown(one)).toEqual([`${element(1).key}*`, overview.key]);
    const lone = opened();
    expect(reduceWindow(lone, { type: "split" })).toBe(lone);
    expect(reduceWindow(EMPTY_WINDOW, { type: "split" })).toBe(EMPTY_WINDOW);
    expect(areas(EMPTY_WINDOW)).toEqual([]);
    expect(shown(lone)).toEqual([`${overview.key}*`]);
  });

  it("[SR-115/AK3] choosing the other area's buffer (switch, open, Next buffer) makes that area active; a buffer is never in both areas", () => {
    let state = run(opened(element(1), element(2)), { type: "split" });
    expect(shown(state)).toEqual([`${element(2).key}*`, element(1).key]);
    // "Other window" and Next buffer dispatch a switch to the other area's buffer.
    state = reduceWindow(state, { type: "switch", key: element(1).key });
    expect(shown(state)).toEqual([element(2).key, `${element(1).key}*`]);
    expect(state.layout.active).toBe("right");
    sound(state);
    // Opening the buffer of the other area again (Go to, a click on its row) makes it active too.
    state = reduceWindow(state, { type: "open", buffer: element(2) });
    expect(shown(state)).toEqual([`${element(2).key}*`, element(1).key]);
    sound(state);
    // A sequence of actions keeps the invariant.
    const sequence: WindowAction[] = [
      { type: "open", buffer: list },
      { type: "switch", key: element(1).key },
      { type: "switch", key: list.key },
      { type: "open", buffer: graph },
      { type: "switch", key: overview.key },
      { type: "close", key: element(2).key },
      { type: "switch", key: graph.key },
      { type: "split" },
      { type: "switch", key: overview.key },
    ];
    for (const action of sequence) {
      state = reduceWindow(state, action);
      sound(state);
    }
  });

  it("[SR-115/AK3] opening or switching in the active area changes only that area", () => {
    let state = run(opened(element(1), element(2)), { type: "split" });
    state = reduceWindow(state, { type: "open", buffer: graph });
    expect(shown(state)).toEqual([`${graph.key}*`, element(1).key]);
    state = reduceWindow(state, { type: "switch", key: overview.key });
    expect(shown(state)).toEqual([`${overview.key}*`, element(1).key]);
    // The same buffer changed in place (a graph one level deeper) stays where it is.
    state = reduceWindow(state, { type: "open", buffer: { ...graph, depth: 2 } });
    expect(shown(state)).toEqual([`${graph.key}*`, element(1).key]);
    // Cursor, select and restore change no area; a switch to a buffer not open changes nothing.
    const moved = run(
      state,
      { type: "cursor", key: element(1).key, cursor: 2 },
      { type: "select", key: graph.key, node: "spec:uuid-2" },
      { type: "restore", buffers: [element(3)] },
    );
    expect(shown(moved)).toEqual([`${graph.key}*`, element(1).key]);
    expect(reduceWindow(moved, { type: "switch", key: "nothing" })).toBe(moved);
  });

  it("[SR-115/AK3] a buffer in the inactive area that reads again stays there and does not become active", () => {
    const result = resultBuffer("trace.affected", {}, "Affected", { total: 0 }, 0);
    let state = run(opened(result, element(1)), { type: "split" });
    expect(shown(state)).toEqual([`${element(1).key}*`, result.key]);
    state = reduceWindow(state, { type: "update", buffer: { ...result, output: { total: 1 }, revision: 1 } });
    expect(shown(state)).toEqual([`${element(1).key}*`, result.key]);
    expect(state.buffers.map((buffer) => buffer.key)).toEqual([element(1).key, result.key, overview.key]);
    expect(state.buffers[1]).toMatchObject({ output: { total: 1 }, revision: 1 });
    // A buffer no longer open is not brought back.
    expect(reduceWindow(state, { type: "update", buffer: element(9) })).toBe(state);
  });

  it("[SR-115/AK3] Unsplit keeps the active area; Close buffer in a split leaves the other buffer alone; closing it, Close all, reset or push-out join the areas", () => {
    const split = run(
      opened(element(1), element(2)),
      { type: "split" },
      { type: "switch", key: element(1).key },
    );
    // Unsplit: the active area stays, on its side; unsplit again changes nothing.
    const unsplit = reduceWindow(split, { type: "unsplit" });
    expect(shown(unsplit)).toEqual([`${element(1).key}*`]);
    expect(areas(unsplit)[0]?.side).toBe("right");
    expect(reduceWindow(unsplit, { type: "unsplit" })).toBe(unsplit);
    // Close buffer on the active area: the other area is left, active, with its buffer; all stay open but the closed one.
    const closed = reduceWindow(split, { type: "close", key: element(1).key });
    expect(shown(closed)).toEqual([`${element(2).key}*`]);
    expect(closed.layout).toEqual({ active: "left" });
    expect(closed.buffers.map((buffer) => buffer.key)).toEqual([element(2).key, overview.key]);
    // Closing the active buffer when the other one is not next in the order of use still shows the other one.
    const deeper = run(split, { type: "open", buffer: graph }, { type: "close", key: graph.key });
    expect(shown(deeper)).toEqual([`${element(2).key}*`]);
    // Close all closes every buffer but the overview: one area.
    const all = run(split, { type: "close", key: element(1).key }, { type: "close", key: element(2).key });
    expect(shown(all)).toEqual([`${overview.key}*`]);
    // Another workspace: one area on the left.
    expect(reduceWindow(split, { type: "reset" })).toEqual(EMPTY_WINDOW);
    expect(reduceWindow(split, { type: "reset", buffer: overview }).layout).toEqual(ONE_AREA);
    // Without a split, buffer actions keep the one area where it is.
    expect(reduceWindow(unsplit, { type: "open", buffer: graph }).layout).toEqual({ active: "right" });
  });

  it("[SR-115/AK3] the inactive area's buffer closed or pushed out: the area shows the next buffer in the order of use, else the window has one area", () => {
    const split = run(opened(element(1), element(2), element(3)), { type: "split" });
    expect(shown(split)).toEqual([`${element(3).key}*`, element(2).key]);
    const closed = reduceWindow(split, { type: "close", key: element(2).key });
    expect(shown(closed)).toEqual([`${element(3).key}*`, element(1).key]);
    // Only the shown buffer is left: one area.
    const single = run(
      EMPTY_WINDOW,
      { type: "reset", buffer: element(1) },
      { type: "split" },
      {
        type: "close",
        key: overview.key,
      },
    );
    expect(shown(single)).toEqual([`${element(1).key}*`]);
    // MAX_BUFFERS pushes the least recent buffer out; it was in the inactive area.
    let full = run(EMPTY_WINDOW, { type: "reset", buffer: element(0) }, { type: "split" });
    expect(shown(full)).toEqual([`${element(0).key}*`, overview.key]);
    full = reduceWindow(full, { type: "switch", key: overview.key });
    full = reduceWindow(full, { type: "switch", key: element(0).key });
    const actions: BufferAction[] = Array.from({ length: MAX_BUFFERS - 1 }, (_, n) => ({
      type: "open",
      buffer: element(n + 1),
    }));
    const pushed = run(full, ...actions);
    expect(pushed.buffers).toHaveLength(MAX_BUFFERS);
    expect(pushed.buffers.some((buffer) => buffer.key === overview.key)).toBe(false);
    expect(shown(pushed)).toEqual([`${element(MAX_BUFFERS - 1).key}*`, element(MAX_BUFFERS - 2).key]);
  });

  it("[SR-115/AK3] Follow agent shows its element in the active area; closing the mode's buffer in the other area fills that area with the next buffer", () => {
    const agent = (n: number): AgentActivity => ({
      access: "mcp",
      command: "element.get",
      effect: "read",
      at: `2026-10-28T10:00:0${String(n)}.000Z`,
      element: { id: `uuid-${String(n)}`, repository: "spec" },
    });
    // The mode shows element 1; the user opens a list, splits, and makes the list's area active.
    let follow = onAccess(startFollowing(FOLLOW_OFF), agent(1), undefined).state;
    let state = opened();
    let placed = place(
      follow,
      follow.generation,
      agent(1),
      element(1),
      state.buffers,
      undefined,
      () => false,
    );
    state = run(state, ...placed.actions);
    follow = placed.state;
    state = run(state, { type: "open", buffer: list }, { type: "split" });
    expect(shown(state)).toEqual([`${list.key}*`, element(1).key]);
    // The mode's next access opens its element in the active area and closes the mode's buffer of the other area.
    follow = onAccess(follow, agent(2), undefined).state;
    placed = place(follow, follow.generation, agent(2), element(2), state.buffers, undefined, () => false);
    expect(placed.actions).toEqual([
      { type: "open", buffer: element(2) },
      { type: "close", key: element(1).key },
    ]);
    state = run(state, ...placed.actions);
    expect(shown(state)).toEqual([`${element(2).key}*`, list.key]);
    sound(state);
  });

  it("[SR-044/AK2] side by side shows two buffers in two areas, the first on the left and active, from one area or from a split", () => {
    const core = readOnlyBuffer(element(1));
    const replacement = readOnlyBuffer(element(2));
    const from = opened(element(1), list);
    const state = reduceWindow(from, { type: "side-by-side", left: core, right: replacement });
    expect(shown(state)).toEqual([`${core.key}*`, replacement.key]);
    expect(state.buffers.map((buffer) => buffer.key)).toEqual([
      core.key,
      replacement.key,
      list.key,
      element(1).key,
      overview.key,
    ]);
    sound(state);
    // From a split whose active area is on the right: the pair takes both areas, the first on the left.
    const split = run(opened(element(3), list), { type: "split" }, { type: "switch", key: element(3).key });
    expect(areas(split).map((area) => area.side)).toEqual(["left", "right"]);
    expect(split.layout.active).toBe("right");
    const again = reduceWindow(split, { type: "side-by-side", left: core, right: replacement });
    expect(shown(again)).toEqual([`${core.key}*`, replacement.key]);
    sound(again);
    // One buffer under both keys opens alone, as `open` does.
    const alone = reduceWindow(from, { type: "side-by-side", left: core, right: core });
    expect(alone).toEqual(reduceWindow(from, { type: "open", buffer: core }));
  });
});

describe("open beside and follow (SR-150)", () => {
  const keys = (state: WindowState): string[] => state.buffers.map((buffer) => buffer.key);

  it("[SR-150/AK1] Open to the right splits the window: the shown buffer stays on the left and active, the marked element opens on the right", () => {
    const from = opened(element(1), graph);
    const state = reduceWindow(from, { type: "beside", side: "right", buffer: element(2) });
    expect(shown(state)).toEqual([`${graph.key}*`, element(2).key]);
    expect(keys(state)).toEqual([graph.key, element(2).key, element(1).key, overview.key]);
    sound(state);
    // The shown element itself is not opened beside itself.
    const self = opened(element(1));
    expect(reduceWindow(self, { type: "beside", side: "right", buffer: element(1) })).toBe(self);
    expect(reduceWindow(EMPTY_WINDOW, { type: "beside", side: "right", buffer: element(1) })).toBe(
      EMPTY_WINDOW,
    );
  });

  it("[SR-150/AK2] Open to the left: the marked element opens on the left, the shown buffer stands on the right and stays active", () => {
    const state = reduceWindow(opened(list), { type: "beside", side: "left", buffer: element(2) });
    expect(shown(state)).toEqual([element(2).key, `${list.key}*`]);
    expect(state.layout).toEqual({ active: "right", other: element(2).key });
    sound(state);
  });

  it("[SR-150/AK3] in a split, the inactive side shows the marked element and the active area stays; the active side opens it as Enter does", () => {
    const split = run(opened(element(1), graph), { type: "split" });
    expect(split.layout.active).toBe("left");
    const right = reduceWindow(split, { type: "beside", side: "right", buffer: element(2) });
    expect(shown(right)).toEqual([`${graph.key}*`, element(2).key]);
    sound(right);
    const left = reduceWindow(split, { type: "beside", side: "left", buffer: element(2) });
    expect(left).toEqual(reduceWindow(split, { type: "open", buffer: element(2) }));
    expect(shown(left)).toEqual([`${element(2).key}*`, element(1).key]);
    sound(left);
  });

  it("[SR-150/AK4] the inactive element follows the element marked in the active area in its place, without a new buffer; unsaved input keeps it open", () => {
    const from = reduceWindow(opened(list), { type: "beside", side: "right", buffer: element(1) });
    const state = reduceWindow(from, { type: "follow", buffer: element(2), keep: false });
    expect(shown(state)).toEqual([`${list.key}*`, element(2).key]);
    expect(keys(state)).toEqual([list.key, element(2).key, overview.key]);
    sound(state);
    // With unsaved input the element followed stays open behind.
    const kept = reduceWindow(from, { type: "follow", buffer: element(2), keep: true });
    expect(shown(kept)).toEqual([`${list.key}*`, element(2).key]);
    expect(keys(kept)).toEqual([list.key, element(2).key, element(1).key, overview.key]);
    // An element already open moves into the area; the one shown before stays open.
    const open = reduceWindow(
      run(from, { type: "open", buffer: element(3) }, { type: "switch", key: list.key }),
      {
        type: "follow",
        buffer: element(3),
        keep: false,
      },
    );
    expect(shown(open)).toEqual([`${list.key}*`, element(3).key]);
    expect(keys(open)).toContain(element(1).key);
    sound(open);
    // The element already shown there, or the active buffer itself: nothing changes.
    expect(reduceWindow(from, { type: "follow", buffer: element(1), keep: false })).toBe(from);
    const twoElements = run(opened(element(2), element(1)), { type: "split" });
    expect(reduceWindow(twoElements, { type: "follow", buffer: element(1), keep: false })).toBe(twoElements);
  });

  it("[SR-150/AK5] an inactive list, overview, graph or package page, the comparison of SR-044 and one area do not follow", () => {
    const listed = run(opened(list, element(1)), { type: "split" });
    expect(reduceWindow(listed, { type: "follow", buffer: element(2), keep: false })).toBe(listed);
    const graphed = run(opened(graph, element(1)), { type: "split" });
    expect(reduceWindow(graphed, { type: "follow", buffer: element(2), keep: false })).toBe(graphed);
    const lone = run(opened(element(1)), { type: "split" });
    expect(reduceWindow(lone, { type: "follow", buffer: element(2), keep: false })).toBe(lone);
    const compared = reduceWindow(opened(list), {
      type: "side-by-side",
      left: readOnlyBuffer(element(1)),
      right: readOnlyBuffer(element(3)),
    });
    expect(reduceWindow(compared, { type: "follow", buffer: element(2), keep: false })).toBe(compared);
    const one = opened(element(1));
    expect(reduceWindow(one, { type: "follow", buffer: element(2), keep: false })).toBe(one);
  });
});
