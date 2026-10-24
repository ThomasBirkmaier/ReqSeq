// Loading the metamodel (SR-011, D-021): every `*.yaml` file directly in the folder that the
// workspace file names, read from the working tree, that is from the checked-out state. Each file
// is checked against metamodel.schema.json; the lists of all files are merged. A faulty file is
// reported with file, line and reason and makes the metamodel invalid, which opens the workspace
// read-only (SR-011 AK3, access.ts).
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

/** Metamodel files end in `.yaml` (metamodel.schema.json). */
export const METAMODEL_FILE_EXTENSION = ".yaml";

/** The metamodel of the checked-out state, as written in its files (no inheritance resolved yet). */
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
  /**
   * The folder exists and no file has an error (faulty YAML, schema violation, key defined twice).
   * When false the workspace is read-only (SR-011 AK3).
   */
  readonly valid: boolean;
  /**
   * Findings of the metamodel files; `file` is relative to the metamodel repository. A missing
   * folder or repository is reported by the workspace layout, not again here.
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

/** A definition of any of the four lists. */
interface Keyed {
  readonly key: MetamodelKey;
}

/** The lists of all files so far, and the file that first defined each key. */
type Merged = Readonly<
  Record<ListName, { readonly items: Keyed[]; readonly firstFile: Map<MetamodelKey, string> }>
>;

/**
 * Adds the lists of one file, in the order of the file. A key defined a second time in a list is
 * reported on its line and left out; the first definition is kept.
 */
const mergeFile = ({ file, yaml, data }: ValidFile, merged: Merged, problems: Problem[]): void => {
  for (const [list, items] of Object.entries(data)) {
    if (!isListName(list)) {
      continue;
    }
    const { items: kept, firstFile } = merged[list];
    // The schema checked that each list is an array of definitions with a key.
    (items as readonly Keyed[]).forEach((item, index) => {
      const first = firstFile.get(item.key);
      if (first === undefined) {
        firstFile.set(item.key, file);
        kept.push(item);
        return;
      }
      problems.push(
        problem(
          "error",
          `${LABELS[list]} key ${item.key} is already defined in ${first}; this definition is ignored`,
          file,
          lineAt(yaml, [list, String(index), "key"]),
        ),
      );
    });
  }
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
  valid: false,
  problems,
});

/**
 * Reads the metamodel files of the working tree from the folder that `layout.metamodel` names.
 * Never throws for faulty files: they become problems and `valid: false`. Only the files directly
 * in the folder are read, not those in subfolders; hidden files (starting with `.`) are skipped.
 * When the folder is the root of the main repository, `logreq-workspace.yaml` is not a metamodel
 * file; every other `.yaml` file there is.
 */
export const loadMetamodel = async (layout: WorkspaceLayout): Promise<Metamodel> => {
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
  for (const file of files) {
    const checked = await checkFile(repository.folder, file);
    problems.push(...checked.problems);
    if (checked.kind === "valid") {
      mergeFile(checked.valid, merged, problems);
    }
  }
  return {
    repository: metamodel.repository,
    path: metamodel.path,
    files,
    // Each list holds only definitions of its own kind: the schema checked every file.
    types: merged.types.items as MetamodelType[],
    properties: merged.properties.items as MetamodelProperty[],
    relations: merged.relations.items as MetamodelRelationKind[],
    statuses: merged.statuses.items as MetamodelStatus[],
    valid: !problems.some((p) => p.severity === "error"),
    problems,
  };
};
