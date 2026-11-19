// A folder that an export writes as a whole and replaces on each run: the HTML export (SR-235,
// packages/core/docs/html-export.md). Its marker file names the files the last export wrote; only
// those are ever replaced or removed, and every other file stays as it is (SR-235 AK2).
//
// - Opening refuses, changing nothing: a target that is no folder (`file.not-regular`), a folder
//   above it that is missing (`file.folder-missing`), a non-empty folder without a readable marker
//   (`file.faulty`, SR-235 AK1), and another export running into it (`file.faulty`).
// - The folder is walked without following links. A folder named `.git` or holding a `.git` entry, a
//   link and anything that is not a file or folder are opaque: nothing in them counts as the
//   export's. A marker entry counts only as a relative path in NFC without `.`, `..`, empty names,
//   `\`, `:` or control characters, no name Git takes, unique ignoring case, that the walk found as a
//   file (so every folder on its way is a real folder). Others are left alone and reported.
// - Lock and staging: `.reqseq-export-staging` is created with an exclusive `mkdir` and holds the
//   process ID and run that own it; a staging folder whose process no longer runs, or of this process
//   whose run has ended, is removed after it is renamed aside and checked again. The marker
//   then names it (`pending`), so a crash leaves nothing unmarked. New files go to `staging/new`.
// - Commit: the marker names old and new files; then from the top, a name that is wholly the old
//   export's (or missing) is moved to `staging/old` and replaced by the new one in one rename, a
//   folder that also holds other files is entered. Every folder is checked to be a real folder right
//   before a rename in it. An error moves everything back and restores the marker (SR-235 AK6); once
//   the marker with the new list is written, nothing is rolled back.
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { CommandError } from "../catalog.js";
import { processRuns } from "./lock.js";
import { errorCode, isTakenForGit } from "./paths.js";
import { readFileSnapshot } from "./read.js";
import { retry, TRANSIENT_CODES } from "./retry.js";
import type { FileSnapshot } from "./snapshot.js";
import { writeFileAtomic } from "./write.js";

/** The staging folder in the target; also the lock of an export running into it. */
export const STAGING_FOLDER = ".reqseq-export-staging";
const OWNER_FILE = "owner.json";
/** A staging folder older than this counts as left behind, whatever process ID it names (a reused one). */
const STALE_OWNER_MS = 24 * 60 * 60 * 1000;
/** A staging folder without a readable owner file counts as left behind after this time. */
const UNOWNED_STALE_MS = 60_000;

/** What a marker file is: its name in the target, its version key, and the comment above. */
export interface MarkerSpec {
  readonly file: string;
  readonly key: string;
  readonly comment: string;
}

/** An entry of the marker that names nothing the export may replace, and why. */
export interface IgnoredEntry {
  readonly entry: string;
  readonly reason: string;
}

export interface ExportFolder {
  /** The real path of the target. */
  readonly folder: string;
  /** Files, links and folders of the target that the earlier export did not write, topmost only, sorted. */
  readonly foreign: readonly string[];
  readonly ignored: readonly IgnoredEntry[];
  /** Writes one file of the new export (relative, `/`); refuses a place a file of another source holds. */
  write(relativePath: string, content: string | Uint8Array): Promise<void>;
  /** Puts the new export in place; `removed` counts the old files it no longer writes. */
  commit(): Promise<{ readonly removed: number; readonly cleanupFailed: boolean }>;
  /** Leaves the target as it was before `openExportFolder`. */
  abort(): Promise<void>;
}

type Kind = "file" | "folder" | "opaque";

const refused = (message: string, details: Record<string, unknown> = {}): CommandError =>
  new CommandError("file.faulty", `Not exported: ${message}`, { fields: ["output"], ...details });

