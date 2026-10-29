// The app's core process records the workspace it opened in the list of recent workspaces (SR-131,
// `workspace/recent.ts`), unless the list would lie inside a repository of that workspace
// (`XDG_CACHE_HOME` or `LOCALAPPDATA` pointed into a checkout): ReqSeq never writes into a working
// tree (ADR-0008, D-036), the same rule as for the cache folder of a copy (`usableCacheFolder`).
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { RememberOptions } from "../workspace/recent.js";
import { recentWorkspacesFolder, rememberWorkspace } from "../workspace/recent.js";
import { insideRepository } from "./model-cache.js";

/**
 * Puts the root of `workspace` first in the list of recent workspaces (`rememberWorkspace`). Resolves
 * `false` without writing when the folder of the list lies inside a repository of the workspace, or when
 * the record was skipped; rejects when the layout of the workspace cannot be read or the file cannot be
 * written.
 */
export async function recordOpenedWorkspace(
  workspace: Workspace,
  options: RememberOptions = {},
): Promise<boolean> {
  const layout = await workspace.get(workspaceLayoutState);
  if (insideRepository(recentWorkspacesFolder(options.environment), layout)) {
    return false;
  }
  return rememberWorkspace(workspace.root, options);
}
