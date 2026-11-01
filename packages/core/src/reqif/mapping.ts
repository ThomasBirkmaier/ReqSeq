// ReqIF mapping files (SR-054, ADR-0013 "Paths", `reqif-mapping.schema.json`): the mapping of the
// types and attributes of one source to the own metamodel, one YAML file per source.
//
// - Where: written only directly in the mapping folder, the `mappings` location of the workspace
//   file, by default the folder `reqif` in the main repository (SR-054 AK1), for every access
//   (`mappingTarget`). The default file is `<portable source name, lower case>.yaml`. A path that
//   lies elsewhere, also through a link, is `input.invalid` (`reason: "outside-mapping-folder"`).
//   ReqSeq follows no link to its files: a mapping folder that is or lies below a link is refused
//   (`reason: "link"`), and so is one in the metamodel folder, so a mapping never becomes a
//   metamodel file (SR-054 AK3).
// - Read from any path the access allows (`readMappingFile`), for `reqif.import` and `reqif.export`
//   with `mapping` (SR-054 AK2): the file must match the schema (`file.faulty` otherwise).
// - Both sides check the mapping against the own metamodel (`checkMapping`), which they only read:
//   known types, properties (of the mapped type when `source-type` names one), choice keys,
//   relation kinds or relation-valued properties as the kind of a relation type, a known target
//   repository. Every violation is listed in one `input.invalid`.
// - Mapping files are not elements (D-056); ReqSeq never deletes or renames one.
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "../catalog.js";
import type { YamlFile } from "../files/index.js";
import { readYamlFile } from "../files/index.js";
import type { ReqifMappingFile, ReqifMappingFileWithDefaults } from "../generated/types.js";
import type { EffectiveType, Metamodel } from "../metamodel/index.js";
import { findType, keyDefinition } from "../metamodel/index.js";
import { portableName, refuseUnlisted } from "../model/index.js";
import { contractsBundle, fileSchemaValidator } from "../runtime/contracts.js";
import { inputViolations } from "../runtime/input-errors.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { locate, settingLocation } from "../workspace/index.js";

/** A mapping as read from a file, or as a command input with the schema defaults filled in. */
export type AnyMapping = ReqifMappingFile | ReqifMappingFileWithDefaults;

/** Mapping files end in `.yaml` (D-056). */
export const MAPPING_FILE_EXTENSION = ".yaml";

/** The keys of a mapping file, in the order a new file has them (the schema's order). */
export const MAPPING_KEYS = [
  "reqseq-reqif-mapping",
  "source",
  "target",
  "types",
  "attributes",
  "relations",
  "statement",
  "omit-properties",
  "export-profiles",
] as const;

/** Where a mapping file is written. */
export interface MappingTarget {
  readonly repository: RepositoryLocation;
  /** The file relative to its repository, `/` as separator. */
  readonly file: string;
}

/** The default file name of the mapping of `source` (see the file comment). */
export const mappingFileName = (source: string): string =>
  `${portableName(source, "source").toLowerCase()}${MAPPING_FILE_EXTENSION}`;

/**
 * The real path of `absolute`, also when its last parts do not exist yet: the real path of its
 * nearest existing ancestor joined with the rest (the file system root always exists).
 */
const realOf = async (absolute: string): Promise<string> =>
  fs
    .realpath(absolute)
    .catch(async () => path.join(await realOf(path.dirname(absolute)), path.basename(absolute)));

/**
 * Whether `a` and `b` name the same path by the rules of `platform` (default this machine's):
 * on Windows the case of the drive letter and of the names does not count.
 */
export const samePath = (a: string, b: string, platform: NodeJS.Platform = process.platform): boolean =>
  (platform === "win32" ? path.win32 : path.posix).relative(a, b) === "";

const inside = (parent: string, child: string): boolean => {
  const rel = path.relative(parent, child);
  return rel === "" || (!path.isAbsolute(rel) && rel.split(path.sep)[0] !== "..");
};

const invalid = (message: string, details: Record<string, unknown>): CommandError =>
  new CommandError("input.invalid", message, details);

/**
 * The file a mapping of `source` is written to: `given` (a local path, resolved against `root`, the
 * input `field`) or the default name, directly in the mapping folder (see the file comment).
 */
