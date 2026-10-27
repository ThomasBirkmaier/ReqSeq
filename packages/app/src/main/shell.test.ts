import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CoreRequest } from "../shared/protocol.js";
import { COPY_CHANNEL, WORKSPACE_CHANNEL } from "../shared/protocol.js";
import { RENDERER_URL } from "./protocols.js";
import type { ShellElectron, ShellOptions } from "./shell.js";
import { startShell } from "./shell.js";

class FakeChild extends EventEmitter {
  readonly sent: CoreRequest[] = [];

  postMessage(message: CoreRequest): void {
    this.sent.push(message);
    if (message.type === "stop") {
      queueMicrotask(() => this.emit("exit", 0));
    }
  }

  kill(): boolean {
    return true;
  }
}

class FakeContents extends EventEmitter {
  readonly mainFrame = { url: RENDERER_URL };
  readonly posted: { channel: string; message: unknown }[] = [];

  postMessage(channel: string, message: unknown): void {
    this.posted.push({ channel, message });
  }

  isDestroyed(): boolean {
    return false;
  }
}

type Handler = (...args: unknown[]) => unknown;

const fakeElectron = (dark = false) => {
  const appHandlers = new Map<string, Handler>();
  const ipcHandlers = new Map<string, Handler>();
  const protocolHandlers = new Map<string, (request: { url: string }) => Promise<Response>>();
  const windows: { options: unknown; webContents: FakeContents; loadURL: ReturnType<typeof vi.fn> }[] = [];
  const children: FakeChild[] = [];
  const electron = {
    app: {
      on: vi.fn((event: string, handler: Handler) => {
        appHandlers.set(event, handler);
      }),
      enableSandbox: vi.fn(),
      quit: vi.fn(),
      whenReady: () => Promise.resolve(),
      isPackaged: false,
    },
    protocol: { registerSchemesAsPrivileged: vi.fn() },
    session: {
      defaultSession: {
        protocol: {
          handle: vi.fn((scheme: string, handler: (request: { url: string }) => Promise<Response>) => {
            protocolHandlers.set(scheme, handler);
          }),
        },
        webRequest: { onBeforeRequest: vi.fn() },
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        setSpellCheckerEnabled: vi.fn(),
        setDevicePermissionHandler: vi.fn(),
        setSpellCheckerDictionaryDownloadURL: vi.fn(),
        on: vi.fn(),
        flushStorageData: vi.fn(),
      },
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        ipcHandlers.set(channel, handler);
      }),
    },
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
    BrowserWindow: class {
      readonly webContents = new FakeContents();
      readonly loadURL = vi.fn(() => Promise.resolve());
      readonly options: unknown;
      constructor(options: unknown) {
        this.options = options;
        windows.push(this);
      }
    },
    nativeTheme: { shouldUseDarkColors: dark },
    dialog: { showOpenDialog: vi.fn() },
    Menu: {
      buildFromTemplate: vi.fn((template: unknown) => ({ template })),
      setApplicationMenu: vi.fn(),
    },
    utilityProcess: {
      fork: vi.fn(() => {
        const child = new FakeChild();
        children.push(child);
        return child;
      }),
    },
    MessageChannelMain: class {
      readonly port1 = { port: 1 };
      readonly port2 = { port: 2 };
    },
  };
  return { electron, appHandlers, ipcHandlers, protocolHandlers, windows, children };
};

const CWD = path.resolve("/home/me");

const options = (argv: readonly string[] = ["electron", "."]): ShellOptions => ({
  argv,
  cwd: CWD,
  platform: "linux",
  paths: { preload: "/out/preload/index.cjs", renderer: "/out/renderer", core: "/out/main/core.js" },
  log: vi.fn(),
});

const start = async (argv?: readonly string[], dark = false) => {
  const fake = fakeElectron(dark);
  await startShell(fake.electron as unknown as ShellElectron, options(argv));
  return fake;
};

/** The click handler of File > Open Workspace. */
const openWorkspaceItem = (electron: ReturnType<typeof fakeElectron>["electron"]): (() => void) => {
  const [template] = electron.Menu.buildFromTemplate.mock.calls[0] as [
    { submenu?: { click?: () => void }[] }[],
  ];
  const click = template[0]?.submenu?.[0]?.click;
  if (click === undefined) {
    throw new Error("no Open Workspace item");
  }
  return click;
};

