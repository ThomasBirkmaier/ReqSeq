// The write layer of the metamodel commands (SR-236, D-081): every command that changes the
// metamodel goes through `changeMetamodel`, so all of them read, check and write the same way.
//
// 1. A metamodel repository this process cannot write (SR-018 AK2, `isWritableFolder`) is refused
//    with `file.read-only` before anything is read (SR-236 AK5).
// 2. The metamodel files are read again from disk, with their snapshots, not taken from
//    `metamodelState`: a command plans on the files as they are now. When they do not give a valid
//    metamodel, the command is refused as `invoke` refuses it for a read-only workspace (SR-011 AK3).
// 3. The command plans its change on that metamodel and those files: the new bytes per file, made
//    line by line (`yaml-list.ts`, SR-236 AK3), or a refusal.
// 4. The planned state is loaded with the same loader (`loadMetamodel` with a reader that gives the
//    planned bytes), so it is checked exactly as a later read would check it. Any error refuses the
//    command with `input.invalid`, reason `metamodel-invalid`, and the errors (SR-236 AK1).
// 5. Every changed file is first checked to be replaceable, then written with its snapshot
//    (`writeFileAtomic`, kind `yaml`): a file another process changed since step 2 is not written
//    (`file.changed-on-disk`, SR-236 AK10). When a later file cannot be written, the files written
//    before it get their old bytes back (SR-236 AK4). Nothing else is written, nothing in Git (D-036).
// 6. The metamodel state is reset, so the next command of this process reads the new metamodel
//    (SR-236 AK9); other processes see the change through their watcher (SR-015 AK1).
import path from "node:path";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { EditableYaml, FileSnapshot, YamlEditResult, YamlFile } from "../files/index.js";
import { checkReplaceable, parseYamlFileBytes, readYamlFile, writeFileAtomic } from "../files/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation } from "../workspace/index.js";
import { isWritableFolder, refuseGitPlace, workspaceLayoutState } from "../workspace/index.js";
import type { Metamodel, MetamodelReader } from "./load.js";
import { loadMetamodel } from "./load.js";
import { metamodelState } from "./state.js";
import { commandTitle } from "../runtime/command-titles.js";

/** What a command plans its change on. */
export interface MetamodelSource {
  /** The metamodel of the files below; valid. */
  readonly metamodel: Metamodel;
  /** Each file of `metamodel.files`, as read (its `path` is relative to the metamodel repository). */
  readonly files: readonly [YamlFile, ...YamlFile[]];
}

/**
 * What a command plans: the new bytes of each file it changes, by its path relative to the metamodel
 * repository, and what it gives back (the definition it adds, for its output).
 */
export interface MetamodelPlan<T> {
  readonly bytes: ReadonlyMap<string, Uint8Array>;
  readonly result: T;
  /**
   * Called with the metamodel the planned bytes give, once it has no error and before anything is
   * written; it refuses by throwing (a use that a change of inheritance would lose, SR-237 AK4).
   */
  readonly check?: (after: Metamodel) => void;
}

/** The lists of definitions of a metamodel file. */
export type DefinitionList = "types" | "properties" | "relations" | "statuses";

/** Where a definition is written: its file and its position in the file's list. */
export interface DefinitionPlace {
  readonly file: YamlFile;
  readonly index: number;
}

/** Every definition of `list` among `files`, with its key, in file order, then in list order. */
export const definitionsOf = (
  files: readonly YamlFile[],
  list: DefinitionList,
): readonly (DefinitionPlace & { readonly key: unknown })[] =>
  files.flatMap((file) => {
    const items = (file.data as Partial<Record<DefinitionList, unknown>>)[list];
    // A valid metamodel file holds a mapping per definition.
    return (Array.isArray(items) ? (items as readonly { readonly key?: unknown }[]) : []).map(
      (item, index) => ({
        key: item.key,
        file,
        index,
      }),
    );
  });

/**
 * The file and position of the definition `key` of `list` among `files` (SR-236 AK4: a changed or
 * removed definition is changed in the file it is in); undefined when no file defines it.
 */
export const definitionAt = (
  files: readonly YamlFile[],
  list: DefinitionList,
  key: string,
): DefinitionPlace | undefined => {
  const found = definitionsOf(files, list).find((place) => place.key === key);
  return found === undefined ? undefined : { file: found.file, index: found.index };
};

