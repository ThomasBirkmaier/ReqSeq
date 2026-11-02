// A repository of the workspace that is also a workspace of its own (#666): every repository is read
// with the metamodel of the workspace (D-021: one metamodel per state), so when that repository's
// own metamodel counts other properties to the version (D-057), its elements get other versions
// here than in its own workspace, and relations and evidence read as outdated in one of the two.
// `workspace.check` warns about it (`workspace.metamodel-mismatch`). The other metamodel is only
// read and compared, never used. Cost: one layout and one metamodel load per repository with its
// own workspace file and its own metamodel folder, per call; nothing per element (N-036).
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { WORKSPACE_FILE, loadWorkspaceLayout } from "../workspace/index.js";
import type { Metamodel } from "./load.js";
import { loadMetamodel } from "./load.js";

/** How many differing items a message names; the rest are counted. */
export const SHOWN_DIFFERENCES = 3;

/** Per type key, its properties that count to the version (`content: true`) with their kind. */
type Counted = ReadonlyMap<string, ReadonlyMap<string, string>>;

/** Per type key, every property key of its effective type. */
type Keys = ReadonlyMap<string, ReadonlySet<string>>;

interface VersionModel {
  readonly counted: Counted;
  readonly keys: Keys;
}

const versionModel = (metamodel: Metamodel): VersionModel => {
  const kinds = new Map<string, string>();
  for (const property of metamodel.properties) {
    if (property.content === true && !kinds.has(property.key)) {
      kinds.set(property.key, property.kind);
    }
  }
  const counted = new Map<string, ReadonlyMap<string, string>>();
  const keys = new Map<string, ReadonlySet<string>>();
  for (const type of metamodel.effectiveTypes) {
    keys.set(type.key, new Set(type.properties));
    const own = new Map<string, string>();
    for (const key of type.properties) {
      const kind = kinds.get(key);
      if (kind !== undefined) {
        own.set(key, kind);
      }
    }
    counted.set(type.key, own);
  }
  return { counted, keys };
};

const NONE: ReadonlyMap<string, string> = new Map();

/**
 * What decides the versions and differs between the repository's metamodel (`there`) and the
 * workspace's (`here`), per type in the order of `there`, then the types only `here` has: a
 * property that counts in one and not in the other, and one that counts in both but is a relation
 * (whose targets count by ID only, ADR-0005) in one of them.
 */
export const versionDifferences = (there: Metamodel, here: Metamodel): readonly string[] => {
  const a = versionModel(there);
  const b = versionModel(here);
  const types = [...new Set([...a.keys.keys(), ...b.keys.keys()])];
  const items: string[] = [];
  for (const type of types) {
    const countsThere = a.counted.get(type) ?? NONE;
    const countsHere = b.counted.get(type) ?? NONE;
    for (const [key, kind] of countsThere) {
      const hereKind = countsHere.get(key);
      if (hereKind === undefined) {
        const known = b.keys.get(type)?.has(key) === true;
        items.push(
          `${type}.${key} counts to the version there but ${known ? "not here" : "is not in this workspace's metamodel"}`,
        );
      } else if ((kind === "relation") !== (hereKind === "relation")) {
        items.push(
          `${type}.${key} is a relation ${kind === "relation" ? "there but not here" : "here but not there"}`,
        );
      }
    }
    for (const key of countsHere.keys()) {
      if (!countsThere.has(key)) {
        const known = a.keys.get(type)?.has(key) === true;
        items.push(
          `${type}.${key} counts to the version here but ${known ? "not there" : "is not in its metamodel"}`,
        );
      }
    }
  }
  return items;
};

const problem = (repository: string, severity: Problem["severity"], message: string): Problem => ({
  code: "workspace.metamodel-mismatch",
  severity,
  repository,
  file: WORKSPACE_FILE,
  message,
});

/** The finding for one available repository other than the main one, if any. */
const repositoryProblem = async (
  repository: RepositoryLocation,
  layout: WorkspaceLayout,
  metamodel: Metamodel,
): Promise<Problem | undefined> => {
  const { name } = repository;
  let own: WorkspaceLayout;
  try {
    own = await loadWorkspaceLayout(repository.folder);
  } catch (error) {
    if (error instanceof CommandError && error.code === "workspace.not-found") {
      return undefined;
    }
    return problem(
      name,
      "info",
      `Repository ${name} has its own ${WORKSPACE_FILE}, which cannot be read, so its metamodel is not compared with this workspace's`,
    );
  }
  // The same folder (a shared metamodel repository) is the same metamodel.
  if (own.metamodel.folder === layout.metamodel.folder) {
    return undefined;
  }
  const theirs = await loadMetamodel(own);
  if (!theirs.valid) {
    return problem(
      name,
      "info",
      `Repository ${name} has its own metamodel, which is missing or not valid, so it is not compared with this workspace's`,
    );
  }
  const items = versionDifferences(theirs, metamodel);
  if (items.length === 0) {
    return undefined;
  }
  const more = items.length - SHOWN_DIFFERENCES;
  const shown = items.slice(0, SHOWN_DIFFERENCES).join(", ") + (more > 0 ? ` and ${String(more)} more` : "");
  return problem(
    name,
    "warning",
    `Repository ${name} has its own metamodel: ${shown}; elements of ${name} get other versions here`,
  );
};

/**
 * `workspace.metamodel-mismatch` for every available repository other than the main one that holds
 * its own workspace file (in its folder) whose metamodel differs from the workspace's in what decides
 * the versions (a warning), or cannot be read (info). None while the workspace's metamodel is not
 * valid: its own errors come first (#208).
 */
export const repositoryMetamodelProblems = async (
  layout: WorkspaceLayout,
  metamodel: Metamodel,
): Promise<readonly Problem[]> => {
  if (!metamodel.valid) {
    return [];
  }
  const problems: Problem[] = [];
  for (const repository of layout.repositories) {
    if (repository.main || !repository.available) {
      continue;
    }
    const found = await repositoryProblem(repository, layout, metamodel);
    if (found !== undefined) {
      problems.push(found);
    }
  }
  return problems;
};
