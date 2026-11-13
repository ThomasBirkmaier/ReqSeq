// Folders of named YAML files the user saves in the repository (D-056): saved filters (SR-070,
// saved.ts) and perspectives (SR-213, perspectives.ts). One reader and one writer for both, so the
// two kinds behave alike wherever their SRs do not differ.
//
// - Where: the location of the workspace file for the kind (`filters`, `perspectives`), by default
//   the folder of that name in the main repository (`settingLocation`). A file of the kind is a
//   `*.yaml` file directly in that folder that matches the kind's schema, as the metamodel folder is
//   read; a `.yml` file is reported and not read. These files are not elements (D-056: YAML files
//   of the tool), so D-045 does not apply to them; ReqSeq never deletes, moves or renames one.
// - Read on every call, never kept: a handful of small files, and a file another person committed
//   is there as soon as the working copy has it (SR-070 AK2, SR-213 AK2), also for a running server
//   or the app.
// - Names compare ignoring case and Unicode normal form (`fold`, spec-frage ThomasBirkmaier/ReqSeq-archive#363 option 2A), as
//   element references, statuses and choices do. Each kind has its own names: a saved filter and a
//   perspective may share one. The first file in file order (code units) that holds a name is that
//   file; a later valid file with the same name is the kind's duplicate code (warning) and not listed.
//   A file that is no valid file of the kind is a problem and not listed; when its name can still be
//   read, that name is held by a faulty file, which saving and calling refuse (`file.faulty`) rather
//   than guess, and nothing overwrites it (SR-008 AK3).
// - New files (`newSavedFile`): the letters and digits of the name in lower case, without accents,
//   `-` between, at most 64 characters, then `-2`, `-3` ... while the folder has an entry of that
//   name ignoring case. An empty result is the kind's word (`filter`, `perspective`); names of Windows
//   devices (`con`, `nul`, `com1` ...) get `-` and that word.
// - Writing (`writeSaved`): an existing name is edited in place (`editYamlDocument`, ADR-0007), only
//   the keys the caller's edits name; the file must be unchanged since it was read
//   (`file.changed-on-disk`). Never into Git, also when the workspace file places the folder there:
//   the file to write is checked right before each write (`refuseGitPlace`, D-036, SR-083 AK4).
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CommandError } from "../catalog.js";
import type { YamlFile, YamlKeyEdit } from "../files/index.js";
import {
  createFolder,
  editYamlDocument,
  listFolderFiles,
  readYamlFile,
  renderYamlDocument,
  writeFileAtomic,
  yamlPointerLine,
} from "../files/index.js";
import type { FilterSortKey, Problem, WorkspaceLocation } from "../generated/types.js";
import { contractsBundle, fileSchemaErrors, fileSchemaValidator } from "../runtime/contracts.js";
import { workspacePath } from "../model/index.js";
import { fileMessage, inputViolations } from "../runtime/input-errors.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { WORKSPACE_FILE, locate, refuseGitPlace, settingLocation } from "../workspace/index.js";
import { fold } from "./context.js";

/** Saved files end in `.yaml` (D-056). */
export const SAVED_FILE_EXTENSION = ".yaml";

/** A kind of saved file: where it lies, its schema and the words and codes of its problems. */
export interface SavedKind {
  /** The setting of the workspace file that places the folder. */
  readonly setting: "filters" | "perspectives";
  readonly schema: "filter.schema.json" | "perspective.schema.json";
  /** The kind in a message, e.g. `saved filter`. */
  readonly label: string;
  /** The name part of a new file whose name has no letter or digit, and the suffix of a device name. */
  readonly word: string;
  readonly invalid: Problem["code"];
  readonly duplicate: Problem["code"];
}

/** A valid saved file. */
export interface SavedFile<T> {
  readonly name: string;
  /** The file relative to the workspace root (the main repository's folder), `/` as separator. */
  readonly file: string;
  readonly repository: RepositoryLocation;
  /** The file relative to its repository, `/` as separator. */
  readonly path: string;
  readonly data: T;
  /** As read, for editing it in place (`editYamlDocument`, ADR-0007). */
  readonly yaml: YamlFile;
}