/**
 * The file a new definition of `list` goes into (SR-236 AK4): the first of `files` (in name order)
 * that has the list, else the first file, at whose end the list is created.
 */
export const fileForNew = (files: readonly [YamlFile, ...YamlFile[]], list: DefinitionList): YamlFile =>
  files.find((file) => (file.data as Partial<Record<DefinitionList, unknown>>)[list] !== undefined) ??
  files[0];

/** One line edit of a file's text (`setMapValue`, `removeListItem` or `appendListItem` with its arguments). */
export type LineEdit = (yaml: EditableYaml) => YamlEditResult;

/**
 * The bytes of each file after its edits, applied in the given order, each to the text the one
 * before gave; by the file's path relative to the metamodel repository, for `MetamodelPlan.bytes`.
 */
export const editedFiles = (
  edits: readonly { readonly file: YamlFile; readonly edit: LineEdit }[],
): ReadonlyMap<string, Uint8Array> => {
  const current = new Map<string, EditableYaml>();
  const bytes = new Map<string, Uint8Array>();
  for (const { file, edit } of edits) {
    const result = edit(current.get(file.path) ?? file);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(result.bytes);
    current.set(file.path, { text: file.bom ? text.slice(1) : text, bom: file.bom });
    bytes.set(file.path, result.bytes);
  }
  return bytes;
};

export interface MetamodelChange<T> {
  /** What the plan gave back. */
  readonly result: T;
  readonly before: Metamodel;
  readonly after: Metamodel;
  /** The files written, relative to the workspace root with `/`, in the order of `before.files`. */
  readonly files: readonly string[];
  /** The warnings of the metamodel afterwards (SR-236 AK1). */
  readonly warnings: readonly Problem[];
}

const BOM = String.fromCharCode(0xfeff);

const textBytes = (yaml: YamlFile): Uint8Array =>
  new TextEncoder().encode(`${yaml.bom ? BOM : ""}${yaml.text}`);

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);

/** A planned write: the file as read and its new bytes. */
interface Write {
  readonly yaml: YamlFile;
  readonly bytes: Uint8Array;
  /** Relative to the workspace root, for the output and errors. */
  readonly shown: string;
}

/**
 * Writes each planned file (step 5 of the file comment): every file is checked first, then written
 * one after the other. When a write fails, the files written before it get their bytes as read
 * back, newest first, each only while it still holds what this call wrote (its snapshot), and the
 * error is thrown again with its code; `details.written` lists the files not restored, relative to
 * the workspace root, and is absent when every file was restored.
 */
const writeAll = async (repository: RepositoryLocation, writes: readonly Write[]): Promise<void> => {
  for (const { yaml } of writes) {
    await refuseGitPlace(repository, yaml.path);
    await checkReplaceable(repository.folder, yaml.path, yaml.snapshot, { kind: "yaml" });
  }
  const done: { readonly write: Write; readonly written: FileSnapshot }[] = [];
  for (const write of writes) {
    try {
      // Checked again right before the write, so a `.git` entry put there meanwhile is not written into.
      await refuseGitPlace(repository, write.yaml.path);
      const written = await writeFileAtomic(
        repository.folder,
        write.yaml.path,
        write.bytes,
        write.yaml.snapshot,
        {
          kind: "yaml",
        },
      );
      done.push({ write, written });
    } catch (error) {
      const kept: string[] = [];
      for (const { write: earlier, written } of done.reverse()) {
        const restored = await writeFileAtomic(
          repository.folder,
          earlier.yaml.path,
          textBytes(earlier.yaml),
          written,
          { kind: "yaml" },
        ).then(
          () => true,
          () => false,
        );
        if (!restored) {
          kept.unshift(earlier.shown);
        }
      }
      if (kept.length === 0) {
        throw error;
      }
      const failure =
        error instanceof CommandError
          ? error
          : new CommandError("internal", `Not written: ${write.shown} (${String(error)})`);
      throw new CommandError(
        failure.code,
        failure.message,
        { ...failure.details, written: kept },
        { cause: error },
      );
    }
  }
};

/**
 * The plan of `source`, checked: every file it changes is one of the files read, and a `file.faulty`
 * it throws about a metamodel file names the metamodel repository, as the metamodel problems do
 * (`file` is relative to it). One about element files (`details.files`, SR-236 AK7) names theirs.
 */
