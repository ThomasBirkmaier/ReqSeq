// The keys of the application menu (`main/menu.ts`, ADR-0010), which the menu reads from here, and the table of them
// for the keyboard reference (SR-139 AK5). Pure: the documentation generator reads it without Electron.
import type { KeyRow, Shortcut } from "../renderer/keys.js";
import { press } from "../renderer/keys.js";

/** File > Open Workspace… */
export const OPEN_WORKSPACE = { label: "Open Workspace…", accelerator: "CmdOrCtrl+O" } as const;

/** The last item of File: the role that quits on Windows and Linux, and closes the window on macOS. */
export const FILE_END_ROLE = { mac: "close", other: "quit" } as const;

/**
 * Electron's own keys of these roles (its `menu-item-roles`): Close is Ctrl/Cmd+W; Quit is Ctrl+Q on Linux and has
 * no key on Windows, where Alt+F4 of the system closes the window.
 */
const CLOSE: Shortcut = { mod: true, shift: false, key: "w" };
const QUIT: Shortcut = { mod: true, shift: false, key: "q" };

/** Electron's keys of the macOS app menu (role `appMenu`): Hide, Hide Others and Quit. */
const HIDE: Shortcut = { mod: true, shift: false, key: "h" };
const HIDE_OTHERS: Shortcut = { mod: true, shift: false, alt: true, key: "h" };

/** An accelerator of the menu ("CmdOrCtrl+Shift+O") as a shortcut. */
export const acceleratorShortcut = (accelerator: string): Shortcut => {
  const parts = accelerator.split("+");
  return {
    mod: parts.includes("CmdOrCtrl"),
    shift: parts.includes("Shift"),
    ...(parts.includes("Alt") ? { alt: true } : {}),
    key: accelerator.slice(accelerator.lastIndexOf("+") + 1).toLowerCase(),
  };
};

/** The keys of the menu. The Edit menu's keys are the usual text editing keys of the system. */
export const MENU_KEYS: readonly KeyRow[] = [
  {
    keys: [{ shortcut: acceleratorShortcut(OPEN_WORKSPACE.accelerator) }],
    does: "Open a workspace (menu File)",
  },
  {
    keys: [{ shortcut: QUIT, only: "other" }],
    does: "Quit the app (menu File); on Linux only, on Windows Alt+F4 closes the window",
  },
  { keys: [{ shortcut: CLOSE, only: "mac" }], does: "Close the window (menu File)" },
  { keys: [{ shortcut: QUIT, only: "mac" }], does: "Quit the app (app menu)" },
  { keys: [{ shortcut: HIDE, only: "mac" }], does: "Hide the app (app menu)" },
  { keys: [{ shortcut: HIDE_OTHERS, only: "mac" }], does: "Hide the other apps (app menu)" },
  { keys: [{ press: press("Alt"), only: "other" }], does: "Show the hidden menu bar" },
];
