// The application menu (ADR-0010). Hidden until Alt on Windows and Linux (`autoHideMenuBar`): the
// window shows only what means something (white sheet), the rest comes on demand. Minimal on purpose:
// the keys belong to the command prompt and the buffers that come (D-061..D-063), so the menu binds only
// Ctrl/Cmd+O, quitting (closing on macOS) and the text editing keys of the Edit menu. Help opens the bundled
// documentation (SR-141 AK2), without a key.
import type { MenuItemConstructorOptions } from "electron";
import { FILE_END_ROLE, OPEN_WORKSPACE } from "../shared/menu-keys.js";

export interface MenuActions {
  readonly openWorkspace: () => void;
  /** Help > ReqSeq Documentation (SR-141 AK2). */
  readonly documentation: () => void;
}

/** The item of the Help menu that opens the bundled documentation. */
export const DOCUMENTATION_LABEL = "ReqSeq Documentation";

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
        { ...OPEN_WORKSPACE, click: actions.openWorkspace },
        { type: "separator" },
        { role: mac ? FILE_END_ROLE.mac : FILE_END_ROLE.other },
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
    // The role puts it last on every system, and macOS adds its search of the menus to it.
    { role: "help", submenu: [{ label: DOCUMENTATION_LABEL, click: actions.documentation }] },
  ];
};
