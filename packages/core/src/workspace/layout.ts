// Locating the repositories of a workspace (SR-004): where each one lies on this machine, which are
// available, where the metamodel folder is. A missing repository is normal (N-041, SR-006): it is
// marked not available and reported as info; the others work as usual (SR-004 AK3).
import fs from "node:fs/promises";
import path from "node:path";
import type { Problem } from "../catalog.js";
import type { WorkspaceLocalFile, WorkspaceLocation, WorkspaceRepository } from "../generated/types.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { CheckedWorkspaceFile } from "./config.js";
import { LOCAL_FILE, WORKSPACE_FILE, readLocalFile, readWorkspaceFile } from "./config.js";

export interface RepositoryLocation {
  /** Name in the workspace file. */
  readonly name: string;
  readonly url: string;
  /** The repository that holds the workspace file; it is always `Workspace.root`. */
  readonly main: boolean;
  /**
   * Where it is looked for, as configured: from `.logreq/local.yaml`, else `path` of the workspace
   * file (with `/`), else `.` for the main repository and `../<name>` for the others. Relative
   * paths are relative to the main repository. No `~` expansion.
   */
  readonly path: string;
  /** The absolute folder on this machine; the real path (links resolved) when available. */
  readonly folder: string;
  /** The folder exists. */
  readonly available: boolean;
  /**
   * Folders of other available repositories inside this one (e.g. a submodule). Element
   * discovery (SR-003) skips them; their elements belong to their own repository.
   */
  readonly excludes: readonly string[];
}

export interface MetamodelLocation {
  readonly repository: string;
  /** Folder inside the repository. */
  readonly path: string;
  /** The absolute folder; undefined when the repository is unknown or not available. */
  readonly folder: string | undefined;
  /** The folder exists. Loading and checking the metamodel files is the metamodel block (SR-011). */
  readonly exists: boolean;
}

/** What `logreq-workspace.yaml` and `.logreq/local.yaml` say, located on this machine. */
export interface WorkspaceLayout {
  /** Absolute folder of the main repository (`Workspace.root`). */
  readonly root: string;
  readonly name: string;
  /** Name of the main repository. */
  readonly main: string;
  /** The checked workspace file, for blocks that need other settings (evidence, baselines, ignore). */
  readonly file: CheckedWorkspaceFile;
  /** In the order of the workspace file, without entries that share a folder with an earlier one. */
  readonly repositories: readonly RepositoryLocation[];
  readonly metamodel: MetamodelLocation;
  /** Findings of the workspace and local files and missing repositories. */
  readonly problems: readonly Problem[];
}

/** A location of the workspace file on this machine. */
export interface LocatedFolder {
  /** Undefined when the workspace has no repository of that name. */
  readonly repository: RepositoryLocation | undefined;
  /** The absolute folder; undefined when the repository is unknown or not available. */
  readonly folder: string | undefined;
}

/**
 * Where a location (`{ repository, path }` of the workspace file) lies on this machine. Only
 * resolves the path; whether the folder exists is up to the caller.
 */
export const locate = (
  layout: Pick<WorkspaceLayout, "repositories">,
  location: WorkspaceLocation,
): LocatedFolder => {
  const repository = layout.repositories.find((r) => r.name === location.repository);
  return repository?.available === true
    ? { repository, folder: path.resolve(repository.folder, location.path) }
    : { repository, folder: undefined };
};

/** Folders of settings that have a default in the main repository (workspace.schema.json). */
export const DEFAULT_FOLDERS = { baselines: "baselines", filters: "filters", mappings: "reqif" } as const;

/** The location of `baselines`, `filters` or `mappings`: as configured, else the default in the main repository. */
export const settingLocation = (
  layout: Pick<WorkspaceLayout, "file" | "main">,
  setting: keyof typeof DEFAULT_FOLDERS,
): WorkspaceLocation => layout.file[setting] ?? { repository: layout.main, path: DEFAULT_FOLDERS[setting] };

/** The real path of an existing folder, else undefined. */
const realFolder = async (folder: string): Promise<string | undefined> =>
  fs.realpath(folder).then(
    async (real) => ((await fs.stat(real)).isDirectory() ? real : undefined),
    () => undefined,
  );

