import { describe, expect, it, vi } from "vitest";
import { MENU_KEYS, acceleratorShortcut } from "../shared/menu-keys.js";
import { keySpecLabel } from "../renderer/keys.js";
import { menuTemplate } from "./menu.js";

interface Item {
  readonly accelerator?: string;
  readonly role?: string;
  readonly submenu?: Item[];
}

describe("menuTemplate", () => {
  it("has File > Open Workspace with Ctrl/Cmd+O, quits from File on Windows and Linux, and nothing more", () => {
    const openWorkspace = vi.fn();
    const template = menuTemplate({ platform: "linux", developer: false }, { openWorkspace });
    expect(template.map((item) => item.label ?? item.role)).toEqual(["File", "editMenu"]);
    const file = template[0]?.submenu as {
      label?: string;
      accelerator?: string;
      role?: string;
      click?: () => void;
    }[];
    expect(file[0]).toMatchObject({ label: "Open Workspace…", accelerator: "CmdOrCtrl+O" });
    file[0]?.click?.();
    expect(openWorkspace).toHaveBeenCalledOnce();
    expect(file[2]).toEqual({ role: "quit" });
  });

  it("has the app menu on macOS and closes the window from File", () => {
    const template = menuTemplate({ platform: "darwin", developer: false }, { openWorkspace: vi.fn() });
    expect(template[0]).toEqual({ role: "appMenu" });
    const file = template[1]?.submenu as { role?: string }[];
    expect(file[2]).toEqual({ role: "close" });
  });

  it("adds reload and the developer tools on F5 and F12 in an unpackaged build only", () => {
    const template = menuTemplate({ platform: "linux", developer: true }, { openWorkspace: vi.fn() });
    expect(template.at(-1)).toEqual({
      label: "Developer",
      submenu: [
        { role: "reload", accelerator: "F5" },
        { role: "toggleDevTools", accelerator: "F12" },
      ],
    });
  });

  it("gives the keyboard reference every key the menu binds, read from the menu's own definition", () => {
    const items = (list: readonly Item[]): Item[] =>
      list.flatMap((item) => [item, ...items(item.submenu ?? [])]);
    for (const [platform, mac] of [
      ["linux", false],
      ["darwin", true],
    ] as const) {
      const template = items(
        menuTemplate({ platform, developer: false }, { openWorkspace: vi.fn() }) as Item[],
      );
      const listed = MENU_KEYS.flatMap((row) => row.keys.map((spec) => keySpecLabel(spec, mac)));
      for (const item of template.filter((candidate) => candidate.accelerator !== undefined)) {
        expect(listed).toContain(
          keySpecLabel({ shortcut: acceleratorShortcut(item.accelerator ?? "") }, mac),
        );
      }
      // The role that ends File has Electron's own key: Ctrl+Q to quit, Cmd+W to close.
      const role = template.find((item) => item.role === "quit" || item.role === "close")?.role;
      expect(listed).toContain(role === "quit" ? "Ctrl+Q" : "⌘W");
    }
    expect(acceleratorShortcut("CmdOrCtrl+Shift+Alt+X")).toEqual({
      mod: true,
      shift: true,
      alt: true,
      key: "x",
    });
    expect(acceleratorShortcut("F5")).toEqual({ mod: false, shift: false, key: "f5" });
  });
});
