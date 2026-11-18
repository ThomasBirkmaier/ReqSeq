// The source model of a mapping file (SR-158, ADR-0013 "Import"; key `source-model` of
// `reqif-mapping.schema.json`): the source's own SPEC-OBJECT-TYPEs, ATTRIBUTE-DEFINITIONs and
// datatypes, so an export can later write a file in the source's model.
//
// - What: every SPEC-OBJECT-TYPE of a delivery that a `types` entry maps to a type, with IDENTIFIER,
//   LONG-NAME and all its attribute definitions (mapped or omitted; one whose datatype the file does
//   not define is left out, as it cannot be written back), and the datatypes these use with every
//   facet as parsed (`model.ts`: MAX-LENGTH, MIN, MAX, ACCURACY, the enumeration values with KEY and
//   OTHER-CONTENT), so a writer can write them back as they were. No LAST-CHANGE, no objects.
// - Merge (`mergedModel`): a stored type matched by the same `types` entry as a delivered one, or
//   with the same IDENTIFIER, is replaced by the delivery's, in place; the others are kept, the new
//   ones appended. Datatypes are those the result's attributes use, in the order of first use, the
//   delivery's definition first; so a datatype no stored attribute uses is removed.
// - Save (`sourceModelSave`, `checkSourceModel`, `saveSourceModel`), the steps of omit.ts: only when
//   the merged model differs from the stored one (none counts as an empty one). The file must lie directly in the mapping folder
//   (`mappingTarget`); one outside it is not written (warning `reqif.source-model-unsaved`), every
//   other refusal of `mappingTarget` refuses the import. The file must be unchanged since it was read
//   (`file.changed-on-disk`); both are checked before the import writes anything, the file is
//   saved after the elements, only the key `source-model` rewritten (`editYamlDocument`, ADR-0007).
// - Read: an attribute naming a datatype the model lacks makes the mapping `file.faulty`
//   (`readMappingFile`).
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { YamlFile } from "../files/index.js";
import { editYamlDocument, readFileSnapshot, writeFileAtomic } from "../files/index.js";
import type { ReqifMappingFile } from "../generated/types.js";
import { workspacePath } from "../model/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { AnyMapping, MappingFile, MappingTarget } from "./mapping.js";
import { mappingTarget } from "./mapping.js";
import type { ReqifDatatype, ReqifFile, ReqifIdentifiable, ReqifSpecType } from "./model.js";

/** The `source-model` of a mapping file. */
export type SourceModel = NonNullable<ReqifMappingFile["source-model"]>;
type SourceType = SourceModel["types"][number];
type SourceDatatype = SourceModel["datatypes"][number];

const named = (item: ReqifIdentifiable): { identifier: string; "long-name"?: string } => ({
  identifier: item.identifier,
  ...(item.longName === undefined ? {} : { "long-name": item.longName }),
});

/** A datatype as stored: every facet as parsed, the values only for an enumeration. */
const storedDatatype = (d: ReqifDatatype): SourceDatatype => ({
  ...named(d),
  kind: d.kind,
  ...(d.maxLength === undefined ? {} : { "max-length": d.maxLength }),
  ...(d.min === undefined ? {} : { min: d.min }),
  ...(d.max === undefined ? {} : { max: d.max }),
  ...(d.accuracy === undefined ? {} : { accuracy: d.accuracy }),
  ...(d.kind === "enumeration"
    ? {
        values: d.values.map((v) => ({
          ...named(v),
          ...(v.key === undefined ? {} : { key: v.key }),
          ...(v.otherContent === undefined ? {} : { "other-content": v.otherContent }),
        })),
      }
    : {}),
});

/** The `types` entry of the mapping that matches `t` by IDENTIFIER or LONG-NAME, as the import matches it; -1 for none. */
const entryOf = (
  mapping: AnyMapping,
  t: { readonly identifier: string; readonly "long-name"?: string },
): number => (mapping.types ?? []).findIndex((e) => e.source === t.identifier || e.source === t["long-name"]);

/** The source model `file` delivers through `mapping` (see the file comment). */
export const deliveredModel = (file: ReqifFile, mapping: AnyMapping): SourceModel => {
  const datatypes = new Map(file.datatypes.map((d) => [d.identifier, storedDatatype(d)]));
  const mapped = (t: ReqifSpecType): boolean =>
    t.category === "spec-object" && mapping.types?.[entryOf(mapping, named(t))]?.type !== undefined;
  const types = file.specTypes.filter(mapped).map((t): SourceType => ({
    ...named(t),
    attributes: t.attributes
      .filter((a) => datatypes.has(a.datatype))
      .map((a) => ({
        ...named(a),
        datatype: a.datatype,
        ...(a.multiValued ? { "multi-valued": true } : {}),
      })),
  }));
  return { datatypes: usedDatatypes(types, datatypes), types };
};