export const mappingTarget = async (
  layout: WorkspaceLayout,
  root: string,
  source: string,
  given: string | undefined,
  command: string,
  field = "file",
): Promise<MappingTarget> => {
  const location = settingLocation(layout, "mappings");
  const { repository, folder } = locate(layout, location);
  if (repository === undefined || folder === undefined) {
    throw new CommandError(
      "file.folder-missing",
      `Not written: the mapping folder is in repository ${location.repository}, which is not available on this machine`,
      { command, repository: location.repository },
    );
  }
  // The repository folder is a real path, so a link in the folder's own path shows as a difference.
  if (!samePath(await realOf(folder), folder)) {
    throw invalid(
      `Not written: the mapping folder ${location.path} of repository ${repository.name} is or lies below a link, which ReqSeq does not follow`,
      { command, reason: "link", repository: repository.name },
    );
  }
  const metamodel = layout.metamodel.folder;
  if (metamodel !== undefined && inside(await realOf(metamodel), folder)) {
    throw invalid(
      `Not written: the mapping folder ${location.path} lies in the metamodel folder; set mappings in the workspace file to another folder`,
      { command, reason: "metamodel-folder", repository: repository.name },
    );
  }
  let name = mappingFileName(source);
  if (given !== undefined) {
    const absolute = path.resolve(root, given);
    name = path.basename(absolute);
    if (!samePath(await realOf(path.dirname(absolute)), folder) || !name.endsWith(MAPPING_FILE_EXTENSION)) {
      throw invalid(
        `${field}: a mapping file is written only as a ${MAPPING_FILE_EXTENSION} file directly in the mapping folder ${location.path} of repository ${repository.name}`,
        { command, fields: [field], reason: "outside-mapping-folder", repository: repository.name },
      );
    }
  }
  const relative = path.relative(repository.folder, folder).split(path.sep).join("/");
  const file = relative === "" ? name : `${relative}/${name}`;
  return { repository, file: await refuseUnlisted(layout, repository, file, { ignored: false }) };
};

/** A violation of the metamodel at `field`. */
interface Violation {
  readonly field: string;
  readonly message: string;
}

/** The violations of a property key `key` at `field`; `type` restricts it to the properties of that type. */
const propertyViolations = (
  metamodel: Metamodel,
  key: string,
  field: string,
  type?: EffectiveType,
): Violation[] => {
  const definition = keyDefinition(metamodel, key);
  if (definition?.kind !== "property") {
    return [{ field, message: `${key} is no property of the metamodel` }];
  }
  if (type !== undefined && !type.properties.includes(key)) {
    return [{ field, message: `${key} is no property of type ${type.key}` }];
  }
  return [];
};

/** The violations of one attribute entry. */
const attributeViolations = (
  metamodel: Metamodel,
  mapping: AnyMapping,
  entry: NonNullable<AnyMapping["attributes"]>[number],
  field: string,
): Violation[] => {
  const { property, values } = entry;
  if (property === undefined) {
    return [];
  }
  const builtIn = property === "title" || property === "text";
  const mapped = mapping.types?.find((t) => t.source === entry["source-type"])?.type;
  const type = mapped === undefined ? undefined : findType(metamodel, mapped);
  const found = builtIn ? [] : propertyViolations(metamodel, property, `${field}.property`, type);
  if (values === undefined || found.length > 0) {
    return found;
  }
  const definition = builtIn ? undefined : keyDefinition(metamodel, property);
  if (definition?.kind !== "property" || definition.definition.kind !== "choice") {
    return [
      { field: `${field}.values`, message: `values map only to a choice property, not to ${property}` },
    ];
  }
  const choices = new Set((definition.definition.choices ?? []).map((c) => c.key));
  return Object.entries(values)
    .filter(([, choice]) => !choices.has(choice))
    .map(([value, choice]) => ({
      field: `${field}.values.${value}`,
      message: `${choice} is no choice of ${property}`,
    }));
};

