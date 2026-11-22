// workspace.markOpened (SR-250): marks the workspace of the call as opened now, first in the list of
// recent workspaces that workspace.recent reads (`<OS cache>/reqseq/recent-workspaces.json`,
// workspace/recent.ts). It is the only command that changes the list (SR-250 AK4); the app's core process
// records the workspace it opens on its own (`recordOpenedWorkspace`, SR-131). The strict form refuses
// instead of skipping and changes nothing then (`markOpenedWorkspace`, SR-250 AK3).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { markOpenedWorkspace } from "../../model/recent-record.js";
import { sentence } from "../answer.js";

export default defineCommand({
  name: "workspace.markOpened",
  answer: ({ root }) => sentence(`The list of recent workspaces starts with ${root}`),
  run: async (ctx): Promise<CommandOutput<"workspace.markOpened">> => {
    const { root, opened } = await markOpenedWorkspace(ctx.workspace);
    return { root, opened };
  },
});