/** The folder of a kind and what it holds. */
export interface SavedFolder<T> {
  /** The location of the workspace file, or its default. */
  readonly location: WorkspaceLocation;
  /** The repository of the folder; undefined when the workspace file names one it does not list. */
  readonly repository: RepositoryLocation | undefined;
  /** The folder relative to its repository, `/` as separator, `""` for its root. */
  readonly folder: string;
  /** Whether the folder exists; false also while its repository is not on this machine. */
  readonly exists: boolean;
  /** The valid files, one per name, in file order. */
  readonly saved: readonly SavedFile<T>[];
  /** Faulty and duplicate files, in file order. */
  readonly problems: readonly Problem[];
  /** The names (folded) of faulty files that could still be read, with their files (relative to the repository). */
  readonly faultyNames: ReadonlyMap<string, readonly string[]>;
  /** Every entry name of the folder, folded, for choosing a new file name. */
  readonly entries: ReadonlySet<string>;
  /** The repository of the folder is not on this machine: its files may exist (SR-006 AK2). */
  readonly incomplete: boolean;
}

/** `label` with a capital first letter, to start a message. */
const capital = (label: string): string => `${label.charAt(0).toUpperCase()}${label.slice(1)}`;

const savedProblem = (
  code: Problem["code"],
  severity: Problem["severity"],
  repository: string,
  file: string,
  message: string,
  line?: number,
): Problem => ({
  code,
  severity,
  message,
  repository,
  file,
  ...(line === undefined ? {} : { line }),
});

type Checked<T> =
  | {
      readonly kind: "valid";
      readonly yaml: YamlFile;
      readonly data: T;
      readonly problems: readonly Problem[];
    }
  | { readonly kind: "faulty"; readonly name: string | undefined; readonly problems: readonly Problem[] };

/** Reads one file and checks it against the schema of `kind`. */
const checkFile = async <T>(
  kind: SavedKind,
  repository: RepositoryLocation,
  file: string,
): Promise<Checked<T>> => {
  const read = await readYamlFile(repository.folder, file);
  if (read.kind === "problem") {
    return { kind: "faulty", name: undefined, problems: [{ ...read.problem, repository: repository.name }] };
  }
  const yaml = read.file;
  const problems: Problem[] = yaml.warnings.map((w) => ({ ...w, repository: repository.name }));
  const validate = fileSchemaValidator(kind.schema);
  if (validate(yaml.data)) {
    return { kind: "valid", yaml, data: yaml.data as T, problems };
  }
  // Readable as input errors are (ThomasBirkmaier/ReqSeq-archive#309): one message for the branches of a condition.
  const violations = inputViolations(fileSchemaErrors(kind.schema, yaml.data), {
    input: yaml.data,
    schemas: contractsBundle.schemas,
  });
  for (const violation of violations) {
    problems.push(
      savedProblem(
        kind.invalid,
        "error",
        repository.name,
        file,
        `Invalid ${kind.label} ${file}: ${fileMessage(violation)}`,
        yamlPointerLine(yaml, violation.path),
      ),
    );
  }
  const name = (yaml.data as { readonly name?: unknown } | null)?.name;
  return { kind: "faulty", name: typeof name === "string" ? name : undefined, problems };
};

