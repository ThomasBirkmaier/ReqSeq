// One page per catalog command and an index of all of them (SR-139 AK1, AK4). Every text comes from the catalog
// and the adapters; internal references in it (SR, D, ADR, #nnn) are the tool's own text and stay as they are.
import type { CatalogEntry } from "@reqseq/core";
import { commandPagePath } from "@reqseq/core/docs-site";
import type { CommandAccess } from "./access.js";
import type { CommandExample } from "./command-examples.js";
import { codeBlock, inline } from "./markdown.js";
import type { SchemaContext } from "./schema-fields.js";
import { fieldTable } from "./schema-fields.js";

const behaviour = (entry: CatalogEntry): string => {
  if (entry.effect === "read") {
    return "Reads the workspace and changes no file.";
  }
  const reason = entry.whileReadOnlyReason === undefined ? "" : ` ${inline(entry.whileReadOnlyReason)}`;
  const readOnly =
    entry.whileReadOnly === "allow"
      ? "It also runs while the workspace is read-only."
      : "It is refused while the workspace is read-only.";
  return `Writes files in the working tree, never to Git. ${readOnly}${reason}`;
};

const withKey = (key: string | undefined, keyMac: string | undefined): string =>
  key === undefined || keyMac === undefined ? "" : ` Key: ${key} (macOS ${keyMac}).`;

const appSection = (access: CommandAccess): string => {
  if (!access.implemented) {
    return "Not offered by the app yet: this version does not implement the command.";
  }
  const prompt = `In the command prompt (${access.promptKey}, macOS ${access.promptKeyMac})`;
  const what = access.app.action ? "the action" : "the command";
  return `${prompt}: ${what} **${inline(access.app.name)}**.${withKey(access.app.key, access.appMac.key)}`;
};

/** Outputs longer than this many lines are folded, so the call sections stay close. */
export const FOLDED_OUTPUT_LINES = 40;

/** The example: its input, the same call on the command line and its output, or why the command has none. */
const exampleSection = (example: CommandExample | string | undefined): string => {
  if (typeof example !== "object") {
    return example === undefined ? "No example." : `No example: ${inline(example)}`;
  }
  const lines = example.output.split("\n").length;
  const output = codeBlock(example.output, "json");
  return [
    "Run in the folder of the weather station, a small example workspace, when this page was built. The input:",
    "",
    codeBlock(JSON.stringify(example.input, null, 2), "json"),
    "",
    "The same call on the command line:",
    "",
    codeBlock(example.cli, "sh"),
    "",
    lines > FOLDED_OUTPUT_LINES
      ? `<details>\n<summary>The output (${String(lines)} lines)</summary>\n\n${output}\n\n</details>`
      : `The output:\n\n${output}`,
    "",
    "The folder of the workspace, the time of the run and new UUIDs are shown as fixed values.",
  ].join("\n");
};

/** The Markdown page of one command; `order` places it in the sidebar. */
export function commandPage(
  entry: CatalogEntry,
  access: CommandAccess,
  context: SchemaContext,
  order: number,
  example?: CommandExample | string,
): string {
  const notYet = access.implemented ? [] : ["This version does not implement the command yet.", ""];
  return [
    "---",
    `title: ${JSON.stringify(entry.title)}`,
    `description: ${JSON.stringify(entry.summary)}`,
    "sidebar:",
    `  order: ${String(order)}`,
    "---",
    "",
    inline(entry.summary),
    "",
    `Command \`${entry.name}\`. ${behaviour(entry)}`,
    "",
    ...notYet,
    "## Input",
    "",
    fieldTable(entry.input, context, "No input."),
    "",
    "## Output",
    "",
    fieldTable(entry.output, context, "No output fields."),
    "",
    "## Example",
    "",
    exampleSection(example),
    "",
    "## App",
    "",
    appSection(access),
    "",
    "## CLI",
    "",
    `\`${access.cliCall}\`, with \`--json\` for the output as JSON. Its help:`,
    "",
    codeBlock(access.cliHelp),
    "",
    "## API",
    "",
    `\`${access.apiCall}\` on the local API (\`reqseq serve api\`), with the input as the JSON body; the answer is the output.`,
    "",
    "## MCP",
    "",
    `Tool \`${access.mcpTool}\` of the MCP server (\`reqseq mcp\`), with the input as its arguments.`,
    "",
  ].join("\n");
}

/** The index of all commands, by catalog group in catalog order; links start with the site's `base`. */
export function commandIndex(entries: readonly CatalogEntry[], base: string): string {
  const groups = new Map<string, CatalogEntry[]>();
  for (const entry of entries) {
    const group = entry.name.slice(0, entry.name.indexOf("."));
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }
  const root = base.replace(/\/$/, "");
  return [
    "---",
    "title: Commands",
    "description: Every command of ReqSeq with its call in the app, the command line, the API and MCP.",
    "sidebar:",
    "  order: 0",
    "---",
    "",
    "Every command of ReqSeq, grouped as in its catalog. Each page shows the input, the output and the call in the app, the command line, the API and MCP.",
    "",
    `What the codes of problems and errors mean, and what to do about them: [Problem and error codes](${base.replace(/\/$/, "")}/reference/problem-codes/).`,
    ...[...groups].flatMap(([group, members]) => [
      "",
      `## ${group}`,
      "",
      ...members.map(
        (entry) =>
          `- [${inline(entry.title)}](${root}/${commandPagePath(entry.name)}): ${inline(entry.summary)}`,
      ),
    ]),
    "",
  ].join("\n");
}
