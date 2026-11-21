// The skill file at the places of D-079 (SR-229 AK8), in its order: `.claude/skills/managing-requirements/SKILL.md`,
// then `.agents/skills/managing-requirements/SKILL.md` (`SKILL_FILES`), both in the root of the Git repository the
// workspace folder lies in (`gitRootOf`, no process), else in the workspace folder. Several workspaces in one
// repository share the files; since they hold no name of a metamodel, the second write finds them unchanged.
// `readSkillFiles` tells what is at each place (#1920, AK10), `writeSkillFiles` writes each place on its own
// (`tool.guide` with `write`, and `workspace.init`, #1919, AK9) and returns a refusal of a place as a value, so a
// refused place never stops the next one; `writtenOrThrow` gives the one error of a call with a refused place.
//
// The steps for the whole call come first and throw: a workspace file must be there, and the places are found.
// Then, per place in order, with nothing read or written before the check and nothing written before the last step:
// 1. through API and MCP the path passes the SR-142 check of the call (`localPaths`): outside the
//    repositories of the workspace (a Git root above the workspace folder) it is refused and names the
//    command-line call instead; no message or detail holds an absolute path (ADR-0009);
// 2. the file is looked at without following a link: a link or a folder there is `file.not-regular`, and so is a
//    file in the way of its folders (`.agents` as a file), on every system;
// 3. ReqSeq's own unchanged file (checksum, guide/skill.ts) is replaced, or left when it is the same; any
//    other file only with `replace`, else `file.exists`;
// 4. the folder must not meet Git (`gitPlaceOf`, and `refuseGitAt` for its real folder, D-036), then the
//    folders are created and the file is written atomically: `createFolder` and `writeFileAtomic` refuse
//    folders linked out of the root and a file changed since step 2 (`file.changed-on-disk`).
// A folder of one place linked to the folder of the other inside the repository finds the file the first place
// wrote, so the second is `unchanged`. An error that is no `CommandError` is a bug and stops the call.
import fs from "node:fs/promises";
import path from "node:path";
import type { LocalPaths } from "../../../catalog.js";
import { CommandError } from "../../../catalog.js";
import type { FileSnapshot } from "../../../files/index.js";
import { createFolder, linksStayInside, readFileSnapshot, writeFileAtomic } from "../../../files/index.js";
import type { CatalogEntry } from "../../../runtime/contracts.js";
import type { Workspace } from "../../../runtime/workspace.js";
import {
  GIT_PLACE,
  gitPlaceOf,
  gitRootOf,
  refuseGitAt,
  workspaceLayoutState,
} from "../../../workspace/index.js";
import { renderCall } from "./calls.js";
import { SKILL_FILES, identifySkill, skillFile } from "./skill.js";

/** The largest file at the place of the skill that is read; a larger one counts as another file. */
export const SKILL_READ_MAX = 64 * 1024;

/** One place of the skill file: the root it lies in, the file below it, and its path relative to the workspace root. */
export interface SkillLocation {
  /** The Git root, or the workspace folder without Git; links resolved. */
  readonly root: string;
  /** The file relative to `root`, with `/` (one of `SKILL_FILES`). */
  readonly file: string;
  /** The file, absolute. */
  readonly absolute: string;
  /** The file relative to the real path of the workspace root, with `/` (`../.claude/…` below a Git root). */
  readonly path: string;
}

/** The places of D-079 for `workspace`, in its order. */
export const skillLocations = async (workspace: Workspace): Promise<readonly SkillLocation[]> => {
  const real = await fs.realpath(workspace.root).catch(() => workspace.root);
  const root = (await gitRootOf(real)) ?? real;
  return SKILL_FILES.map((file) => {
    const absolute = path.join(root, ...file.split("/"));
    return { root, file, absolute, path: path.relative(real, absolute).split(path.sep).join("/") };
  });
};

/** What lies at one place of the skill (AK8, AK10). */
export type SkillFileState =
  | { readonly state: "missing" }
  | { readonly state: "foreign" }
  /**
   * Written by ReqSeq: its `version`, whether its checksum still matches (`intact`), whether it is what this
   * version writes (`current`), and whether it is what this version writes with the version it carries
   * (`sameContent`, AK10: only the version differs); compared in the canonical form, so line endings do not count.
   */
  | {
      readonly state: "own";
      readonly version: string;
      readonly intact: boolean;
      readonly current: boolean;
      readonly sameContent: boolean;
    };

