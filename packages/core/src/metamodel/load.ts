// Loading the metamodel (SR-011, D-021): every `*.yaml` file directly in the folder that the
// workspace file names, read from the working tree, that is from the checked-out state. Each file
// is checked against metamodel.schema.json; the lists of all files are merged. A faulty file is
// reported with file, line and reason and makes the metamodel invalid, which opens the workspace
// read-only (SR-011 AK3, access.ts). Then the inheritance of the types is resolved (SR-012,
// inheritance.ts) and the built-in meanings are assigned (SR-013, meanings.ts). Checks across the
// lists (enabler #157): a key is either a property or a relation kind (ADR-0004, while merging);
// after all files, every type in `source-types`/`target-types` is defined and exactly one status is
// initial.
import fs from "node:fs/promises";
import path from "node:path";
import { isNode } from "yaml";
import type { Problem } from "../catalog.js";
import type { YamlFile } from "../files/index.js";
import { readYamlFile } from "../files/index.js";
import type { SchemaViolation } from "../runtime/contracts.js";
import { describeViolations, fileSchemaValidator, schemaViolations } from "../runtime/contracts.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { WORKSPACE_FILE } from "../workspace/index.js";
import type {
  MetamodelFile,
  MetamodelKey,
  MetamodelProperty,
  MetamodelRelationKind,
  MetamodelStatus,
  MetamodelType,
} from "../generated/types.js";
import type { EffectiveType, Located } from "./inheritance.js";
import { resolveTypes } from "./inheritance.js";
import type { MeaningAssignment } from "./meanings.js";
import { assignMeanings } from "./meanings.js";

/** Metamodel files end in `.yaml` (metamodel.schema.json). */
export const METAMODEL_FILE_EXTENSION = ".yaml";

/** The metamodel of the checked-out state: the definitions as written, and the types resolved. */
export interface Metamodel {
  /** Repository and folder from the workspace file. */
  readonly repository: string;
  readonly path: string;
  /** The metamodel files found, relative to the repository, `/` as separator, in the order merged. */
  readonly files: readonly string[];
  /** The definitions of all valid files, in file order, then in the order of each file. */
  readonly types: readonly MetamodelType[];
  readonly properties: readonly MetamodelProperty[];
  readonly relations: readonly MetamodelRelationKind[];
  readonly statuses: readonly MetamodelStatus[];
  /** The types with inheritance resolved (SR-012), in the order of `types`; see `findType`. */
  readonly effectiveTypes: readonly EffectiveType[];
  /**
   * For every built-in meaning, the keys whose own definition declares it (SR-013); see
   * `requireMeaning` and the lookups in meanings.ts.
   */
  readonly meanings: MeaningAssignment;
  /**
   * The folder exists and no file has an error (faulty YAML, schema violation, key defined twice,
   * key used by a property and a relation kind), every type has known parents without a cycle and
   * names only known properties, no type or property meaning is declared by two keys, every type in
   * `source-types`/`target-types` is defined, and exactly one status is initial.
   * When false the workspace is read-only (SR-011 AK3).
   */
  readonly valid: boolean;
  /**
   * Findings of the metamodel files; each names the metamodel repository in `repository`, and
   * `file` is relative to it. A missing folder or repository is reported by the workspace layout,
   * not again here.
   */
  readonly problems: readonly Problem[];
}

const problem = (severity: Problem["severity"], message: string, file: string, line?: number): Problem => ({
  code: "metamodel.invalid",
  severity,
  message,
  file,
  ...(line === undefined ? {} : { line }),
});

/** The line of the node at `segments`, or of the closest node above it; undefined for an empty file. */
const lineAt = (yaml: YamlFile, segments: readonly string[]): number | undefined => {
  for (let n = segments.length; n >= 0; n--) {
    const node: unknown = yaml.document.getIn(segments.slice(0, n), true);
    const range = isNode(node) ? node.range : undefined;
    if (range) {
      return yaml.lines.linePos(range[0]).line;
    }
  }
  return undefined;
};

/** The name of the property a violation is about when the schema does not know it. */
const unknownProperty = (violation: SchemaViolation): string | undefined => {
  const name = violation.params["additionalProperty"] ?? violation.params["unevaluatedProperty"];
  return typeof name === "string" ? name : undefined;
};

