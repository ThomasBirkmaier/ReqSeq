// Reading `logreq-workspace.yaml` (D-041, SR-004) and the untracked `.logreq/local.yaml` of one
// person. Both are checked against their schema in schemas/ (ADR-0003).
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { readYamlFile } from "../files/index.js";
import { describeViolations, fileSchemaValidator, schemaViolations } from "../runtime/contracts.js";

/** In the root of the main repository; the folder that holds it is `Workspace.root`. */
export const WORKSPACE_FILE = "logreq-workspace.yaml";

/** Local overrides of one person, next to the workspace file; never committed. */
export const LOCAL_FILE = ".logreq/local.yaml";

// Hand-written until the types are generated from the schemas (ADR-0003, #134).

/** `workspace.schema.json#/$defs/repository`. */
export interface RepositoryEntry {
  readonly name: string;
  readonly url: string;
  readonly path?: string;
  readonly main?: boolean;
}

/** `workspace.schema.json#/$defs/location`. */
export interface LocationEntry {
  readonly repository: string;
  readonly path: string;
}

/** `workspace.schema.json`. */
export interface WorkspaceFile {
  readonly "logreq-workspace": 1;
  readonly name: string;
  /** At least one (`minItems: 1`). */
  readonly repositories: readonly [RepositoryEntry, ...RepositoryEntry[]];
  readonly metamodel: LocationEntry;
  readonly evidence?: readonly LocationEntry[];
  readonly baselines?: LocationEntry;
  readonly filters?: LocationEntry;
  readonly mappings?: LocationEntry;
  readonly ignore?: readonly string[];
}

/** `workspace-local.schema.json`. */
export interface LocalFile {
  readonly "logreq-local": 1;
  readonly repositories?: Readonly<Record<string, { readonly path: string }>>;
}

export interface Read<T> {
  readonly data: T;
  /** YAML warnings of the file. */
  readonly problems: readonly Problem[];
}

const exists = async (file: string): Promise<boolean> =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );

/** Schema violations as `workspace.invalid` problems of `file`. */
const violations = (schema: string, file: string, data: unknown): readonly Problem[] => {
  const validate = fileSchemaValidator(schema);
  if (validate(data)) {
    return [];
  }
  return schemaViolations(validate.errors).map((v) => ({
    code: "workspace.invalid",
    severity: "error",
    file,
    message: `Invalid ${file}: ${describeViolations([v])}`,
  }));
};

/** Repository names must be unique; JSON Schema cannot say that, so it is checked here. */
const duplicateNames = (data: WorkspaceFile): readonly Problem[] => {
  const seen = new Set<string>();
  return data.repositories.flatMap((entry): Problem[] => {
    if (!seen.has(entry.name)) {
      seen.add(entry.name);
      return [];
    }
    const message = `Invalid ${WORKSPACE_FILE}: repository ${entry.name} is listed twice`;
    return [{ code: "workspace.invalid", severity: "error", file: WORKSPACE_FILE, message }];
  });
};

/** Schema violations, then (for a file that matches the schema) duplicate repository names. */
const workspaceFileProblems = (data: unknown): readonly Problem[] => {
  const invalid = violations("workspace.schema.json", WORKSPACE_FILE, data);
  return invalid.length > 0 ? invalid : duplicateNames(data as WorkspaceFile);
};

/**
 * Reads and checks `logreq-workspace.yaml` in `root`. Throws `workspace.not-found` when there is
 * none and `file.faulty` (with `details.problems`) when it is not valid YAML, does not match
 * `workspace.schema.json` or names a repository twice: a faulty workspace file is never used in part.
 */
export const readWorkspaceFile = async (root: string): Promise<Read<WorkspaceFile>> => {
  if (!(await exists(path.join(root, WORKSPACE_FILE)))) {
    throw new CommandError("workspace.not-found", `No ${WORKSPACE_FILE} in the workspace folder`, {
      file: WORKSPACE_FILE,
    });
  }
  const read = await readYamlFile(root, WORKSPACE_FILE);
  const problems = read.kind === "problem" ? [read.problem] : workspaceFileProblems(read.file.data);
  if (read.kind === "problem" || problems.length > 0) {
    throw new CommandError(
      "file.faulty",
      `${WORKSPACE_FILE} is faulty: ${problems.map((p) => p.message).join("; ")}`,
      { file: WORKSPACE_FILE, problems },
    );
  }
  return { data: read.file.data as WorkspaceFile, problems: read.file.warnings };
};

/** A problem of the local file, downgraded to a warning: the local file never stops a workspace. */
const localProblem = (problem: Problem): Problem => ({
  ...problem,
  severity: "warning",
  message: `${problem.message}; ${LOCAL_FILE} is ignored`,
});

/**
 * Reads `.logreq/local.yaml` in `root` if there is one. A faulty file is reported as warnings and
 * ignored (`data` is undefined), so the workspace opens with the paths of the workspace file.
 */
export const readLocalFile = async (root: string): Promise<Read<LocalFile | undefined>> => {
  if (!(await exists(path.join(root, LOCAL_FILE)))) {
    return { data: undefined, problems: [] };
  }
  const read = await readYamlFile(root, LOCAL_FILE);
  if (read.kind === "problem") {
    return { data: undefined, problems: [localProblem(read.problem)] };
  }
  const invalid = violations("workspace-local.schema.json", LOCAL_FILE, read.file.data);
  if (invalid.length > 0) {
    return { data: undefined, problems: [...read.file.warnings, ...invalid.map(localProblem)] };
  }
  return { data: read.file.data as LocalFile, problems: read.file.warnings };
};