/** Reads the folder of `kind` (see the file comment). */
export const readSavedFolder = async <T extends { readonly name: string }>(
  layout: WorkspaceLayout,
  kind: SavedKind,
): Promise<SavedFolder<T>> => {
  const location = settingLocation(layout, kind.setting);
  const located = locate(layout, location);
  const { repository } = located;
  const none = {
    location,
    saved: [],
    problems: [],
    faultyNames: new Map<string, readonly string[]>(),
    entries: new Set<string>(),
  };
  if (repository === undefined || located.folder === undefined) {
    return { ...none, repository, folder: "", exists: false, incomplete: repository !== undefined };
  }
  const folder = path.relative(repository.folder, located.folder).split(path.sep).join("/");
  const at = (name: string): string => path.posix.join(folder, name);
  const shown = folder === "" ? "." : folder;
  const listing = await listFolderFiles(located.folder, repository.folder);
  if (listing.kind !== "names") {
    const problems =
      listing.kind === "missing"
        ? []
        : [
            savedProblem(
              "file.unreadable",
              "error",
              repository.name,
              shown,
              `Cannot read the ${kind.setting} folder ${shown}: ${listing.reason}`,
            ),
          ];
    // An unreadable folder counts as missing: creating it then names what is in the way.
    return { ...none, problems, repository, folder, exists: false, incomplete: false };
  }
  const names = listing.names.filter(
    (name) => !(repository.main && folder === "" && name === WORKSPACE_FILE),
  );
  const problems: Problem[] = [];
  const saved: SavedFile<T>[] = [];
  const firstOf = new Map<string, SavedFile<T>>();
  const faultyNames = new Map<string, string[]>();
  for (const name of names) {
    const file = at(name);
    if (name.endsWith(".yml")) {
      problems.push(
        savedProblem(
          kind.invalid,
          "warning",
          repository.name,
          file,
          `${file} is not read: ${kind.label} files end in ${SAVED_FILE_EXTENSION}`,
        ),
      );
      continue;
    }
    if (!name.endsWith(SAVED_FILE_EXTENSION)) {
      continue;
    }
    const checked = await checkFile<T>(kind, repository, file);
    problems.push(...checked.problems);
    if (checked.kind === "faulty") {
      if (checked.name !== undefined) {
        const faulty = fold(checked.name);
        faultyNames.set(faulty, [...(faultyNames.get(faulty) ?? []), file]);
      }
      continue;
    }
    const { yaml, data } = checked;
    const key = fold(data.name);
    const first = firstOf.get(key);
    if (first !== undefined) {
      problems.push(
        savedProblem(
          kind.duplicate,
          "warning",
          repository.name,
          file,
          `${capital(kind.label)} ${file} has the name ${JSON.stringify(data.name)} of ${first.path}, which is used; rename one`,
          yamlPointerLine(yaml, "/name"),
        ),
      );
      continue;
    }
    const entry: SavedFile<T> = {
      name: data.name,
      file: workspacePath(layout, repository, file),
      repository,
      path: file,
      data,
      yaml,
    };
    firstOf.set(key, entry);
    saved.push(entry);
  }
  return {
    location,
    repository,
    folder,
    exists: true,
    saved,
    problems,
    faultyNames,
    entries: new Set(listing.entries.map(fold)),
    incomplete: false,
  };
};

export type FoundSaved<T> =
  | { readonly kind: "found"; readonly saved: SavedFile<T> }
  | { readonly kind: "faulty"; readonly files: readonly string[] }
  | { readonly kind: "none" };

/** The file of `name` (ignoring case and normal form): the valid one, else the faulty files that hold it. */
export const findSaved = <T>(folder: SavedFolder<T>, name: string): FoundSaved<T> => {
  const key = fold(name);
  const saved = folder.saved.find((f) => fold(f.name) === key);
  if (saved !== undefined) {
    return { kind: "found", saved };
  }
  const files = folder.faultyNames.get(key);
  return files === undefined ? { kind: "none" } : { kind: "faulty", files };
};

/** `file.faulty` for a name only faulty files of `kind` hold. */
export const faultySaved = (
  kind: SavedKind,
  name: string,
  files: readonly string[],
  action: string,
): CommandError =>
  new CommandError(
    "file.faulty",
    `The ${kind.label} ${JSON.stringify(name)} is in a faulty file (${files.join(", ")}); fix it by hand before it can be ${action}`,
    { files: [...files] },
  );

/**
 * Runs `fn` and gives every `CommandError` it throws the kind, name and file of `saved` in its
 * message, so a problem of a hand-written file says where it is. The code stays.
 */
export const inSavedFile = <T>(kind: SavedKind, saved: SavedFile<unknown>, fn: () => T): T => {
  try {
    return fn();
  } catch (error) {
    throw error instanceof CommandError
      ? new CommandError(
          error.code,
          `${capital(kind.label)} ${JSON.stringify(saved.name)} (${saved.file}): ${error.message}`,
          error.details,
        )
      : error;
  }
};

/** `inSavedFile` for an asynchronous `fn`. */
export const inSavedFileAsync = async <T>(
  kind: SavedKind,
  saved: SavedFile<unknown>,
  fn: () => Promise<T>,
): Promise<T> => {
  try {
    return await fn();
  } catch (error) {
    return inSavedFile(kind, saved, () => {
      throw error;
    });
  }
};