/** Why `entry` can never be a file of the export, or undefined when its spelling is fine. */
const entryProblem = (entry: unknown, spec: MarkerSpec): string | undefined => {
  if (typeof entry !== "string" || entry === "") {
    return "it is not a path";
  }
  // eslint-disable-next-line no-control-regex -- control characters are what the test looks for
  if (entry.normalize("NFC") !== entry || /[\\:\u0000-\u001f\u007f]/u.test(entry) || entry.startsWith("/")) {
    return "it is no relative path with / in NFC";
  }
  const names = entry.split("/");
  if (names.some((name) => name === "" || name === "." || name === "..")) {
    return "it holds an empty name, . or ..";
  }
  if (names.some(isTakenForGit)) {
    return "it leads into a .git folder";
  }
  if (entry === spec.file || names[0] === STAGING_FOLDER) {
    return "it names the marker file or the staging folder";
  }
  return undefined;
};

/** The walk of the target: the kind of every path below it, `/`-separated, without links followed. */
const walk = async (root: string): Promise<Map<string, Kind>> => {
  const kinds = new Map<string, Kind>();
  const pending = [""];
  for (let folder = pending.pop(); folder !== undefined; folder = pending.pop()) {
    const entries = await fs.readdir(path.join(root, folder), { withFileTypes: true });
    for (const entry of entries) {
      const relative = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (folder === "" && entry.name === STAGING_FOLDER) {
        continue;
      }
      if (entry.isDirectory() && !isTakenForGit(entry.name)) {
        const inner = await fs.readdir(path.join(root, relative));
        // A nested repository is not the export's, whatever its files are called.
        if (inner.some(isTakenForGit)) {
          kinds.set(relative, "opaque");
        } else {
          kinds.set(relative, "folder");
          pending.push(relative);
        }
      } else {
        kinds.set(relative, entry.isFile() && !isTakenForGit(entry.name) ? "file" : "opaque");
      }
    }
  }
  return kinds;
};

const ancestors = (relative: string): string[] => {
  const names = relative.split("/");
  return names.slice(0, -1).map((_, i) => names.slice(0, i + 1).join("/"));
};

/** The marker's text: the comment, the version, `pending` while staging, the files sorted. */
const markerText = (spec: MarkerSpec, files: Iterable<string>, pending: boolean): string => {
  const sorted = [...files].sort((a, b) => Number(a > b) - Number(a < b));
  return [
    `# ${spec.comment}`,
    `${spec.key}: 1`,
    ...(pending ? [`pending: ${STAGING_FOLDER}`] : []),
    sorted.length === 0 ? "files: []" : "files:",
    ...sorted.map((file) => `  - ${JSON.stringify(file)}`),
    "",
  ].join("\n");
};

/** The runs of this process by their ID, which stay until their commit or abort ends. */
const runs = new Set<string>();

/** Whether the staging folder at `staging` was left by an export that no longer runs. */
const leftBehind = async (staging: string): Promise<boolean> => {
  try {
    const owner = JSON.parse(await fs.readFile(path.join(staging, OWNER_FILE), "utf8")) as {
      pid?: unknown;
      started?: unknown;
      run?: unknown;
    };
    if (owner.pid === process.pid) {
      return !runs.has(String(owner.run));
    }
    const started = typeof owner.started === "number" ? owner.started : 0;
    return !processRuns(owner.pid) || Date.now() - started > STALE_OWNER_MS;
  } catch {
    const stat = await fs.lstat(staging);
    return Date.now() - stat.mtimeMs > UNOWNED_STALE_MS;
  }
};

const removeTree = (absolute: string): Promise<void> =>
  retry(() => fs.rm(absolute, { recursive: true, force: true }), TRANSIENT_CODES);

const rename = (from: string, to: string): Promise<void> => retry(() => fs.rename(from, to), TRANSIENT_CODES);

/** The marker as read: its snapshot and entries, undefined when there is none; refuses one that cannot be read. */
const readMarker = async (
  folder: string,
  spec: MarkerSpec,
): Promise<{ snapshot: FileSnapshot; text: string; entries: unknown[] } | undefined> => {
  const read = await readFileSnapshot(folder, spec.file);
  if (read.kind !== "read") {
    if (read.missing) {
      return undefined;
    }
    throw refused(`the marker file ${spec.file} cannot be read: ${read.problem.message}`);
  }
  const text = new TextDecoder().decode(read.bytes);
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    throw refused(
      `the marker file ${spec.file} is no YAML: ${(error as Error).message.replace(/\n[\s\S]*/u, "")}`,
    );
  }
  const marker = (typeof data === "object" ? data : null) as Record<string, unknown> | null;
  if (marker?.[spec.key] !== 1 || !Array.isArray(marker["files"])) {
    throw refused(`the marker file ${spec.file} is not one of this version (${spec.key}: 1 with files)`);
  }
  return { snapshot: read.snapshot, text, entries: marker["files"] as unknown[] };
};