/** The datatypes `types` use, in the order of first use, as `definitions` has them; one it lacks is left out. */
const usedDatatypes = (
  types: readonly SourceType[],
  definitions: ReadonlyMap<string, SourceDatatype>,
): SourceDatatype[] => {
  const out = new Map<string, SourceDatatype>();
  for (const id of types.flatMap((t) => t.attributes.map((a) => a.datatype))) {
    const found = definitions.get(id);
    if (found !== undefined) {
      out.set(id, found);
    }
  }
  return [...out.values()];
};

/** `stored` with the delivered model `delivered` merged in through `mapping` (see the file comment). */
export const mergedModel = (
  stored: SourceModel | undefined,
  delivered: SourceModel,
  mapping: AnyMapping,
): SourceModel => {
  // The delivered types by their `types` entry, and each delivered IDENTIFIER's group.
  const groups = new Map<number, SourceType[]>();
  const byIdentifier = new Map<string, SourceType[]>();
  for (const t of delivered.types) {
    const at = entryOf(mapping, t);
    const group = groups.get(at) ?? [];
    groups.set(at, [...group, t]);
  }
  for (const group of groups.values()) {
    for (const t of group) {
      byIdentifier.set(t.identifier, group);
    }
  }
  const emitted = new Set<SourceType[]>();
  const types: SourceType[] = [];
  for (const t of stored?.types ?? []) {
    const group = groups.get(entryOf(mapping, t)) ?? byIdentifier.get(t.identifier);
    if (group === undefined) {
      types.push(t);
    } else if (!emitted.has(group)) {
      emitted.add(group);
      types.push(...group);
    }
  }
  for (const group of groups.values()) {
    if (!emitted.has(group)) {
      types.push(...group);
    }
  }
  const definitions = new Map(
    [...(stored?.datatypes ?? []), ...delivered.datatypes].map((d) => [d.identifier, d]),
  );
  return { datatypes: usedDatatypes(types, definitions), types };
};

/** The mapping file to save with its new source model. */
export interface SourceModelSave {
  readonly target: MappingTarget;
  readonly yaml: YamlFile;
  readonly model: SourceModel;
}

/** What `sourceModelSave` gives: the file to save, if any, and the warnings. */
export interface SourceModelPlan {
  readonly save?: SourceModelSave;
  readonly problems: readonly Problem[];
}

/**
 * The save of the source model `file` delivers into the mapping file `read`, named by the local path
 * `given` (see the file comment): nothing when it is unchanged, a warning when the file lies outside
 * the mapping folder.
 */
export const sourceModelSave = async (
  layout: WorkspaceLayout,
  root: string,
  read: MappingFile,
  given: string,
  file: ReqifFile,
  command: string,
): Promise<SourceModelPlan> => {
  const { mapping } = read;
  const stored = mapping["source-model"];
  const model = mergedModel(stored, deliveredModel(file, mapping), mapping);
  if (isDeepStrictEqual(model, stored ?? { datatypes: [], types: [] })) {
    return { problems: [] };
  }
  try {
    const target = await mappingTarget(layout, root, mapping.source.name, given, command, "mapping");
    return { save: { target, yaml: read.yaml, model }, problems: [] };
  } catch (error) {
    if (!(error instanceof CommandError) || error.details?.["reason"] !== "outside-mapping-folder") {
      throw error;
    }
    return {
      problems: [
        {
          code: "reqif.source-model-unsaved",
          severity: "warning",
          message: `The source model was not saved: ${error.message}`,
        },
      ],
    };
  }
};

/** The folder and name of the mapping file to save. */
const fileOf = (target: MappingTarget): { readonly folder: string; readonly name: string } => ({
  folder: path.join(target.repository.folder, path.posix.dirname(target.file)),
  name: path.posix.basename(target.file),
});

/** Refuses with `file.changed-on-disk` when the mapping of `save` changed since it was read (see the file comment). */
export const checkSourceModel = async (save: SourceModelSave | undefined, command: string): Promise<void> => {
  if (save === undefined) {
    return;
  }
  const { folder, name } = fileOf(save.target);
  const now = await readFileSnapshot(folder, name);
  if (now.kind !== "read" || now.snapshot.sha256 !== save.yaml.snapshot.sha256) {
    throw new CommandError(
      "file.changed-on-disk",
      `Not imported: the mapping ${save.target.file} changed since it was read; run the import again`,
      { command, file: save.target.file, fields: ["mapping"] },
    );
  }
};

/** Saves the source model of `save`; gives the file saved, relative to the workspace root. */
export const saveSourceModel = async (layout: WorkspaceLayout, save: SourceModelSave): Promise<string> => {
  const { target, yaml, model } = save;
  const edited = editYamlDocument(yaml, [{ key: "source-model", value: model }]);
  const { folder, name } = fileOf(target);
  await writeFileAtomic(folder, name, edited.bytes, yaml.snapshot, { kind: "yaml" });
  return workspacePath(layout, target.repository, target.file);
};
