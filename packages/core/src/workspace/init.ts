// Creating a workspace (SR-014): `reqseq-workspace.yaml` and a metamodel file (the standard model,
// passed in by `workspace.init`) in a folder, created when only it is missing (#637). Writes only through the files block,
// creates files without ever replacing one, and never touches Git (D-036): no `git init`, no commit.
import fs from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { CommandError } from "../catalog.js";
import { createFolder, readFileSnapshot, writeFileAtomic } from "../files/index.js";
import type { WorkspaceFile, WorkspaceLocation, WorkspaceRepository } from "../generated/types.js";
import { describeViolations, fileSchemaValidator, schemaViolations } from "../runtime/contracts.js";
import { LOCAL_FILE, WORKSPACE_FILE } from "./config.js";
import { refuseGitAt } from "./git-folder.js";

/** The metamodel folder of a new workspace when the caller names none. */
export const DEFAULT_METAMODEL_FOLDER = "metamodel";

/** The main repository's name when the folder name has no letter or digit to build one from. */
export const FALLBACK_REPOSITORY_NAME = "main";

export interface NewWorkspace {
  /** Display name (`name` of the workspace file). */
  readonly name: string;
  /**
   * Where the metamodel lies. Default: folder `metamodel` in the main repository. Another
   * repository (SR-018) is listed in the workspace file; nothing is written into it.
   */
  readonly metamodel?: { readonly repository?: string; readonly path?: string } | undefined;
  /** The file written into the metamodel folder when that folder is in the main repository. */
  readonly metamodelFile: { readonly name: string; readonly text: string };
}

/**
 * The name of the main repository, built from the name of its folder so that it fits the pattern
 * of repository names (workspace.schema.json): `Weather Station` becomes `weather-station`,
 * `Müller` `muller`. A folder name without any letter or digit gives `main`.
 */
export const repositoryNameFor = (folder: string): string => {
  const name = path
    .basename(folder)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "");
  return name === "" ? FALLBACK_REPOSITORY_NAME : name;
};

/** The workspace file of a new workspace, checked against workspace.schema.json. */
const workspaceFileFor = (main: string, input: NewWorkspace): WorkspaceFile => {
  const metamodel: WorkspaceLocation = {
    repository: input.metamodel?.repository ?? main,
    path: input.metamodel?.path ?? DEFAULT_METAMODEL_FOLDER,
  };
  const repositories: WorkspaceRepository[] = [{ name: main, url: "", main: true }];
  if (metamodel.repository !== main) {
    repositories.push({ name: metamodel.repository, url: "" });
  }
  const file: WorkspaceFile = { "reqseq-workspace": 1, name: input.name, repositories, metamodel };
  const validate = fileSchemaValidator("workspace.schema.json");
  if (!validate(file)) {
    const errors = schemaViolations(validate.errors);
    throw new CommandError(
      "input.invalid",
      `Not written: ${WORKSPACE_FILE} would be invalid: ${describeViolations(errors)}`,
      { file: WORKSPACE_FILE, errors },
    );
  }
  return file;
};

const exists = async (file: string): Promise<boolean> =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );

/** A path that does not exist, also one below a file. */
const MISSING: readonly string[] = ["ENOENT", "ENOTDIR"];

const statOf = async (file: string): Promise<Awaited<ReturnType<typeof fs.stat>> | undefined> =>
  fs.stat(file).catch((error: unknown) => {
    if (MISSING.includes(String((error as NodeJS.ErrnoException).code))) {
      return undefined;
    }
    throw error;
  });

/**
 * Whether the folder must be created: it may be missing while the folder above it exists, as with
 * `git init <folder>` (#637). The messages never echo an absolute path (the same on every machine).
 */
const checkFolder = async (root: string): Promise<{ readonly create: boolean }> => {
  const stat = await statOf(root);
  if (stat === undefined) {
    const parent = await statOf(path.dirname(root));
    if (parent === undefined) {
      throw new CommandError(
        "file.folder-missing",
        "Not written: neither the folder of the new workspace nor the folder above it exists; create the folder above it first",
      );
    }
    if (!parent.isDirectory()) {
      throw new CommandError(
        "file.folder-missing",
        "Not written: the path above the new workspace is not a folder",
      );
    }
    // A link whose target is missing is no folder to create.
    if (await exists(root)) {
      throw new CommandError(
        "file.folder-missing",
        "Not written: the path of the new workspace links to a missing folder",
      );
    }
    return { create: true };
  }
  if (!stat.isDirectory()) {
    throw new CommandError("input.invalid", "Not written: the path of the new workspace is not a folder");
  }
  return { create: false };
};

/**
 * Creates a workspace in the folder `root`, which is created when only it is missing (#637): the
 * metamodel file in the metamodel folder of the main repository (created when missing), then `reqseq-workspace.yaml`, which makes the folder
 * a workspace. The folder may hold other files (a fresh clone has `.git`). Before anything is
 * written it refuses a folder whose parent is missing too (`file.folder-missing`), a folder or
 * metamodel folder in a `.git` folder (`input.invalid`, D-036), a path that is no folder or input
 * that gives an invalid workspace file (`input.invalid`), and a workspace file or metamodel file
 * that exists already (`file.changed-on-disk`). Returns the written files relative to `root`. When
 * the workspace file cannot be written after the metamodel file was, the error keeps its code and
 * names the metamodel file in its message and in `details.written`.
 */
