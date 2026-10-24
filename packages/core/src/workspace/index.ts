// The `workspace` block (SR-004, SR-006): `logreq-workspace.yaml`, local overrides, where the
// repositories lie and which are available. Core blocks and commands import it relatively.
export { LOCAL_FILE, WORKSPACE_FILE, readLocalFile, readWorkspaceFile } from "./config.js";
export type { LocalFile, LocationEntry, RepositoryEntry, WorkspaceFile } from "./config.js";
export {
  DEFAULT_FOLDERS,
  availableRepositories,
  loadWorkspaceLayout,
  locate,
  settingLocation,
  workspaceLayoutState,
} from "./layout.js";
export type { LocatedFolder, MetamodelLocation, RepositoryLocation, WorkspaceLayout } from "./layout.js";
