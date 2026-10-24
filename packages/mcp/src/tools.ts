// The MCP tools of the catalog (ADR-0009): one per command, `group_action`, with the schemas of the catalog.
// The same rewriting as scripts/contracts/generate.mjs, from the runtime catalog, so a test-only catalog gets
// its tools too; a test checks that the product catalog gives exactly schemas/generated/mcp-tools.json.
import type { CatalogEntry, CommandRuntime, Contracts, JsonSchema } from "@logreq/core";
import { SCHEMA_BASE } from "@logreq/core";

export interface McpToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: false;
  readonly openWorldHint: false;
}

/** A tool as in schemas/generated/mcp-tools.json: `$ref`s point into the shared `$defs`. */
export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly annotations: McpToolAnnotations;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
}

/** The tool list: shared definitions once (`#/$defs/<schema file>/...`) and the tools. */
export interface McpToolList {
  readonly $defs: Readonly<Record<string, JsonSchema>>;
  readonly tools: readonly McpTool[];
}

/** A tool as the server offers it: self-contained schemas, and the catalog command it calls. */
export interface ServerTool extends McpTool {
  readonly command: string;
}

/** `element.setStatus` is the tool `element_setStatus`. */
export const toolName = (command: string): string => command.replace(".", "_");

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const REF = /^(?:\.\.\/)?([a-z-]+\.schema\.json)?(?:#(.*))?$/;

const component = (file: string): string => file.replace(".schema.json", "");

/** `../common.schema.json#/$defs/uuid` (or `#/...` inside `file`) as `#/$defs/common/$defs/uuid`. */
const rewriteRef = (ref: string, file: string): string => {
  const match = REF.exec(ref);
  if (match === null) {
    throw new Error(`unsupported $ref ${ref}`);
  }
  return `#/$defs/${component(match[1] ?? file)}${match[2] ?? ""}`;
};

const rewrite = (node: unknown, file: string): unknown => {
  if (Array.isArray(node)) {
    return node.map((item) => rewrite(item, file));
  }
  if (!isRecord(node)) {
    return node;
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      key === "$ref" && typeof value === "string" ? rewriteRef(value, file) : rewrite(value, file),
    ]),
  );
};

/** The schema files of the contracts as `$defs`, keyed by file name without `.schema.json`. */
const definitions = (contracts: Contracts): Record<string, JsonSchema> =>
  Object.fromEntries(
    contracts.schemas.map((schema) => {
      const { $schema: _schema, $id, ...rest } = schema;
      const file = String($id).slice(SCHEMA_BASE.length);
      return [component(file), rewrite(rest, file) as JsonSchema];
    }),
  );

const tool = (entry: CatalogEntry): McpTool => ({
  name: toolName(entry.name),
  description: entry.summary,
  annotations: { readOnlyHint: entry.effect === "read", destructiveHint: false, openWorldHint: false },
  // Command schemas sit in schemas/commands/; their refs name the file, so the file here is a fallback only.
  inputSchema: rewrite(entry.input, "common.schema.json") as JsonSchema,
  outputSchema: rewrite(entry.output, "common.schema.json") as JsonSchema,
});

/** The tool list of a catalog, as `pnpm contracts:generate` writes it to schemas/generated/mcp-tools.json. */
export function catalogTools(contracts: Contracts): McpToolList {
  return { $defs: definitions(contracts), tools: contracts.commands.map(tool) };
}

/** Names of the `$defs` a schema refers to, directly or through other definitions. */
const usedDefinitions = (schema: unknown, defs: Readonly<Record<string, JsonSchema>>): string[] => {
  const used = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isRecord(node)) {
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const name =
        key === "$ref" && typeof value === "string" ? /^#\/\$defs\/([^/]+)/.exec(value)?.[1] : undefined;
      if (name !== undefined && !used.has(name)) {
        used.add(name);
        visit(defs[name]);
      }
      visit(value);
    }
  };
  visit(schema);
  return [...used].sort();
};

/** A schema with the `$defs` it needs, so a client can resolve every `$ref` (ADR-0009). */
const selfContained = (schema: JsonSchema, defs: Readonly<Record<string, JsonSchema>>): JsonSchema => {
  const used = usedDefinitions(schema, defs);
  return used.length === 0
    ? schema
    : { ...schema, $defs: Object.fromEntries(used.map((name) => [name, defs[name]])) };
};

/**
 * The tools the server offers: every catalog command, with self-contained schemas. Commands without an
 * implementation say so in their description, as in the CLI help; calling one gives `input.invalid`.
 */
export function serverTools(runtime: CommandRuntime): ServerTool[] {
  const defs = definitions(runtime.contracts);
  return runtime.contracts.commands.map((entry) => {
    const plain = tool(entry);
    return {
      ...plain,
      command: entry.name,
      description: runtime.commands.has(entry.name)
        ? plain.description
        : `${plain.description} (not implemented yet)`,
      inputSchema: selfContained(plain.inputSchema, defs),
      // `type: "object"` at the root comes from the catalog (catalog.meta.schema.json). Without it, the SDK
      // would wrap results as `{ result: ... }` for clients of the 2025 protocol revision (SR-080 AK2).
      outputSchema: selfContained(plain.outputSchema, defs),
    };
  });
}
