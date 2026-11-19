// tool.guide (SR-229): the agent guide as Markdown, the same text for the same input in every access (AK1),
// with the facts of the workspace metamodel or the reason they are missing (AK2, AK4). The MCP server sends
// its output with `names: mcp` as the instructions of its `initialize` result. The text is guide/text.ts.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import type { CommandCatalog } from "../../generated/types.js";
import { contractsBundle } from "../../runtime/contracts.js";
import { sentence } from "../answer.js";
import { readGuideFacts } from "./guide/facts.js";
import { agentGuide } from "./guide/text.js";

/** The catalog commands of this version, which the guide's calls name. */
const ENTRIES = (contractsBundle.catalog as CommandCatalog).commands;

export default defineCommand({
  name: "tool.guide",
  answer: (_output, input) =>
    sentence(
      `Wrote the agent guide with commands named for ${input.names === "mcp" ? "MCP" : "the command line"}`,
    ),
  run: async (ctx, input): Promise<CommandOutput<"tool.guide">> => ({
    guide: agentGuide(await readGuideFacts(ctx.workspace), input.names, ENTRIES),
  }),
});
