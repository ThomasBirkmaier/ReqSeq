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
