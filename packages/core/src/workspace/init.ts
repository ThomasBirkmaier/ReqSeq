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
import { WORKSPACE_FILE } from "./config.js";

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
    if ((await statOf(path.dirname(root)))?.isDirectory() !== true) {
      throw new CommandError(
        "file.folder-missing",
        "Not written: neither the folder of the new workspace nor the folder above it exists; create the folder above it first",
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
 * Creates a workspace in the folder `root`, which is created when only it is missing (#637): the metamodel file in the metamodel folder of
 * the main repository (created when missing), then `reqseq-workspace.yaml`, which makes the folder
 * a workspace. The folder may hold other files (a fresh clone has `.git`). Before anything is
 * written it refuses a folder whose parent is missing too (`file.folder-missing`), a path that is no folder or input
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
  // The workspace is complete here; the `.gitignore` line is a convenience and never fails the call.
  const ignore = await ignoreTempFiles(root).catch(() => undefined);
  return ignore === undefined ? written : [...written, ignore];
};

/** The line of `.gitignore` that keeps ReqSeq's temp files out of Git (#271, `TEMP_FILE_PATTERN`). */
export const TEMP_FILE_IGNORE = "*.reqseq-tmp";

/**
 * Adds `TEMP_FILE_IGNORE` to the `.gitignore` of `root` (product owner decision, 2026-11-02, #271):
 * creates the file, or appends the line with the file's own line ending when no line is it. A
 * `.gitignore` that cannot be read (a link, not a file) is left alone; its bytes are kept as they are.
 * Gives the path written, else undefined.
 */
const ignoreTempFiles = async (root: string): Promise<string | undefined> => {
  const current = await readFileSnapshot(root, GITIGNORE);
  if (current.kind === "problem") {
    return current.missing
      ? (await writeFileAtomic(root, GITIGNORE, `${TEMP_FILE_IGNORE}\n`, null, { kind: "copy" })).path
      : undefined;
  }
  // Only read to find the line and the line ending; the bytes are kept as they are (any encoding).
  const text = Buffer.from(current.bytes).toString("latin1");
  // Git keeps leading spaces as part of a pattern and drops trailing ones.
  if (text.split(/\r?\n/).some((line) => line.trimEnd() === TEMP_FILE_IGNORE)) {
    return undefined;
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lead = text === "" || text.endsWith("\n") ? "" : eol;
  const bytes = Buffer.concat([current.bytes, Buffer.from(`${lead}${TEMP_FILE_IGNORE}${eol}`)]);
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
