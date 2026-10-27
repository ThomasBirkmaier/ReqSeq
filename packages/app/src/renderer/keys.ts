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
  if (event.key === "ArrowDown" || event.key === "Tab") {
    return 1;
  }
  if (event.key === "ArrowUp") {
    return -1;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    const key = event.key.toLowerCase();
    if (key === "n") {
      return 1;
    }
    if (key === "p") {
      return -1;
    }
  }
  return undefined;
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
