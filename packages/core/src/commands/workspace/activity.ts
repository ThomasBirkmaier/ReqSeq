// workspace.activity (SR-117): the element read or changed last through the API or the MCP server on
// this copy, as their processes record it in the cache folder of the copy (model/activity.ts). The
// app starts its mode „Agent folgen“ from it; the mode itself is display state of the app and no
// command (SR-117 AK4).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { lastAccess } from "../../model/activity.js";
import { sentence } from "../answer.js";

export default defineCommand({
  name: "workspace.activity",
  answer: ({ activity }) =>
    sentence(
      activity === null
        ? "No call through the API or the MCP server named an element on this working copy"
        : `The last call through ${activity.access === "api" ? "the API" : activity.access === "mcp" ? "the MCP server" : activity.access} that named an element was ${activity.command}, at ${activity.at}`,
    ),
  run: async (ctx): Promise<CommandOutput<"workspace.activity">> => ({
    activity: (await lastAccess(ctx.workspace)) ?? null,
  }),
});