describe("startShell", () => {
  it("registers the schemes, enables the sandbox and guards every web contents before Electron is ready", async () => {
    const { electron, appHandlers } = await start();
    expect(electron.protocol.registerSchemesAsPrivileged).toHaveBeenCalledOnce();
    expect(electron.app.enableSandbox).toHaveBeenCalledOnce();
    const contents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
    appHandlers.get("web-contents-created")?.({}, contents);
    expect(contents.setWindowOpenHandler).toHaveBeenCalledOnce();
    appHandlers.get("window-all-closed")?.();
    expect(electron.app.quit).toHaveBeenCalledOnce();
  });

  it("[SR-113/AK1] gives the window the sheet colour of the system's scheme, so that a start does not flash", async () => {
    const light = await start(undefined, false);
    expect(light.windows[0]?.options).toMatchObject({ backgroundColor: "#ffffff" });
    const dark = await start(undefined, true);
    expect(dark.windows[0]?.options).toMatchObject({ backgroundColor: "#16181b" });
  });

  it("opens one secured window on the bundled renderer, with the menu and the protocols", async () => {
    const { electron, windows, protocolHandlers } = await start();
    expect(windows).toHaveLength(1);
    expect(windows[0]?.options).toMatchObject({
      title: "LogReq",
      backgroundColor: "#ffffff",
      autoHideMenuBar: true,
      webPreferences: { preload: "/out/preload/index.cjs", sandbox: true, contextIsolation: true },
    });
    expect(windows[0]?.loadURL).toHaveBeenCalledWith(RENDERER_URL);
    expect(electron.session.defaultSession.webRequest.onBeforeRequest).toHaveBeenCalledOnce();
    expect([...protocolHandlers.keys()]).toEqual(["app", "logreq-file"]);
    // An unpackaged build has the Developer menu (reload on F5, developer tools on F12).
    const [menu] = electron.Menu.buildFromTemplate.mock.calls[0] as [{ label?: string }[]];
    expect(menu.at(-1)?.label).toBe("Developer");
    expect(electron.Menu.setApplicationMenu).toHaveBeenCalledWith({
      template: electron.Menu.buildFromTemplate.mock.calls[0]?.[0],
    });
    // No workspace: no core process, nothing to serve.
    const image = await protocolHandlers.get("logreq-file")?.({
      url: "logreq-file://workspace/system/a.png",
    });
    expect(image?.status).toBe(404);
    expect(electron.utilityProcess.fork).not.toHaveBeenCalled();
    windows[0]?.webContents.emit("did-finish-load");
    expect(windows[0]?.webContents.posted).toEqual([
      { channel: WORKSPACE_CHANNEL, message: { open: false } },
    ]);
  });

  it("[SR-128/AK2] answers the copy channel of the window and nothing else puts text on the clipboard", async () => {
    const { electron, ipcHandlers, windows } = await start();
    const contents = windows[0]?.webContents;
    expect([...ipcHandlers.keys()]).toEqual([COPY_CHANNEL]);
    const copied = await ipcHandlers.get(COPY_CHANNEL)?.(
      { sender: contents, senderFrame: contents?.mainFrame },
      "x",
    );
    expect(copied).toBe(true);
    expect(electron.clipboard.writeText).toHaveBeenCalledWith("x");
  });

  it("opens the workspace of --workspace in the core process and connects the page once it has loaded", async () => {
    const { electron, windows, children } = await start(["electron", ".", "--workspace", "ws"]);
    expect(electron.utilityProcess.fork).toHaveBeenCalledWith("/out/main/core.js", [], {
      serviceName: "LogReq core",
    });
    expect(children[0]?.sent).toEqual([{ type: "open", folder: path.join(CWD, "ws") }]);
    windows[0]?.webContents.emit("did-finish-load");
    expect(children[0]?.sent.at(-1)).toEqual({ type: "connect" });
    expect(windows[0]?.webContents.posted).toEqual([{ channel: WORKSPACE_CHANNEL, message: { open: true } }]);
  });

  it("opens the folder chosen in File > Open Workspace, and nothing when the dialog is cancelled", async () => {
    const { electron, children } = await start();
    const click = openWorkspaceItem(electron);
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    click();
    await vi.waitFor(() => {
      expect(electron.dialog.showOpenDialog).toHaveBeenCalledTimes(1);
    });
    expect(electron.dialog.showOpenDialog.mock.calls[0]?.[1]).toEqual({
      title: "Open Workspace",
      properties: ["openDirectory"],
    });
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] });
    click();
    electron.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ["/chosen"] });
    click();
    await vi.waitFor(() => {
      expect(children).toHaveLength(1);
    });
    expect(children[0]?.sent[0]).toEqual({ type: "open", folder: "/chosen" });
  });

  it("closes the workspace before the app quits", async () => {
    const { electron, appHandlers, children } = await start(["electron", ".", "--workspace=/ws"]);
    const event = { preventDefault: vi.fn() };
    appHandlers.get("will-quit")?.(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(children[0]?.sent.at(-1)).toEqual({ type: "stop" });
    await vi.waitFor(() => {
      expect(electron.app.quit).toHaveBeenCalledOnce();
    });
    const again = { preventDefault: vi.fn() };
    appHandlers.get("will-quit")?.(again);
    expect(again.preventDefault).not.toHaveBeenCalled();
  });

  it("quits at once without a workspace", async () => {
    const { appHandlers } = await start();
    const event = { preventDefault: vi.fn() };
    appHandlers.get("will-quit")?.(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("writes the web storage (the recent elements of the overview) to disk when the app quits", async () => {
    const { electron, appHandlers } = await start(["electron", ".", "--workspace=/ws"]);
    appHandlers.get("will-quit")?.({ preventDefault: vi.fn() });
    expect(electron.session.defaultSession.flushStorageData).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(electron.app.quit).toHaveBeenCalledOnce();
    });
    appHandlers.get("will-quit")?.({ preventDefault: vi.fn() });
    expect(electron.session.defaultSession.flushStorageData).toHaveBeenCalledOnce();
  });
});
