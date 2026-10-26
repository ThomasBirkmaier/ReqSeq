// The application menu (ADR-0010). Hidden until Alt on Windows and Linux (`autoHideMenuBar`): the
// window shows only what means something (white sheet), the rest comes on demand. Minimal on purpose:
// the keys belong to the minibuffer and the buffers that come (D-061..D-063), so the menu binds only
// Ctrl/Cmd+O, quitting (closing on macOS) and the text editing keys of the Edit menu.
import type { MenuItemConstructorOptions } from "electron";

export interface MenuActions {
  readonly openWorkspace: () => void;
}

export interface MenuOptions {
  readonly platform: NodeJS.Platform;
  /** An unpackaged build (`app.isPackaged` false): adds reload and the developer tools, on F5 and F12. */
  readonly developer: boolean;
}

export const menuTemplate = (options: MenuOptions, actions: MenuActions): MenuItemConstructorOptions[] => {
  const mac = options.platform === "darwin";
  return [
    ...(mac ? [{ role: "appMenu" } as const] : []),
    {
      label: "File",
      submenu: [
        { label: "Open Workspace…", accelerator: "CmdOrCtrl+O", click: actions.openWorkspace },
        { type: "separator" },
        mac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    ...(options.developer
      ? [
          {
            label: "Developer",
            submenu: [
              { role: "reload", accelerator: "F5" },
              { role: "toggleDevTools", accelerator: "F12" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
  ];
};
