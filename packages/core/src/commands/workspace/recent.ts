// workspace.recent (SR-131): the workspaces opened last, the list the app's "Open workspace" shows, the
// most recent first, with whether each root still holds a workspace. The list belongs to the user, not to
// the workspace of the call (`<OS cache>/reqseq/recent-workspaces.json`, workspace/recent.ts), so `run`
// does not use `ctx.workspace` and gives the same list from any folder (ADR-0002 rule 7). The app's core
// process records the workspace it opens, and workspace.markOpened marks the workspace it runs on
// (SR-250); this command only reads. Switching the workspace stays a function of the app's window: the
// other accesses choose theirs with `--workspace`.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { recentWorkspaceStates } from "../../workspace/recent.js";
import { counted, sentence } from "../answer.js";

export default defineCommand({
  name: "workspace.recent",
  answer: (output) =>
    sentence(`The list of recent workspaces holds ${counted(output.workspaces.length, "workspace")}`),
  run: async (): Promise<CommandOutput<"workspace.recent">> => ({
    workspaces: (await recentWorkspaceStates()).map(({ root, opened, exists }) => ({ root, opened, exists })),
  }),
});