export const createWorkspace = async (root: string, input: NewWorkspace): Promise<readonly string[]> => {
  const { create } = await checkFolder(root);
  const main = repositoryNameFor(root);
  const file = workspaceFileFor(main, input);
  // `.` or "" is the root of the repository, as the layout reads it (path.resolve).
  const folder = path.posix.join(file.metamodel.path, ".");
  const metamodelFile =
    file.metamodel.repository === main ? path.posix.join(folder, input.metamodelFile.name) : undefined;
  for (const target of [WORKSPACE_FILE, ...(metamodelFile === undefined ? [] : [metamodelFile])]) {
    if (await exists(path.join(root, target))) {
      throw new CommandError(
        "file.changed-on-disk",
        `Not written: ${target} already exists; workspace.init only creates a new workspace`,
        { file: target },
      );
    }
  }
  // D-036: neither file goes into a `.git` folder, also through a link (#1449).
  await refuseGitAt(root, path.join(root, WORKSPACE_FILE));
  if (metamodelFile !== undefined) {
    await refuseGitAt(path.join(root, folder), path.join(root, metamodelFile));
  }
  if (create) {
    await createFolder(path.dirname(root), path.basename(root));
  }
  const written: string[] = [];
  if (metamodelFile !== undefined) {
    if (folder !== ".") {
      await createFolder(root, folder);
    }
    const snapshot = await writeFileAtomic(root, metamodelFile, input.metamodelFile.text, null, {
      kind: "yaml",
    });
    written.push(snapshot.path);
  }
  try {
    const snapshot = await writeFileAtomic(root, WORKSPACE_FILE, stringify(file, { lineWidth: 0 }), null, {
      kind: "yaml",
    });
    written.push(snapshot.path);
  } catch (error) {
    throw withWritten(error, written);
  }
  // The workspace is complete here; the `.gitignore` lines are a convenience and never fail the call.
  const ignore = await ignoreFiles(root).catch(() => undefined);
  return ignore === undefined ? written : [...written, ignore];
};

/** The line of `.gitignore` that keeps ReqSeq's temp files out of Git (#271, `TEMP_FILE_PATTERN`). */
export const TEMP_FILE_IGNORE = "*.reqseq-tmp";

/** The lines of `.gitignore` that `workspace.init` makes sure of (SR-014 AK1): temp files and the local file. */
export const GITIGNORE_LINES: readonly string[] = [TEMP_FILE_IGNORE, LOCAL_FILE];

/**
 * Adds the `GITIGNORE_LINES` that are missing to the `.gitignore` of `root` (product owner
 * decisions, 2026-11-02, #271, and 2026-11-11, #1456): creates the file, or appends the missing
 * lines in one write, with the file's own line ending. A `.gitignore` that cannot be read (a link,
 * not a file) is left alone; its bytes are kept as they are. Gives the path written, else undefined.
 */
const ignoreFiles = async (root: string): Promise<string | undefined> => {
  const current = await readFileSnapshot(root, GITIGNORE);
  if (current.kind === "problem") {
    return current.missing
      ? (
          await writeFileAtomic(root, GITIGNORE, GITIGNORE_LINES.map((l) => `${l}\n`).join(""), null, {
            kind: "copy",
          })
        ).path
      : undefined;
  }
  // Only read to find the lines and the line ending; the bytes are kept as they are (any encoding).
  const text = Buffer.from(current.bytes).toString("latin1");
  // Git keeps leading spaces as part of a pattern and drops trailing ones.
  const present = new Set(text.split(/\r?\n/).map((line) => line.trimEnd()));
  const missing = GITIGNORE_LINES.filter((line) => !present.has(line));
  if (missing.length === 0) {
    return undefined;
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lead = text === "" || text.endsWith("\n") ? "" : eol;
  const bytes = Buffer.concat([
    current.bytes,
    Buffer.from(`${lead}${missing.map((l) => `${l}${eol}`).join("")}`),
  ]);
  return (await writeFileAtomic(root, GITIGNORE, bytes, current.snapshot, { kind: "copy" })).path;
};

const GITIGNORE = ".gitignore";

/**
 * The failure of the workspace file write, naming the metamodel file that was written before it and
 * is left in place (ReqSeq removes nothing), so the person can remove it before trying again.
 */
const withWritten = (error: unknown, written: readonly string[]): unknown =>
  error instanceof CommandError && written.length > 0
    ? new CommandError(
        error.code,
        `${error.message.replace(/\.$/, "")}; ${written.join(", ")} was written already and is left in place; remove it before running workspace.init again.`,
        { ...error.details, written: [...written] },
        { cause: error },
      )
    : error;