/** Every violation of the own metamodel and workspace in `mapping` (see the file comment). */
const mappingViolations = (
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  mapping: AnyMapping,
  at: string,
): Violation[] => {
  const omitted = (keys: readonly string[] | undefined, field: string): Violation[] =>
    (keys ?? []).flatMap((key, i) => propertyViolations(metamodel, key, `${field}[${String(i)}]`));
  const target = mapping.target?.repository;
  return [
    ...(target === undefined || layout.repositories.some((r) => r.name === target)
      ? []
      : [{ field: `${at}.target.repository`, message: `the workspace has no repository ${target}` }]),
    ...(mapping.types ?? []).flatMap(({ type }, i) =>
      type === undefined || findType(metamodel, type) !== undefined
        ? []
        : [{ field: `${at}.types[${String(i)}].type`, message: `${type} is no type of the metamodel` }],
    ),
    ...(mapping.attributes ?? []).flatMap((entry, i) =>
      attributeViolations(metamodel, mapping, entry, `${at}.attributes[${String(i)}]`),
    ),
    ...(mapping.relations ?? []).flatMap(({ kind }, i) =>
      kind === undefined || relationTarget(metamodel, kind)
        ? []
        : [
            {
              field: `${at}.relations[${String(i)}].kind`,
              message: `${kind} is no relation kind or relation-valued property of the metamodel`,
            },
          ],
    ),
    ...(mapping.statement === undefined
      ? []
      : propertyViolations(metamodel, mapping.statement.property, `${at}.statement.property`)),
    ...omitted(mapping["omit-properties"], `${at}.omit-properties`),
    ...(mapping["export-profiles"] ?? []).flatMap((profile, i) =>
      omitted(profile["omit-properties"], `${at}.export-profiles[${String(i)}].omit-properties`),
    ),
  ];
};

/**
 * Checks the properties `keys` an export leaves out (SR-059 AK1), the input `field`: each must be a
 * property of the own metamodel, else one `input.invalid` lists every violation.
 */
export const checkOmitted = (
  metamodel: Metamodel,
  keys: readonly string[],
  field: string,
  command: string,
): void => {
  const violations = keys.flatMap((key, i) => propertyViolations(metamodel, key, `${field}[${String(i)}]`));
  if (violations.length > 0) {
    throw invalid(violations.map((v) => `${v.field}: ${v.message}`).join("; "), {
      command,
      fields: violations.map((v) => v.field),
    });
  }
};

/** Whether a SPEC-RELATION-TYPE can map to `kind`: a relation kind or a relation-valued property. */
const relationTarget = (metamodel: Metamodel, kind: string): boolean => {
  const found = keyDefinition(metamodel, kind);
  return found?.kind === "relation" || (found?.kind === "property" && found.definition.kind === "relation");
};

/**
 * Checks `mapping` against the own metamodel, which it only reads (SR-054 AK3); throws one
 * `input.invalid` that lists every violation, with `details.fields` below `at`.
 */
export const checkMapping = (
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  mapping: AnyMapping,
  at: string,
  command: string,
): void => {
  const violations = mappingViolations(layout, metamodel, mapping, at);
  if (violations.length > 0) {
    throw invalid(violations.map((v) => `${v.field}: ${v.message}`).join("; "), {
      command,
      fields: violations.map((v) => v.field),
    });
  }
};

/** A mapping file as read. */
export interface MappingFile {
  readonly mapping: ReqifMappingFile;
  readonly yaml: YamlFile;
}

/**
 * Reads the mapping file at the local path `given` (resolved against `root`) for `reqif.import`
 * and `reqif.export` (SR-054 AK2): a file that cannot be read or does not match the schema is
 * `file.faulty`, one that does not fit the own metamodel `input.invalid` (`checkMapping`).
 */
export const readMappingFile = async (
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  root: string,
  given: string,
  command: string,
): Promise<MappingFile> => {
  const absolute = path.resolve(root, given);
  const read = await readYamlFile(path.dirname(absolute), path.basename(absolute));
  if (read.kind === "problem") {
    throw new CommandError("file.faulty", `mapping: ${read.problem.message}`, {
      command,
      fields: ["mapping"],
    });
  }
  const validate = fileSchemaValidator("reqif-mapping.schema.json");
  if (!validate(read.file.data)) {
    const violations = inputViolations(validate.errors, {
      input: read.file.data,
      schemas: contractsBundle.schemas,
    });
    throw new CommandError(
      "file.faulty",
      `mapping: ${path.basename(absolute)} is no mapping file: ${violations.map((v) => v.message).join("; ")}`,
      { command, fields: ["mapping"] },
    );
  }
  const mapping = read.file.data as ReqifMappingFile;
  checkMapping(layout, metamodel, mapping, "mapping", command);
  return { mapping, yaml: read.file };
};