const isFolder = async (folder: string): Promise<boolean> => (await realFolder(folder)) !== undefined;

const invalid = (severity: Problem["severity"], file: string, message: string): Problem => ({
  code: "workspace.invalid",
  severity,
  file,
  message,
});

/** The path of the committed workspace file: `/` as separator, never absolute (not the same on every machine). */
const committedPath = (entry: WorkspaceRepository, problems: Problem[]): string | undefined => {
  if (entry.path === undefined) {
    return undefined;
  }
  const slashed = entry.path.replaceAll("\\", "/");
  if (slashed !== entry.path) {
    problems.push(
      invalid("warning", WORKSPACE_FILE, `Repository ${entry.name}: write its path with / instead of \\`),
    );
  }
  if (path.win32.isAbsolute(slashed)) {
    problems.push(
      invalid(
        "warning",
        WORKSPACE_FILE,
        `Repository ${entry.name}: an absolute path is ignored here; put it in ${LOCAL_FILE}`,
      ),
    );
    return undefined;
  }
  return slashed;
};

/** The configured path of a repository, with the local override applied. */
const configuredPath = (
  entry: WorkspaceRepository,
  isMain: boolean,
  local: WorkspaceLocalFile | undefined,
  problems: Problem[],
): string => {
  const committed = committedPath(entry, problems);
  const override = local?.repositories?.[entry.name]?.path;
  if (!isMain) {
    return override ?? committed ?? `../${entry.name}`;
  }
  const moved = committed !== undefined && path.posix.normalize(committed).replace(/\/$/, "") !== ".";
  if (override !== undefined || moved) {
    problems.push(
      invalid(
        "warning",
        override === undefined ? WORKSPACE_FILE : LOCAL_FILE,
        `Repository ${entry.name} holds the workspace file; its path is always "."`,
      ),
    );
  }
  return ".";
};

const unknownOverrides = (
  entries: readonly WorkspaceRepository[],
  local: WorkspaceLocalFile | undefined,
): readonly Problem[] => {
  const names = new Set(entries.map((e) => e.name));
  return Object.keys(local?.repositories ?? {})
    .filter((name) => !names.has(name))
    .map((name) =>
      invalid("warning", LOCAL_FILE, `Repository ${name} is not in ${WORKSPACE_FILE}; its path is ignored`),
    );
};

const locateRepository = async (
  root: string,
  entry: WorkspaceRepository,
  isMain: boolean,
  local: WorkspaceLocalFile | undefined,
  problems: Problem[],
): Promise<RepositoryLocation> => {
  const configured = configuredPath(entry, isMain, local, problems);
  const resolved = path.resolve(root, configured);
  const real = await realFolder(resolved);
  return {
    name: entry.name,
    url: entry.url,
    main: isMain,
    path: configured,
    folder: real ?? resolved,
    available: real !== undefined,
    excludes: [],
  };
};

const isInside = (parent: string, child: string): boolean => {
  const rel = path.relative(parent, child);
  return rel !== "" && !path.isAbsolute(rel) && rel.split(path.sep)[0] !== "..";
};

/**
 * Leaves out a repository whose folder is the folder of another one (the main repository always
 * stays) and gives each repository the folders of the repositories nested in it.
 */
const resolveOverlaps = (
  located: readonly RepositoryLocation[],
  problems: Problem[],
): readonly RepositoryLocation[] => {
  const byFolder = new Map<string, RepositoryLocation>();
  const left = new Set<RepositoryLocation>();
  // Main first, then file order (sort is stable).
  for (const repository of [...located].sort((a, b) => Number(b.main) - Number(a.main))) {
    const same = repository.available ? byFolder.get(repository.folder) : undefined;
    if (same === undefined) {
      byFolder.set(repository.folder, repository);
      continue;
    }
    left.add(repository);
    problems.push(
      invalid(
        "error",
        WORKSPACE_FILE,
        `Repository ${repository.name} lies in the same folder as ${same.name}; it is left out`,
      ),
    );
  }
  const kept = located.filter((r) => !left.has(r));
  const available = kept.filter((r) => r.available);
  return kept.map((r) => ({
    ...r,
    excludes: r.available ? available.filter((o) => isInside(r.folder, o.folder)).map((o) => o.folder) : [],
  }));
};

