import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CoreRequest } from "../shared/protocol.js";
import {
  COPY_CHANNEL,
  OPEN_WORKSPACE_CHANNEL,
  RECENT_WORKSPACES_CHANNEL,
  SAVED_CHANNEL,
  SAVE_CHANNEL,
  WORKSPACE_CHANNEL,
} from "../shared/protocol.js";
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
  readonly sent: { channel: string; message: unknown }[] = [];

  postMessage(channel: string, message: unknown): void {
    this.posted.push({ channel, message });
  }

  send(channel: string, message: unknown): void {
    this.sent.push({ channel, message });
  }

  isDestroyed(): boolean {
    return false;
  }
}

type Handler = (...args: unknown[]) => unknown;

const fakeElectron = (dark = false) => {
  const appHandlers = new Map<string, Handler>();
  const ipcHandlers = new Map<string, Handler>();
  const ipcListeners = new Map<string, Handler>();
  const protocolHandlers = new Map<string, (request: { url: string }) => Promise<Response>>();
  const windows: {
    options: unknown;
    webContents: FakeContents;
    loadURL: ReturnType<typeof vi.fn>;
    close: () => void;
    closed: boolean;
  }[] = [];
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
      on: vi.fn((channel: string, handler: Handler) => {
        ipcListeners.set(channel, handler);
      }),
    },
    clipboard: { writeText: vi.fn(() => Promise.resolve()) },
    BrowserWindow: class extends EventEmitter {
      readonly webContents = new FakeContents();
      readonly loadURL = vi.fn(() => Promise.resolve());
      readonly options: unknown;
      /** The window closes as Electron closes it: a `close` that a listener may prevent. */
      readonly close = vi.fn(() => {
        const close = { prevented: false };
        this.emit("close", {
          preventDefault: () => {
            close.prevented = true;
          },
        });
        this.closed = !close.prevented;
      });
      closed = false;
      constructor(options: unknown) {
        super();
        this.options = options;
        windows.push(this);
      }
      isDestroyed(): boolean {
        return this.closed;
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
  return { electron, appHandlers, ipcHandlers, ipcListeners, protocolHandlers, windows, children };
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

  it("hides the native title bar on macOS only, so that the sheet reaches the top of the window (#490)", async () => {
    const mac = fakeElectron(false);
    await startShell(mac.electron as unknown as ShellElectron, { ...options(), platform: "darwin" });
    expect(mac.windows[0]?.options).toMatchObject({
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 12 },
    });
    for (const platform of ["linux", "win32"] as const) {
      const other = fakeElectron(false);
      await startShell(other.electron as unknown as ShellElectron, { ...options(), platform });
      expect(other.windows[0]?.options).not.toHaveProperty("titleBarStyle");
      expect(other.windows[0]?.options).not.toHaveProperty("titleBarOverlay");
      expect(other.windows[0]?.options).not.toHaveProperty("trafficLightPosition");
    }
  });

  it("opens one secured window on the bundled renderer, with the menu and the protocols", async () => {
    const { electron, windows, protocolHandlers } = await start();
    expect(windows).toHaveLength(1);
    expect(windows[0]?.options).toMatchObject({
      title: "ReqSeq",
      backgroundColor: "#ffffff",
      autoHideMenuBar: true,
      webPreferences: { preload: "/out/preload/index.cjs", sandbox: true, contextIsolation: true },
    });
    expect(windows[0]?.loadURL).toHaveBeenCalledWith(RENDERER_URL);
    expect(electron.session.defaultSession.webRequest.onBeforeRequest).toHaveBeenCalledOnce();
    expect([...protocolHandlers.keys()]).toEqual(["app", "reqseq-file"]);
    // An unpackaged build has the Developer menu (reload on F5, developer tools on F12).
    const [menu] = electron.Menu.buildFromTemplate.mock.calls[0] as [{ label?: string }[]];
    expect(menu.at(-1)?.label).toBe("Developer");
    expect(electron.Menu.setApplicationMenu).toHaveBeenCalledWith({
      template: electron.Menu.buildFromTemplate.mock.calls[0]?.[0],
    });
    // No workspace: no core process, nothing to serve.
    const image = await protocolHandlers.get("reqseq-file")?.({
      url: "reqseq-file://workspace/system/a.png",
    });
    expect(image?.status).toBe(404);
    expect(electron.utilityProcess.fork).not.toHaveBeenCalled();
    windows[0]?.webContents.emit("did-finish-load");
    expect(windows[0]?.webContents.posted).toEqual([
      { channel: WORKSPACE_CHANNEL, message: { open: false } },
    ]);
  });

  it("[SR-128/AK2] answers the copy channel of the window and nothing else puts text on the clipboard", async () => {
    const { electron, ipcHandlers, ipcListeners, windows } = await start();
    const contents = windows[0]?.webContents;
    // The four channels from the renderer: the clipboard (SR-128), the recent workspaces and the answer
    // whether the window saved before a switch (SR-131).
    expect([...ipcHandlers.keys()]).toEqual([
      COPY_CHANNEL,
      RECENT_WORKSPACES_CHANNEL,
      OPEN_WORKSPACE_CHANNEL,
    ]);
    expect([...ipcListeners.keys()]).toEqual([SAVED_CHANNEL]);
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
      serviceName: "ReqSeq core",
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

  it("[SR-131/AK3] File > Open Workspace has the loaded window save its input first, and keeps the workspace when it could not", async () => {
    const shell = options(["electron", ".", "--workspace=/ws"]);
    const { electron, children, windows, ipcListeners } = fakeElectron(false);
    await startShell(electron as unknown as ShellElectron, shell);
    const contents = windows[0]?.webContents;
    const answer = (id: number, saved: boolean): void => {
      ipcListeners.get(SAVED_CHANNEL)?.(
        { sender: contents, senderFrame: contents?.mainFrame },
        { id, saved },
      );
    };
    const click = openWorkspaceItem(electron);
    contents?.emit("did-start-loading");
    contents?.emit("did-finish-load");
    electron.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/chosen"] });
    click();
    await vi.waitFor(() => {
      expect(contents?.sent).toEqual([{ channel: SAVE_CHANNEL, message: { id: 1 } }]);
    });
    // The folder stays in main, and nothing opens until the window answers.
    expect(children).toHaveLength(1);
    // A second File > Open Workspace meanwhile opens nothing, asks for no second save, and says so in the log.
    click();
    await vi.waitFor(() => {
      expect(shell.log).toHaveBeenCalledWith(
        "File > Open Workspace opened nothing: another workspace is being opened",
      );
    });
    expect(contents?.sent).toHaveLength(1);
    answer(1, false);
    click();
    await vi.waitFor(() => {
      expect(contents?.sent).toHaveLength(2);
    });
    expect(children).toHaveLength(1);
    answer(2, true);
    await vi.waitFor(() => {
      expect(children).toHaveLength(2);
    });
    expect(children[1]?.sent[0]).toEqual({ type: "open", folder: "/chosen" });
    // While the page reloads it holds no input: the switch does not ask.
    contents?.emit("did-start-loading");
    click();
    await vi.waitFor(() => {
      expect(children).toHaveLength(3);
    });
    expect(contents?.sent).toHaveLength(2);
  });

  it("[SR-105/AK3] shows no save dialog and no message box: the one dialog is the folder dialog of File > Open Workspace", async () => {
    const fake = fakeElectron(false);
    const others = {
      showSaveDialog: vi.fn(),
      showSaveDialogSync: vi.fn(),
      showMessageBox: vi.fn(),
      showMessageBoxSync: vi.fn(),
      showErrorBox: vi.fn(),
      showCertificateTrustDialog: vi.fn(),
    };
    Object.assign(fake.electron.dialog, others);
    await startShell(
      fake.electron as unknown as ShellElectron,
      options(["electron", ".", "--workspace=/ws"]),
    );
    const contents = fake.windows[0]?.webContents;
    contents?.emit("did-finish-load");
    fake.electron.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ["/chosen"] });
    openWorkspaceItem(fake.electron)();
    await vi.waitFor(() => {
      expect(contents?.sent).toHaveLength(1);
    });
    fake.ipcListeners.get(SAVED_CHANNEL)?.(
      { sender: contents, senderFrame: contents?.mainFrame },
      { id: 1, saved: false },
    );
    // Closing the window with input that cannot be saved: it stays open, and no dialog says so.
    const window = fake.windows[0];
    window?.close();
    await vi.waitFor(() => {
      expect(contents?.sent).toHaveLength(2);
    });
    fake.ipcListeners.get(SAVED_CHANNEL)?.(
      { sender: contents, senderFrame: contents?.mainFrame },
      { id: 2, saved: false },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window?.closed).toBe(false);
    fake.appHandlers.get("window-all-closed")?.();
    fake.appHandlers.get("will-quit")?.({ preventDefault: vi.fn() });
    await vi.waitFor(() => {
      expect(fake.electron.app.quit).toHaveBeenCalled();
    });
    expect(fake.electron.dialog.showOpenDialog).toHaveBeenCalledOnce();
    for (const shown of Object.values(others)) {
      expect(shown).not.toHaveBeenCalled();
    }
  });

  it("[SR-105/AK1] closing the window asks it to save first and closes it once everything is saved", async () => {
    const fake = await start(["electron", ".", "--workspace=/ws"]);
    const window = fake.windows[0];
    const contents = window?.webContents;
    contents?.emit("did-finish-load");
    const answer = (id: number, saved: boolean): void => {
      fake.ipcListeners.get(SAVED_CHANNEL)?.(
        { sender: contents, senderFrame: contents?.mainFrame },
        { id, saved },
      );
    };
    window?.close();
    expect(window?.closed).toBe(false);
    expect(contents?.sent).toEqual([{ channel: SAVE_CHANNEL, message: { id: 1, closing: true } }]);
    answer(1, false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(window?.closed).toBe(false);
    window?.close();
    expect(contents?.sent).toHaveLength(2);
    answer(2, true);
    await vi.waitFor(() => {
      expect(window?.closed).toBe(true);
    });
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
