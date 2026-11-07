// A channel from the renderer to the main process (ADR-0010): the folders of the folder of a path typed
// in "Open workspace" (SR-143 AK1). It goes to main, not over the port, because no core process runs
// while no workspace is open, and "Open workspace" takes the same absolute paths with or without one.
// The listing is core's (`@reqseq/core/list-folder`, the function of `workspace.listFolder` with
// `absolute`), loaded on the first request, so the start of main loads no part of core.
//
// The renderer is not trusted: the message must come from the main frame of the ReqSeq window
// (`sender.ts`), and the path must be a string of at most 4096 characters without NUL before core sees
// it. Core then checks it by its text before any file-system call (absolute or `~`, on Windows only a
// path on a drive: no UNC, device or NT path, SR-078), reads only the names of the folder (no `stat`, no
// link followed) and runs in main's slot for typed paths with a timeout, so a folder on a share that does
// not answer takes no further thread of main and blocks only typed paths.
import os from "node:os";
import type Electron from "electron";
import type { listTypedFolder, typedPathRun } from "@reqseq/core/list-folder";
import type { FolderListing } from "../shared/protocol.js";
import { LIST_FOLDER_CHANNEL, MAX_ROOT_LENGTH, REFUSED_LISTING } from "../shared/protocol.js";
import type { WindowContents } from "./sender.js";
import { fromReqSeqWindow } from "./sender.js";

/** The parts of core's listing module that main uses. */
export interface ListFolderModule {
  readonly listTypedFolder: typeof listTypedFolder;
  readonly typedPathRun: typeof typedPathRun;
}

/** The parts of the `electron` module the handler uses. */
export type ListFolderElectron = Pick<typeof Electron, "ipcMain">;

export interface ListFolderOptions {
  /** Loads core's listing module; default `loadListFolder`. */
  readonly load?: () => Promise<ListFolderModule>;
  readonly log: (line: string) => void;
  /** The home folder, which `~` stands for; default `os.homedir()`. */
  readonly home?: () => string;
  /** The platform of the typed paths; default this process's. */
  readonly platform?: NodeJS.Platform;
}

/** Core's listing module, without the rest of core (no schema validator, no command). */
export const loadListFolder = (): Promise<ListFolderModule> => import("@reqseq/core/list-folder");

/** What the renderer learns when the module cannot be loaded: the folder counts as not readable. */
const UNREADABLE: FolderListing = { name: "", entries: [], problem: "unreadable" };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Answers LIST_FOLDER_CHANNEL for the window with these web contents: the folders and links in the
 * folder of the typed path, as `workspace.listFolder` with `absolute` gives them. A request from anywhere
 * else, or a path that is no string, longer than 4096 characters or with NUL, gets `invalid` and reads
 * nothing.
 */
export const handleListFolder = (
  electron: ListFolderElectron,
  contents: WindowContents,
  options: ListFolderOptions,
): void => {
  let loaded: Promise<ListFolderModule> | undefined;
  // A failed import is tried again on the next request.
  const module = (): Promise<ListFolderModule> =>
    (loaded ??= (options.load ?? loadListFolder)().catch((error: unknown) => {
      loaded = undefined;
      throw error;
    }));
  electron.ipcMain.handle(LIST_FOLDER_CHANNEL, async (event, text: unknown): Promise<FolderListing> => {
    if (
      typeof text !== "string" ||
      text.length > MAX_ROOT_LENGTH ||
      text.includes("\0") ||
      !fromReqSeqWindow(event, contents)
    ) {
      return REFUSED_LISTING;
    }
    try {
      const core = await module();
      return await core.listTypedFolder(text, {
        files: false,
        home: (options.home ?? os.homedir)(),
        platform: options.platform ?? process.platform,
        run: core.typedPathRun,
      });
    } catch (error) {
      options.log(`The folder could not be listed: ${messageOf(error)}`);
      return UNREADABLE;
    }
  });
};