/** JSON Pointer segments of a violation; an unknown property points at that property. */
const violationSegments = (violation: SchemaViolation): readonly string[] => {
  const segments =
    violation.path === ""
      ? []
      : violation.path
          .slice(1)
          .split("/")
          .map((s) => s.replaceAll("~1", "/").replaceAll("~0", "~"));
  const unknown = unknownProperty(violation);
  return unknown === undefined ? segments : [...segments, unknown];
};

/** `Invalid model/types.yaml: /types/0 must NOT have unevaluated properties: colour`. */
const violationMessage = (file: string, violation: SchemaViolation): string => {
  const unknown = unknownProperty(violation);
  return `Invalid ${file}: ${describeViolations([violation])}${unknown === undefined ? "" : `: ${unknown}`}`;
};

/** A metamodel file that is valid YAML and matches the schema. */
interface ValidFile {
  readonly file: string;
  readonly yaml: YamlFile;
  readonly data: MetamodelFile;
}

type CheckedFile =
  | { readonly kind: "valid"; readonly valid: ValidFile; readonly problems: readonly Problem[] }
  | { readonly kind: "faulty"; readonly problems: readonly Problem[] };

/** Reads and checks one file. Faulty YAML is the problem of the files block: file, line, reason. */
const checkFile = async (root: string, file: string): Promise<CheckedFile> => {
  const read = await readYamlFile(root, file);
  if (read.kind === "problem") {
    return { kind: "faulty", problems: [read.problem] };
  }
  const yaml = read.file;
  const validate = fileSchemaValidator("metamodel.schema.json");
  if (validate(yaml.data)) {
    return {
      kind: "valid",
      valid: { file, yaml, data: yaml.data as MetamodelFile },
      problems: yaml.warnings,
    };
  }
  const violations = schemaViolations(validate.errors).map((v) =>
    problem("error", violationMessage(file, v), file, lineAt(yaml, violationSegments(v))),
  );
  return { kind: "faulty", problems: [...yaml.warnings, ...violations] };
};

type ListName = "types" | "properties" | "relations" | "statuses";

const LABELS: Readonly<Record<ListName, string>> = {
  types: "Type",
  properties: "Property",
  relations: "Relation kind",
  statuses: "Status",
};

const isListName = (key: string): key is ListName => Object.hasOwn(LABELS, key);

/**
 * Keys are unique across properties and relation kinds (ADR-0004): the value under a key in an
 * element file is either a property value or a relation.
 */
const SHARED_KEYS: Readonly<Partial<Record<ListName, ListName>>> = {
  properties: "relations",
  relations: "properties",
};

/** `a property`, `a relation kind`. */
const withArticle = (list: ListName): string => `a ${LABELS[list].toLowerCase()}`;

/** A definition of any of the four lists. */
interface Keyed {
  readonly key: MetamodelKey;
}

/**
 * The lists of all files so far: the kept definitions with their place in the file (for the
 * problems of inheritance and meanings), and the file that first defined each key.
 */
type Merged = Readonly<
  Record<ListName, { readonly items: Located<Keyed>[]; readonly firstFile: Map<MetamodelKey, string> }>
>;

/** Why `key` cannot be added to `list`, or undefined when it can. */
const takenBy = (merged: Merged, list: ListName, key: MetamodelKey): string | undefined => {
  const first = merged[list].firstFile.get(key);
  if (first !== undefined) {
    return `is already defined in ${first}`;
  }
  const other = SHARED_KEYS[list];
  const otherFile = other === undefined ? undefined : merged[other].firstFile.get(key);
  return other === undefined || otherFile === undefined
    ? undefined
    : `is already used by ${withArticle(other)} in ${otherFile}`;
};

/**
 * Adds the lists of one file, in the order of the file. A key defined a second time in a list, or a
 * property key a relation kind already uses (and the other way round), is reported on its line and
 * left out; the first definition is kept.
 */
