// reqif.saveMapping (SR-054 AK1): saves the mapping of the types and attributes of one source to the
// own metamodel as a YAML file of `reqif-mapping.schema.json`, one file per source, directly in the
// mapping folder of the workspace file (default `reqif` in the main repository), for every access
// (reqif/mapping.ts `mappingTarget`).
//
// - The mapping is checked against the own metamodel first (`checkMapping`); nothing is written on a
//   violation. The metamodel is only read (SR-054 AK3).
// - A new file is written in the schema's key order (`renderYamlDocument`); the folder is created
//   when missing. The input is the whole mapping: an existing file is changed key by key, so only the
//   top-level keys whose value changed are rewritten and every other byte stays (ADR-0007); a key the
//   input leaves out, and a key the schema does not know, is removed. The file must be unchanged
//   since it was read (`file.changed-on-disk`). Nothing changed: nothing is written and `files` is
//   empty. Defaults of the schema come with the input (`statement.datatype`) and are written too.
// - Names that are equal once portable share the default file: when it holds the mapping of another
//   `source.name`, it is replaced only when `file` names it (`input.invalid`, `reason:
//   "other-source"`).
// - Nothing is ever deleted or renamed, and no status is touched.
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import {
  createFolder,
  editYamlDocument,
  readYamlFile,
  renderYamlDocument,
  writeFileAtomic,
} from "../../files/index.js";
import type { YamlKeyEdit } from "../../files/index.js";
import { metamodelState } from "../../metamodel/index.js";
import { workspacePath } from "../../model/index.js";
import { MAPPING_KEYS, checkMapping, mappingTarget } from "../../reqif/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

const KNOWN_KEYS: ReadonlySet<string> = new Set(MAPPING_KEYS);

/** `source.name` of a file's data, if it has one. */
const sourceNameOf = (data: Readonly<Record<string, unknown>>): unknown => {
  const source = data["source"];
  return typeof source === "object" && source !== null
    ? (source as { readonly name?: unknown }).name
    : undefined;
};

/** Whether `absolute` exists, also as a link or folder, which the read then refuses. */
const exists = async (absolute: string): Promise<boolean> =>
  fs.lstat(absolute).then(
    () => true,
    () => false,
  );

export default defineCommand({
  name: "reqif.saveMapping",
  run: async (ctx, input): Promise<CommandOutput<"reqif.saveMapping">> => {
    const command = "reqif.saveMapping";
    const { workspace } = ctx;
    const layout = await workspace.get(workspaceLayoutState);
    const metamodel = await workspace.get(metamodelState);
    const { mapping } = input;
    checkMapping(layout, metamodel, mapping, "mapping", command);
    const target = await mappingTarget(layout, workspace.root, mapping.source.name, input.file, command);
    const { repository, file } = target;
    const shown = workspacePath(layout, repository, file);
    const data: Readonly<Record<string, unknown>> = { ...mapping };
    if (!(await exists(path.join(repository.folder, file)))) {
      const folder = path.posix.dirname(file);
      if (folder !== ".") {
        await createFolder(repository.folder, folder);
      }
      const ordered = Object.fromEntries(
        MAPPING_KEYS.flatMap((key) => (data[key] === undefined ? [] : [[key, data[key]]])),
      );
      await writeFileAtomic(repository.folder, file, renderYamlDocument(ordered), null, { kind: "yaml" });
      return { files: [shown], problems: [] };
    }
    const read = await readYamlFile(repository.folder, file);
    if (read.kind === "problem") {
      throw new CommandError(
        "file.faulty",
        `Not written: ${shown} cannot be replaced: ${read.problem.message}`,
        {
          command,
          file: shown,
        },
      );
    }
    const current = (read.file.data ?? {}) as Readonly<Record<string, unknown>>;
    const held = sourceNameOf(current);
    if (input.file === undefined && typeof held === "string" && held !== mapping.source.name) {
      throw new CommandError(
        "input.invalid",
        `Not written: ${shown} holds the mapping of source ${held}; name another file in file to keep both, or this file to replace it`,
        { command, fields: ["mapping.source.name"], reason: "other-source", file: shown, source: held },
      );
    }
    const edits = [
      ...MAPPING_KEYS.flatMap((key): YamlKeyEdit[] => {
        if (isDeepStrictEqual(current[key], data[key])) {
          return [];
        }
        return data[key] === undefined ? [{ key }] : [{ key, value: data[key] }];
      }),
      // A key the schema does not know is removed, so the file stays a mapping file.
      ...Object.keys(current)
        .filter((key) => !KNOWN_KEYS.has(key))
        .map((key): YamlKeyEdit => ({ key })),
    ];
    if (edits.length === 0) {
      return { files: [], problems: [] };
    }
    const edited = editYamlDocument(read.file, edits);
    await writeFileAtomic(repository.folder, file, edited.bytes, read.file.snapshot, { kind: "yaml" });
    return { files: [shown], problems: [] };
  },
});
