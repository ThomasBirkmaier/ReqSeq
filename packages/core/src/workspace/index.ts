// The `workspace` block (SR-004, SR-006, SR-018): `logreq-workspace.yaml`, local overrides, where
// the repositories lie, which are available and which are writable. Core blocks and commands import
// it relatively.
export { LOCAL_FILE, WORKSPACE_FILE, readLocalFile, readWorkspaceFile } from "./config.js";
export {
  cacheFolder,
  lockCacheFile,
  osCacheFolder,
  readCacheFile,
  removeCacheFile,
  writeCacheFile,
} from "./cache.js";
export type { CacheEnvironment } from "./cache.js";
export {
  DEFAULT_METAMODEL_FOLDER,
  FALLBACK_REPOSITORY_NAME,
  createWorkspace,
  repositoryNameFor,
} from "./init.js";
export type { NewWorkspace } from "./init.js";
export { findWorkspaceRoot } from "./root.js";
export type { CheckedWorkspaceFile } from "./config.js";
export {
  DEFAULT_FOLDERS,
  availableRepositories,
  loadWorkspaceLayout,
  locate,
  settingLocation,
  workspaceLayoutState,
} from "./layout.js";
export type { LocatedFolder, MetamodelLocation, RepositoryLocation, WorkspaceLayout } from "./layout.js";
export { isWritableFolder } from "./writable.js";
