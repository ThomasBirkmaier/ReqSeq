// The file formats (SR-139 AK3, SR-009 AK1): one page per schema of a file a user reads or writes, rendered from the
// schema with its examples from schemas/examples/<format>/, and the shared definitions of common.schema.json.
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import type { JsonSchema } from "@reqseq/core";
import { codeBlock, inline } from "./markdown.js";
import type { Schema, SchemaContext } from "./schema-fields.js";
import { fieldRows, fieldTable, typeText } from "./schema-fields.js";

/** The folder of the format pages below the content folder, and the page of the shared definitions. */
export const FORMATS_FOLDER = "reference/formats";
export const COMMON_TYPES_PAGE = "reference/common-types";

/** The documented formats, by schema file name without `.schema.json`, in the order of the sidebar. */
export const FORMATS: readonly string[] = [
  "workspace",
  "workspace-local",
  "element",
  "metamodel",
  "evidence-record",
  "baseline",
  "filter",
  "reqif-mapping",
  "data-export",
  "api-endpoint",
];

/** Files ReqSeq keeps for itself in its cache folder: listed, not documented. */
export const INTERNAL_FORMATS: readonly string[] = ["activity", "recent-workspaces"];

const COMMON = "common";

/** An example file of a format. */
export interface Example {
  readonly file: string;
  readonly text: string;
}

/** The name of a schema: its file name without `.schema.json`. */
export const schemaName = (schema: JsonSchema): string =>
  String(schema["$id"])
    .replace(/^.*\//, "")
    .replace(/\.schema\.json$/, "");

/** Fails when a schema is neither documented nor listed as internal, so no format is left out silently. */
export function checkFormats(schemas: readonly JsonSchema[]): void {
  const known = new Set([...FORMATS, ...INTERNAL_FORMATS, COMMON]);
  const unknown = schemas.map(schemaName).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `Schemas neither documented nor internal (packages/docs/src/formats.ts): ${unknown.join(", ")}`,
    );
  }
}

/** Links to where the reference documents the type at a schema URL; none for internal formats. */
export const schemaLink =
  (base: string) =>
  (url: URL): string | undefined => {
    const name = url.pathname.replace(/^.*\//, "").replace(/\.schema\.json$/, "");
    const page =
      name === COMMON ? COMMON_TYPES_PAGE : FORMATS.includes(name) ? `${FORMATS_FOLDER}/${name}` : undefined;
    const definition = /^#\/\$defs\/([^/]+)$/.exec(url.hash)?.[1];
    return page === undefined
      ? undefined
      : `${base.replace(/\/$/, "")}/${page}/${definition === undefined ? "" : `#${definition}`}`;
  };

/** A missing folder has no files; any other error of reading it stands. */
const missingAsEmpty = (error: unknown): [] => {
  if ((error as NodeJS.ErrnoException).code === "ENOENT") {
    return [];
  }
  throw error;
};

/** The example files of every documented format, from `schemas/examples/<format>/` of the repository. */
export async function readExamples(repoRoot: string): Promise<Readonly<Record<string, readonly Example[]>>> {
  const entries = await Promise.all(
    FORMATS.map(async (name): Promise<[string, Example[]]> => {
      const folder = join(repoRoot, "schemas", "examples", name);
      const files = (await readdir(folder, { withFileTypes: true }).catch(missingAsEmpty))
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .sort();
      return [
        name,
        await Promise.all(
          files.map(async (file) => ({ file, text: await readFile(join(folder, file), "utf8") })),
        ),
      ];
    }),
  );
  return Object.fromEntries(entries);
}

const LANGUAGES: Readonly<Record<string, string>> = { ".md": "markdown", ".json": "json" };

const description = (schema: Schema): string =>
  typeof schema["description"] === "string" ? inline(schema["description"]) : "";

/** The id the site gives a heading of `name` (github-slugger: lower case, punctuation dropped, blanks to `-`). */
export const headingSlug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_ -]/gu, "")
    .replace(/ /g, "-");

/** The `$defs` of a schema, each with an anchor of its name (the heading's own id when that equals it), so a `$ref` can link to it. */
function definitions(schema: Schema, context: SchemaContext): string[] {
  const defs = (schema["$defs"] ?? {}) as Readonly<Record<string, Schema>>;
  return Object.entries(defs).flatMap(([name, definition]) => [
    ...(headingSlug(name) === name ? [] : [`<a id="${name}"></a>`, ""]),
    `### \`${name}\``,
    "",
    ...[description(definition), `Type: ${typeText(definition, context)}.`]
      .filter((line) => line !== "")
      .flatMap((line) => [line, ""]),
    ...(fieldRows(definition, context).length === 0 ? [] : [fieldTable(definition, context, ""), ""]),
  ]);
}

const frontmatter = (title: string, text: string, order: number): string[] => [
  "---",
  `title: ${JSON.stringify(title)}`,
  `description: ${JSON.stringify(text)}`,
  "sidebar:",
  `  order: ${String(order)}`,
  "---",
  "",
];

/** The page of one format: its fields, its definitions and its examples. */
export function formatPage(
  schema: JsonSchema,
  examples: readonly Example[],
  context: SchemaContext,
  order: number,
): string {
  const title = typeof schema["title"] === "string" ? schema["title"] : schemaName(schema);
  const defs = definitions(schema, context);
  return [
    ...frontmatter(title, `The file format ${title} of ReqSeq.`, order),
    description(schema),
    "",
    "## Fields",
    "",
    fieldTable(schema, context, `Type: ${typeText(schema, context)}.`),
    "",
    ...(defs.length === 0 ? [] : ["## Definitions", "", ...defs]),
    ...(examples.length === 0 ? [] : ["## Examples", ""]),
    ...examples.flatMap((example) => [
      `### \`${example.file}\``,
      "",
      codeBlock(example.text, LANGUAGES[extname(example.file)] ?? "yaml"),
      "",
    ]),
  ].join("\n");
}

/** The page of the definitions of common.schema.json that formats and commands share. */
export function commonTypesPage(schema: JsonSchema, context: SchemaContext): string {
  return [
    ...frontmatter("Common types", "The types that the file formats and commands of ReqSeq share.", 0),
    description(schema),
    "",
    ...definitions(schema, context),
  ].join("\n");
}

/** The index of the formats, with the internal files listed at the end. */
export function formatsIndex(schemas: readonly JsonSchema[], base: string): string {
  const titled = (name: string): string => {
    const schema = schemas.find((candidate) => schemaName(candidate) === name);
    return typeof schema?.["title"] === "string" ? schema["title"] : name;
  };
  const root = `${base.replace(/\/$/, "")}/${FORMATS_FOLDER}`;
  return [
    ...frontmatter("File formats", "Every file format of ReqSeq.", 0),
    "The files of a workspace are plain text: YAML, Markdown with YAML frontmatter, and JSON. Each page lists the fields of one format, its types and examples.",
    "",
    ...FORMATS.map((name) => `- [${inline(titled(name))}](${root}/${name}/)`),
    "",
    `ReqSeq also keeps files for itself in its cache folder, which are not meant to be read or changed: ${INTERNAL_FORMATS.map((name) => `${inline(titled(name))} (\`${name}\`)`).join(", ")}.`,
    "",
  ].join("\n");
}
