// Short instructions for an AI agent (#303): what ReqSeq is, which commands to start with, how elements and
// hints are named. The MCP server sends them in its `initialize` result; they are built here, from the catalog
// and the schema descriptions, so the adapter adds no text or logic of its own (ADR-0002).
import type { JsonSchema } from "../catalog.js";
import type { CommandRuntime } from "./invoke.js";
import { SCHEMA_BASE } from "./contracts.js";

/** The commands an agent starts with (in catalog order); only the implemented ones are named. */
export const FIRST_COMMANDS: readonly string[] = [
  "workspace.status",
  "metamodel.get",
  "element.get",
  "element.resolve",
  "hint.list",
];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `text` without its references to decisions and requirements ("(D-017, SR-002 AK3)"). */
const withoutSpecRefs = (text: string): string => text.replace(/ \((?:D|SR|N)-\d{3}[^)]*\)/g, "");

/**
 * The `description` at `path` in the schema file `file` (e.g. `common.schema.json`), without its references
 * to decisions and requirements ("(D-017, SR-002 AK3)"), which mean nothing to an agent. Throws when the
 * schemas have none there: the instructions would silently lose a sentence.
 */
export const schemaDescription = (
  schemas: readonly JsonSchema[],
  file: string,
  path: readonly string[],
): string => {
  let node: unknown = schemas.find((schema) => schema["$id"] === `${SCHEMA_BASE}${file}`);
  for (const key of path) {
    node = isRecord(node) ? node[key] : undefined;
  }
  const description = isRecord(node) ? node["description"] : undefined;
  if (typeof description !== "string") {
    throw new Error(`no description at ${file}#/${path.join("/")}`);
  }
  return withoutSpecRefs(description);
};

/**
 * The instructions for an agent, with each command named by `nameOf` (the MCP tool name, `group_action`).
 * Commands that the runtime does not implement are left out.
 */
export function agentInstructions(
  runtime: CommandRuntime,
  nameOf: (command: string) => string = (command) => command,
): string {
  const implemented = (name: string): boolean => runtime.commands.has(name);
  const schemas = runtime.contracts.schemas;
  const common = (...path: string[]): string => schemaDescription(schemas, "common.schema.json", path);
  const first = runtime.contracts.commands
    .filter((entry) => FIRST_COMMANDS.includes(entry.name) && implemented(entry.name))
    .map((entry) => `- ${nameOf(entry.name)}: ${entry.summary}`);
  // How hints are confirmed is the catalog summary of hint.confirm, so the text follows the catalog.
  const hints = runtime.contracts.commands
    .filter((entry) => entry.name === "hint.confirm" && ["hint.list", entry.name].every(implemented))
    .map(
      (entry) =>
        `- \`hintId\`: ${nameOf("hint.list")} gives each confirmable hint a stable ID. ${nameOf(entry.name)}: ${withoutSpecRefs(entry.summary)}`,
    );
  return [
    "ReqSeq keeps requirements, their relations and evidence as Markdown files in Git working copies. Each tool runs one ReqSeq command on the workspace this server was started for; the CLI and the local API offer the same commands with the same results.",
    ...(first.length === 0 ? [] : ["", "Start with:", ...first]),
    "",
    "IDs:",
    `- \`ref\`: ${common("$defs", "elementRef")}`,
    `- \`shortId\`: ${common("$defs", "shortId")}`,
    `- \`id\`: ${common("$defs", "uuid")}`,
    ...hints,
    `- local paths: ${common("$defs", "localPath")}`,
    "",
    "Read-only tools carry readOnlyHint. Write tools change only ReqSeq files in the working tree, never Git; no tool deletes an element.",
    `Only ${nameOf("element.setStatus")} and ${nameOf("element.supersede")} change a status, and only on explicit request; no other tool changes one.`,
    "A failed call is a tool error whose text is a JSON object with `code` and `message`; findings are not errors but `problems` in the result.",
  ].join("\n");
}
