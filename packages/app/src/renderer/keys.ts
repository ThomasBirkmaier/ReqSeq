// Keyboard shortcuts of the main view: how a key press is matched and how a shortcut is written. The
// modifier is Ctrl, or Cmd on macOS. On Linux and Windows a press with Ctrl or Cmd (the Windows or Super
// key) counts; on macOS only Cmd does, because there Ctrl with a letter is the key of the text and the
// lists (Ctrl+P one line up, Ctrl+N one line down, Ctrl+A to the start of the line; SR-122 AK5).

/** A shortcut: the modifier key (Ctrl or Cmd), optionally Shift or Alt (Option on macOS), and a letter. */
export interface Shortcut {
  readonly mod: boolean;
  readonly shift: boolean;
  /** Alt, or Option on macOS; absent is false. */
  readonly alt?: boolean;
  /** Lower case. */
  readonly key: string;
}

/** The part of a key event that decides whether it is `shortcut`. */
export interface KeyPress {
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly key: string;
  /** The physical key (`KeyA`); a test may leave it out. */
  readonly code?: string;
  /** An input method is composing (CJK); absent is false. */
  readonly isComposing?: boolean;
}

/** A Latin letter: what Alt with a letter key gives on Linux and Windows with a Latin layout. */
const LETTER = /^[a-z]$/i;

/**
 * Whether the key of `event` is the letter of `shortcut`. With Option held, macOS reports the character
 * Option makes, not the letter: Cmd+Option+A is "å", Option+N the dead key of "~" ("Dead"), Option+P
 * "π". So for a shortcut with Alt the physical key (`event.code`) counts too:
 *
 * - with Cmd and Option held (⌥⌘A);
 * - with Alt alone (Option+N, SR-115 AK5) when the key is no Latin letter. On Linux and Windows Alt+N
 *   is "n" and matches by the letter; with a Dvorak layout there the letter counts, not the place. On
 *   macOS Option+letter is never the plain letter, so there the place counts, also with Dvorak. A
 *   non-Latin layout (Alt+N is "т" in Russian) matches by the place. Not while an input method composes
 *   (its key is "Process"): the key belongs to the composition.
 *
 * Not with Ctrl+Alt: on Windows that is AltGr, which types a letter of its own on many layouts (AltGr+A
 * is "ą" in Polish) and must stay that letter.
 */
const sameKey = (event: KeyPress, shortcut: Shortcut): boolean =>
  event.key.toLowerCase() === shortcut.key ||
  (shortcut.alt === true &&
    event.code === `Key${shortcut.key.toUpperCase()}` &&
    (event.metaKey || (!event.ctrlKey && event.isComposing !== true && !LETTER.test(event.key))));

/**
 * Whether `event` is `shortcut`, under macOS when `mac`. There the modifier is Cmd only, and a press with
 * the physical Ctrl key is no shortcut at all: it is left to the editor (CodeMirror's Ctrl+P, Ctrl+N,
 * Ctrl+A, Ctrl+E, ...) and to the lists (`ctrlStep`), so Ctrl+P on macOS never jumps (product owner
 * decision, 2026-10-27). On Linux and Windows Ctrl or Cmd counts, as before.
 */
export const matches = (event: KeyPress, shortcut: Shortcut, mac: boolean): boolean =>
  (mac
    ? !event.ctrlKey && event.metaKey === shortcut.mod
    : (event.ctrlKey || event.metaKey) === shortcut.mod) &&
  event.shiftKey === shortcut.shift &&
  event.altKey === (shortcut.alt ?? false) &&
  sameKey(event, shortcut);

/** Whether `platform` (`navigator.platform`) is macOS. */
export const isMac = (platform: string): boolean => platform.startsWith("Mac");

/**
 * Whether `event` is Ctrl/Cmd+click with the main button, without Shift or Alt (SR-132 AK1). Under macOS,
 * as for the keys (`matches`), only Cmd counts: the physical Ctrl+click is the context menu there.
 */
export const isModClick = (
  event: Pick<KeyPress, "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & { readonly button: number },
  mac: boolean,
): boolean =>
  event.button === 0 &&
  !event.altKey &&
  !event.shiftKey &&
  (mac ? event.metaKey && !event.ctrlKey : event.ctrlKey || event.metaKey);

/** Ctrl/Cmd+click, as the keyboard reference writes it (`isModClick`; "click" is no key). */
export const MOD_CLICK: Shortcut = { mod: true, shift: false, key: "click" };

/** Whether `platform` (`navigator.platform`) is Windows. */
export const isWindows = (platform: string): boolean => platform.startsWith("Win");

/**
 * The step of a key in a hit list of the minibuffer (SR-122): 1 down, -1 up, else undefined. Down and
 * Tab, Up, and the physical Ctrl key with N or P (Emacs), on every platform, also on macOS.
 */