const mergeFile = ({ file, yaml, data }: ValidFile, merged: Merged, problems: Problem[]): void => {
  for (const [list, items] of Object.entries(data)) {
    if (!isListName(list)) {
      continue;
    }
    const { items: kept, firstFile } = merged[list];
    // The schema checked that each list is an array of definitions with a key.
    (items as readonly Keyed[]).forEach((item, index) => {
      const reason = takenBy(merged, list, item.key);
      if (reason === undefined) {
        firstFile.set(item.key, file);
        kept.push({
          definition: item,
          file,
          lineOf: (segments) => lineAt(yaml, [list, String(index), ...segments]),
        });
        return;
      }
      problems.push(
        problem(
          "error",
          `${LABELS[list]} key ${item.key} ${reason}; this definition is ignored`,
          file,
          lineAt(yaml, [list, String(index), "key"]),
        ),
      );
    });
  }
};

/** An error at a node of a located definition. */
const locatedProblem = <T>(located: Located<T>, segments: readonly string[], message: string): Problem =>
  problem("error", message, located.file, located.lineOf(segments));

type TypeList = "source-types" | "target-types";

/** Every entry of `source-types`/`target-types` that names no defined type, on its line. */
const unknownTypeProblems = (
  typeKeys: ReadonlySet<MetamodelKey>,
  properties: readonly Located<MetamodelProperty>[],
  relations: readonly Located<MetamodelRelationKind>[],
): Problem[] => {
  const check = (
    located: Located<Partial<Record<TypeList, readonly MetamodelKey[]>> & Keyed>,
    label: string,
    lists: readonly TypeList[],
  ): Problem[] =>
    lists.flatMap((list) =>
      (located.definition[list] ?? []).flatMap((key, index) =>
        typeKeys.has(key)
          ? []
          : [
              locatedProblem(
                located,
                [list, String(index)],
                `${label} ${located.definition.key} names unknown type ${key} in ${list}`,
              ),
            ],
      ),
    );
  return [
    ...properties.flatMap((p) => check(p, LABELS.properties, ["target-types"])),
    ...relations.flatMap((r) => check(r, LABELS.relations, ["source-types", "target-types"])),
  ];
};

const ONE_INITIAL = "exactly one status must have initial: true";

/**
 * Exactly one status is initial (metamodel.schema.json): new elements get it, the tool never picks
 * one itself (D-030). Every further one is reported on its `initial`. None is reported, when every
 * file was read (`complete`), on the first status, or on the folder when there is no status.
 */
const initialStatusProblems = (
  statuses: readonly Located<MetamodelStatus>[],
  folder: string,
  complete: boolean,
): Problem[] => {
  const initial = statuses.filter((s) => s.definition.initial === true);
  const [first, ...further] = initial;
  if (first === undefined) {
    if (!complete) {
      return [];
    }
    const message = `No status is initial; ${ONE_INITIAL}`;
    const [any] = statuses;
    return [any === undefined ? problem("error", message, folder) : locatedProblem(any, ["key"], message)];
  }
  return further.map((s) =>
    locatedProblem(
      s,
      ["initial"],
      `Status ${s.definition.key} is initial, but status ${first.definition.key} in ${first.file} is already initial; ${ONE_INITIAL}`,
    ),
  );
};

type Listing =
  | { readonly kind: "names"; readonly names: readonly string[] }
  | { readonly kind: "error"; readonly reason: string };

/** Names of the entries of the folder that are not folders and not hidden, sorted (code-unit order). */
const listFolder = async (folder: string): Promise<Listing> => {
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const names = entries.filter((e) => !e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
    return { kind: "names", names: [...names].sort() };
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    return { kind: "error", reason: code ?? message };
  }
};

/** A metamodel without definitions: the folder is missing, unreadable or has no files. */
const empty = (layout: WorkspaceLayout, problems: readonly Problem[]): Metamodel => ({
  repository: layout.metamodel.repository,
  path: layout.metamodel.path,
  files: [],
  types: [],
  properties: [],
  relations: [],
  statuses: [],
  effectiveTypes: [],
  meanings: assignMeanings({ types: [], effectiveTypes: [], properties: [], relations: [] }).meanings,
  valid: false,
  problems,
});

