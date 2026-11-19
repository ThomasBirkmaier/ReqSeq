// The skill file at the place of D-079 (SR-229 AK8): `.claude/skills/managing-requirements/SKILL.md` in the
// root of the Git repository the workspace folder lies in (`gitRootOf`, no process), else in the workspace
// folder. Several workspaces in one repository share the file; since it holds no name of a metamodel, the
// second write finds it unchanged. `readSkillFile` tells what is there (#1920, AK10), `writeSkillFile` writes
// it (`tool.guide` with `write`, and `workspace.init`, #1919, AK9) and returns a refusal as a value.
//
// Writing, in this order, with nothing read or written before the check and nothing written before the last step:
// 1. through API and MCP the path passes the SR-142 check of the call (`localPaths`): outside the
//    repositories of the workspace (a Git root above the workspace folder) it is refused and names the
//    command-line call instead; no message or detail holds an absolute path (ADR-0009);
// 2. the file is looked at without following a link: a link or a folder there is `file.not-regular`;
// 3. ReqSeq's own unchanged file (checksum, guide/skill.ts) is replaced, or left when it is the same; any
//    other file only with `replace`, else `file.exists`;
// 4. the folder must not meet Git (`gitPlaceOf`, and `refuseGitAt` for its real folder, D-036), then the
//    folders are created and the file is written atomically: `createFolder` and `writeFileAtomic` refuse
//    folders linked out of the root and a file changed since step 2 (`file.changed-on-disk`).
import fs from "node:fs/promises";
import path from "node:path";
import type { LocalPaths } from "../../../catalog.js";
import { CommandError } from "../../../catalog.js";
import type { FileSnapshot } from "../../../files/index.js";
import { createFolder, readFileSnapshot, writeFileAtomic } from "../../../files/index.js";
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
import { SKILL_FILE, identifySkill, skillFile } from "./skill.js";

/** The largest file at the place of the skill that is read; a larger one counts as another file. */
export const SKILL_READ_MAX = 64 * 1024;

/** Where the skill file goes: the root it lies in, and its path relative to the workspace root, with `/`. */
export interface SkillLocation {
  /** The Git root, or the workspace folder without Git; links resolved. */
  readonly root: string;
  /** The file, absolute. */
  readonly absolute: string;
  /** The file relative to the real path of the workspace root, with `/` (`../.claude/…` below a Git root). */
  readonly path: string;
}

/** The place of D-079 for `workspace`. */
export const skillLocation = async (workspace: Workspace): Promise<SkillLocation> => {
  const real = await fs.realpath(workspace.root).catch(() => workspace.root);
  const root = (await gitRootOf(real)) ?? real;
  const absolute = path.join(root, ...SKILL_FILE.split("/"));
  return { root, absolute, path: path.relative(real, absolute).split(path.sep).join("/") };
};

/** What lies at the place of the skill (AK8, AK10). */
export type SkillFileState =
  | { readonly state: "missing" }
  | { readonly state: "foreign" }
  /**
   * Written by ReqSeq: its `version`, whether its checksum still matches (`intact`), and whether it is
   * what this version writes (`current`, compared in the canonical form, so line endings do not count).
   */
  | { readonly state: "own"; readonly version: string; readonly intact: boolean; readonly current: boolean };

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

/** Looks at the file without following a link (step 1). */
const look = async (location: SkillLocation, entries: readonly CatalogEntry[]): Promise<Looked> => {
  const stat = await fs.lstat(location.absolute).catch((error: unknown) => {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return undefined;
    }
    throw new CommandError(
      "file.faulty",
      `Not written: the skill file ${location.path} cannot be looked at (${String(code)})`,
      { path: location.path, reason: code },
    );
  });
  if (stat === undefined) {
    return { found: { state: "missing" } };
  }
  if (!stat.isFile()) {
    throw notRegular(location);
  }
  if (stat.size > SKILL_READ_MAX) {
    return { found: { state: "foreign" } };
  }
  const read = await readFileSnapshot(location.root, SKILL_FILE);
  if (read.kind === "problem") {
    throw unreadable(location, read.problem);
  }
  const text = new TextDecoder().decode(read.bytes);
  const identity = identifySkill(text);
  if (!identity.own) {
    return { found: { state: "foreign" }, snapshot: read.snapshot };
  }
  const current = canonical(text) === skillFile(entries);
  return {
    found: { state: "own", version: identity.version, intact: identity.intact, current },
    snapshot: read.snapshot,
  };
};

/** The snapshot of a file over the read limit, read only to be replaced. */
const snapshotOf = async (location: SkillLocation): Promise<FileSnapshot> => {
  const read = await readFileSnapshot(location.root, SKILL_FILE);
  if (read.kind === "problem") {
    throw unreadable(location, read.problem);
  }
  return read.snapshot;
};

/** What lies at the place of the skill of `workspace`, and where (#1920). */
export const readSkillFile = async (
  workspace: Workspace,
  entries: readonly CatalogEntry[],
): Promise<SkillFileState & { readonly path: string }> => {
  const location = await skillLocation(workspace);
  return { ...(await look(location, entries)).found, path: location.path };
};

/** What a write did. */
export interface SkillWritten {
  readonly path: string;
  readonly action: "created" | "replaced" | "unchanged";
  /** The version of the file it replaced, when ReqSeq wrote that one. */
  readonly previousVersion?: string;
}

export type SkillWriteResult = { readonly written: SkillWritten } | { readonly refused: CommandError };

export interface SkillWriteOptions {
  /** Replace a file ReqSeq did not write, or that was changed since (AK8). */
  readonly replace: boolean;
  /** The local path rule of the call (SR-142). */
  readonly localPaths: LocalPaths;
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
        ? "the skill file lies outside the repositories of the workspace"
        : "the place of the skill file cannot be checked";
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
  await refuseGitAt(folder, SKILL_FILE);
};

/** Writes the skill file, or why not, in the order of the file comment. */
const write = async (
  workspace: Workspace,
  entries: readonly CatalogEntry[],
  options: SkillWriteOptions,
): Promise<SkillWritten> => {
  // A workspace file must be there; the metamodel need not be valid, since the skill names none of it.
  await workspace.get(workspaceLayoutState);
  const location = await skillLocation(workspace);
  // Before the file is looked at: through API and MCP nothing outside the repositories is read (SR-142 AK1).
  await checkAccess(location, options, entries);
  const { found, snapshot } = await look(location, entries);
  const own = found.state === "own" && found.intact;
  if (own && found.current) {
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
  await createFolder(location.root, path.posix.dirname(SKILL_FILE));
  await writeFileAtomic(location.root, SKILL_FILE, skillFile(entries), expected, { kind: "copy" });
  return {
    path: location.path,
    action: found.state === "missing" ? "created" : "replaced",
    ...(found.state === "own" ? { previousVersion: found.version } : {}),
  };
};

/**
 * Writes the skill file of `workspace` at the place of D-079 (AK8): created, replaced, or left unchanged;
 * a refusal (`file.exists`, `input.invalid` through API and MCP outside the repositories or in Git,
 * `file.not-regular`, `file.read-only`, `file.changed-on-disk` for a change meanwhile) comes as a value.
 */
export const writeSkillFile = async (
  workspace: Workspace,
  entries: readonly CatalogEntry[],
  options: SkillWriteOptions,
): Promise<SkillWriteResult> => {
  try {
    return { written: await write(workspace, entries, options) };
  } catch (error) {
    if (error instanceof CommandError) {
      return { refused: error };
    }
    throw error;
  }
};
