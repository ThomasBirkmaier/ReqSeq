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
  /** The title of the catalog entry: the name for people (MCP `Tool.title`). */
  readonly title: string;
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

/**
 * A tool as the server lists it: a self-contained input schema, and the catalog command it calls. No output
 * schema: MCP does not require one for structured content, and the output schemas were four fifths of the
 * list (#303). schemas/generated/mcp-tools.json keeps them as the contract.
 */
export interface ServerTool extends Omit<McpTool, "outputSchema"> {
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

/** `node` with every `$ref` string replaced by `to(ref)`. */
const mapRefs = (node: unknown, to: (ref: string) => string): unknown => {
  if (Array.isArray(node)) {
    return node.map((item) => mapRefs(item, to));
  }
  if (!isRecord(node)) {
    return node;
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [
      key,
      key === "$ref" && typeof value === "string" ? to(value) : mapRefs(value, to),
    ]),
  );
};

const rewrite = (node: unknown, file: string): unknown => mapRefs(node, (ref) => rewriteRef(ref, file));

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
  title: entry.title,
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

/** `#/$defs/common/$defs/uuid` as the flat `#/$defs/common.uuid`; `#/$defs/data-export` stays as it is. */
const flatRef = (ref: string): string => ref.replace(/^#\/\$defs\/([^/]+)\/\$defs\//, "#/$defs/$1.");

const flat = (node: unknown): JsonSchema => mapRefs(node, flatRef) as JsonSchema;

/**
 * The shared definitions one by one, flat: `common.uuid` for a definition of a file, `data-export` for a
 * whole file (without its `$defs`, which are entries of their own). So a tool schema carries only the
 * definitions it reaches, not whole files (#303), in the `#/$defs/<name>` form that clients resolve best.
 */
const flatDefinitions = (contracts: Contracts): Record<string, JsonSchema> => {
  const flatDefs: Record<string, JsonSchema> = {};
  for (const [file, { $defs: nested, ...root }] of Object.entries(definitions(contracts))) {
    flatDefs[file] = flat(root);
    for (const [name, schema] of Object.entries(isRecord(nested) ? nested : {})) {
      flatDefs[`${file}.${name}`] = flat(schema);
    }
  }
  return flatDefs;
};

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
 * The tools the server lists: the implemented catalog commands, with self-contained input schemas that
 * carry only the definitions they use. Commands without an implementation are not listed; a call to one still reaches
 * `invoke` and gives `command.not-implemented`, as on every access (server.ts).
 */
export function serverTools(runtime: CommandRuntime): ServerTool[] {
  const defs = flatDefinitions(runtime.contracts);
  return runtime.contracts.commands
    .filter((entry) => runtime.commands.has(entry.name))
    .map((entry) => {
      const { outputSchema: _output, ...plain } = tool(entry);
      return { ...plain, command: entry.name, inputSchema: selfContained(flat(plain.inputSchema), defs) };
    });
}
