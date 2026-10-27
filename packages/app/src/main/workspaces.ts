// The workspaces opened last and the switch between them (SR-131, ADR-0010): channels from the renderer
// to the main process. They go to main, not over the port, because no core process runs while no
// workspace is open, and switching the workspace of the window is main's job. The list is core's
// (`@logreq/core/recent-workspaces`: order, keys, existence checks, typed paths), loaded on the first
// request, so the start of main loads no part of core; main only marks the entry its core process has
// open.
//
// Before any switch, also File > Open Workspace, main asks the window to save its unsaved input
// (SAVE_CHANNEL, answered on SAVED_CHANNEL) and opens the other workspace only when the window answers
// that it is saved (AK3): a failure, or no answer within SAVE_TIMEOUT_MS, keeps the open workspace, and
// on a timeout the window is told (`expired`), so it can say why. The switch never carries on without
// the answer. One switch runs at a time: from the request to save until the other workspace is open, a
// second one answers `busy` and asks for no second save.
//
// The renderer is not trusted. Every channel takes only messages from the main frame of the LogReq
// window (`sender.ts`). An open takes a root that is, character for character, a root of the stored
// list, read again for each request, or (`typed`) a typed folder path that core's lexical check takes
// (absolute or `~`, no UNC path, no NUL, at most 4096 characters) before any file-system call, and only
// when a folder from it upwards holds a workspace file: a renderer never opens a folder without a
// workspace. Main makes no synchronous file-system call here (a hung share would freeze the window): the
// keys are stored, and the existence checks are core's asynchronous, bounded ones.
import os from "node:os";
import type Electron from "electron";
import type {
  findTypedWorkspace,
  readRecentWorkspaces,
  recentWorkspaceStates,
  typedWorkspaceFolder,
  workspaceExists,
} from "@logreq/core/recent-workspaces";
import type { OpenWorkspaceResult, RecentWorkspaceEntry, SaveRequest } from "../shared/protocol.js";
import {
  MAX_ROOT_LENGTH,
  OPEN_WORKSPACE_CHANNEL,
  RECENT_WORKSPACES_CHANNEL,
  SAVED_CHANNEL,
  SAVE_CHANNEL,
  saveAnswer,
} from "../shared/protocol.js";
import type { WindowContents } from "./sender.js";
import { fromLogReqWindow } from "./sender.js";

/** The parts of core's module of the list that main uses. */
export interface RecentWorkspacesModule {
  readonly readRecentWorkspaces: typeof readRecentWorkspaces;
  readonly recentWorkspaceStates: typeof recentWorkspaceStates;
  readonly workspaceExists: typeof workspaceExists;
  readonly typedWorkspaceFolder: typeof typedWorkspaceFolder;
  readonly findTypedWorkspace: typeof findTypedWorkspace;
}

/** The parts of the `electron` module the handlers use. */
export type WorkspacesElectron = Pick<typeof Electron, "ipcMain">;

/** The part of `CoreProcess` the handlers use. */
export interface WorkspaceSwitch {
  /** Whether a core process runs, so a workspace is open. */
  readonly running: boolean;
  /** The key of the open workspace in the list, undefined while none is open. */
  readonly key: string | undefined;
  /** Opens `folder` in the window in place of the open workspace; never rejects. */
  open(folder: string, options: { readonly exact: boolean }): Promise<void>;
}

/** The parts of the window's web contents the handlers use. */
export interface WorkspaceWindow extends WindowContents {
  send(channel: string, request: SaveRequest): void;
  isDestroyed(): boolean;
}

