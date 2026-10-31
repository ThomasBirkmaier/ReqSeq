// The generated reference (SR-139): the pages written next to the hand-written ones in the content folder.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { shortcutReference } from "@reqseq/app";
import type { CommandRuntime, JsonSchema } from "@reqseq/core";
import type { GeneratedContracts } from "./access.js";
import { commandAccess } from "./access.js";
import type { ProblemCodes } from "./codes.js";
import { CODES_PAGE, codesPage } from "./codes.js";
import { COMMANDS_FOLDER, commandIndex, commandPage, commandSlug } from "./command-page.js";
import type { Example } from "./formats.js";
import type { StandardModel } from "./standard-model.js";
import { STANDARD_MODEL_PAGE, standardModelPage } from "./standard-model.js";
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
 * (`runtime.contracts.schemas` in a build), the examples of the formats and the standard model.
 */
export interface ReferenceSources {
  readonly runtime: CommandRuntime;
  readonly generated: GeneratedContracts;
  readonly codes: ProblemCodes;
  readonly schemas: readonly JsonSchema[];
  readonly examples: Readonly<Record<string, readonly Example[]>>;
  readonly standardModel: StandardModel;
}

/** The format pages, their index and the page of the common types. */
function formatPages(
  schemas: readonly JsonSchema[],
  examples: ReferenceSources["examples"],
  base: string,
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
    ...named("common").map((common) => ({
      path: `${COMMON_TYPES_PAGE}.md`,
      text: commonTypesPage(common, contextOf(common)),
    })),
    ...FORMATS.flatMap((name, index) =>
      named(name).map((schema) => ({
        path: `${FORMATS_FOLDER}/${name}.md`,
        text: formatPage(schema, examples[name] ?? [], contextOf(schema), index + 1),
      })),
    ),
  ];
}

/**
 * The command index and pages (catalog order), the codes page, the format pages, the standard model page and the
 * page of the app's keyboard shortcuts.
 */
export async function referencePages(
  { runtime, generated, codes, schemas, examples, standardModel }: ReferenceSources,
  base: string,
): Promise<Page[]> {
  const entries = runtime.contracts.commands;
  const context = { schemas, link: schemaLink(base) };
  const pages: Page[] = [
    { path: `${COMMANDS_FOLDER}/index.md`, text: commandIndex(entries, base) },
    { path: CODES_PAGE, text: codesPage(codes) },
    ...formatPages(schemas, examples, base),
    { path: STANDARD_MODEL_PAGE, text: standardModelPage(standardModel) },
    { path: SHORTCUTS_PAGE, text: shortcutsPage(shortcutReference(entries)) },
  ];
  for (const [index, entry] of entries.entries()) {
    const access = await commandAccess(entry, runtime, generated);
    pages.push({
      path: `${COMMANDS_FOLDER}/${commandSlug(entry.name)}.md`,
      text: commandPage(entry, access, context, index + 1),
    });
  }
  return pages;
}
