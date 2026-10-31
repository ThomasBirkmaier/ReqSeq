// The window's areas (SR-115 AK3, D-062): one, or two side by side after "Split window". The buffers stay
// one list in the order of use (`buffers.ts`): the first is shown in the active area, and `other` names
// the buffer of the inactive one. This module settles the layout in the same step as each buffer action,
// so the two never disagree. Pure, no React; display state, never stored (SR-115 AK4 restores buffers only).
//
// The rules, in this order:
// - Of the actions that keep both areas, only `open` and `switch` change the active area: when the buffer
//   they show is the one in the inactive area, that area becomes active and the other one shows the
//   buffer that was active. A buffer is never shown in both areas.
// - `cursor`, `select`, `restore` and `update` never change the active area (a view in the inactive area
//   that reads again replaces its buffer in place).
// - `close` of the active area's buffer in a split leaves one area, the inactive one, which becomes active.
// - When the inactive area's buffer is gone otherwise (Follow agent closes its buffer, Close all, a buffer
//   pushed out by `MAX_BUFFERS`), the area shows the next buffer in the order of use; with none left, the
//   window has one area.
// - `reset` (another workspace) leaves one area.
// - `side-by-side` (SR-044 AK2) shows two buffers in two areas: the first on the left, active, the second
//   on the right.
// - `beside` ("Open to the right", "Open to the left", SR-150 AK1 to AK3) opens an element in the area on
//   that side. On the inactive side, or without a split, the active area keeps its buffer and stays active;
//   on the active side it opens as `open` does (Enter).
// - `follow` (SR-150 AK4, AK5) shows the element marked in the active area in the inactive one. It takes the
//   place of the element shown there when the caller says it may (`replace`: one that following or `beside`
//   put there, without unsaved input), so marking opens no buffer per row; else that element stays open
//   behind. An inactive area that shows no element, a package page (`page`) or a read-only element (the
//   comparison of SR-044) stays as it is.
import type { Buffer, BufferAction, Buffers, ElementBuffer } from "./buffers.js";
import { onlyOverview, overviewBuffer, reduceBuffers } from "./buffers.js";

/** The side of an area: left or right. */
export type Side = "left" | "right";

/**
 * The areas of the window: the side of the active one, and with a split the key of the buffer in the
 * inactive area (`other`). Invariant: `other` is open and is not the first buffer.
 */
export interface Layout {
  readonly active: Side;
  readonly other?: string;
}

/** The buffers and the areas, the state of the window's reducer. */
export interface WindowState {
  readonly buffers: Buffers;
  readonly layout: Layout;
}

/** A buffer action, "Split window" and "Unsplit window", or two buffers side by side. */
export type WindowAction =
  | BufferAction
  | { readonly type: "split" }
  | { readonly type: "unsplit" }
  | { readonly type: "side-by-side"; readonly left: Buffer; readonly right: Buffer }
  | { readonly type: "beside"; readonly side: Side; readonly buffer: ElementBuffer }
  | {
      readonly type: "follow";
      readonly buffer: ElementBuffer;
      readonly replace: boolean;
      readonly page: boolean;
    };

/** One area, on the left. */
export const ONE_AREA: Layout = { active: "left" };

export const EMPTY_WINDOW: WindowState = { buffers: [], layout: ONE_AREA };

/** One area shown: what an area holds and whether it is the active one. */
export interface Area {
  readonly side: Side;
  readonly buffer: Buffer;
  readonly active: boolean;
}

const opposite = (side: Side): Side => (side === "left" ? "right" : "left");

const isOpen = (buffers: Buffers, key: string): boolean => buffers.some((buffer) => buffer.key === key);

/** The layout with `other` in the inactive area, or one area when there is none. */
const withOther = (active: Side, other: string | undefined): Layout =>
  other === undefined ? { active } : { active, other };

/** The next buffer in the order of use that is not shown in the active area. */
const nextOther = (buffers: Buffers): string | undefined => buffers[1]?.key;

/** "Split window": the shown buffer keeps its area, the one used before stands beside it (A1 of #411). */
const split = (state: WindowState): WindowState => {
  const shown = state.buffers[0];
  if (state.layout.other !== undefined || shown === undefined || onlyOverview(state.buffers)) {
    return state;
  }
  // A single buffer: the overview comes beside it, so there are two buffers to show.
  const buffers = state.buffers.length > 1 ? state.buffers : [shown, overviewBuffer()];
  return { buffers, layout: withOther(state.layout.active, nextOther(buffers)) };
};

