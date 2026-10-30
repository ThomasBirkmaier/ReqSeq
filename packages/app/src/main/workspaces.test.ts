import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecentWorkspace, RecentWorkspaceState } from "@reqseq/core";
import { findTypedWorkspace, typedWorkspaceFolder } from "@reqseq/core/recent-workspaces";
import type { SaveRequest } from "../shared/protocol.js";
import {
  MAX_ROOT_LENGTH,
  OPEN_WORKSPACE_CHANNEL,
  RECENT_WORKSPACES_CHANNEL,
  SAVED_CHANNEL,
  SAVE_CHANNEL,
} from "../shared/protocol.js";
import { RENDERER_URL } from "./protocols.js";
import type { RecentWorkspacesModule, WorkspaceSwitch, WorkspacesElectron } from "./workspaces.js";
import { CLOSE_SAVE_TIMEOUT_MS } from "./close.js";
import { SAVE_TIMEOUT_MS, handleWorkspaces, loadRecentWorkspaces } from "./workspaces.js";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

/** The web contents of the window: it answers each request to save with `answer` (none: it does not answer). */
class FakeWindow {
  readonly mainFrame = { url: RENDERER_URL };
  readonly sent: { channel: string; request: SaveRequest }[] = [];
  answer: boolean | undefined = true;
  destroyed = false;
  saved: Handler | undefined;

