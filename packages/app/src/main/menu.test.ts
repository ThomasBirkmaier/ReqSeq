import { describe, expect, it, vi } from "vitest";
import { menuTemplate } from "./menu.js";

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
});