export interface WorkspacesOptions {
  readonly core: WorkspaceSwitch;
  /** Whether the page of the window has loaded: only a loaded page can hold unsaved input. */
  readonly loaded: () => boolean;
  /** Loads core's module of the list; default `loadRecentWorkspaces`. */
  readonly load?: () => Promise<RecentWorkspacesModule>;
  readonly log: (line: string) => void;
  /** The home folder, which `~` of a typed path stands for; default `os.homedir()`. */
  readonly home?: () => string;
  /** The platform of the typed paths; default this process's. */
  readonly platform?: NodeJS.Platform;
  /** Default SAVE_TIMEOUT_MS. */
  readonly saveTimeoutMs?: number;
}

/** What `handleWorkspaces` gives the rest of main. */
export interface Workspaces {
  /**
   * Opens `folder` in the window once the window saved its unsaved input (File > Open Workspace; the
   * root is found upwards, else the folder itself). Opens nothing when the input could not be saved
   * (`unsaved`, `timeout`) or another switch runs (`busy`).
   */
  openFolder(folder: string): Promise<OpenWorkspaceResult>;
}

/**
 * How long main waits for the window to save before a switch. No answer by then keeps the open
 * workspace: the switch never carries on without the window's answer (SR-131 AK3).
 */
export const SAVE_TIMEOUT_MS = 30_000;

/** Core's module of the list, without the rest of core (no schema validator, no command). */
export const loadRecentWorkspaces = (): Promise<RecentWorkspacesModule> =>
  import("@logreq/core/recent-workspaces");

const OPENED: OpenWorkspaceResult = { ok: true };
const REFUSED: OpenWorkspaceResult = { ok: false, reason: "refused" };
const MISSING: OpenWorkspaceResult = { ok: false, reason: "missing" };
const UNSAVED: OpenWorkspaceResult = { ok: false, reason: "unsaved" };
const TIMEOUT: OpenWorkspaceResult = { ok: false, reason: "timeout" };
const BUSY: OpenWorkspaceResult = { ok: false, reason: "busy" };
const NO_WORKSPACE: OpenWorkspaceResult = { ok: false, reason: "no-workspace" };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Whether `root` can be a root or a typed path at all; checked before anything is read. */
const plausibleRoot = (root: unknown): root is string =>
  typeof root === "string" && root.length <= MAX_ROOT_LENGTH && !root.includes("\0");

/** Whether the second argument of an open asks for a typed path. */
const isTyped = (how: unknown): boolean =>
  typeof how === "object" && how !== null && (how as { readonly typed?: unknown }).typed === true;

/**
 * Answers RECENT_WORKSPACES_CHANNEL with the list, the most recent first, each `open` (the workspace of
 * the running core process), `found` or `missing`, and OPEN_WORKSPACE_CHANNEL by opening a root of the
 * list, or the workspace of a typed folder path, in the window with these web contents (`exact`: the
 * root itself, never a workspace above it), after the window saved its unsaved input. A request from
 * anywhere else gets the empty list or `refused`; a root whose workspace file is gone gets `missing`, a
 * typed folder without a workspace `no-workspace`, input that could not be saved `unsaved`, and the
 * running core process is not touched (SR-131 AK3, AK4, AK5).
 */