export const listStep = (event: KeyPress): 1 | -1 | undefined => {
  if (event.key === "Tab") {
    return 1;
  }
  return rowStep(event);
};

/**
 * Ctrl+N (1) and Ctrl+P (-1), else undefined (SR-122): the physical Ctrl key on every platform, also on
 * macOS, where Cmd+N and Cmd+P do not count. With Shift, Alt or Cmd held the key is another one: Ctrl+Alt
 * is AltGr on Windows.
 */
export const ctrlStep = (event: KeyPress): 1 | -1 | undefined => {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return undefined;
  }
  const key = event.key.toLowerCase();
  return key === "n" ? 1 : key === "p" ? -1 : undefined;
};

/** The step of a key in a list: Down and Ctrl+N 1, Up and Ctrl+P -1, else undefined. */
export const rowStep = (event: KeyPress): 1 | -1 | undefined =>
  event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : ctrlStep(event);

/** A part of a buffer (the elements of a package page) is left with Escape, or with Up or Ctrl+P on its first row. */
export const leavesPart = (event: KeyPress, cursor: number): boolean =>
  event.key === "Escape" || (rowStep(event) === -1 && cursor === 0);

/**
 * The row a key moves the selection of a list in the main window to (SR-122 AK4/AK5), before the list
 * clamps it to its rows; undefined when the key is not the list's. The list takes (prevents) every key
 * this gives a number for. A `cursor` below 0 means that no row is selected: a fresh list shows none.
 *
 * - Down and Ctrl+N go one row down; with no row selected, to the first.
 * - Up and Ctrl+P go one row up. With no row selected, Up selects the first row, and Ctrl+P is not the
 *   list's: on Linux and Windows it stays Ctrl+P "Go to" (SR-118 AK3, SR-115 AK1); on macOS, where "Go
 *   to" is Cmd+P only, it does nothing. With a row selected, the physical Ctrl+P only moves the
 *   selection, also on the first row (AK5), on every platform; Cmd+P on macOS always jumps.
 * - A list without rows takes neither Ctrl+N nor Ctrl+P.
 * - Page Down and Page Up go `screen` rows (none when the list has no `screen`), Home to the first row,
 *   End to the last.
 *
 * A key that acts on "the row" (Enter, and Right and Left where a list has them) selects the first row
 * first when none is selected, and acts on it in the same handler: no key acts on a row that is not shown
 * as selected.
 */
export const rowTarget = (
  event: KeyPress,
  cursor: number,
  length: number,
  screen?: number,
): number | undefined => {
  const ctrl = ctrlStep(event);
  if (ctrl !== undefined) {
    return length === 0 || (ctrl === -1 && cursor < 0) ? undefined : cursor + ctrl;
  }
  // From no row (-1) the sums land where they should once clamped: Down and Up on the first row, Page
  // Down on the last row of the first screen.
  const moves: Readonly<Record<string, number | undefined>> = {
    ArrowDown: cursor + 1,
    ArrowUp: cursor - 1,
    PageDown: screen === undefined ? undefined : cursor + screen,
    PageUp: screen === undefined ? undefined : cursor - screen,
    Home: 0,
    End: length - 1,
  };
  return Object.hasOwn(moves, event.key) ? moves[event.key] : undefined;
};

/** How a key is written: letters in upper case, the others by a name. */
const KEY_NAMES: Readonly<Record<string, { readonly plain: string; readonly mac: string }>> = {
  enter: { plain: "Enter", mac: "↩" },
  click: { plain: "Click", mac: "Click" },
};

/** "Ctrl+Shift+P", or "⌘⇧P" on macOS; "Ctrl+Alt+A", or "⌥⌘A". */
export const shortcutLabel = (shortcut: Shortcut, mac: boolean): string => {
  const named = KEY_NAMES[shortcut.key];
  const key = named === undefined ? shortcut.key.toUpperCase() : mac ? named.mac : named.plain;
  const alt = shortcut.alt === true;
  if (mac) {
    return `${alt ? "⌥" : ""}${shortcut.mod ? "⌘" : ""}${shortcut.shift ? "⇧" : ""}${key}`;
  }
  return [
    ...(shortcut.mod ? ["Ctrl"] : []),
    ...(alt ? ["Alt"] : []),
    ...(shortcut.shift ? ["Shift"] : []),
    key,
  ].join("+");
};

const UNDO: Shortcut = { mod: true, shift: false, key: "z" };
const REDO: Shortcut = { mod: true, shift: true, key: "z" };
const REDO_Y: Shortcut = { mod: true, shift: false, key: "y" };

/**
 * Undo or redo, as the text editor takes them (SR-105 AK2): Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z redoes,
 * and so does Ctrl+Y outside macOS.
 */
