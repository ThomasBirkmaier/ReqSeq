// The generated reference (SR-139): the pages written next to the hand-written ones in the content folder.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { shortcutReference } from "@reqseq/app";
import type { CommandRuntime, JsonSchema } from "@reqseq/core";
import { COMMANDS_FOLDER, commandSlug } from "@reqseq/core/docs-site";
import type { GeneratedContracts } from "./access.js";
import { commandAccess } from "./access.js";
import type { ProblemCodes } from "./codes.js";
import { CODES_PAGE, codesPage } from "./codes.js";
import type { CommandExample } from "./command-examples.js";
import { WITHOUT_EXAMPLE } from "./command-examples.js";
import { commandIndex, commandPage } from "./command-page.js";
import type { Example } from "./formats.js";
import type { StandardModel } from "./standard-model.js";
import type { Schema, SchemaContext } from "./schema-fields.js";
import { forms, undescribedFields } from "./schema-fields.js";
import { STANDARD_MODEL_PAGE, standardModelPage } from "./standard-model.js";
import { SERVERS_PAGE, serversPage } from "./servers.js";
import { SHORTCUTS_PAGE, shortcutsPage } from "./shortcuts.js";
import {
  COMMON_TYPES_PAGE,
  FORMATS,
  FORMATS_FOLDER,
  checkFormats,
  commonTypesPage,
  formatPage,
  formatsIndex,
  schemaLink,
  schemaName,
} from "./formats.js";

/** A page of the content folder: its path relative to it, with `/`, and its Markdown. */
export interface Page {
  readonly path: string;
  readonly text: string;
}

/** `schemas/generated/openapi.json` and `mcp-tools.json` of the repository at `repoRoot`. */
export async function readGeneratedContracts(repoRoot: string): Promise<GeneratedContracts> {
  const read = async (file: string): Promise<unknown> =>
    JSON.parse(await readFile(join(repoRoot, "schemas", "generated", file), "utf8")) as unknown;
  return {
    openapi: (await read("openapi.json")) as GeneratedContracts["openapi"],
    mcpTools: (await read("mcp-tools.json")) as GeneratedContracts["mcpTools"],
  };
}

/**
 * The sources of the reference: the catalog (of `runtime`), the generated contracts, the code texts, the schemas
 * (`runtime.contracts.schemas` in a build), the examples of the formats, the standard model and the example of each
 * command (`commandExamples`).
 */
export interface ReferenceSources {
  readonly runtime: CommandRuntime;
  readonly generated: GeneratedContracts;
  readonly codes: ProblemCodes;
  readonly schemas: readonly JsonSchema[];
  readonly examples: Readonly<Record<string, readonly Example[]>>;
  readonly standardModel: StandardModel;
  readonly commandExamples: ReadonlyMap<string, CommandExample>;
}

/** Notes in `failures` the fields of the page at `path` without a description (`undescribedFields`), if any. */
function noteUndescribed(path: string, fields: readonly string[], failures: string[]): void {
  if (fields.length > 0) {
    failures.push(`${path}: fields without a description: ${fields.join(", ")}`);
  }
}

/** The fields without a description of each `$defs` entry of a schema, as `<definition>.<field>`. */
const undescribedDefinitions = (schema: JsonSchema, context: SchemaContext): string[] =>
  Object.entries((schema["$defs"] ?? {}) as Readonly<Record<string, Schema>>).flatMap(
    ([name, definition]) => [
      ...undescribedFields(definition, context, name),
      ...forms(definition).flatMap((form) => undescribedFields(form.schema, context, name)),
    ],
  );

/** The format pages, their index and the page of the common types. */
function formatPages(
  schemas: readonly JsonSchema[],
  examples: ReferenceSources["examples"],
  base: string,
  failures: string[],
): Page[] {
  checkFormats(schemas);
  const link = schemaLink(base);
  const contextOf = (
    schema: JsonSchema,
  ): { schemas: readonly JsonSchema[]; base: string; link: typeof link } => ({
    schemas,
    base: String(schema["$id"]),
    link,
  });
  const named = (name: string): JsonSchema[] => schemas.filter((schema) => schemaName(schema) === name);
  return [
    { path: `${FORMATS_FOLDER}/index.md`, text: formatsIndex(schemas, base) },
    ...named("common").map((common) => {
      const path = `${COMMON_TYPES_PAGE}.md`;
      noteUndescribed(path, undescribedDefinitions(common, contextOf(common)), failures);
      return { path, text: commonTypesPage(common, contextOf(common)) };
    }),
    ...FORMATS.flatMap((name, index) =>
      named(name).map((schema) => {
        const path = `${FORMATS_FOLDER}/${name}.md`;
        const context = contextOf(schema);
        noteUndescribed(
          path,
          [...undescribedFields(schema, context, "fields"), ...undescribedDefinitions(schema, context)],
          failures,
        );
        return { path, text: formatPage(schema, examples[name] ?? [], context, index + 1) };
      }),
    ),
  ];
}

/**
 * The command index and pages (catalog order), the page of the server commands after them, the codes page, the format
 * pages, the standard model page and the page of the app's keyboard shortcuts. Throws naming every page and field
 * without a description, by its table (`input.`, `output.`, `fields.` or the definition), the way a failing example
 * stops the build.
 */
export async function referencePages(
  { runtime, generated, codes, schemas, examples, standardModel, commandExamples }: ReferenceSources,
  base: string,
): Promise<Page[]> {
  const entries = runtime.contracts.commands;
  const context = { schemas, link: schemaLink(base) };
  const failures: string[] = [];
  const pages: Page[] = [
    { path: `${COMMANDS_FOLDER}/index.md`, text: commandIndex(entries, base) },
    { path: CODES_PAGE, text: codesPage(codes) },
    ...formatPages(schemas, examples, base, failures),
    { path: STANDARD_MODEL_PAGE, text: standardModelPage(standardModel) },
    { path: SHORTCUTS_PAGE, text: shortcutsPage(shortcutReference(entries)) },
  ];
  for (const [index, entry] of entries.entries()) {
    const access = await commandAccess(entry, runtime, generated);
    const path = `${COMMANDS_FOLDER}/${commandSlug(entry.name)}.md`;
    noteUndescribed(
      path,
      [
        ...undescribedFields(entry.input, context, "input"),
        ...undescribedFields(entry.output, context, "output"),
      ],
      failures,
    );
    pages.push({
      path,
      text: commandPage(
        entry,
        access,
        context,
        index + 1,
        commandExamples.get(entry.name) ?? WITHOUT_EXAMPLE[entry.name],
      ),
    });
  }
  if (failures.length > 0) {
    throw new Error(`docs: reference pages\n${failures.join("\n")}`);
  }
  pages.push({ path: SERVERS_PAGE, text: await serversPage(runtime, base, entries.length + 1) });
  return pages;
}
