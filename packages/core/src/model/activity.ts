// The last access of an agent to the copy (SR-117): the API and MCP processes record the element a
// call read or changed in `activity.json` in the cache folder of the copy (ADR-0008), and the app's
// core process watches that file (product owner's implementation note on the approved draft: the API
// and MCP processes write their last accesses to a file in the cache of the copy, ADR-0008, and the app
// watches it). Docs: docs/model-store.md, "Agent activity".
//
// Which element a call names follows from its catalog entry alone (ADR-0002 rule 3, `accessSubject`),
// never from the command name. Recording runs after the answer is ready, never changes it, never
// throws and is never awaited by it (SR-080 AK2); nothing is read or built for it (ADR-0008). The
// file is written only through `files` (`writeCacheFile`), only into a cache folder outside every
// repository (`usableCacheFolder`), so it never lands in a working tree or in Git (D-036). No socket,
// pipe or listener is involved (SR-117 AK6, SR-078, SR-079).
import { randomBytes } from "node:crypto";
import type { FSWatcher } from "node:fs";
import { watch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { JsonSchema } from "../catalog.js";
import { createPrivateFolder } from "../files/index.js";
import type { ActivityAccess, ActivityFile } from "../generated/types.js";
import { metamodelState } from "../metamodel/index.js";
import type { CatalogEntry } from "../runtime/contracts.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import { settledValue } from "../runtime/settled.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { readCacheFile, workspaceLayoutState, writeCacheFile } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { isUuid } from "./elements.js";
import { usableCacheFolder } from "./model-cache.js";
import { resolveRef } from "./resolve.js";
import type { ShortIds } from "./short-id.js";
import { shortIdState, shortIdsBuiltFrom } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";
import { normalizeRef } from "./uuid.js";
import { watchWorkspace } from "./watch.js";
import { workspacePath } from "./write.js";

/** The access a call comes through (`InvokeContext.access`, ADR-0002 rule 4). */
export type AccessName = ActivityAccess["access"];

/**
 * The accesses whose calls are recorded (SR-117: „das zuletzt über API oder MCP gelesen oder geändert
 * wurde“). Calls of the command line and of the app are not (spec question #481, assumption (a)); the
 * answer changes this one constant.
 */
export const FOLLOWED_ACCESSES: readonly AccessName[] = ["api", "mcp"];

/** The file in the cache folder of the copy. */
export const ACTIVITY_FILE = "activity.json";

/** A larger file is not LogReq's and is ignored. */
export const ACTIVITY_MAX_BYTES = 4096;

/** A process writes the file at most once per this time; the latest access of a burst wins. */
export const ACTIVITY_WRITE_MS = 100;

/** How long a watch holds an access back at most until the store holds the state it saw (`watchActivity`). */
export const ACTIVITY_HOLD_MS = 1000;

/**
 * Which element a call of a catalog command names (`accessSubject`):
 * - `ref`: the input field of the subject, the first required argument that completes an element and
 *   is one element reference (`common.schema.json#/$defs/elementRef`; an array never is);
 * - `repository`: the field of an argument that completes a repository, which picks one of several
 *   elements the reference names (a UUID two files share, SR-088). It applies only then, so a
 *   repository argument of another meaning (`relation.remove`: the repository of the targets) never
 *   moves the subject: the reference of a successful call names one record;
 * - `written`: for a `write-files` command, the one element whose file it wrote counts when no
 *   subject resolves after the run (no subject, or one whose identifier the call changed).
 */
export interface AccessSubject {
  readonly ref: string | undefined;
  readonly repository: string | undefined;
  readonly written: boolean;
}

const ELEMENT_REF = /(^|\/)common\.schema\.json#\/\$defs\/elementRef$/;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether an input property is one element reference (other keywords such as `description` beside it). */
const isElementRef = (schema: unknown): boolean =>
  isRecord(schema) && typeof schema["$ref"] === "string" && ELEMENT_REF.test(schema["$ref"]);

/** The subject of the calls of `entry` (`AccessSubject`), from its arguments and input schema alone. */
export const accessSubject = (entry: CatalogEntry): AccessSubject => {
  const input: JsonSchema = entry.input;
  const properties = isRecord(input["properties"]) ? input["properties"] : {};
  const required = Array.isArray(input["required"]) ? (input["required"] as unknown[]) : [];
  const ref = entry.arguments.find(
    (a) => a.complete === "element" && required.includes(a.field) && isElementRef(properties[a.field]),
  )?.field;
  return {
    ref,
    repository:
      ref === undefined ? undefined : entry.arguments.find((a) => a.complete === "repository")?.field,
    written: entry.effect === "write-files",
  };
};

/** One call as `noteAccess` needs it. */
export interface AccessCall {
  readonly command: string;
  readonly effect: ActivityAccess["effect"];
  readonly access: AccessName;
  readonly subject: AccessSubject;
}

/** An access to record: where, the element's file hash and the access itself. */
export interface NotedAccess {
  readonly folder: string;
  readonly sha256: string;
  readonly access: ActivityAccess;
}

/**
 * The one record `ref` names in `store`. A UUID needs only the store; any other reference needs short
 * IDs of this store. A reference that names several records counts only when `repository` leaves one.
 */
const subjectRecord = (
  store: ElementStore,
  shortIds: ShortIds | undefined,
  ref: string,
  repository: string | undefined,
): ElementRecord | undefined => {
  const canonical = normalizeRef(ref);
  if (isUuid(canonical)) {
    const records = store.byId.get(canonical) ?? [];
    const fitting = records.length > 1 ? records.filter((r) => r.repository === repository) : records;
    return fitting.length === 1 ? fitting[0] : undefined;
  }
  if (shortIds === undefined) {
    return undefined;
  }
  for (const copy of repository === undefined ? [{}] : [{}, { repository }]) {
    try {
      return resolveRef(store, shortIds, ref, copy);
    } catch {
      // ref.unknown or ref.ambiguous: no subject, or try again with the repository.
    }
  }
  return undefined;
};

/** The one element record among the files a write gives (relative to the workspace root), else undefined. */
const writtenRecord = (
  store: ElementStore,
  layout: WorkspaceLayout,
  files: unknown,
): ElementRecord | undefined => {
  if (!Array.isArray(files) || store.repositories === undefined) {
    return undefined;
  }
  const places = store.repositories.map((contents) => ({
    contents,
    prefix: workspacePath(layout, contents.location, ""),
  }));
  let found: ElementRecord | undefined;
  for (const file of files) {
    for (const { contents, prefix } of places) {
      const relative = path.posix.relative(prefix, String(file));
      const contribution = relative.startsWith("..") ? undefined : contents.files.get(relative);
      if (contribution?.kind !== "element") {
        continue;
      }
      if (found !== undefined) {
        return undefined;
      }
      found = contribution.element;
    }
  }
  return found;
};

/** Per workspace: the usable cache folder of the last layout seen, so it is computed once per layout. */
interface FolderMemo {
  layout: WorkspaceLayout | undefined;
  folder: string | undefined;
}

const folderMemoState = defineWorkspaceState("activity-folder", (): FolderMemo => ({
  layout: undefined,
  folder: undefined,
}));

const recordingFolder = (workspace: Workspace, layout: WorkspaceLayout): string | undefined => {
  const memo = workspace.get(folderMemoState);
  if (memo.layout !== layout) {
    memo.layout = layout;
    memo.folder = usableCacheFolder(workspace, layout);
  }
  return memo.folder;
};

/**
 * What to record for a successful call (`AccessCall`) with its input and output, from the states the
 * command left (taken when this is called, in one step, ADR-0008); undefined when the call names no
 * one element, the workspace has no usable cache folder, or a state it needs is not built. Never
 * rejects and builds nothing.
 */
export const noteAccess = async (
  workspace: Workspace,
  call: AccessCall,
  input: Readonly<Record<string, unknown>>,
  output: Readonly<Record<string, unknown>>,
): Promise<NotedAccess | undefined> => {
  try {
    const states = Promise.all([
      settledValue(workspace.peek(workspaceLayoutState)),
      settledValue(workspace.peek(elementStoreState)),
      settledValue(workspace.peek(metamodelState)),
      settledValue(workspace.peek(shortIdState)),
    ]);
    const [layout, store, metamodel, kept] = await states;
    if (layout === undefined || store === undefined) {
      return undefined;
    }
    const folder = recordingFolder(workspace, layout);
    if (folder === undefined) {
      return undefined;
    }
    const shortIds =
      kept !== undefined && metamodel !== undefined && shortIdsBuiltFrom(kept, store.byId, metamodel)
        ? kept
        : undefined;
    const { ref, repository, written } = call.subject;
    const given = ref === undefined ? undefined : input[ref];
    const copy = repository === undefined ? undefined : input[repository];
    const named =
      typeof given === "string"
        ? subjectRecord(store, shortIds, given, typeof copy === "string" ? copy : undefined)
        : undefined;
    const record = named ?? (written ? writtenRecord(store, layout, output["files"]) : undefined);
    if (record === undefined) {
      return undefined;
    }
    return {
      folder,
      sha256: record.snapshot.sha256,
      access: {
        access: call.access,
        command: call.command,
        effect: call.effect,
        at: new Date().toISOString(),
        element: { id: record.id, repository: record.repository },
      },
    };
  } catch {
    // A closed workspace, or a state that failed: nothing is recorded.
    return undefined;
  }
};

/**
 * Writes the noted accesses of one workspace: the first at once, then at most one per
 * `ACTIVITY_WRITE_MS` with the latest access, one write at a time. A failed write is dropped without
 * a word (core has no logger and writes nothing to stdout or stderr). The timer never keeps the
 * process alive; `flush` (on `workspace.close()`) writes the pending access.
 */
class Recorder {
  /** New for each recorder, so that `(process, seq)` of a rebuilt one is new too. */
  readonly process = `${String(process.pid)}-${randomBytes(4).toString("hex")}`;
  #seq = 0;
  #pending: NotedAccess | undefined;
  #timer: NodeJS.Timeout | undefined;
  #writing: Promise<void> | undefined;
  #lastWrite = Number.NEGATIVE_INFINITY;
  #flushing = false;
  /** Accesses still being noted (`noteAccess`); `flush` waits for them. */
  readonly #noting = new Set<Promise<void>>();

  note(noted: Promise<NotedAccess | undefined>): void {
    const added = noted.then((access) => {
      if (access !== undefined) {
        this.#add(access);
      }
    });
    this.#noting.add(added);
    void added.finally(() => this.#noting.delete(added));
  }

  #add(noted: NotedAccess): void {
    this.#pending = noted;
    this.#next();
  }

  #next(): void {
    if (
      this.#flushing ||
      this.#pending === undefined ||
      this.#timer !== undefined ||
      this.#writing !== undefined
    ) {
      return;
    }
    const wait = this.#lastWrite + ACTIVITY_WRITE_MS - Date.now();
    if (wait > 0) {
      this.#timer = setTimeout(() => {
        this.#timer = undefined;
        this.#next();
      }, wait);
      this.#timer.unref();
      return;
    }
    this.#write(this.#pending);
  }

  #write(noted: NotedAccess): void {
    this.#pending = undefined;
    this.#lastWrite = Date.now();
    this.#seq += 1;
    const file: ActivityFile = {
      version: 1,
      process: this.process,
      seq: this.#seq,
      sha256: noted.sha256,
      access: noted.access,
    };
    this.#writing = (async (): Promise<void> => {
      try {
        await writeCacheFile(noted.folder, ACTIVITY_FILE, `${JSON.stringify(file)}\n`);
      } catch {
        // The cache folder cannot be written (read-only, full, a file in its place): nothing is recorded.
      } finally {
        this.#writing = undefined;
        this.#next();
      }
    })();
  }

  async flush(): Promise<void> {
    this.#flushing = true;
    await Promise.all(this.#noting);
    clearTimeout(this.#timer);
    this.#timer = undefined;
    await this.#writing;
    if (this.#pending !== undefined) {
      this.#write(this.#pending);
      await this.#writing;
    }
  }
}

const recorderState = defineWorkspaceState("activity-recorder", (): Recorder => new Recorder(), {
  dispose: (recorder) => recorder.flush(),
});

/**
 * Records the access `noted` gives (`noteAccess`) as the last access of the copy, in the background;
 * `workspace.close()` waits for it. Returns at once and never throws; a closed workspace records
 * nothing.
 */
export const recordAccess = (workspace: Workspace, noted: Promise<NotedAccess | undefined>): void => {
  let recorder: Recorder;
  try {
    recorder = workspace.get(recorderState);
  } catch {
    return;
  }
  recorder.note(noted);
};

let validActivity: ReturnType<typeof fileSchemaValidator> | undefined;

/** The activity file in `folder` when it is there, at most `ACTIVITY_MAX_BYTES` and valid; else undefined. */
export const readActivity = async (folder: string): Promise<ActivityFile | undefined> => {
  let text: string | undefined;
  try {
    text = await readCacheFile(folder, ACTIVITY_FILE, ACTIVITY_MAX_BYTES);
  } catch {
    return undefined;
  }
  if (text === undefined) {
    return undefined;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  validActivity ??= fileSchemaValidator("activity.schema.json");
  return validActivity(data) ? (data as ActivityFile) : undefined;
};

/**
 * The last access recorded for the copy of `workspace` (`workspace.activity`): undefined when there
 * is none, the copy has no usable cache folder, or the file cannot be read or used.
 */
export const lastAccess = async (workspace: Workspace): Promise<ActivityAccess | undefined> => {
  const folder = usableCacheFolder(workspace, await workspace.get(workspaceLayoutState));
  return folder === undefined ? undefined : (await readActivity(folder))?.access;
};

export interface ActivityWatchOptions {
  /**
   * Called once per new access (a new `(process, seq)`), at most `holdMs` after it was written. What it
   * throws is caught and logged; the watch goes on.
   */
  readonly onAccess: (access: ActivityAccess) => void;
  /** Why the watch could not start or ended, or a report failed (the app's core process passes its log). */
  readonly log?: (message: string) => void;
  /** Default `ACTIVITY_HOLD_MS`. */
  readonly holdMs?: number;
}

/** A watch of the activity file (`watchActivity`). */
export interface ActivityWatch {
  /**
   * Resolves once the file is watched with undefined, or with why accesses cannot be seen here (no
   * usable cache folder, the watch could not start). Never rejects.
   */
  readonly ready: Promise<string | undefined>;
  /** Stops the watch; no `onAccess` after it. */
  close(): void;
}

interface Held {
  readonly file: ActivityFile;
  readonly timer: NodeJS.Timeout;
}

const keyOf = (file: ActivityFile | undefined): string | undefined =>
  file === undefined ? undefined : `${file.process}/${String(file.seq)}`;

/** Errors of the file system and of commands are `Error`s. */
const messageOf = (error: unknown): string => (error as Error).message;

class ActivityWatcher implements ActivityWatch {
  readonly ready: Promise<string | undefined>;
  readonly #workspace: Workspace;
  readonly #options: ActivityWatchOptions;
  #folder = "";
  #watcher: FSWatcher | undefined;
  #unsubscribe: (() => void) | undefined;
  #closed = false;
  /** The `(process, seq)` of the last file seen; the file at start is the baseline, never reported. */
  #seen: string | undefined;
  #reading = false;
  #again = false;
  /** The latest access that is not reported yet, with the timer that reports it at the latest. */
  #held: Held | undefined;

  constructor(workspace: Workspace, options: ActivityWatchOptions) {
    this.#workspace = workspace;
    this.#options = options;
    this.ready = this.#start();
  }

  async #start(): Promise<string | undefined> {
    let folder: string | undefined;
    try {
      folder = usableCacheFolder(this.#workspace, await this.#workspace.get(workspaceLayoutState));
    } catch (error) {
      return this.#stop(`the workspace cannot be read: ${messageOf(error)}`);
    }
    if (folder === undefined) {
      return this.#stop("the working copy has no cache folder outside its repositories");
    }
    this.#folder = folder;
    try {
      await createPrivateFolder(folder);
      this.#seen = keyOf(await readActivity(folder));
      if (this.#closed) {
        return undefined;
      }
      const watcher = watch(folder, { persistent: false }, (_event, name) => {
        // No name: the OS dropped events (a Windows overflow), so read the file again.
        if (name === null || name === ACTIVITY_FILE) {
          void this.#read();
        } else if (name === path.basename(folder)) {
          // The folder itself was removed or renamed (ADR-0008: removing the cache is safe): the watch
          // is dead, and a folder created again is not watched (no re-arming, that would be polling).
          void this.#checkFolder();
        }
      });
      this.#watcher = watcher;
      watcher.on("error", (error) => {
        this.#stop(`the cache folder is no longer watched: ${messageOf(error)}`);
      });
      this.#unsubscribe = watchWorkspace(this.#workspace).onChange(() => this.#recheck());
    } catch (error) {
      return this.#stop(`the cache folder cannot be watched: ${messageOf(error)}`);
    }
    return undefined;
  }

  #stop(reason: string): string {
    this.#options.log?.(`Agents cannot be followed: ${reason}`);
    this.close();
    return reason;
  }

  /**
   * Ends the watch with a log line when the watched folder is gone. The OS can report the removal
   * more than once (Linux), and the checks run side by side: only the first that finds it gone logs.
   */
  async #checkFolder(): Promise<void> {
    try {
      await fs.stat(this.#folder);
    } catch {
      if (this.#closed) {
        return;
      }
      this.#stop("the cache folder was removed");
    }
  }

  close(): void {
    this.#closed = true;
    this.#watcher?.close();
    this.#unsubscribe?.();
    this.#drop();
  }

  async #read(): Promise<void> {
    if (this.#reading) {
      this.#again = true;
      return;
    }
    this.#reading = true;
    this.#again = false;
    try {
      do {
        const file = await readActivity(this.#folder);
        const key = keyOf(file);
        if (file !== undefined && key !== this.#seen && !this.#closed) {
          this.#seen = key;
          await this.#arrive(file);
        }
      } while (this.#takeAgain());
    } finally {
      this.#reading = false;
    }
  }

  /** Whether an event came while the file was read, and resets it. */
  #takeAgain(): boolean {
    const again = this.#again;
    this.#again = false;
    return again;
  }

  /**
   * A new access: held, with a timer that reports it at the latest after `holdMs`, and reported at
   * once when the store holds what it saw (point 7 of the plan review). It drops an older held one.
   */
  async #arrive(file: ActivityFile): Promise<void> {
    this.#drop();
    const held: Held = {
      file,
      timer: setTimeout(() => {
        this.#release(held);
      }, this.#options.holdMs ?? ACTIVITY_HOLD_MS),
    };
    held.timer.unref();
    this.#held = held;
    await this.#check(held);
  }

  /** On every watcher batch: the held access is reported once the store holds what it saw. */
  async #recheck(): Promise<void> {
    const held = this.#held;
    if (held !== undefined) {
      await this.#check(held);
    }
  }

  async #check(held: Held): Promise<void> {
    if (await this.#storeHas(held.file)) {
      this.#release(held);
    }
  }

  /** Reports `held` if it is still the held access (not dropped by a newer one or by `close`). */
  #release(held: Held): void {
    if (this.#held !== held) {
      return;
    }
    this.#drop();
    try {
      this.#options.onAccess(held.file.access);
    } catch (error) {
      // A throwing listener (e.g. a window whose port is gone) must not crash the core process.
      this.#options.log?.(`An agent's access could not be reported: ${String(error)}`);
    }
  }

  #drop(): void {
    clearTimeout(this.#held?.timer);
    this.#held = undefined;
  }

  /**
   * Whether the store of this process shows the element as the access saw it: true when the store is
   * not built (the next read reads the files as they are) or holds the element's file with that hash.
   */
  async #storeHas(file: ActivityFile): Promise<boolean> {
    const store = await settledValue(this.#workspace.peek(elementStoreState));
    if (store === undefined) {
      return true;
    }
    const { id, repository } = file.access.element;
    return (store.byId.get(id) ?? []).some(
      (r) => r.repository === repository && r.snapshot.sha256 === file.sha256,
    );
  }
}

/**
 * Watch the accesses that API and MCP processes of the copy of `workspace` record (SR-117), for the
 * app's core process: one plain watch of the cache folder (not recursive, `persistent: false`),
 * created with mode 0700 when missing; only `activity.json` counts (LogReq's temp files and the
 * other cache files are dropped). The file present at start is the baseline and is never reported.
 * A new access is reported once the element store of `workspace` holds the element's file with the
 * hash the access saw (after the watcher of `workspace` applied the change; the watcher is started
 * when it is not running), at once when the store is not built, and at the latest `holdMs` after it
 * arrived; a newer access drops a held one. A file that is too large, broken or of another version is
 * ignored. A watch that cannot start or fails is logged and ends; there is no polling.
 */
export const watchActivity = (workspace: Workspace, options: ActivityWatchOptions): ActivityWatch =>
  new ActivityWatcher(workspace, options);