export const historyStep = (event: KeyPress, mac: boolean): "undo" | "redo" | undefined => {
  if (matches(event, UNDO, mac)) {
    return "undo";
  }
  return matches(event, REDO, mac) || (!mac && matches(event, REDO_Y, mac)) ? "redo" : undefined;
};

/** The systems a key of the reference is for, when it is not for all of them. */
export type KeyPlatform = "mac" | "other";

/**
 * A key of the keyboard reference (SR-139 AK5): a shortcut, whose modifier is Ctrl or Cmd on macOS, or a key
 * press as it is, such as Down or the physical Ctrl key with N, also on macOS. `only` names the one system.
 */
export type KeySpec =
  | { readonly shortcut: Shortcut; readonly only?: KeyPlatform }
  | { readonly press: KeyPress; readonly only?: KeyPlatform };

/** A row of the keyboard reference: its keys, each of which does the same, and what they do. */
export interface KeyRow {
  readonly keys: readonly KeySpec[];
  readonly does: string;
}

/** A key pressed alone, or with the physical Ctrl key (`ctrl`). */
export const press = (key: string, ctrl = false): KeyPress => ({
  ctrlKey: ctrl,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  key,
});

/** How a key of a press is written: Down, Page Up, Space; a letter in upper case. */
const PRESS_NAMES: Readonly<Record<string, string>> = {
  ArrowDown: "Down",
  ArrowUp: "Up",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  PageDown: "Page Down",
  PageUp: "Page Up",
  " ": "Space",
};

/**
 * "Ctrl+N" and "Down", or "⌃N" and "Down" on macOS, as `shortcutLabel` writes a shortcut (Enter "↩" there).
 */
export const pressLabel = (event: KeyPress, mac: boolean): string => {
  const named = KEY_NAMES[event.key.toLowerCase()];
  const plain = PRESS_NAMES[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  const key = named === undefined ? plain : mac ? named.mac : named.plain;
  if (mac) {
    return `${event.ctrlKey ? "⌃" : ""}${event.altKey ? "⌥" : ""}${event.metaKey ? "⌘" : ""}${event.shiftKey ? "⇧" : ""}${key}`;
  }
  return [
    ...(event.ctrlKey || event.metaKey ? ["Ctrl"] : []),
    ...(event.altKey ? ["Alt"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
    key,
  ].join("+");
};

/** How `spec` is written on macOS (`mac`) or on the other systems; undefined when it is not a key there. */
export const keySpecLabel = (spec: KeySpec, mac: boolean): string | undefined => {
  if (spec.only !== undefined && spec.only !== (mac ? "mac" : "other")) {
    return undefined;
  }
  return "shortcut" in spec ? shortcutLabel(spec.shortcut, mac) : pressLabel(spec.press, mac);
};

/** The keys of a list in the main window that `rowTarget` takes. */
export const LIST_MOVES: readonly KeyRow[] = [
  {
    keys: [{ press: press("ArrowDown") }, { press: press("n", true) }],
    does: "Next row; with no row selected, the first",
  },
  {
    keys: [{ press: press("ArrowUp") }, { press: press("p", true) }],
    does: "Previous row; with no row selected, Up selects the first row and Ctrl+P stays “Go to” on Windows and Linux",
  },
  { keys: [{ press: press("PageDown") }], does: "One screen of rows down" },
  { keys: [{ press: press("PageUp") }], does: "One screen of rows up" },
  { keys: [{ press: press("Home") }], does: "First row" },
  { keys: [{ press: press("End") }], does: "Last row" },
];

/**
 * The keys of a list in the main window: `LIST_MOVES`, and the keys each list view handles on its selected row
 * (`ListView`, `OverviewView`, `ResultView`, `NeighbourhoodView`, `MatrixView`).
 */
export const LIST_KEYS: readonly KeyRow[] = [
  ...LIST_MOVES,
  { keys: [{ press: press("Enter") }], does: "Open the selected row; with no row selected, the first" },
  {
    keys: [{ press: press("ArrowRight") }, { press: press("ArrowLeft") }],
    does: "In the neighbourhood: open or close the tree row, or go to its parent; in the matrix: step through the relations of the row",
  },
];

/** The keys of a hit list in a prompt that `listStep` takes: the next candidate, then the previous one. */
export const PROMPT_MOVES: readonly KeyRow[] = [
  {
    keys: [{ press: press("ArrowDown") }, { press: press("Tab") }, { press: press("n", true) }],
    does: "Next candidate",
  },
  { keys: [{ press: press("ArrowUp") }, { press: press("p", true) }], does: "Previous candidate" },
];

/** The keys of `historyStep`: undo, then redo. */
export const HISTORY_KEYS: readonly KeyRow[] = [
  { keys: [{ shortcut: UNDO }], does: "Undo, in the text, the title and every property box" },
  {
    keys: [{ shortcut: REDO }, { shortcut: REDO_Y, only: "other" }],
    does: "Redo, in the text, the title and every property box",
  },
];