  send(channel: string, request: SaveRequest): void {
    this.sent.push({ channel, request });
    const { answer } = this;
    if (answer !== undefined && request.expired !== true) {
      queueMicrotask(() => {
        this.saved?.(fromWindow, { id: request.id, saved: answer });
      });
    }
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

let contents = new FakeWindow();
let fromWindow = { sender: contents, senderFrame: contents.mainFrame };

const STATES: readonly RecentWorkspaceState[] = [
  { root: "/req/buoy", key: "/srv/buoy", opened: "2026-10-27T10:02:00.000Z", exists: true },
  { root: "/req/station", key: "/req/station", opened: "2026-10-27T10:01:00.000Z", exists: true },
  { root: "/req/gone", key: "/req/gone", opened: "2026-10-27T10:00:00.000Z", exists: false },
];

const setup = (
  options: {
    readonly exists?: boolean;
    readonly load?: () => Promise<RecentWorkspacesModule>;
    readonly home?: string;
    readonly platform?: NodeJS.Platform;
  } = {},
) => {
  contents = new FakeWindow();
  fromWindow = { sender: contents, senderFrame: contents.mainFrame };
  const window = contents;
  const handlers = new Map<string, Handler>();
  const electron = {
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
      on: vi.fn((channel: string, handler: Handler) => {
        if (channel === SAVED_CHANNEL) {
          window.saved = handler;
        }
      }),
    },
  };
  const module = {
    recentWorkspaceStates: vi.fn(() => Promise.resolve(STATES)),
    readRecentWorkspaces: vi.fn(() =>
      Promise.resolve(STATES.map(({ exists: _exists, ...entry }): RecentWorkspace => entry)),
    ),
    workspaceExists: vi.fn(() => Promise.resolve(options.exists ?? true)),
    // Core's own: by the text alone, then upwards on the disk.
    typedWorkspaceFolder: vi.fn(typedWorkspaceFolder),
    findTypedWorkspace: vi.fn(findTypedWorkspace),
  };
  const load = vi.fn(options.load ?? (() => Promise.resolve(module as unknown as RecentWorkspacesModule)));
  const core = {
    running: true,
    key: "/req/station" as string | undefined,
    listedRoot: "/req/station" as string | undefined,
    open: vi.fn<WorkspaceSwitch["open"]>(() => Promise.resolve()),
  };
  const page = { loaded: true };
  const log = vi.fn<(line: string) => void>();
  const workspaces = handleWorkspaces(electron as unknown as WorkspacesElectron, window, {
    core,
    load,
    log,
    loaded: () => page.loaded,
    ...(options.home === undefined ? {} : { home: () => options.home ?? "" }),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
  });
  const list = (event: unknown = fromWindow): Promise<unknown> =>
    Promise.resolve(handlers.get(RECENT_WORKSPACES_CHANNEL)?.(event));
  const open = (root: unknown, event: unknown = fromWindow, ...how: unknown[]): Promise<unknown> =>
    Promise.resolve(handlers.get(OPEN_WORKSPACE_CHANNEL)?.(event, root, ...how));
  const typed = (text: string): Promise<unknown> => open(text, fromWindow, { typed: true });
  return { module, load, core, log, list, open, typed, window, page, workspaces };
};

let top = "";

afterEach(async () => {
  vi.useRealTimers();
  if (top !== "") {
    await fs.rm(top, { recursive: true, force: true });
    top = "";
  }
});

/** A folder in a new test folder, with `reqseq-workspace.yaml`, and a folder inside it without one. */
const workspaceOnDisk = async (): Promise<{ readonly root: string; readonly inside: string }> => {
  top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-typed-")));
  const root = path.join(top, "station");
  const inside = path.join(root, "requirements", "system");
  await fs.mkdir(inside, { recursive: true });
  await fs.writeFile(path.join(root, "reqseq-workspace.yaml"), "reqseq-workspace: 1\n");
  return { root, inside };
};

describe("the recent workspaces channels (SR-131)", () => {
  it("[SR-131/AK1] the recent workspaces come from core in their order, the open one first and marked open", async () => {
    const { list, load, core } = setup();
    expect(await list()).toEqual([
      { root: "/req/station", state: "open" },
      { root: "/req/buoy", state: "found" },
      { root: "/req/gone", state: "missing" },
    ]);
    // Opened just now: the core process has not written it to the stored list yet (#423).
    core.key = "/req/harbour";
    core.listedRoot = "/req/Harbour";
    expect(await list()).toEqual([
      { root: "/req/Harbour", state: "open" },
      { root: "/req/buoy", state: "found" },
      { root: "/req/station", state: "found" },
      { root: "/req/gone", state: "missing" },
    ]);
    // A folder without a workspace is open, which the list does not hold.
    core.listedRoot = undefined;
    expect(await list()).toEqual([
      { root: "/req/buoy", state: "found" },
      { root: "/req/station", state: "found" },
      { root: "/req/gone", state: "missing" },
    ]);
    // Without an open workspace none is open; core's module is loaded once.
    core.key = undefined;
    expect(await list()).toEqual([
      { root: "/req/buoy", state: "found" },
      { root: "/req/station", state: "found" },
      { root: "/req/gone", state: "missing" },
    ]);
    expect(load).toHaveBeenCalledOnce();
  });

  it("[SR-131/AK2] opening a found root stops the running core process and opens the root in the same window", async () => {
    const { open, core, module, window } = setup();
    expect(await open("/req/buoy")).toEqual({ ok: true });
    // The window saved its input first (AK3).
    expect(window.sent).toEqual([{ channel: SAVE_CHANNEL, request: { id: 1 } }]);
    // `CoreProcess.open` stops the running core process and tells this window (core-process.test.ts).
    expect(core.open).toHaveBeenCalledExactlyOnceWith("/req/buoy", { exact: true });
    expect(module.workspaceExists).toHaveBeenCalledExactlyOnceWith("/req/buoy");
  });

  it("[SR-131/AK4] opening a root that is gone answers missing and leaves the running core process alone", async () => {
    const { open, core, window } = setup({ exists: false });
    expect(await open("/req/gone")).toEqual({ ok: false, reason: "missing" });
    expect(core.open).not.toHaveBeenCalled();
    // Nothing to switch to: the window is not asked to save.
    expect(window.sent).toEqual([]);
  });

  it("refuses a request that is not from the main frame of the ReqSeq window, not a string, not a root of the list, longer than 4096 or holding NUL", async () => {
    const { open, list, core, module } = setup();
    const other = { mainFrame: { url: RENDERER_URL } };
    const elsewhere = { sender: other, senderFrame: other.mainFrame };
    expect(await list(elsewhere)).toEqual([]);
    expect(await open("/req/buoy", elsewhere)).toEqual({ ok: false, reason: "refused" });
    // Refused before anything is read.
    for (const root of [undefined, 3, ["/req/buoy"], `/${"x".repeat(MAX_ROOT_LENGTH)}`, "/req/buoy\0"]) {
      expect(await open(root)).toEqual({ ok: false, reason: "refused" });
    }
    expect(module.readRecentWorkspaces).not.toHaveBeenCalled();
    expect(module.recentWorkspaceStates).not.toHaveBeenCalled();
    // Only a root of the list, character for character: no other folder, no other spelling.
    for (const root of [
      "/req",
      "/req/buoy/",
      "/REQ/buoy",
      "/srv/buoy",
      "req/buoy",
      "\\\\host\\share\\spec",
    ]) {
      expect(await open(root)).toEqual({ ok: false, reason: "refused" });
    }
    expect(module.workspaceExists).not.toHaveBeenCalled();
    expect(core.open).not.toHaveBeenCalled();
  });

  it("[SR-131/AK3] the window saves its unsaved input before main opens another workspace, and nothing opens when it could not", async () => {
    const { open, core, window, workspaces } = setup();
    const order: string[] = [];
    const send = window.send.bind(window);
    window.send = (channel, request) => {
      order.push(`save ${String(request.id)}`);
      send(channel, request);
    };
    core.open.mockImplementation((folder) => {
      order.push(`open ${folder}`);
      return Promise.resolve();
    });
    expect(await open("/req/buoy")).toEqual({ ok: true });
    expect(await workspaces.openFolder("/chosen")).toEqual({ ok: true });
    expect(order).toEqual(["save 1", "open /req/buoy", "save 2", "open /chosen"]);
    // File > Open Workspace finds the root upwards (else the folder itself, for workspace.init).
    expect(core.open.mock.calls[1]).toEqual(["/chosen", { exact: false }]);
    // The window could not save: the open workspace stays.
    window.answer = false;
    expect(await open("/req/buoy")).toEqual({ ok: false, reason: "unsaved" });
    expect(await workspaces.openFolder("/chosen")).toEqual({ ok: false, reason: "unsaved" });
    expect(core.open).toHaveBeenCalledTimes(2);
  });

  it("[SR-131/AK3] no answer from the window keeps the open workspace, says timeout and tells the window: the switch never carries on without it", async () => {
    vi.useFakeTimers();
    const { open, core, window, log } = setup();
    window.answer = undefined;
    const answer = vi.fn();
    void open("/req/buoy").then(answer);
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS - 1);
    expect(answer).not.toHaveBeenCalled();
    // An answer from elsewhere, of another shape or to another request is no answer.
    const other = new FakeWindow();
    window.saved?.({ sender: other, senderFrame: other.mainFrame }, { id: 1, saved: true });
    window.saved?.(fromWindow, { id: 1, saved: "yes" });
    window.saved?.(fromWindow, { id: 2, saved: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toHaveBeenCalledExactlyOnceWith({ ok: false, reason: "timeout" });
    expect(core.open).not.toHaveBeenCalled();
    // The window learns it, so it can say why nothing opened.
    expect(window.sent).toEqual([
      { channel: SAVE_CHANNEL, request: { id: 1 } },
      { channel: SAVE_CHANNEL, request: { id: 1, expired: true } },
    ]);
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "The window did not say whether its unsaved input was saved; the workspace stays open",
    );
    // A late answer changes nothing.
    window.saved?.(fromWindow, { id: 1, saved: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(core.open).not.toHaveBeenCalled();
    // A window closed while main waited is told nothing.
    void open("/req/buoy").then(answer);
    await vi.advanceTimersByTimeAsync(0);
    expect(window.sent).toHaveLength(3);
    window.destroyed = true;
    await vi.advanceTimersByTimeAsync(SAVE_TIMEOUT_MS);
    expect(answer).toHaveBeenLastCalledWith({ ok: false, reason: "timeout" });
    expect(window.sent).toHaveLength(3);
  });

  it("[SR-105/AK1] before the window closes main asks it to save, with closing, and waits at most CLOSE_SAVE_TIMEOUT_MS, then tells it (#611 review N1)", async () => {
    vi.useFakeTimers();
    const { window, workspaces, log } = setup();
    const closing = workspaces.saveBeforeClose();
    await vi.advanceTimersByTimeAsync(0);
    expect(await closing).toBe(true);
    window.answer = false;
    expect(await workspaces.saveBeforeClose()).toBe(false);
    expect(window.sent).toEqual([
      { channel: SAVE_CHANNEL, request: { id: 1, closing: true } },
      { channel: SAVE_CHANNEL, request: { id: 2, closing: true } },
    ]);
    // No answer: a timeout after CLOSE_SAVE_TIMEOUT_MS; the window is told (expired, closing), and nothing is logged here.
    window.answer = undefined;
    const answer = vi.fn();
    void workspaces.saveBeforeClose().then(answer);
    await vi.advanceTimersByTimeAsync(CLOSE_SAVE_TIMEOUT_MS - 1);
    expect(answer).not.toHaveBeenCalled();
    expect(window.sent).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toHaveBeenCalledExactlyOnceWith("timeout");
    expect(window.sent.slice(2)).toEqual([
      { channel: SAVE_CHANNEL, request: { id: 3, closing: true } },
      { channel: SAVE_CHANNEL, request: { id: 3, expired: true, closing: true } },
    ]);
    expect(log).not.toHaveBeenCalled();
    // A window closed while main waited is told nothing.
    void workspaces.saveBeforeClose().then(answer);
    await vi.advanceTimersByTimeAsync(0);
    window.destroyed = true;
    await vi.advanceTimersByTimeAsync(CLOSE_SAVE_TIMEOUT_MS);
    expect(answer).toHaveBeenLastCalledWith("timeout");
    expect(window.sent).toHaveLength(5);
  });

  it("[SR-131/AK3] one switch at a time: a second one while the first waits answers busy and asks for no second save", async () => {
    const { open, core, window, workspaces } = setup();
    window.answer = undefined;
    const first = open("/req/buoy");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await open("/req/buoy")).toEqual({ ok: false, reason: "busy" });
    expect(await workspaces.openFolder("/chosen")).toEqual({ ok: false, reason: "busy" });
    expect(window.sent).toHaveLength(1);
    // Busy until the other workspace is open.
    let opened: () => void = () => undefined;
    core.open.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          opened = resolve;
        }),
    );
    window.saved?.(fromWindow, { id: 1, saved: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(core.open).toHaveBeenCalledOnce();
    expect(await workspaces.openFolder("/chosen")).toEqual({ ok: false, reason: "busy" });
    opened();
    expect(await first).toEqual({ ok: true });
    // Then the next switch runs; a timeout or a failed save frees it too.
    window.answer = false;
    expect(await workspaces.openFolder("/chosen")).toEqual({ ok: false, reason: "unsaved" });
    window.answer = true;
    expect(await workspaces.openFolder("/chosen")).toEqual({ ok: true });
  });

  it("without an open workspace, before the page has loaded or without a window, main opens at once", async () => {
    const { open, core, window, page, workspaces } = setup();
    window.answer = undefined;
    core.running = false;
    expect(await open("/req/buoy")).toEqual({ ok: true });
    core.running = true;
    page.loaded = false;
    expect(await workspaces.openFolder("/chosen")).toEqual({ ok: true });
    page.loaded = true;
    window.destroyed = true;
    expect(await open("/req/buoy")).toEqual({ ok: true });
    expect(window.sent).toEqual([]);
    expect(core.open).toHaveBeenCalledTimes(3);
  });

  it("[SR-131/AK5] a typed folder opens the workspace found from it upwards", async () => {
    const { root, inside } = await workspaceOnDisk();
    const { typed, core, window, module } = setup();
    expect(await typed(inside)).toEqual({ ok: true });
    expect(await typed(`${root}/`)).toEqual({ ok: true });
    // The root as found, exactly: the core process opens that folder, and records it (it comes first).
    expect(core.open.mock.calls).toEqual([
      [root, { exact: true }],
      [root, { exact: true }],
    ]);
    expect(window.sent).toHaveLength(2);
    // Not limited to the list, and not checked against it.
    expect(module.readRecentWorkspaces).not.toHaveBeenCalled();
  });

  it("a typed folder without a workspace answers no-workspace and leaves the running core process alone", async () => {
    const { inside } = await workspaceOnDisk();
    await fs.rm(path.join(path.dirname(path.dirname(inside)), "reqseq-workspace.yaml"));
    const { typed, core, window } = setup();
    expect(await typed(inside)).toEqual({ ok: false, reason: "no-workspace" });
    expect(core.open).not.toHaveBeenCalled();
    expect(window.sent).toEqual([]);
  });

  it("~ is the home folder, and a relative or UNC path is refused before any file-system call", async () => {
    const { root } = await workspaceOnDisk();
    const home = setup({ home: path.dirname(root) });
    expect(await home.typed(`~/${path.basename(root)}`)).toEqual({ ok: true });
    expect(home.core.open).toHaveBeenCalledExactlyOnceWith(root, { exact: true });
    const { typed, core, module } = setup();
    for (const text of ["req/spec", "./spec", "~ada/spec", "", "/req\0/spec"]) {
      expect(await typed(text), text).toEqual({ ok: false, reason: "refused" });
    }
    const windows = setup({ platform: "win32", home: "C:\\Users\\ada" });
    for (const text of ["\\\\host\\share\\spec", "//host/share/spec", "\\\\?\\C:\\Work", "Work"]) {
      expect(await windows.typed(text), text).toEqual({ ok: false, reason: "refused" });
    }
    expect(module.findTypedWorkspace).not.toHaveBeenCalled();
    expect(windows.module.findTypedWorkspace).not.toHaveBeenCalled();
    expect(core.open).not.toHaveBeenCalled();
    expect(windows.core.open).not.toHaveBeenCalled();
    // `~` is `os.homedir()` by default.
    const plain = setup();
    await plain.typed("~");
    expect(plain.module.typedWorkspaceFolder).toHaveBeenCalledExactlyOnceWith("~", {
      platform: process.platform,
      home: os.homedir(),
    });
  });

  it("a failed import of core's module is tried again on the next request", async () => {
    const module = setup().module as unknown as RecentWorkspacesModule;
    const load = vi
      .fn<() => Promise<RecentWorkspacesModule>>()
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValue(module);
    const { list } = setup({ load });
    expect(await list()).toEqual([]);
    expect(await list()).toHaveLength(3);
    expect(await list()).toHaveLength(3);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a list that cannot be read answers an empty list", async () => {
    for (const failure of [new Error("Cannot find module"), "odd" as unknown as Error]) {
      const { list, open, log, core } = setup({ load: () => Promise.reject(failure) });
      expect(await list()).toEqual([]);
      expect(await open("/req/buoy")).toEqual({ ok: false, reason: "refused" });
      const message = failure instanceof Error ? failure.message : String(failure);
      expect(log.mock.calls).toEqual([
        [`The recent workspaces could not be read: ${message}`],
        [`The recent workspaces could not be read: ${message}`],
      ]);
      expect(core.open).not.toHaveBeenCalled();
    }
  });

  it("reads the list with core's module when no loader is given", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-recent-main-"));
    for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
      vi.stubEnv(name, home);
    }
    try {
      const handlers = new Map<string, Handler>();
      const electron = {
        ipcMain: {
          handle: (channel: string, handler: Handler) => {
            handlers.set(channel, handler);
          },
          on: vi.fn(),
        },
      };
      const core = {
        running: false,
        key: undefined,
        listedRoot: undefined,
        open: vi.fn<WorkspaceSwitch["open"]>(() => Promise.resolve()),
      };
      handleWorkspaces(electron as unknown as WorkspacesElectron, contents, {
        core,
        log: vi.fn(),
        loaded: () => true,
      });
      // A cache folder without a list: none opened yet.
      expect(await handlers.get(RECENT_WORKSPACES_CHANNEL)?.(fromWindow)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it("loads core's module of the list alone", async () => {
    const module = await loadRecentWorkspaces();
    expect(typeof module.readRecentWorkspaces).toBe("function");
    expect(typeof module.recentWorkspaceStates).toBe("function");
    expect(typeof module.workspaceExists).toBe("function");
    expect(typeof module.typedWorkspaceFolder).toBe("function");
    expect(typeof module.findTypedWorkspace).toBe("function");
  });
});