interface Looked {
  readonly found: SkillFileState;
  /** The snapshot to replace the file with; undefined when it is missing or too large to read. */
  readonly snapshot?: FileSnapshot;
}

const canonical = (text: string): string => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

/** The refusal of a path that is no regular file. */
const notRegular = (location: SkillLocation): CommandError =>
  new CommandError(
    "file.not-regular",
    `Not written: the skill file ${location.path} is a symbolic link or not a regular file`,
    { path: location.path },
  );

/** A file that cannot be read: a folder above it linked out of the root, no permission, or a swap since the look. */
const unreadable = (location: SkillLocation, problem: { readonly message: string }): CommandError =>
  new CommandError(
    "file.faulty",
    `Not written: the skill file ${location.path} cannot be read: ${problem.message}`,
    {
      path: location.path,
    },
  );

/** The refusal of a place that cannot be looked at, with the code of the file system. */
const unlooked = (location: SkillLocation, code: unknown): CommandError =>
  new CommandError(
    "file.faulty",
    `Not written: the skill file ${location.path} cannot be looked at (${String(code)})`,
    { path: location.path, reason: code },
  );

/** The refusal of a place whose folder cannot be made because a file is in its way. */
const inTheWay = (location: SkillLocation): CommandError =>
  new CommandError(
    "file.not-regular",
    `Not written: a path above the skill file ${location.path} is a file, not a folder`,
    { path: location.path, reason: "file-in-the-way" },
  );

/**
 * Whether a file stands where a folder of `location` belongs, walking from the root down: `lstat` of a file below
 * a file says ENOTDIR on Linux and macOS but ENOENT on Windows, so the answer cannot come from the code. The links
 * on the way were checked to stay inside the root (`linksStayInside`), so `stat` may follow them.
 */
const fileInTheWay = async (location: SkillLocation): Promise<boolean> => {
  let at = location.root;
  for (const name of location.file.split("/").slice(0, -1)) {
    at = path.join(at, name);
    const stat = await fs.stat(at).catch((error: unknown) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return undefined;
      }
      throw unlooked(location, code);
    });
    if (stat === undefined) {
      return false;
    }
    if (!stat.isDirectory()) {
      return true;
    }
  }
  return false;
};

/**
 * Looks at the file without following a link (step 2). First the links on the way to its folder, name by
 * name (`linksStayInside`): a folder linked out of the root is refused, and so is a loop of links, which
 * the walk reports as `ELOOP` on every system, while `lstat` of the file itself may only say ENOENT
 * (Windows) and leave the loop to the write.
 */
const look = async (location: SkillLocation, entries: readonly CatalogEntry[]): Promise<Looked> => {
  const inside = await linksStayInside(location.root, path.dirname(location.absolute)).catch(
    (error: unknown) => {
      throw unlooked(location, (error as NodeJS.ErrnoException).code);
    },
  );
  if (!inside) {
    throw new CommandError(
      "input.invalid",
      `Not written: the folder of the skill file ${location.path} is linked outside its repository`,
      { path: location.path, reason: "linked-outside" },
    );
  }
  const stat = await fs.lstat(location.absolute).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return undefined;
    }
    throw unlooked(location, code);
  });
  if (stat === undefined) {
    if (await fileInTheWay(location)) {
      throw inTheWay(location);
    }
    return { found: { state: "missing" } };
  }
  if (!stat.isFile()) {
    throw notRegular(location);
  }
  if (stat.size > SKILL_READ_MAX) {
    return { found: { state: "foreign" } };
  }
  const read = await readFileSnapshot(location.root, location.file);
  if (read.kind === "problem") {
    throw unreadable(location, read.problem);
  }
  const text = new TextDecoder().decode(read.bytes);
  const identity = identifySkill(text);
  if (!identity.own) {
    return { found: { state: "foreign" }, snapshot: read.snapshot };
  }
  const lf = canonical(text);
  const current = lf === skillFile(entries);
  const sameContent = current || lf === skillFile(entries, identity.version);
  return {
    found: { state: "own", version: identity.version, intact: identity.intact, current, sameContent },
    snapshot: read.snapshot,
  };
};

