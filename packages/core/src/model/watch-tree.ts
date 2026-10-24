// Watching a folder tree folder by folder (SR-007, ADR-0008). Node's `recursive` watch on Linux is
// emulated with one inotify watch per file, and a file replaced by a rename (an atomic save, a
// checkout) is not reported again; it also costs a watch, memory and start time per file. So on
// Linux the watcher puts a plain watch on every folder instead: a folder's watch reports every
// name in it, however the file was written. Folders that never hold element files are not watched
// (`skip`), new folders are watched when an event names them, and the watches of a folder that is
// gone are dropped. A watch belongs to one folder (its `dev:ino`): a folder deleted and created
// again, replaced, or emptied and filled by a checkout gets a new watch. All walks run one after
// the other, so a walk never meets a half-done one.
import type { FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

/** What the watcher needs of `fs.watch`; tests pass their own. */
export type WatchFunction = (
  folder: string,
  options: { readonly recursive: boolean },
  listener: (event: string, fileName: string | null) => void,
) => Pick<FSWatcher, "close" | "on">;

export interface FolderTreeOptions {
  readonly watch: WatchFunction;
  /** Whether a folder below the root (relative, `/`) is left out with everything in it. */
  readonly skip: (relative: string) => boolean;
  /** A name changed in a watched folder (relative to the root, `/`), or null when the OS gave none. */
  readonly onEvent: (relative: string | null) => void;
  /** A folder that exists could not be watched, with the error code (e.g. `ENOSPC`, the OS limit). */
  readonly onUnwatchable: (relative: string, code: string) => void;
  /** The root folder is gone (deleted, moved away): the layout has to be read again. */
  readonly onGone: () => void;
}

const errorCode = (error: unknown): string => String((error as NodeJS.ErrnoException).code);

/** Codes of a folder that is gone (or became a file) while it was walked: nothing to report. */
const GONE = new Set(["ENOENT", "ENOTDIR"]);

const join = (folder: string, name: string): string => (folder === "" ? name : `${folder}/${name}`);

const atOrBelow = (relative: string, folder: string): boolean =>
  relative === folder || relative.startsWith(`${folder}/`);

type Handle = Pick<FSWatcher, "close" | "on">;

interface FolderWatch {
  readonly handle: Handle;
  /** `dev:ino` of the folder, from a stat right after the watch attached; "" until then. */
  id: string;
}

const idOf = (stats: { readonly dev: number; readonly ino: number }): string =>
  `${String(stats.dev)}:${String(stats.ino)}`;

/** One plain watch per folder of a tree below `root`. */
export class FolderTree {
  readonly #root: string;
  readonly #options: FolderTreeOptions;
  readonly #watches = new Map<string, FolderWatch>();
  /** All walks run one after the other on this chain; `settled` waits for them. */
  #walks: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(root: string, options: FolderTreeOptions) {
    this.#root = root;
    this.#options = options;
  }

  /** Watches the root and every folder below it that is not skipped. */
  start(): Promise<void> {
    this.#queue("", false);
    return this.settled();
  }

  /** Resolves when the walks started so far, and those they started, are done. */
  async settled(): Promise<void> {
    let walks: Promise<void>;
    do {
      walks = this.#walks;
      await walks;
    } while (walks !== this.#walks);
  }

  close(): void {
    this.#closed = true;
    for (const { handle } of this.#watches.values()) {
      handle.close();
    }
    this.#watches.clear();
  }

  #isClosed(): boolean {
    return this.#closed;
  }

  /** Walks `relative` after the walks before it; a folder that got a new watch is reported again. */
  #queue(relative: string, report: boolean): void {
    this.#walks = this.#walks.then(async () => {
      if ((await this.#add(relative)) && report) {
        this.#options.onEvent(relative === "" ? null : relative);
      }
    });
  }

  /**
   * Watches `relative` and the folders below it; returns whether `relative` got a new watch. A
   * folder already watched keeps its watch while it is the same folder (`dev:ino`); one that is
   * gone, no longer a folder, or another folder (deleted and created again, replaced, a checkout)
   * is watched anew. Folders found below a folder that kept its watch are reported.
   */
  async #add(relative: string): Promise<boolean> {
    const folder = path.join(this.#root, relative);
    let fresh = false;
    let entries;
    try {
      const known = this.#watches.get(relative)?.id;
      if (!(known !== undefined && known === idOf(await fs.lstat(folder)))) {
        fresh = await this.#watchFolder(relative, folder);
        if (!fresh) {
          return false;
        }
      }
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch (error) {
      this.#drop(relative);
      if (!GONE.has(errorCode(error))) {
        this.#options.onUnwatchable(relative, errorCode(error));
      } else if (relative === "") {
        this.#options.onGone();
      }
      return false;
    }
    // A folder with a `.git` entry below the root is another repository (as in discover.ts).
    if (relative !== "" && entries.some((e) => e.name === ".git")) {
      this.#drop(relative);
      return false;
    }
    for (const entry of entries) {
      const child = join(relative, entry.name);
      if (entry.isDirectory() && !this.#options.skip(child) && (await this.#add(child)) && !fresh) {
        this.#options.onEvent(child);
      }
    }
    return fresh;
  }

  /**
   * Puts a new watch on `folder` (first, so nothing created during the walk is missed), then takes
   * its `dev:ino`. False when the tree was closed or the watch was dropped meanwhile.
   */
  async #watchFolder(relative: string, folder: string): Promise<boolean> {
    if (this.#isClosed()) {
      return false;
    }
    this.#drop(relative);
    const watch: FolderWatch = {
      handle: this.#options.watch(folder, { recursive: false }, (event, name) => {
        this.#onName(relative, event, name);
      }),
      id: "",
    };
    // A watch that breaks is dropped, and its folder checked and watched anew.
    watch.handle.on("error", () => {
      this.#rewatch(relative);
    });
    if (this.#isClosed()) {
      // Closed while the watch attached.
      watch.handle.close();
      return false;
    }
    this.#watches.set(relative, watch);
    const stats = await fs.lstat(folder);
    if (this.#watches.get(relative) !== watch) {
      // Dropped (and closed) meanwhile; a walk queued by that drop takes over.
      return false;
    }
    if (!stats.isDirectory()) {
      throw Object.assign(new Error(`${folder} is not a folder`), { code: "ENOTDIR" });
    }
    watch.id = idOf(stats);
    return true;
  }

  /** Closes the watches of `relative` and of every folder below it. */
  #drop(relative: string): void {
    for (const [folder, { handle }] of this.#watches) {
      if (atOrBelow(folder, relative)) {
        handle.close();
        this.#watches.delete(folder);
      }
    }
  }

  /** Drops the watches of `relative` now, reports it, and walks it again. */
  #rewatch(relative: string): void {
    if (this.#closed) {
      return;
    }
    this.#drop(relative);
    this.#options.onEvent(relative === "" ? null : relative);
    this.#queue(relative, true);
  }

  #onName(folder: string, event: string, fileName: string | null): void {
    if (this.#closed) {
      return;
    }
    if (fileName === null) {
      this.#options.onEvent(null);
      return;
    }
    // Linux names the watched folder itself when it is deleted or moved away (IN_DELETE_SELF,
    // IN_MOVE_SELF). Its watch is dead, and a folder created in its place may get the same inode,
    // so the watch is dropped at once and the folder walked again. (An entry with the folder's own
    // name costs only this walk.)
    if (event === "rename" && fileName === path.basename(path.join(this.#root, folder))) {
      this.#rewatch(folder);
      return;
    }
    const relative = join(folder, fileName.split(path.sep).join("/"));
    this.#options.onEvent(relative);
    if (this.#options.skip(relative)) {
      return;
    }
    // A new or other folder is watched with everything in it; the watches of one that is gone are dropped.
    this.#walks = this.#walks.then(async () => {
      let isFolder = false;
      try {
        isFolder = (await fs.lstat(path.join(this.#root, relative))).isDirectory();
      } catch {
        // Gone: nothing to watch.
      }
      if (!isFolder) {
        this.#drop(relative);
      } else if (await this.#add(relative)) {
        // Files created before the watch attached.
        this.#options.onEvent(relative);
      }
    });
  }
}