/** The layout after a buffer action changed `before.buffers` into `buffers` (the rules above). */
const settle = (before: WindowState, action: BufferAction, buffers: Buffers): WindowState => {
  const { layout } = before;
  if (action.type === "reset" || buffers.length === 0) {
    return { buffers, layout: ONE_AREA };
  }
  const other = layout.other;
  if (other === undefined) {
    return { buffers, layout };
  }
  const shownBefore = before.buffers[0]?.key;
  if (action.type === "close" && action.key === shownBefore) {
    // The active area's buffer closed: the inactive area is left, and its buffer is the shown one.
    return {
      buffers: reduceBuffers(buffers, { type: "switch", key: other }),
      layout: { active: opposite(layout.active) },
    };
  }
  if ((action.type === "open" || action.type === "switch") && buffers[0]?.key === other) {
    // The inactive area's buffer was chosen: that area becomes active, the other one keeps what was shown
    // (`open` of the inactive buffer moves it, so nothing is pushed out).
    return { buffers, layout: withOther(opposite(layout.active), shownBefore) };
  }
  return isOpen(buffers, other)
    ? { buffers, layout }
    : { buffers, layout: withOther(layout.active, nextOther(buffers)) };
};

/** `left` and `right` opened in two areas, `left` active (one buffer under both keys opens alone). */
const sideBySide = (state: WindowState, left: Buffer, right: Buffer): WindowState => {
  const open = { type: "open", buffer: left } as const;
  if (left.key === right.key) {
    return settle(state, open, reduceBuffers(state.buffers, open));
  }
  const opened = reduceBuffers(reduceBuffers(state.buffers, { type: "open", buffer: right }), open);
  return { buffers: opened, layout: { active: "left", other: right.key } };
};

/** `buffer` opened behind the shown one, which stays first (shown in the active area). */
const openBehind = (buffers: Buffers, buffer: Buffer): Buffers => {
  const shown = buffers[0];
  const opened = reduceBuffers(buffers, { type: "open", buffer });
  return shown === undefined ? opened : reduceBuffers(opened, { type: "switch", key: shown.key });
};

/** "Open to the right" or "Open to the left" (SR-150 AK1 to AK3). */
const beside = (state: WindowState, side: Side, buffer: ElementBuffer): WindowState => {
  const shown = state.buffers[0];
  if (shown === undefined || shown.key === buffer.key) {
    return state;
  }
  const { layout } = state;
  if (layout.other !== undefined && side === layout.active) {
    const open = { type: "open", buffer } as const;
    return settle(state, open, reduceBuffers(state.buffers, open));
  }
  // Without a split the active area moves to the other side, so the element stands on the one asked for.
  const active = layout.other === undefined ? opposite(side) : layout.active;
  return { buffers: openBehind(state.buffers, buffer), layout: { active, other: buffer.key } };
};

/** The inactive area follows the element marked in the active one (SR-150 AK4, AK5). */
const follow = (state: WindowState, buffer: ElementBuffer, replace: boolean, page: boolean): WindowState => {
  const { buffers, layout } = state;
  const other = buffers.find((open) => open.key === layout.other);
  if (
    page ||
    other?.kind !== "element" ||
    other.readOnly === true ||
    other.key === buffer.key ||
    buffers[0]?.key === buffer.key
  ) {
    return state;
  }
  const already = buffers.some((open) => open.key === buffer.key);
  const next =
    replace && !already
      ? buffers.map((open) => (open.key === other.key ? buffer : open))
      : openBehind(buffers, buffer);
  return { buffers: next, layout: { active: layout.active, other: buffer.key } };
};

export const reduceWindow = (state: WindowState, action: WindowAction): WindowState => {
  if (action.type === "beside") {
    return beside(state, action.side, action.buffer);
  }
  if (action.type === "follow") {
    return follow(state, action.buffer, action.replace, action.page);
  }
  if (action.type === "split") {
    return split(state);
  }
  if (action.type === "side-by-side") {
    return sideBySide(state, action.left, action.right);
  }
  if (action.type === "unsplit") {
    return state.layout.other === undefined ? state : { ...state, layout: { active: state.layout.active } };
  }
  const buffers = reduceBuffers(state.buffers, action);
  return buffers === state.buffers ? state : settle(state, action, buffers);
};

/** The window is split into two areas. */
export const isSplit = (layout: Layout): boolean => layout.other !== undefined;

/** The areas to show, left to right: none without a buffer, one, or two after "Split window". */
export const areas = (state: WindowState): readonly Area[] => {
  const shown = state.buffers[0];
  if (shown === undefined) {
    return [];
  }
  const active: Area = { side: state.layout.active, buffer: shown, active: true };
  const other = state.buffers.find((buffer) => buffer.key === state.layout.other);
  if (other === undefined) {
    return [active];
  }
  const inactive: Area = { side: opposite(state.layout.active), buffer: other, active: false };
  return active.side === "left" ? [active, inactive] : [inactive, active];
};