/** Reads the metamodel files; `loadMetamodel` names the repository in the problems. */
const readMetamodel = async (layout: WorkspaceLayout): Promise<Metamodel> => {
  const { metamodel } = layout;
  const repository = layout.repositories.find((r) => r.name === metamodel.repository);
  if (!metamodel.exists || metamodel.folder === undefined || repository === undefined) {
    return empty(layout, []);
  }
  // The folder relative to its repository, `/` as separator; `""` for the repository root.
  const folder = path.relative(repository.folder, metamodel.folder).split(path.sep).join("/");
  const folderName = folder === "" ? "." : folder;
  const at = (name: string): string => path.posix.join(folder, name);
  const listing = await listFolder(metamodel.folder);
  if (listing.kind === "error") {
    return empty(layout, [
      problem("error", `Cannot read metamodel folder ${metamodel.path}: ${listing.reason}`, folderName),
    ]);
  }
  const names = listing.names.filter(
    (name) => !(repository.main && folder === "" && name === WORKSPACE_FILE),
  );
  const problems: Problem[] = names
    .filter((name) => name.endsWith(".yml"))
    .map((name) =>
      problem(
        "warning",
        `${at(name)} is not read: metamodel files end in ${METAMODEL_FILE_EXTENSION}`,
        at(name),
      ),
    );
  const files = names.filter((name) => name.endsWith(METAMODEL_FILE_EXTENSION)).map(at);
  if (files.length === 0) {
    problems.push(
      problem(
        "error",
        `Metamodel folder ${metamodel.path} has no ${METAMODEL_FILE_EXTENSION} files`,
        folderName,
      ),
    );
    return empty(layout, problems);
  }
  const merged: Merged = {
    types: { items: [], firstFile: new Map() },
    properties: { items: [], firstFile: new Map() },
    relations: { items: [], firstFile: new Map() },
    statuses: { items: [], firstFile: new Map() },
  };
  // One file after the other, so the problems come in file order, each file's in line order.
  let complete = true;
  for (const file of files) {
    const checked = await checkFile(repository.folder, file);
    problems.push(...checked.problems);
    if (checked.kind === "valid") {
      mergeFile(checked.valid, merged, problems);
    } else {
      complete = false;
    }
  }
  // Each list holds only definitions of its own kind: the schema checked every file.
  const types = merged.types.items as Located<MetamodelType>[];
  const properties = merged.properties.items as Located<MetamodelProperty>[];
  const relations = merged.relations.items as Located<MetamodelRelationKind>[];
  const statuses = merged.statuses.items as Located<MetamodelStatus>[];
  // After all files: a parent, property, type or meaning may be defined in any file, so these
  // problems come last.
  const resolved = resolveTypes(types, new Set(merged.properties.firstFile.keys()), complete);
  const assigned = assignMeanings({ types, effectiveTypes: resolved.types, properties, relations });
  problems.push(
    ...resolved.problems,
    ...assigned.problems,
    // A type or the initial status that seems missing may be in a faulty file, which is reported
    // already; so these (like an unknown parent or property in `resolveTypes`) are checked only when
    // every file was read.
    ...(complete ? unknownTypeProblems(new Set(merged.types.firstFile.keys()), properties, relations) : []),
    ...initialStatusProblems(statuses, folderName, complete),
  );
  const definitions = <T>(located: readonly Located<T>[]): T[] => located.map((l) => l.definition);
  return {
    repository: metamodel.repository,
    path: metamodel.path,
    files,
    types: definitions(types),
    properties: definitions(properties),
    relations: definitions(relations),
    statuses: definitions(statuses),
    effectiveTypes: resolved.types,
    meanings: assigned.meanings,
    valid: !problems.some((p) => p.severity === "error"),
    problems,
  };
};

/**
 * Reads the metamodel files of the working tree from the folder that `layout.metamodel` names.
 * Never throws for faulty files: they become problems and `valid: false`. Only the files directly
 * in the folder are read, not those in subfolders; hidden files (starting with `.`) are skipped.
 * When the folder is the root of the main repository, `logreq-workspace.yaml` is not a metamodel
 * file; every other `.yaml` file there is. Every problem names the metamodel repository, since the
 * metamodel may lie in its own repository (SR-018) and `file` is relative to it.
 */
export const loadMetamodel = async (layout: WorkspaceLayout): Promise<Metamodel> => {
  const metamodel = await readMetamodel(layout);
  const { repository } = layout.metamodel;
  return { ...metamodel, problems: metamodel.problems.map((p) => ({ ...p, repository })) };
};
