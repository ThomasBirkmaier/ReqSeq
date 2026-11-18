// The properties `reqif.export` leaves out (SR-059 AK1, AK3; ADR-0013 "Export").
//
// - Left out: the union of the mapping's `omit-properties` and the input `omitProperties`, each a
//   property of the own metamodel (`checkOmitted`, `input.invalid` at `omitProperties[i]`).
// - With `mapping`, the input keys the mapping lacks are added to its `omit-properties` after the
//   ones it has and saved, so later deliveries to that target leave them out too (AK3). Only that key
//   is rewritten (`editYamlDocument`, ADR-0007); the file must lie directly in the mapping folder
//   (`mappingTarget`, `input.invalid` at `mapping`) and be unchanged since it was read
//   (`checkOmissions`, `file.changed-on-disk`), both checked before the export writes anything; it is
//   saved after the output. Nothing new to add writes nothing.
import type { YamlFile } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { MappingTarget } from "./mapping.js";
import { checkOmitted, mappingTarget, readMappingFile } from "./mapping.js";
import { checkUnchanged, saveMappingKey } from "./mapping-key.js";

/** The mapping file to save with the added keys. */
interface OmitSave {
  readonly target: MappingTarget;
  readonly yaml: YamlFile;
  /** The new `omit-properties`. */
  readonly value: readonly string[];
}

/** The properties an export leaves out, and the mapping to save when the input added some. */
export interface Omissions {
  readonly keys: ReadonlySet<string>;
  readonly save?: OmitSave;
}

/** The omissions of an export with the mapping file `mapping` and the input `given`, each if any (see the file comment). */
export const exportOmissions = async (
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  root: string,
  mapping: string | undefined,
  input: readonly string[] | undefined,
  command: string,
): Promise<Omissions> => {
  const given = input ?? [];
  checkOmitted(metamodel, given, "omitProperties", command);
  if (mapping === undefined) {
    return { keys: new Set(given) };
  }
  const read = await readMappingFile(layout, metamodel, root, mapping, command);
  const saved = read.mapping["omit-properties"] ?? [];
  const keys = new Set([...saved, ...given]);
  const added = [...new Set(given)].filter((key) => !saved.includes(key));
  if (added.length === 0) {
    return { keys };
  }
  const target = await mappingTarget(layout, root, read.mapping.source.name, mapping, command, "mapping");
  return { keys, save: { target, yaml: read.yaml, value: [...saved, ...added] } };
};

/**
 * Refuses with `file.changed-on-disk` when the mapping of `omissions` to save changed since it was
 * read, so the export writes nothing it cannot finish (see the file comment).
 */
export const checkOmissions = async (omissions: Omissions, command: string): Promise<void> => {
  const { save } = omissions;
  if (save !== undefined) {
    await checkUnchanged(save.target, save.yaml, "export", command);
  }
};

/** Saves the mapping of `omissions` when it has keys to add; gives the file saved, relative to the workspace root. */
export const saveOmissions = async (layout: WorkspaceLayout, omissions: Omissions): Promise<string[]> => {
  const { save } = omissions;
  return save === undefined
    ? []
    : [await saveMappingKey(layout, save.target, save.yaml, "omit-properties", save.value)];
};
