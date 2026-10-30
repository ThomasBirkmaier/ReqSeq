// One page per catalog command and an index of all of them (SR-139 AK1, AK4). Every text comes from the catalog
// and the adapters; internal references in it (SR, D, ADR, #nnn) are the tool's own text and stay as they are.
import type { CatalogEntry } from "@reqseq/core";
import type { CommandAccess } from "./access.js";
import { codeBlock, inline } from "./markdown.js";
import type { SchemaContext } from "./schema-fields.js";
import { fieldTable } from "./schema-fields.js";

/** The folder of the command pages below the content folder. */
export const COMMANDS_FOLDER = "reference/commands";

/**
 * The file name of a command's page, without `.md`, in the lower case of the site's URLs:
 * `element.setStatus` → `element-set-status`.
 */
export const commandSlug = (name: string): string =>
  name
    .replaceAll(".", "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();

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

/** The Markdown page of one command; `order` places it in the sidebar. */
export function commandPage(
  entry: CatalogEntry,
  access: CommandAccess,
  context: SchemaContext,
  order: number,
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
  const root = `${base.replace(/\/$/, "")}/${COMMANDS_FOLDER}`;
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
          `- [${inline(entry.title)}](${root}/${commandSlug(entry.name)}/): ${inline(entry.summary)}`,
      ),
    ]),
    "",
  ].join("\n");
}
