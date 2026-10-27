// workspace.recent (SR-131, SR-080 AK4): the workspaces the app opened last, the list its "Open
// workspace" shows, the most recent first, with whether each root still holds a workspace. The list
// belongs to the user, not to the workspace of the call (`<OS cache>/logreq/recent-workspaces.json`,
// workspace/recent.ts), so `run` does not use `ctx.workspace` and gives the same list from any folder
// (ADR-0002 rule 7). Only the app's core process records; this command only reads. Switching the
// workspace stays a function of the app's window: the other accesses choose theirs with `--workspace`.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { recentWorkspaceStates } from "../../workspace/recent.js";

export default defineCommand({
  name: "workspace.recent",
  run: async (): Promise<CommandOutput<"workspace.recent">> => ({
    workspaces: (await recentWorkspaceStates()).map(({ root, opened, exists }) => ({ root, opened, exists })),
  }),
});
