// Keyboard shortcuts of the main view: how a key press is matched and how a shortcut is written. The
// modifier is Ctrl, or Cmd on macOS; a press with either counts, so the same keys work everywhere.

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
}

/**
 * Whether the key of `event` is the letter of `shortcut`. With Cmd and Option held, macOS reports the
 * character Option makes (Cmd+Option+A is "å"), so then the physical key counts. Not with Ctrl+Alt:
 * on Windows that is AltGr, which types a letter of its own on many layouts (AltGr+A is "ą" in Polish)
 * and must stay that letter.
 */
const sameKey = (event: KeyPress, shortcut: Shortcut): boolean =>
  event.key.toLowerCase() === shortcut.key ||
  (shortcut.alt === true && event.metaKey && event.code === `Key${shortcut.key.toUpperCase()}`);

export const matches = (event: KeyPress, shortcut: Shortcut): boolean =>
  (event.ctrlKey || event.metaKey) === shortcut.mod &&
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
 *   list's: it stays Ctrl+P "Go to" on Linux and Windows (SR-118 AK3, SR-115 AK1). With a row selected,
 *   Ctrl+P only moves the selection, also on the first row (AK5).
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