/** Longest name part of a new file, in characters. */
const SLUG_LENGTH = 64;
/** Names Windows gives to devices, in any case and with any extension. */
const WINDOWS_DEVICES = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/** The file name part of `name` for a file of `kind` (see the file comment). */
export const savedSlug = (kind: Pick<SavedKind, "word">, name: string): string => {
  const letters = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  // By code points, so no character is cut in half.
  const cut = Array.from(letters).slice(0, SLUG_LENGTH).join("").replace(/-+$/, "");
  const slug = cut === "" ? kind.word : cut;
  return WINDOWS_DEVICES.test(slug) ? `${slug}-${kind.word}` : slug;
};

/** The file name of a new file of `kind` named `name` in a folder with `entries` (folded names). */
export const newSavedFile = (
  kind: Pick<SavedKind, "word">,
  name: string,
  entries: ReadonlySet<string>,
): string => {
  const slug = savedSlug(kind, name);
  for (let n = 1; ; n++) {
    const file = `${n === 1 ? slug : `${slug}-${String(n)}`}${SAVED_FILE_EXTENSION}`;
    if (!entries.has(fold(file))) {
      return file;
    }
  }
};

/** A sort as compared: `order` absent is `asc`. */
const sortOf = (sort: readonly FilterSortKey[] | undefined): unknown =>
  sort?.map((key) => ({ ...key, order: key.order ?? "asc" }));

/**
 * The edits that turn `current` into `data` for the top-level `keys`, one per key whose value changed
 * (a `sort` compared with `order` absent as `asc`); a key `data` does not have is removed.
 */
export const keyEdits = <T extends { readonly sort?: readonly FilterSortKey[] }>(
  keys: readonly (keyof T & string)[],
  current: T,
  data: T,
): readonly YamlKeyEdit[] =>
  keys.flatMap((key): YamlKeyEdit[] => {
    const same =
      key === "sort"
        ? isDeepStrictEqual(sortOf(current.sort), sortOf(data.sort))
        : isDeepStrictEqual(current[key], data[key]);
    if (same) {
      return [];
    }
    return data[key] === undefined ? [{ key }] : [{ key, value: data[key] }];
  });

/**
 * Saves `data` under `name` in the folder of `kind` (see the file comment): a name only faulty files
 * hold is `file.faulty`; an existing name gets `editsOf(its data)` in its own file (none: nothing is
 * written, `files` is empty); a new name a new file, the folder created when missing. Gives the
 * written files relative to the workspace root.
 */
export const writeSaved = async <T extends { readonly name: string }>(
  layout: WorkspaceLayout,
  kind: SavedKind,
  data: T,
  editsOf: (current: T) => readonly YamlKeyEdit[],
): Promise<readonly string[]> => {
  const folder = await readSavedFolder<T>(layout, kind);
  const { repository } = folder;
  if (repository?.available !== true) {
    throw new CommandError(
      "file.folder-missing",
      `Not written: the ${kind.setting} folder is in repository ${folder.location.repository}, which is not available on this machine`,
      { repository: folder.location.repository },
    );
  }
  const found = findSaved(folder, data.name);
  if (found.kind === "faulty") {
    throw faultySaved(kind, data.name, found.files, "saved again");
  }
  if (found.kind === "found") {
    const { saved } = found;
    const edits = editsOf(saved.data);
    if (edits.length === 0) {
      return [];
    }
    await refuseGitPlace(repository, saved.path);
    const edited = editYamlDocument(saved.yaml, edits);
    await writeFileAtomic(repository.folder, saved.path, edited.bytes, saved.yaml.snapshot, {
      kind: "yaml",
    });
    return [saved.file];
  }
  const file = path.posix.join(folder.folder, newSavedFile(kind, data.name, folder.entries));
  await refuseGitPlace(repository, file);
  if (!folder.exists && folder.folder !== "") {
    await createFolder(repository.folder, folder.folder);
    // Again with the folder there, so a link or `.git` entry put there meanwhile is not written into.
    await refuseGitPlace(repository, file);
  }
  await writeFileAtomic(repository.folder, file, renderYamlDocument(data), null, { kind: "yaml" });
  return [workspacePath(layout, repository, file)];
};
