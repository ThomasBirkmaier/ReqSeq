import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RecentWorkspace, RecentWorkspaceState } from "@logreq/core";
import { MAX_ROOT_LENGTH, OPEN_WORKSPACE_CHANNEL, RECENT_WORKSPACES_CHANNEL } from "../shared/protocol.js";
import { RENDERER_URL } from "./protocols.js";
import type { RecentWorkspacesModule, WorkspaceSwitch, WorkspacesElectron } from "./workspaces.js";
import { handleWorkspaces, loadRecentWorkspaces } from "./workspaces.js";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const contents = { mainFrame: { url: RENDERER_URL } };
const fromWindow = { sender: contents, senderFrame: contents.mainFrame };

const STATES: readonly RecentWorkspaceState[] = [
  { root: "/req/buoy", key: "/srv/buoy", opened: "2026-10-27T10:02:00.000Z", exists: true },
  { root: "/req/station", key: "/req/station", opened: "2026-10-27T10:01:00.000Z", exists: true },
  { root: "/req/gone", key: "/req/gone", opened: "2026-10-27T10:00:00.000Z", exists: false },
];

const setup = (
  options: { readonly exists?: boolean; readonly load?: () => Promise<RecentWorkspacesModule> } = {},
) => {
  const handlers = new Map<string, Handler>();
  const electron = {
    ipcMain: {
      handle: vi.fn((channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      }),
    },
  };
  const module = {
    recentWorkspaceStates: vi.fn(() => Promise.resolve(STATES)),
    readRecentWorkspaces: vi.fn(() =>
      Promise.resolve(STATES.map(({ exists: _exists, ...entry }): RecentWorkspace => entry)),
    ),
    workspaceExists: vi.fn(() => Promise.resolve(options.exists ?? true)),
  };
  const load = vi.fn(options.load ?? (() => Promise.resolve(module as unknown as RecentWorkspacesModule)));
  const core = {
    key: "/req/station" as string | undefined,
    open: vi.fn<WorkspaceSwitch["open"]>(() => Promise.resolve()),
  };
  const log = vi.fn<(line: string) => void>();
  handleWorkspaces(electron as unknown as WorkspacesElectron, contents, { core, load, log });
  const list = (event: unknown = fromWindow): Promise<unknown> =>
    Promise.resolve(handlers.get(RECENT_WORKSPACES_CHANNEL)?.(event));
  const open = (root: unknown, event: unknown = fromWindow): Promise<unknown> =>
    Promise.resolve(handlers.get(OPEN_WORKSPACE_CHANNEL)?.(event, root));
  return { module, load, core, log, list, open };
};

describe("the recent workspaces channels (SR-131)", () => {
  it("[SR-131/AK1] the recent workspaces come from core in their order, the open one marked open", async () => {
    const { list, load, core } = setup();
    expect(await list()).toEqual([
      { root: "/req/buoy", state: "found" },
      { root: "/req/station", state: "open" },
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
    const { open, core, module } = setup();
    expect(await open("/req/buoy")).toEqual({ ok: true });
    // `CoreProcess.open` stops the running core process and tells this window (core-process.test.ts).
    expect(core.open).toHaveBeenCalledExactlyOnceWith("/req/buoy", { exact: true });
    expect(module.workspaceExists).toHaveBeenCalledExactlyOnceWith("/req/buoy");
  });

  it("[SR-131/AK4] opening a root that is gone answers missing and leaves the running core process alone", async () => {
    const { open, core } = setup({ exists: false });
    expect(await open("/req/gone")).toEqual({ ok: false, reason: "missing" });
    expect(core.open).not.toHaveBeenCalled();
  });

  it("refuses a request that is not from the main frame of the LogReq window, not a string, not a root of the list, longer than 4096 or holding NUL", async () => {
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
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-recent-main-"));
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
        },
      };
      const core = { key: undefined, open: vi.fn<WorkspaceSwitch["open"]>(() => Promise.resolve()) };
      handleWorkspaces(electron as unknown as WorkspacesElectron, contents, { core, log: vi.fn() });
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
  });
});
