// Keyboard shortcuts of the main view: how a key press is matched and how a shortcut is written. The
// modifier is Ctrl, or Cmd on macOS; a press with either counts, so the same keys work everywhere.

/** A shortcut: the modifier key (Ctrl or Cmd), optionally Shift, and a letter. */
export interface Shortcut {
  readonly mod: boolean;
  readonly shift: boolean;
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
}

export const matches = (event: KeyPress, shortcut: Shortcut): boolean =>
  (event.ctrlKey || event.metaKey) === shortcut.mod &&
  event.shiftKey === shortcut.shift &&
  !event.altKey &&
  event.key.toLowerCase() === shortcut.key;

/** Whether `platform` (`navigator.platform`) is macOS. */
export const isMac = (platform: string): boolean => platform.startsWith("Mac");

/** "Ctrl+Shift+P", or "⌘⇧P" on macOS. */
export const shortcutLabel = (shortcut: Shortcut, mac: boolean): string => {
  const key = shortcut.key.toUpperCase();
  if (mac) {
    return `${shortcut.mod ? "⌘" : ""}${shortcut.shift ? "⇧" : ""}${key}`;
  }
  return [...(shortcut.mod ? ["Ctrl"] : []), ...(shortcut.shift ? ["Shift"] : []), key].join("+");
};
