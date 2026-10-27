// The workspaces opened last and the switch between them (SR-131, ADR-0010): two channels from the
// renderer to the main process. They go to main, not over the port, because no core process runs while
// no workspace is open, and switching the workspace of the window is main's job. The list is core's
// (`@logreq/core/recent-workspaces`: order, keys, existence checks), loaded on the first request, so the
// start of main loads no part of core; main only marks the entry its core process has open.
//
// The renderer is not trusted. Both channels take only messages from the main frame of the LogReq
// window (`sender.ts`), and an open takes only a root that is, character for character, a root of the
// stored list, read again for each request: a renderer can switch among the user's recent workspaces and
// nothing else. Before that, the type, the length and NUL are checked, and main makes no file-system call
// for a refused root. Main makes no synchronous file-system call here (a hung share would freeze the
// window): the keys are stored, and the existence check is core's asynchronous, bounded one.
import type Electron from "electron";
import type {
  readRecentWorkspaces,
  recentWorkspaceStates,
  workspaceExists,
} from "@logreq/core/recent-workspaces";
import type { OpenWorkspaceResult, RecentWorkspaceEntry } from "../shared/protocol.js";
import { MAX_ROOT_LENGTH, OPEN_WORKSPACE_CHANNEL, RECENT_WORKSPACES_CHANNEL } from "../shared/protocol.js";
import type { WindowContents } from "./sender.js";
import { fromLogReqWindow } from "./sender.js";

/** The parts of core's module of the list that main uses. */
export interface RecentWorkspacesModule {
  readonly readRecentWorkspaces: typeof readRecentWorkspaces;
  readonly recentWorkspaceStates: typeof recentWorkspaceStates;
  readonly workspaceExists: typeof workspaceExists;
}

/** The parts of the `electron` module the handlers use. */
export type WorkspacesElectron = Pick<typeof Electron, "ipcMain">;

/** The part of `CoreProcess` the handlers use. */
export interface WorkspaceSwitch {
  /** The key of the open workspace in the list, undefined while none is open. */
  readonly key: string | undefined;
  /** Opens `folder` in the window in place of the open workspace; never rejects. */
  open(folder: string, options: { readonly exact: boolean }): Promise<void>;
}

export interface WorkspacesOptions {
  readonly core: WorkspaceSwitch;
  /** Loads core's module of the list; default `loadRecentWorkspaces`. */
  readonly load?: () => Promise<RecentWorkspacesModule>;
  readonly log: (line: string) => void;
}

/** Core's module of the list, without the rest of core (no schema validator, no command). */
export const loadRecentWorkspaces = (): Promise<RecentWorkspacesModule> =>
  import("@logreq/core/recent-workspaces");

const REFUSED: OpenWorkspaceResult = { ok: false, reason: "refused" };
const MISSING: OpenWorkspaceResult = { ok: false, reason: "missing" };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Whether `root` can be a root of the list at all; checked before anything is read. */
const plausibleRoot = (root: unknown): root is string =>
  typeof root === "string" && root.length <= MAX_ROOT_LENGTH && !root.includes("\0");

/**
 * Answers RECENT_WORKSPACES_CHANNEL with the list, the most recent first, each `open` (the workspace of
 * the running core process), `found` or `missing`, and OPEN_WORKSPACE_CHANNEL by opening a root of the
 * list in the window with these web contents (`exact`: the root itself, never a workspace above it).
 * A request from anywhere else gets the empty list or `refused`; a root whose workspace file is gone
 * gets `missing`, and the running core process is not touched (SR-131 AK4).
 */
export const handleWorkspaces = (
  electron: WorkspacesElectron,
  contents: WindowContents,
  options: WorkspacesOptions,
): void => {
  let loaded: Promise<RecentWorkspacesModule> | undefined;
  const recent = (): Promise<RecentWorkspacesModule> => (loaded ??= (options.load ?? loadRecentWorkspaces)());

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

  electron.ipcMain.handle(
    OPEN_WORKSPACE_CHANNEL,
    async (event, root: unknown): Promise<OpenWorkspaceResult> => {
      if (!plausibleRoot(root) || !fromLogReqWindow(event, contents)) {
        return REFUSED;
      }
      try {
        const module = await recent();
        const listed = (await module.readRecentWorkspaces()).some((entry) => entry.root === root);
        if (!listed) {
          return REFUSED;
        }
        // The folder can have gone since the list was shown.
        if (!(await module.workspaceExists(root))) {
          return MISSING;
        }
      } catch (error) {
        options.log(`The recent workspaces could not be read: ${messageOf(error)}`);
        return REFUSED;
      }
      await options.core.open(root, { exact: true });
      return { ok: true };
    },
  );
};