const checkedPlan = <T>(
  plan: (source: MetamodelSource) => MetamodelPlan<T>,
  source: MetamodelSource,
  repository: string,
): MetamodelPlan<T> => {
  let planned: MetamodelPlan<T>;
  try {
    planned = plan(source);
  } catch (error) {
    if (
      error instanceof CommandError &&
      error.code === "file.faulty" &&
      error.details?.["files"] === undefined
    ) {
      throw new CommandError(error.code, error.message, { ...error.details, repository }, { cause: error });
    }
    throw error;
  }
  const known = new Set(source.files.map((f) => f.path));
  const unknown = [...planned.bytes.keys()].filter((file) => !known.has(file));
  if (unknown.length > 0) {
    throw new CommandError(
      "internal",
      `Not written: ${unknown.join(", ")} is no metamodel file that was read`,
    );
  }
  return planned;
};

/**
 * Changes the metamodel as `plan` says, for `command` (named in messages), through the steps of the
 * file comment, and returns the metamodel before and after, the files written and the warnings.
 */
export const changeMetamodel = async <T>(
  workspace: Workspace,
  command: string,
  plan: (source: MetamodelSource) => MetamodelPlan<T>,
): Promise<MetamodelChange<T>> => {
  const layout = await workspace.get(workspaceLayoutState);
  const { repository: name } = layout.metamodel;
  // A repository that is not on this machine has no metamodel to change: refused below.
  const repository = layout.repositories.find((r) => r.name === name && r.available);
  if (repository !== undefined && (await isWritableFolder(repository.folder)) === false) {
    throw new CommandError(
      "file.read-only",
      `The metamodel repository ${name} is read-only; ${commandTitle(command)} changes no file`,
      { repository: name },
    );
  }
  const read = new Map<string, YamlFile>();
  const recording: MetamodelReader = async (root, file) => {
    const result = await readYamlFile(root, file);
    if (result.kind === "parsed") {
      read.set(file, result.file);
    }
    return result;
  };
  if (repository === undefined) {
    throw new CommandError(
      "workspace.read-only",
      `The metamodel repository ${name} is not on this machine; ${command} changes no file`,
      { command, repository: name, problems: [] },
    );
  }
  const before = await loadMetamodel(layout, recording);
  // In the order the loader read them, which is that of `before.files`; a valid metamodel read them all.
  const [first, ...others] = [...read.values()];
  if (!before.valid || first === undefined) {
    throw new CommandError(
      "workspace.read-only",
      `The metamodel is missing or faulty; ${command} changes no file. Fix the metamodel files first.`,
      { command, problems: before.problems.filter((p) => p.severity === "error") },
    );
  }
  const files: readonly [YamlFile, ...YamlFile[]] = [first, ...others];
  const { bytes: planned, result, check } = checkedPlan(plan, { metamodel: before, files }, name);
  const planning: MetamodelReader = async (root, file) => {
    const bytes = planned.get(file);
    if (bytes === undefined) {
      const kept = read.get(file);
      return kept === undefined ? readYamlFile(root, file) : { kind: "parsed", file: kept };
    }
    const parsed = parseYamlFileBytes(file, bytes);
    return parsed.kind === "parsed" ? { kind: "parsed", file: parsed.content } : parsed;
  };
  const after = await loadMetamodel(layout, planning);
  const errors = after.problems.filter((p) => p.severity === "error");
  if (errors.length > 0) {
    throw new CommandError(
      "input.invalid",
      `Not written: the metamodel would have ${errors.length === 1 ? "an error" : `${String(errors.length)} errors`}: ${errors.map((p) => p.message).join("; ")}`,
      { reason: "metamodel-invalid", problems: errors },
    );
  }
  check?.(after);
  const writes = files.flatMap((yaml): Write[] => {
    const bytes = planned.get(yaml.path);
    const shown = path
      .relative(layout.root, path.join(repository.folder, yaml.path))
      .split(path.sep)
      .join("/");
    return bytes === undefined || sameBytes(bytes, textBytes(yaml)) ? [] : [{ yaml, bytes, shown }];
  });
  await writeAll(repository, writes);
  await workspace.reset(metamodelState);
  return {
    result,
    before,
    after,
    files: writes.map((write) => write.shown),
    warnings: after.problems.filter((p) => p.severity === "warning"),
  };
};
