// The context menu (D-075, SR-194): a right-click in a buffer opens the app's own menu at the pointer, with a
// short fixed choice of the commands of the command prompt for that place. This module is pure: the places
// and their entries, where a press lands, which entries are shown, which press opens the menu, where it
// sits and what a key does while it is open. `use-context-menu.ts` listens, `ContextMenu.tsx` draws.
import type { Choice } from "./actions.js";
import type { KeyRow } from "./keys.js";
import { press } from "./keys.js";
import { TEXT_MENU } from "./text-menu.js";

/**
 * The places that have a menu of their own. A view marks a place with `data-menu="<place>"`; a press on
 * no mark, or on a place whose block is still empty, gets the menu of `buffer` (SR-194 AK6).
 */
export type MenuPlace =
  | "buffer"
  | "text"
  | "field"
  | "field-property"
  | "field-status"
  | "field-short-id"
  | "element-entry"
  | "list"
  | "graph"
  | "metamodel-graph"
  | "matrix-cell"
  | "matrix-target";

/**
 * Where the menu was asked for: the place, the element pressed and the point of the pointer in the
 * window. A place works out its details from `target` and `point` (a position in the text, a cell).
 */
export interface MenuHit {
  readonly place: MenuPlace;
  readonly target: Element;
  readonly point: { readonly x: number; readonly y: number };
}

/** An entry of a place: an action id or `command:<name>`, shown where `when` holds (absent: always). */
export interface MenuEntry {
  readonly id: string;
  readonly when?: (hit: MenuHit) => boolean;
}

// Each block stays on lines of its own, so the SRs that fill a place never touch the lines of another.
export const MENU_PLACES: Readonly<Record<MenuPlace, readonly MenuEntry[]>> = {
  buffer: [
    // SR-194 AK6
    { id: "go-to" },
    { id: "search" },
    { id: "close" },
    { id: "split-window" },
    { id: "other-window" },
    { id: "unsplit-window" },
  ],

  text: [
    // SR-195 AK4: first on a reference to an element.
    { id: "follow-reference", when: TEXT_MENU.reference },
    // SR-195 AK1: Cut and Copy only with text selected.
    { id: "cut", when: TEXT_MENU.selected },
    { id: "copy", when: TEXT_MENU.selected },
    { id: "paste" },
    { id: "format-bold" },
    { id: "format-italic" },
    { id: "format-code" },
    { id: "format-link" },
    { id: "insert-image" },
    // SR-195 AK5: in a table.
    { id: "insert-table-row", when: TEXT_MENU.table },
    { id: "delete-table-row", when: TEXT_MENU.table },
    { id: "insert-table-column", when: TEXT_MENU.table },
    { id: "delete-table-column", when: TEXT_MENU.table },
    { id: "align-table", when: TEXT_MENU.table },
    // SR-195 AK6: on a heading with a section.
    { id: "fold-section", when: TEXT_MENU.fold },
    { id: "unfold-section", when: TEXT_MENU.unfold },
  ],

  field: [
    // SR-196
  ],

  "field-property": [
    // SR-196
  ],

  "field-status": [
    // SR-196
  ],

  "field-short-id": [
    // SR-196
  ],

  "element-entry": [
    // SR-197
  ],

  list: [
    // SR-198
  ],

  graph: [
    // SR-199
  ],

  "metamodel-graph": [
    // SR-199
  ],

  "matrix-cell": [
    // SR-199
  ],

  "matrix-target": [
    // SR-199
  ],
};

const isPlace = (name: string): name is MenuPlace => Object.hasOwn(MENU_PLACES, name);

/**
 * The place of a press on `target`: the nearest mark inside its area, else `buffer`; undefined outside
 * the areas of the sheet (the modeline, the minibuffer), where there is no menu.
 */
export const placeAt = (target: Element): MenuPlace | undefined => {
  const area = target.closest("[data-area]");
  if (area === null) {
    return undefined;
  }
  const mark = target.closest("[data-menu]")?.getAttribute("data-menu");
  return mark !== undefined && mark !== null && isPlace(mark) ? mark : "buffer";
};

/** The entries of a place: its own, or those of `buffer` while it has none. */
export const placeEntries = (place: MenuPlace): readonly MenuEntry[] => {
  const own = MENU_PLACES[place];
  return own.length > 0 ? own : MENU_PLACES.buffer;
};

/**
 * The entries of the menu at `hit`, in the order of its place: those of the command prompt's `items`
 * (which holds only what can run now, with its name and key as the prompt shows them, SR-109) for which
 * `when` holds.
 */
export const menuEntries = (hit: MenuHit, items: readonly Choice[]): Choice[] =>
  placeEntries(hit.place).flatMap((entry) => {
    const item = items.find((candidate) => candidate.id === entry.id);
    return item === undefined || entry.when?.(hit) === false ? [] : [item];
  });

