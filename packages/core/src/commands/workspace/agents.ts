// workspace.agents (SR-228): the clients connected to this copy through the MCP server and the one
// connected last, as the MCP server processes record them in the cache folder of the copy
// (model/agents.ts). The app's status line shows them (#1894).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { connectedAgents } from "../../model/agents.js";
import { counted, sentence } from "../answer.js";

/** A client as a sentence names it. */
const client = (name: string | null): string => name ?? "a client without a name";

export default defineCommand({
  name: "workspace.agents",
  answer: (output) =>
    output.recorded
      ? sentence(
          `${counted(output.connected.length, "agent")} connected to this copy`,
          output.last === null
            ? "no connection has ended"
            : `the connection that ended last was ${client(output.last.client)}`,
        )
      : "This copy has no cache folder that records agent connections.",
  run: async (ctx): Promise<CommandOutput<"workspace.agents">> => {
    const { recorded, connected, last } = await connectedAgents(ctx.workspace);
    return { recorded, connected: connected.map(({ client, since }) => ({ client, since })), last };
  },
});
