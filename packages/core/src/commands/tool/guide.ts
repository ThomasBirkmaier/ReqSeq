// tool.guide (SR-229): the agent guide as Markdown, the same text for the same input in every access (AK1),
// with the facts of the workspace metamodel or the reason they are missing (AK2, AK4). The MCP server sends
// its output with `names: mcp` as the instructions of its `initialize` result. The text is guide/text.ts.
// With `skill` the output is the skill file instead (AK7, guide/skill.ts), which `write` also writes at the
// place of D-079 (AK8, guide/skill-file.ts); `replace` replaces a file there that is not ReqSeq's own.
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { CommandCatalog } from "../../generated/types.js";
import { contractsBundle } from "../../runtime/contracts.js";
import { sentence } from "../answer.js";
import { readGuideFacts } from "./guide/facts.js";
import { skillFile } from "./guide/skill.js";
import { writeSkillFile } from "./guide/skill-file.js";
import { agentGuide } from "./guide/text.js";

/** The catalog commands of this version, which the guide's calls name. */
const ENTRIES = (contractsBundle.catalog as CommandCatalog).commands;

/** `field` given without the field it needs: `input.invalid` naming it, as a schema violation would. */
const needs = (field: string, other: string): CommandError =>
  new CommandError("input.invalid", `Invalid input for tool.guide: ${field} needs ${other}`, {
    command: "tool.guide",
    errors: [
      {
        path: `/${field}`,
        keyword: "dependentRequired",
        message: `${field} needs ${other}`,
        params: {},
        field,
      },
    ],
  });

/** The verb of the answer for what a write did to the skill file. */
const FILE_ACTION = { created: "Created", replaced: "Replaced", unchanged: "Left" } as const;

export default defineCommand({
  name: "tool.guide",
  answer: (output, input) =>
    sentence(
      output.file !== undefined
        ? `${FILE_ACTION[output.file.action]} the skill file ${output.file.path}${output.file.action === "unchanged" ? " unchanged" : ""}`
        : input.skill
          ? "Gave the skill file for an AI agent without writing it"
          : `Gave the agent guide with commands named for ${input.names === "mcp" ? "MCP" : "the command line"}`,
    ),
  run: async (ctx, input): Promise<CommandOutput<"tool.guide">> => {
    if (input.write && !input.skill) {
      throw needs("write", "skill");
    }
    if (input.replace && !input.write) {
      throw needs("replace", "write");
    }
    if (!input.skill) {
      return { guide: agentGuide(await readGuideFacts(ctx.workspace), input.names, ENTRIES) };
    }
    const guide = skillFile(ENTRIES);
    if (!input.write) {
      return { guide };
    }
    const result = await writeSkillFile(ctx.workspace, ENTRIES, {
      replace: input.replace,
      localPaths: ctx.localPaths,
    });
    if ("refused" in result) {
      throw result.refused;
    }
    return { guide, file: result.written };
  },
});
