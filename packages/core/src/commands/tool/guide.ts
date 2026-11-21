// tool.guide (SR-229): the agent guide as Markdown, the same text for the same input in every access (AK1),
// with the facts of the workspace metamodel or the reason they are missing (AK2, AK4). The text is
// guide/text.ts. With `instructions` the output is the MCP server instructions instead (AK17), which the MCP
// server sends in its `initialize` result.
// With `skill` the output is the skill file instead (AK7, guide/skill.ts), which `write` also writes at each
// place of D-079 (AK8, guide/skill-file.ts), listed in `places` in its order; `replace` replaces a file that is not
// ReqSeq's own at every place. A refused place makes the call fail after the other places were written, with one
// error that names each place with its result (`writtenOrThrow`).
import type { CommandOutput } from "../../catalog.js";
import { CommandError, defineCommand } from "../../catalog.js";
import type { CommandCatalog } from "../../generated/types.js";
import { contractsBundle } from "../../runtime/contracts.js";
import { sentence } from "../answer.js";
import { readGuideFacts } from "./guide/facts.js";
import { skillFile } from "./guide/skill.js";
import type { SkillWritten } from "./guide/skill-file.js";
import { writeSkillFiles, writtenOrThrow } from "./guide/skill-file.js";
import { agentGuide, serverInstructions } from "./guide/text.js";

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

/** `field` given together with `other`, which it excludes: `input.invalid` naming it, as a schema violation would. */
const excludes = (field: string, other: string): CommandError =>
  new CommandError("input.invalid", `Invalid input for tool.guide: ${field} cannot be given with ${other}`, {
    command: "tool.guide",
    errors: [
      {
        path: `/${field}`,
        keyword: "not",
        message: `${field} cannot be given with ${other}`,
        params: {},
        field,
      },
    ],
  });

/** The verb of the answer for what a write did to the skill file at one place. */
const FILE_ACTION = { created: "created", replaced: "replaced", unchanged: "left" } as const;

/** What the write did at each place, in the order of D-079: `Created the skill file A, and left the skill file B unchanged`. */
const placesAnswer = (places: readonly SkillWritten[]): string => {
  const parts = places.map(
    (place) =>
      `${FILE_ACTION[place.action]} the skill file ${place.path}${place.action === "unchanged" ? " unchanged" : ""}`,
  );
  const text = parts.join(", and ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
};

export default defineCommand({
  name: "tool.guide",
  answer: (output, input) =>
    sentence(
      output.places !== undefined
        ? placesAnswer(output.places)
        : input.instructions
          ? "Gave the MCP server instructions"
          : input.skill
            ? "Gave the skill file for an AI agent without writing it"
            : `Gave the agent guide with commands named for ${input.names === "mcp" ? "MCP" : "the command line"}`,
    ),
  run: async (ctx, input): Promise<CommandOutput<"tool.guide">> => {
    if (input.instructions && input.skill) {
      throw excludes("instructions", "skill");
    }
    if (input.write && !input.skill) {
      throw needs("write", "skill");
    }
    if (input.replace && !input.write) {
      throw needs("replace", "write");
    }
    if (input.instructions) {
      return { guide: serverInstructions(ENTRIES) };
    }
    if (!input.skill) {
      return { guide: agentGuide(await readGuideFacts(ctx.workspace), input.names, ENTRIES) };
    }
    const guide = skillFile(ENTRIES);
    if (!input.write) {
      return { guide };
    }
    const places = await writeSkillFiles(ctx.workspace, ENTRIES, {
      replace: input.replace,
      localPaths: ctx.localPaths,
    });
    return { guide, places: writtenOrThrow(places) };
  },
});