/** The snapshot of a file over the read limit, read only to be replaced. */
const snapshotOf = async (location: SkillLocation): Promise<FileSnapshot> => {
  const read = await readFileSnapshot(location.root, location.file);
  if (read.kind === "problem") {
    throw unreadable(location, read.problem);
  }
  return read.snapshot;
};

/** What `run` gives, or the refusal it throws; an error that is no `CommandError` is a bug and is thrown on. */
const refusalOr = async <T>(run: () => Promise<T>): Promise<T | CommandError> => {
  try {
    return await run();
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
};

/** What lies at one place, or `blocked` when nothing can be written there (step 2 or, unless ReqSeq's own unchanged file of this version is there, the Git check refuses it). */
export type SkillPlaceState = (SkillFileState | { readonly state: "blocked" }) & { readonly path: string };

/**
 * What lies at each place of the skill of `workspace`, in the order of D-079 (#1920, AK10). Only reads: the look of
 * step 2 and the Git check of step 4; a place either refuses is `blocked`.
 */
export const readSkillFiles = async (
  workspace: Workspace,
  entries: readonly CatalogEntry[],
): Promise<readonly SkillPlaceState[]> => {
  const places: SkillPlaceState[] = [];
  for (const location of await skillLocations(workspace)) {
    const found = await refusalOr(async () => {
      const looked = await look(location, entries);
      // As `write`: ReqSeq's own unchanged file of this version is left before the Git check.
      const left = looked.found.state === "own" && looked.found.intact && looked.found.current;
      if (!left) {
        await refuseGitPlace(location);
      }
      return looked.found;
    });
    places.push(
      found instanceof CommandError
        ? { state: "blocked", path: location.path }
        : { ...found, path: location.path },
    );
  }
  return places;
};

/** What a write did. */
export interface SkillWritten {
  readonly path: string;
  readonly action: "created" | "replaced" | "unchanged";
  /** The version of the file it replaced, when ReqSeq wrote that one. */
  readonly previousVersion?: string;
}

/** What happened at one place: written (or left), or refused with the reason. */
export type SkillPlaceResult = SkillWritten | { readonly path: string; readonly refused: CommandError };

export interface SkillWriteOptions {
  /** Replace a file ReqSeq did not write, or that was changed since (AK8), at every place. */
  readonly replace: boolean;
  /** The local path rule of the call (SR-142). */
  readonly localPaths: LocalPaths;
  /**
   * Leave ReqSeq's own unchanged file of another version as it is (`unchanged`): `workspace.init` changes no
   * existing file (SR-014 AK1, SR-229 AK9).
   */
  readonly keepOwn?: boolean;
}

/** The command-line call that writes the skill file, which a refusal through API and MCP names (AK8). */
const writeCall = (entries: readonly CatalogEntry[], replace: boolean): string =>
  renderCall(
    { command: "tool.guide", input: { skill: true, write: true, ...(replace ? { replace: true } : {}) } },
    "cli",
    entries,
  );

/** Step 3: the SR-142 check of the call; a refusal names the command line, never an absolute path. */
const checkAccess = async (
  location: SkillLocation,
  options: SkillWriteOptions,
  entries: readonly CatalogEntry[],
): Promise<void> => {
  try {
    await options.localPaths.check([{ field: "skill file", path: location.absolute }]);
  } catch (error) {
    if (!(error instanceof CommandError)) {
      throw error;
    }
    const reason = (error.details as { reason?: unknown } | undefined)?.reason;
    const why =
      reason === "outside-repositories"
        ? `the skill file ${location.path} lies outside the repositories of the workspace`
        : `the place of the skill file ${location.path} cannot be checked`;
    throw new CommandError(
      "input.invalid",
      `Not written: ${why}, and through the API and the MCP server ReqSeq writes only inside them; run ${writeCall(entries, options.replace)} in the workspace folder`,
      { command: "tool.guide", reason, field: "skill file", path: location.path },
    );
  }
};

/**
 * Refuses a skill folder that meets Git (D-036): one below the root that some system takes for `.git`, holds
 * a `.git` entry, or leads into such a folder by a link (`gitPlaceOf`), and a real folder in a `.git` folder
 * (`refuseGitAt`).
 */
const refuseGitPlace = async (location: SkillLocation): Promise<void> => {
  const folder = path.dirname(location.absolute);
  const place = await gitPlaceOf(location.root, folder);
  if (place !== undefined) {
    throw new CommandError(
      "input.invalid",
      `Not written: the skill file ${location.path}: ${place.path} ${GIT_PLACE[place.rule]}; ReqSeq never writes to Git`,
      { path: location.path, reason: "git-folder", rule: place.rule },
    );
  }
  await refuseGitAt(folder, location.file);
};

/** Writes the skill file at one place, or why not, in the order of the file comment. */
const write = async (
  location: SkillLocation,
  entries: readonly CatalogEntry[],
  options: SkillWriteOptions,
): Promise<SkillWritten> => {
  // Before the file is looked at: through API and MCP nothing outside the repositories is read (SR-142 AK1).
  await checkAccess(location, options, entries);
  const { found, snapshot } = await look(location, entries);
  const own = found.state === "own" && found.intact;
  if (own && (found.current || options.keepOwn === true)) {
    return { path: location.path, action: "unchanged" };
  }
  if (found.state !== "missing" && !own && !options.replace) {
    const reason = found.state === "foreign" ? "foreign" : "changed";
    const what = reason === "foreign" ? "was not written by ReqSeq" : "was changed since ReqSeq wrote it";
    throw new CommandError(
      "file.exists",
      `Not written: the skill file ${location.path} ${what}; ReqSeq replaces it only on request: ${writeCall(entries, true)}`,
      { path: location.path, reason },
    );
  }
  await refuseGitPlace(location);
  const expected = found.state === "missing" ? null : (snapshot ?? (await snapshotOf(location)));
  await createFolder(location.root, path.posix.dirname(location.file));
  await writeFileAtomic(location.root, location.file, skillFile(entries), expected, { kind: "copy" });
  return {
    path: location.path,
    action: found.state === "missing" ? "created" : "replaced",
    ...(found.state === "own" ? { previousVersion: found.version } : {}),
  };
};

/**
 * Writes the skill file of `workspace` at each place of D-079, in its order (AK8): created, replaced, or left
 * unchanged; a refusal of one place (`file.exists`, `input.invalid` through API and MCP outside the repositories or
 * in Git, `file.not-regular`, `file.read-only`, `file.changed-on-disk` for a change meanwhile) comes as a value, and
 * the next place is written all the same. No workspace file throws, before any place.
 */
export const writeSkillFiles = async (
  workspace: Workspace,
  entries: readonly CatalogEntry[],
  options: SkillWriteOptions,
): Promise<readonly SkillPlaceResult[]> => {
  // A workspace file must be there; the metamodel need not be valid, since the skill names none of it.
  await workspace.get(workspaceLayoutState);
  const results: SkillPlaceResult[] = [];
  for (const location of await skillLocations(workspace)) {
    const done = await refusalOr(() => write(location, entries, options));
    results.push(done instanceof CommandError ? { path: location.path, refused: done } : done);
  }
  return results;
};

/** The verb of a written place in the message of a failed call. */
const DONE = { created: "created", replaced: "replaced", unchanged: "left unchanged" } as const;

/**
 * The places a write wrote, in the order of D-079, or the error of a write with a refused place (AK8): its code is
 * that of the first refused place, its message names each place with its result, a reason given once for the places
 * it holds for, and `details.places` holds each place as the output would, a refused one with its error instead of
 * an action.
 */
export const writtenOrThrow = (results: readonly SkillPlaceResult[]): readonly SkillWritten[] => {
  const written = results.flatMap((result) => ("refused" in result ? [] : [result]));
  const [first] = results.flatMap((result) => ("refused" in result ? [result.refused] : []));
  if (first === undefined) {
    return written;
  }
  const reasons: string[] = [];
  const parts = results.map((result) => {
    if (!("refused" in result)) {
      return `${result.path}: ${DONE[result.action]}`;
    }
    const reason = result.refused.message.replace(/^Not written: /, "");
    // The same reason at another place differs only in the path it names.
    const same = reason.replaceAll(result.path, "\0");
    if (reasons.includes(same)) {
      return `${result.path}: not written, for the same reason`;
    }
    reasons.push(same);
    return `${result.path}: not written: ${reason}`;
  });
  throw new CommandError(first.code, `Not written at every place of the skill file: ${parts.join("; ")}`, {
    command: "tool.guide",
    places: results.map((result) =>
      "refused" in result ? { path: result.path, error: result.refused.toJSON() } : result,
    ),
  });
};
