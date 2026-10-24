import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { Metamodel } from "./load.js";
import { loadMetamodel } from "./load.js";

/**
 * The metamodel of a workspace, read from the working tree on first use and kept until reset.
 * Nothing is kept outside the `Workspace` object, so a new object, or a reset after a checkout (the
 * watcher, SR-007, SR-015), reads the metamodel of the checked-out state (SR-011 AK2). Resetting
 * the workspace layout resets it too.
 */
export const metamodelState = defineWorkspaceState(
  "metamodel",
  async (workspace): Promise<Metamodel> => loadMetamodel(await workspace.get(workspaceLayoutState)),
  { dependsOn: [workspaceLayoutState] },
);
