// Reading `reqseq-workspace.yaml` (D-041, SR-004) and the untracked `.reqseq/local.yaml` of one
// person. Both are checked against their schema in schemas/ (ADR-0003).
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { readYamlFile } from "../files/index.js";
import type { WorkspaceFile, WorkspaceLocalFile, WorkspaceRepository } from "../generated/types.js";
import { describeViolations, fileSchemaValidator, schemaViolations } from "../runtime/contracts.js";
import { WORKSPACE_FILE } from "./workspace-file.js";

export { WORKSPACE_FILE };

/** Local overrides of one person, next to the workspace file; never committed. */
export const LOCAL_FILE = ".reqseq/local.yaml";

/**
 * `reqseq-workspace.yaml` after the schema check. `minItems: 1` is not part of the generated
 * `WorkspaceFile`; a file that passed the check has a first repository, so it is typed here.
 */
export type CheckedWorkspaceFile = WorkspaceFile & {
  readonly repositories: readonly [WorkspaceRepository, ...WorkspaceRepository[]];
};

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

/** At most this many workspaces one level below are named in `workspace.not-found`. */
const BELOW_SHOWN = 3;

/**
 * The folders directly below `root` that hold a workspace file, sorted, for the message of
 * `workspace.not-found` (#640): a call from the repository root of a workspace in `spec/` then names
 * it. Only read when there is no workspace file; a folder that cannot be read gives none.
 */
const workspacesBelow = async (root: string): Promise<readonly string[]> => {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const found = await Promise.all(
    folders.map(async (name) => ((await exists(path.join(root, name, WORKSPACE_FILE))) ? name : undefined)),
  );
  return found.filter((name) => name !== undefined).sort();
};

const notFound = async (root: string): Promise<CommandError> => {
  const below = await workspacesBelow(root);
  const shown = below.slice(0, BELOW_SHOWN).map((name) => `${name}/${WORKSPACE_FILE}`);
  const more = below.length > BELOW_SHOWN ? ` and ${String(below.length - BELOW_SHOWN)} more` : "";
  const hint =
    below.length === 0
      ? ""
      : `; one level below lies ${shown.join(", ")}${more}: open that folder as the workspace`;
  return new CommandError("workspace.not-found", `No ${WORKSPACE_FILE} in the workspace folder${hint}`, {
    file: WORKSPACE_FILE,
    ...(below.length === 0 ? {} : { below }),
  });
};

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
 * Reads and checks `reqseq-workspace.yaml` in `root`. Throws `workspace.not-found` when there is
 * none (naming workspaces one level below, `details.below`) and `file.faulty` (with `details.problems`) when it is not valid YAML, does not match
 * `workspace.schema.json` or names a repository twice: a faulty workspace file is never used in part.
 */
export const readWorkspaceFile = async (root: string): Promise<Read<CheckedWorkspaceFile>> => {
  if (!(await exists(path.join(root, WORKSPACE_FILE)))) {
    throw await notFound(root);
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
  return { data: read.file.data as CheckedWorkspaceFile, problems: read.file.warnings };
};

/** A problem of the local file, downgraded to a warning: the local file never stops a workspace. */
const localProblem = (problem: Problem): Problem => ({
  ...problem,
  severity: "warning",
  message: `${problem.message}; ${LOCAL_FILE} is ignored`,
});

/**
 * Reads `.reqseq/local.yaml` in `root` if there is one. A faulty file is reported as warnings and
 * ignored (`data` is undefined), so the workspace opens with the paths of the workspace file.
 */
export const readLocalFile = async (root: string): Promise<Read<WorkspaceLocalFile | undefined>> => {
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
  return { data: read.file.data as WorkspaceLocalFile, problems: read.file.warnings };
};