/** Opens the target `target` (absolute) for a new export (see the file comment). */
export const openExportFolder = async (target: string, spec: MarkerSpec): Promise<ExportFolder> => {
  const shownName = path.basename(target);
  const parentStat = await fs.stat(path.dirname(target)).catch(() => undefined);
  if (parentStat?.isDirectory() !== true) {
    throw new CommandError(
      "file.folder-missing",
      `Not exported: the folder above ${shownName} does not exist`,
      {
        fields: ["output"],
      },
    );
  }
  const stat = await fs.stat(target).catch((error: unknown) => {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (stat !== undefined && !stat.isDirectory()) {
    throw new CommandError("file.not-regular", `Not exported: ${shownName} is no folder`, {
      fields: ["output"],
    });
  }
  const created = stat === undefined;
  if (created) {
    await fs.mkdir(target).catch((error: unknown) => {
      // Taken since the check, or a link that leads nowhere.
      throw errorCode(error) === "EEXIST"
        ? new CommandError("file.not-regular", `Not exported: ${shownName} is no folder`, {
            fields: ["output"],
          })
        : error;
    });
  }
  const folder = await fs.realpath(target);
  const staging = path.join(folder, STAGING_FOLDER);
  const undoCreate = async (): Promise<void> => {
    if (created) {
      await fs.rmdir(folder).catch(() => undefined);
    }
  };
  try {
    const marker = await readMarker(folder, spec);
    const kinds = await walk(folder);
    const hasStaging = (await fs.lstat(staging).catch(() => undefined)) !== undefined;
    if (marker === undefined && kinds.size > 0) {
      throw refused(`${shownName} is not empty and holds no marker file ${spec.file} of an HTML export`);
    }
    if (hasStaging) {
      const stagingStat = await fs.lstat(staging);
      if (!stagingStat.isDirectory() || !(await leftBehind(staging))) {
        throw refused(`another export into ${shownName} is running (${STAGING_FOLDER})`);
      }
      await removeLeftBehind(staging, shownName);
    }
    try {
      await fs.mkdir(staging);
    } catch (error) {
      throw errorCode(error) === "EEXIST"
        ? refused(`another export into ${shownName} is running (${STAGING_FOLDER})`)
        : error;
    }
    const run = randomUUID();
    runs.add(run);
    try {
      await fs.writeFile(
        path.join(staging, OWNER_FILE),
        JSON.stringify({ pid: process.pid, started: Date.now(), run }),
      );
      const opening = await opened(folder, spec, kinds, marker, created);
      const ending =
        <T>(end: () => Promise<T>) =>
        async (): Promise<T> => {
          try {
            return await end();
          } finally {
            runs.delete(run);
          }
        };
      return { ...opening, commit: ending(() => opening.commit()), abort: ending(() => opening.abort()) };
    } catch (error) {
      runs.delete(run);
      await removeTree(staging);
      throw error;
    }
  } catch (error) {
    await undoCreate();
    throw error;
  }
};

/**
 * Removes the staging folder `staging` that an export left behind. It is first renamed to a name of
 * its own, so two exports cannot both remove it, and checked once more there: an export that took
 * its place since the check gets it back, and this one is refused.
 */
const removeLeftBehind = async (staging: string, shownName: string): Promise<void> => {
  const aside = `${staging}-${randomUUID()}`;
  try {
    await rename(staging, aside);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
    // Another export removed it first.
    return;
  }
  if (!(await leftBehind(aside))) {
    await rename(aside, staging);
    throw refused(`another export into ${shownName} is running (${STAGING_FOLDER})`);
  }
  await removeTree(aside);
};

/** The files the earlier export wrote by its marker entries, their folders, and the entries not used. */
const oldFiles = (
  entries: readonly unknown[],
  spec: MarkerSpec,
  kinds: ReadonlyMap<string, Kind>,
): { old: Set<string>; oldUnder: Set<string>; ignored: IgnoredEntry[] } => {
  const ignored: IgnoredEntry[] = [];
  const old = new Set<string>();
  const seen = new Set<string>();
  for (const entry of entries) {
    const problem = entryProblem(entry, spec);
    const shown = typeof entry === "string" ? entry : JSON.stringify(entry);
    if (problem !== undefined) {
      ignored.push({ entry: shown, reason: problem });
      continue;
    }
    const name = String(entry);
    if (seen.has(name.toLowerCase())) {
      ignored.push({ entry: name, reason: "it is listed twice" });
      continue;
    }
    seen.add(name.toLowerCase());
    const kind = kinds.get(name);
    if (kind === "file") {
      old.add(name);
    } else if (
      kind !== undefined ||
      ancestors(name).some((a) => kinds.get(a) !== undefined && kinds.get(a) !== "folder")
    ) {
      ignored.push({ entry: name, reason: "it is no file the export wrote: a folder, a link or inside one" });
    }
  }
  const oldUnder = new Set<string>();
  for (const file of old) {
    for (const a of ancestors(file)) {
      oldUnder.add(a);
    }
  }
  return { old, oldUnder, ignored };
};

const opened = async (
  folder: string,
  spec: MarkerSpec,
  kinds: Map<string, Kind>,
  marker: { snapshot: FileSnapshot; text: string; entries: unknown[] } | undefined,
  created: boolean,
): Promise<ExportFolder> => {
  const staging = path.join(folder, STAGING_FOLDER);
  const { old, ignored, oldUnder } = oldFiles(marker?.entries ?? [], spec, kinds);
  // Not the old export's: a file or link it did not write, a folder without its files below.
  const isForeign = (relative: string, kind: Kind): boolean =>
    relative !== spec.file && (kind === "folder" ? !oldUnder.has(relative) : !old.has(relative));
  // Paths whose subtree holds anything of another source: entered, never moved.
  const mixed = new Set<string>();
  const foreign = new Set<string>();
  for (const [relative, kind] of kinds) {
    if (isForeign(relative, kind)) {
      mixed.add(relative);
      for (const a of ancestors(relative)) {
        mixed.add(a);
      }
      // Named once, by its topmost folder of another source.
      foreign.add(ancestors(relative).find((a) => !oldUnder.has(a)) ?? relative);
    }
  }
  const foreignTop = [...foreign].sort((x, y) => Number(x > y) - Number(x < y));
  const written = new Set<string>();
  const newFolders = new Set<string>();
  const markerFile = (files: Iterable<string>, pending: boolean): string => markerText(spec, files, pending);
  let snapshot: FileSnapshot | null = marker?.snapshot ?? null;
  const writeMarker = async (text: string): Promise<void> => {
    snapshot = await writeFileAtomic(folder, spec.file, text, snapshot, { kind: "yaml" });
  };
  const restoreMarker = async (): Promise<void> => {
    if (marker === undefined) {
      await fs.rm(path.join(folder, spec.file), { force: true });
    } else {
      await writeMarker(marker.text);
    }
  };
  const giveUp = async (): Promise<void> => {
    await restoreMarker();
    await removeTree(staging);
    if (created) {
      await fs.rmdir(folder).catch(() => undefined);
    }
  };
  try {
    await writeMarker(markerFile(old, true));
  } catch (error) {
    await removeTree(staging);
    throw error;
  }

  // Every spelling the walk found, by its lower case: a file system that ignores case takes them as one.
  const spellings = new Map<string, string[]>();
  for (const p of kinds.keys()) {
    spellings.set(p.toLowerCase(), [...(spellings.get(p.toLowerCase()) ?? []), p]);
  }
  const oldPaths = new Set([...old, ...oldUnder]);
  /** Whether `q`, found where `p` goes, belongs to another source; `inner` for a folder on the way. */
  const takenBy = (p: string, q: string, inner: boolean): boolean => {
    const kind = kinds.get(q);
    if (q !== p) {
      // Only what is wholly the earlier export's is moved aside before the other spelling comes in.
      return !oldPaths.has(q) || mixed.has(q);
    }
    return kind === "opaque" || (kind === "file" && !old.has(q)) || (!inner && mixed.has(q));
  };
  const blocked = (relative: string): boolean =>
    [...ancestors(relative), relative].some((p) =>
      (spellings.get(p.toLowerCase()) ?? []).some((q) => takenBy(p, q, p !== relative)),
    );

  const write = async (relative: string, content: string | Uint8Array): Promise<void> => {
    if (entryProblem(relative, spec) !== undefined || written.has(relative)) {
      throw new CommandError("internal", `Not exported: ${relative} is no new file of the export`);
    }
    if (blocked(relative)) {
      throw refused(`${relative} is taken by a file the earlier export did not write; move it away`, {
        file: relative,
      });
    }
    for (const a of ancestors(relative)) {
      if (written.has(a)) {
        throw new CommandError("internal", `Not exported: ${a} is a file and a folder of the export`);
      }
      newFolders.add(a);
    }
    written.add(relative);
    const absolute = path.join(staging, "new", ...relative.split("/"));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, { flag: "wx" });
  };

  /** Throws unless `relative` (a folder of the target, "" for its root) is still a real folder. */
  const checkFolder = async (relative: string): Promise<void> => {
    let at = folder;
    for (const name of relative === "" ? [] : relative.split("/")) {
      at = path.join(at, name);
      const stat = await fs.lstat(at);
      if (!stat.isDirectory()) {
        throw refused(`${relative} changed while the export ran; run it again`);
      }
    }
  };

  const moves: { readonly from: string; readonly to: string }[] = [];
  const move = async (from: string, to: string): Promise<void> => {
    await fs.mkdir(path.dirname(to), { recursive: true });
    await rename(from, to);
    moves.push({ from, to });
  };
  const childrenOf = (set: Iterable<string>, relative: string): Set<string> => {
    const prefix = relative === "" ? "" : `${relative}/`;
    const names = new Set<string>();
    for (const p of set) {
      if (p.startsWith(prefix)) {
        names.add(p.slice(prefix.length).replace(/\/[\s\S]*/u, ""));
      }
    }
    return names;
  };
  const swap = async (relative: string, newPaths: ReadonlySet<string>): Promise<void> => {
    await checkFolder(relative);
    const names = new Set([...childrenOf(oldPaths, relative), ...childrenOf(newPaths, relative)]);
    for (const name of [...names].sort()) {
      const p = relative === "" ? name : `${relative}/${name}`;
      const parts = p.split("/");
      const inTarget = path.join(folder, ...parts);
      if (mixed.has(p)) {
        // A folder that also holds files of another source: entered, never moved.
        await swap(p, newPaths);
        continue;
      }
      if (oldPaths.has(p)) {
        await checkFolder(relative);
        await move(inTarget, path.join(staging, "old", ...parts));
      }
      if (newPaths.has(p)) {
        await checkFolder(relative);
        await move(path.join(staging, "new", ...parts), inTarget);
      }
    }
  };

  const commit = async (): Promise<{ removed: number; cleanupFailed: boolean }> => {
    try {
      await writeMarker(markerFile(new Set([...old, ...written]), true));
      await swap("", new Set([...written, ...newFolders]));
    } catch (error) {
      try {
        for (const { from, to } of moves.reverse()) {
          await rename(to, from);
        }
      } catch {
        throw refused(
          `the earlier export could not be put back; its files are in ${STAGING_FOLDER}/old of the export folder, so move them out before the next export removes that folder`,
        );
      }
      await giveUp();
      throw error;
    }
    await writeMarker(markerFile(written, false));
    const removed = [...old].filter((file) => !written.has(file)).length;
    const cleanupFailed = await removeTree(staging).then(
      () => false,
      () => true,
    );
    return { removed, cleanupFailed };
  };

  return {
    folder,
    foreign: foreignTop,
    ignored,
    write,
    commit,
    abort: giveUp,
  };
};