/** The locations of the workspace file besides the metamodel, with the setting they belong to. */
const settingLocations = (file: CheckedWorkspaceFile): readonly (readonly [string, WorkspaceLocation])[] => [
  ...(file.evidence ?? []).map((e) => ["evidence", e] as const),
  ...(file.baselines === undefined ? [] : [["baselines", file.baselines] as const]),
  ...(file.filters === undefined ? [] : [["filters", file.filters] as const]),
  ...(file.mappings === undefined ? [] : [["mappings", file.mappings] as const]),
];

const unknownLocationRepositories = (
  file: CheckedWorkspaceFile,
  entries: readonly WorkspaceRepository[],
): readonly Problem[] => {
  const names = new Set(entries.map((r) => r.name));
  return settingLocations(file)
    .filter(([, location]) => !names.has(location.repository))
    .map(([setting, location]) =>
      invalid(
        "error",
        WORKSPACE_FILE,
        `${setting} names repository ${location.repository}, which is not in repositories`,
      ),
    );
};

/** Names the repository only: the configured path may be absolute and differ per machine. */
const missingRepository = (repository: RepositoryLocation): Problem => ({
  code: "workspace.repository-missing",
  severity: "info",
  message: `Repository ${repository.name} is not available locally`,
});

const metamodelProblem = (message: string): Problem => ({
  code: "metamodel.invalid",
  severity: "error",
  file: WORKSPACE_FILE,
  message,
});

const locateMetamodel = async (
  location: WorkspaceLocation,
  repositories: readonly RepositoryLocation[],
  problems: Problem[],
): Promise<MetamodelLocation> => {
  const { repository, folder } = locate({ repositories }, location);
  if (repository === undefined || folder === undefined) {
    problems.push(
      metamodelProblem(
        repository === undefined
          ? `Metamodel repository ${location.repository} is not in repositories`
          : `Metamodel repository ${location.repository} is not available`,
      ),
    );
    return { ...location, folder: undefined, exists: false };
  }
  const exists = await isFolder(folder);
  if (!exists) {
    problems.push(
      metamodelProblem(`Metamodel folder ${location.path} is missing in repository ${location.repository}`),
    );
  }
  return { ...location, folder, exists };
};

/**
 * Reads the workspace file in `root` (and the local overrides), locates every repository and the
 * metamodel folder. Missing repositories never fail it (SR-004 AK3). Rejects with
 * `workspace.not-found` or `file.faulty` when the workspace file is missing or faulty.
 */
export const loadWorkspaceLayout = async (root: string): Promise<WorkspaceLayout> => {
  const workspaceFile = await readWorkspaceFile(root);
  const localFile = await readLocalFile(root);
  const file = workspaceFile.data;
  const local = localFile.data;
  const problems: Problem[] = [...workspaceFile.problems, ...localFile.problems];
  const entries = file.repositories;
  // The schema allows one `main: true` at most, and requires it with two or more repositories.
  const main = entries.find((e) => e.main === true) ?? entries[0];
  const located: RepositoryLocation[] = [];
  for (const entry of entries) {
    located.push(await locateRepository(root, entry, entry === main, local, problems));
  }
  const repositories = resolveOverlaps(located, problems);
  problems.push(...unknownOverrides(entries, local), ...unknownLocationRepositories(file, entries));
  problems.push(...repositories.filter((r) => !r.available).map(missingRepository));
  const metamodel = await locateMetamodel(file.metamodel, repositories, problems);
  return { root, name: file.name, main: main.name, file, repositories, metamodel, problems };
};

/** The repositories whose folders exist: the roots in which elements are discovered (SR-003, SR-004 AK1). */
export const availableRepositories = (layout: WorkspaceLayout): readonly RepositoryLocation[] =>
  layout.repositories.filter((r) => r.available);

/**
 * The layout of a workspace, read on first use and kept until reset (e.g. by the watcher when
 * `logreq-workspace.yaml` or `.logreq/local.yaml` changes, SR-007). A failed read is not kept.
 */
export const workspaceLayoutState = defineWorkspaceState("workspace", async (workspace) =>
  loadWorkspaceLayout(workspace.root),
);