/** The entries of the open menu; none while it is closed, when the prompt's `items` are not built. */
export const openEntries = (
  open: { readonly hit: MenuHit } | undefined,
  items: () => readonly Choice[],
): Choice[] => (open === undefined ? [] : menuEntries(open.hit, items()));

/** The name of the last entry, which opens the command prompt (SR-194 AK3). */
export const ALL_COMMANDS = "All commands…";

/** A press of a mouse button, as far as the menu reads it. */
export interface Press {
  readonly button: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/** The right button, and on macOS the left one with Ctrl held (not Cmd+Ctrl) (SR-194 AK7). */
export const opensMenu = (press: Press, mac: boolean): boolean =>
  press.button === 2 || (mac && press.button === 0 && press.ctrlKey && !press.metaKey);

/** The left button with Ctrl held on macOS: a press the app takes as a right one (SR-194 AK7). */
export const isMacCtrlPress = (press: Press, mac: boolean): boolean =>
  press.button !== 2 && opensMenu(press, mac);

/** The menu sits this far off the pointer, so the release of a held right button lands on no entry. */
export const POINTER_GAP = 2;
/** The menu keeps at least this far from the window's edges. */
export const EDGE_GAP = 4;

interface Size {
  readonly width: number;
  readonly height: number;
}

/** One axis of `menuPosition`: after the pointer, else before it, inside the window. */
const along = (at: number, size: number, room: number): number => {
  const after = at + POINTER_GAP;
  const start = after + size <= room - EDGE_GAP ? after : at - POINTER_GAP - size;
  return Math.max(EDGE_GAP, Math.min(start, room - EDGE_GAP - size));
};

/**
 * The top left corner of a menu of `size` at `point` in a window of `viewport`: right of and below the
 * pointer, left of or above it where it would not fit, and never outside the window.
 */
export const menuPosition = (
  point: MenuHit["point"],
  size: Size,
  viewport: Size,
): { readonly x: number; readonly y: number } => ({
  x: along(point.x, size.width, viewport.width),
  y: along(point.y, size.height, viewport.height),
});

/** What a key does while the menu is open. */
export type MenuKey =
  | { readonly kind: "move"; readonly step: 1 | -1 }
  | { readonly kind: "first" }
  | { readonly kind: "last" }
  | { readonly kind: "choose" }
  | { readonly kind: "close" }
  /** Any other key closes the menu and does what it does without it. */
  | { readonly kind: "pass" };

/** The keys taken bare (no Ctrl, Alt or Cmd), and with Ctrl alone, by what they do. */
const BARE_KEYS: ReadonlyMap<string, MenuKey> = new Map<string, MenuKey>([
  ["ArrowDown", { kind: "move", step: 1 }],
  ["ArrowUp", { kind: "move", step: -1 }],
  ["Home", { kind: "first" }],
  ["End", { kind: "last" }],
  ["Enter", { kind: "choose" }],
  [" ", { kind: "choose" }],
  ["Escape", { kind: "close" }],
]);
const CTRL_KEYS: ReadonlyMap<string, MenuKey> = new Map<string, MenuKey>([
  ["n", { kind: "move", step: 1 }],
  ["p", { kind: "move", step: -1 }],
]);
const PASS: MenuKey = { kind: "pass" };

/** The keys of the menu: Up/Down and Ctrl+P/N move, Home/End jump, Enter/Space choose, Escape closes. */
export const menuKey = (event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): MenuKey => {
  if (event.altKey || event.metaKey) {
    return PASS;
  }
  if (!event.ctrlKey) {
    return BARE_KEYS.get(event.key) ?? PASS;
  }
  return event.shiftKey ? PASS : (CTRL_KEYS.get(event.key.toLowerCase()) ?? PASS);
};

/** The keys of the open menu (`menuKey`), for the keyboard reference (SR-139 AK5). */
export const CONTEXT_MENU_KEYS: readonly KeyRow[] = [
  { keys: [{ press: press("ArrowDown") }, { press: press("n", true) }], does: "Next entry" },
  { keys: [{ press: press("ArrowUp") }, { press: press("p", true) }], does: "Previous entry" },
  { keys: [{ press: press("Home") }, { press: press("End") }], does: "First or last entry" },
  { keys: [{ press: press("Enter") }, { press: press(" ") }], does: "Run the selected entry" },
  {
    keys: [{ press: press("Escape") }],
    does: "Close the menu; a press of the left button outside closes it too and acts on what it presses",
  },
];

/** The entry selected after `key` among `count` entries; -1: none is selected (the menu opened by the mouse). */
export const menuSelection = (key: MenuKey, selected: number, count: number): number => {
  if (key.kind === "first") {
    return 0;
  }
  if (key.kind === "last") {
    return count - 1;
  }
  if (key.kind !== "move") {
    return selected;
  }
  if (selected < 0) {
    return key.step === 1 ? 0 : count - 1;
  }
  return (selected + key.step + count) % count;
};
