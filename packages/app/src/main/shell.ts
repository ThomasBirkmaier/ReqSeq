// The main process (ADR-0010): one window, the menu, the file dialog that opens a workspace, the
// protocols and the security settings. No program logic (ADR-0002): every command runs in the core
// process, which the renderer reaches over a port.
import type Electron from "electron";
import { handleCopy } from "./clipboard.js";
import { handleWorkspaces } from "./workspaces.js";
import { CoreProcess } from "./core-process.js";
import { menuTemplate } from "./menu.js";
import { APP_SCHEMES, RENDERER_URL, rendererFiles, workspaceFiles } from "./protocols.js";
import { guardContents, secureSession, webPreferences } from "./security.js";
import { workspaceArgument } from "./args.js";
import { SHEET } from "../shared/theme.js";

/** The parts of the `electron` module the main process uses. */
export type ShellElectron = Pick<
  typeof Electron,
  | "app"
  | "BrowserWindow"
  | "clipboard"
  | "dialog"
  | "ipcMain"
  | "Menu"
  | "MessageChannelMain"
  | "nativeTheme"
  | "protocol"
  | "session"
  | "utilityProcess"
>;

export interface ShellOptions {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly platform: NodeJS.Platform;
  /** The built files: preload script, renderer folder, core process entry. */
  readonly paths: { readonly preload: string; readonly renderer: string; readonly core: string };
  /** Local log lines (standard error); never content of elements. */
  readonly log: (line: string) => void;
}

/** Opens the window once Electron is ready; resolves when its page has loaded. */
const ready = async (electron: ShellElectron, options: ShellOptions, core: CoreProcess): Promise<void> => {
  const session = electron.session.defaultSession;
  secureSession(session, options.log);
  session.protocol.handle("app", rendererFiles(options.paths.renderer));
  session.protocol.handle(
    "logreq-file",
    workspaceFiles((url) => core.file(url)),
  );
  const window = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    title: "LogReq",
    // The colour of the sheet in the scheme of the system, so that a dark start does not flash white (SR-113).
    backgroundColor: electron.nativeTheme.shouldUseDarkColors ? SHEET.dark : SHEET.light,
    autoHideMenuBar: true,
    // macOS: no native title bar; the traffic lights lie on the sheet, whose top strip moves the window
    // and names it in the colours of the scheme (#490). Windows and Linux keep the native frame (ADR-0010).
    // The lights are pinned to the middle of the 38 px strip: the inset of `hiddenInset` differs between macOS versions.
    ...(options.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 14, y: 12 } }
      : {}),
    webPreferences: webPreferences(options.paths.preload),
  });
  // The renderer asks for a copy to the clipboard (SR-128), for the workspaces opened last and to open
  // one of them in this window (SR-131): the three channels it has to the main process.
  handleCopy(electron, window.webContents);
  handleWorkspaces(electron, window.webContents, { core, log: options.log });
  window.webContents.on("did-finish-load", () => {
    core.attach(window.webContents);
  });
  const openWorkspace = async (): Promise<void> => {
    const chosen = await electron.dialog.showOpenDialog(window, {
      title: "Open Workspace",
      properties: ["openDirectory"],
    });
    const [folder] = chosen.filePaths;
    if (!chosen.canceled && folder !== undefined) {
      await core.open(folder);
    }
  };
  electron.Menu.setApplicationMenu(
    electron.Menu.buildFromTemplate(
      menuTemplate(
        { platform: options.platform, developer: !electron.app.isPackaged },
        {
          openWorkspace: () => {
            void openWorkspace();
          },
        },
      ),
    ),
  );
  const folder = workspaceArgument(options.argv, options.cwd);
  if (folder !== undefined) {
    // The core process starts while the page loads; the page gets its port once it has loaded.
    void core.open(folder);
  }
  await window.loadURL(RENDERER_URL);
};

/** Sets up the app before Electron is ready (schemes, sandbox, guards) and opens the window when it is. */
export const startShell = (electron: ShellElectron, options: ShellOptions): Promise<void> => {
  const { app } = electron;
  electron.protocol.registerSchemesAsPrivileged(APP_SCHEMES);
  app.enableSandbox();
  app.on("web-contents-created", (_event, contents) => {
    guardContents(contents);
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
  const core = new CoreProcess({
    fork: () => electron.utilityProcess.fork(options.paths.core, [], { serviceName: "LogReq core" }),
    channel: () => new electron.MessageChannelMain(),
    log: options.log,
  });
  // The core process finishes its running writes and closes the workspace before the app ends (it is
  // killed after STOP_TIMEOUT_MS).
  let closing = false;
  app.on("will-quit", (event) => {
    if (closing) {
      return;
    }
    // The recent elements of the overview (SR-118) are in the web storage of the window: written to disk
    // now, as Chromium flushes it lazily.
    electron.session.defaultSession.flushStorageData();
    if (!core.running) {
      return;
    }
    event.preventDefault();
    closing = true;
    void core.stop().then(() => {
      app.quit();
    });
  });
  return app.whenReady().then(() => ready(electron, options, core));
};
