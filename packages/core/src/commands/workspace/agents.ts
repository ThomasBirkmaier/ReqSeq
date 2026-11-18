// workspace.agents (SR-228 AK7): the clients connected to this copy through the MCP server and the one
// connected last, as the MCP server processes record them in the cache folder of the copy
// (model/agents.ts). The app's status line shows them (#1894).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { connectedAgents } from "../../model/agents.js";

export default defineCommand({
  name: "workspace.agents",
  run: async (ctx): Promise<CommandOutput<"workspace.agents">> => {
    const { recorded, connected, last } = await connectedAgents(ctx.workspace);
    return { recorded, connected: connected.map(({ client, since }) => ({ client, since })), last };
  },
});
