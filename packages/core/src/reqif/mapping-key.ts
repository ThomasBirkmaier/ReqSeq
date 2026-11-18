// One key of a mapping file rewritten by a command that also writes other files (ADR-0013):
// `reqif.export` for `omit-properties` (omit.ts), `reqif.import` for `source-model`
// (source-model.ts). The file must be unchanged since it was read, checked before the command writes
// anything (`checkUnchanged`, `file.changed-on-disk`); only that key is rewritten
// (`editYamlDocument`, ADR-0007), and the write refuses a file changed meanwhile as well.
import path from "node:path";
import { CommandError } from "../catalog.js";
import type { YamlFile } from "../files/index.js";
import { editYamlDocument, readFileSnapshot, writeFileAtomic } from "../files/index.js";
import { workspacePath } from "../model/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { MappingTarget } from "./mapping.js";

/** The folder and name of the mapping file `target`. */
const fileOf = (target: MappingTarget): { readonly folder: string; readonly name: string } => ({
  folder: path.join(target.repository.folder, path.posix.dirname(target.file)),
  name: path.posix.basename(target.file),
});

/**
 * Refuses with `file.changed-on-disk` when the mapping `target` no longer holds what `yaml` read, so
 * the `command` (`export` or `import`, for the message) writes nothing it cannot finish.
 */
export const checkUnchanged = async (
  target: MappingTarget,
  yaml: YamlFile,
  verb: "export" | "import",
  command: string,
): Promise<void> => {
  const { folder, name } = fileOf(target);
  const now = await readFileSnapshot(folder, name);
  if (now.kind !== "read" || now.snapshot.sha256 !== yaml.snapshot.sha256) {
    throw new CommandError(
      "file.changed-on-disk",
      `Not ${verb}ed: the mapping ${target.file} changed since it was read; run the ${verb} again`,
      { command, file: target.file, fields: ["mapping"] },
    );
  }
};

/** Rewrites only `key` of the mapping `target` as read in `yaml`; gives the file, relative to the workspace root. */
export const saveMappingKey = async (
  layout: WorkspaceLayout,
  target: MappingTarget,
  yaml: YamlFile,
  key: string,
  value: unknown,
): Promise<string> => {
  const edited = editYamlDocument(yaml, [{ key, value }]);
  const { folder, name } = fileOf(target);
  await writeFileAtomic(folder, name, edited.bytes, yaml.snapshot, { kind: "yaml" });
  return workspacePath(layout, target.repository, target.file);
};