export const handleWorkspaces = (
  electron: WorkspacesElectron,
  contents: WorkspaceWindow,
  options: WorkspacesOptions,
): Workspaces => {
  let loaded: Promise<RecentWorkspacesModule> | undefined;
  // A failed import is tried again on the next request.
  const recent = (): Promise<RecentWorkspacesModule> =>
    (loaded ??= (options.load ?? loadRecentWorkspaces)().catch((error: unknown) => {
      loaded = undefined;
      throw error;
    }));

  // The requests to save that wait for the window's answer, by number.
  const waiting = new Map<number, (saved: boolean | "timeout") => void>();
  let nextSave = 1;
  electron.ipcMain.on(SAVED_CHANNEL, (event, value: unknown) => {
    const answer = fromLogReqWindow(event, contents) ? saveAnswer(value) : undefined;
    if (answer !== undefined) {
      waiting.get(answer.id)?.(answer.saved);
    }
  });
  /** Asks the window to save its unsaved input; resolves whether it is saved, or `timeout`. */
  const saved = (): Promise<boolean | "timeout"> => {
    // Without an open workspace, or before the page has loaded, nothing can be unsaved.
    if (!options.core.running || !options.loaded() || contents.isDestroyed()) {
      return Promise.resolve(true);
    }
    const id = nextSave++;
    return new Promise((resolve) => {
      const done = (value: boolean | "timeout"): void => {
        clearTimeout(timer);
        waiting.delete(id);
        resolve(value);
      };
      const timer = setTimeout(() => {
        options.log("The window did not say whether its unsaved input was saved; the workspace stays open");
        // The window learns it, so it leaves its switching state and says why nothing opened.
        if (!contents.isDestroyed()) {
          contents.send(SAVE_CHANNEL, { id, expired: true });
        }
        done("timeout");
      }, options.saveTimeoutMs ?? SAVE_TIMEOUT_MS);
      waiting.set(id, done);
      contents.send(SAVE_CHANNEL, { id });
    });
  };

  // One switch at a time, from the request to save until the other workspace is open.
  let switching = false;
  /** Saves the window's input, then opens `folder` in place of the open workspace. */
  const switchTo = async (folder: string, exact: boolean): Promise<OpenWorkspaceResult> => {
    if (switching) {
      return BUSY;
    }
    switching = true;
    try {
      const answer = await saved();
      if (answer !== true) {
        return answer === "timeout" ? TIMEOUT : UNSAVED;
      }
      await options.core.open(folder, { exact });
      return OPENED;
    } finally {
      switching = false;
    }
  };

  electron.ipcMain.handle(
    RECENT_WORKSPACES_CHANNEL,
    async (event): Promise<readonly RecentWorkspaceEntry[]> => {
      if (!fromLogReqWindow(event, contents)) {
        return [];
      }
      try {
        const states = await (await recent()).recentWorkspaceStates();
        const open = options.core.key;
        return states.map(({ root, key, exists }) => ({
          root,
          state: key === open ? "open" : exists ? "found" : "missing",
        }));
      } catch (error) {
        options.log(`The recent workspaces could not be read: ${messageOf(error)}`);
        return [];
      }
    },
  );

  /** The root of the list to open, or why none. */
  const listed = async (
    module: RecentWorkspacesModule,
    root: string,
  ): Promise<string | OpenWorkspaceResult> => {
    if (!(await module.readRecentWorkspaces()).some((entry) => entry.root === root)) {
      return REFUSED;
    }
    // The folder can have gone since the list was shown.
    return (await module.workspaceExists(root)) ? root : MISSING;
  };

  /** The root of the workspace of a typed path, or why none: refused by its text before any `stat`. */
  const typed = async (
    module: RecentWorkspacesModule,
    text: string,
  ): Promise<string | OpenWorkspaceResult> => {
    const platform = options.platform ?? process.platform;
    const folder = module.typedWorkspaceFolder(text, { platform, home: (options.home ?? os.homedir)() });
    if (folder === undefined) {
      return REFUSED;
    }
    return (await module.findTypedWorkspace(folder, { platform })) ?? NO_WORKSPACE;
  };

  electron.ipcMain.handle(
    OPEN_WORKSPACE_CHANNEL,
    async (event, root: unknown, how: unknown): Promise<OpenWorkspaceResult> => {
      if (!plausibleRoot(root) || !fromLogReqWindow(event, contents)) {
        return REFUSED;
      }
      let found: string | OpenWorkspaceResult;
      try {
        const module = await recent();
        found = isTyped(how) ? await typed(module, root) : await listed(module, root);
      } catch (error) {
        options.log(`The recent workspaces could not be read: ${messageOf(error)}`);
        return REFUSED;
      }
      return typeof found === "string" ? switchTo(found, true) : found;
    },
  );

  return { openFolder: (folder) => switchTo(folder, false) };
};
