// The fast reader of baseline files in the layout ReqSeq writes (ADR-0018 "Reading", N-036). YAML
// takes about 2 s for a baseline of 50,000 elements, so a file in that layout is read in parts:
//
// - The header, the lines before the line `repositories:`, is parsed with YAML and must hold the
//   keys `reqseq-baseline`, `name`, `date` and optionally `selection`, in this order, each valid
//   against its part of baseline.schema.json, without YAML warnings (`baselineHeader`). Its
//   `selection.ids` lines (`  ids:` below `selection:`) are taken out first and read line by line,
//   so a selection of 50,000 IDs is not parsed with YAML either.
// - `repositories` and `elements` are read line by line, one anchored pattern per line that checks
//   what the schema checks for an entry; entries ordered by `id`, then `repository`, each once.
//
// Anything else (a comment, a blank line, another layout, CRLF, a value YAML would read as no
// string) gives undefined: the caller then parses the whole file with YAML and the schema, which
// gives the same data or the problems with their lines. read.test.ts reads files both ways.
import { parseYamlFileBytes } from "../files/index.js";
import type { BaselineFile } from "../generated/types.js";
import { fileSchemaValidator } from "../runtime/contracts.js";

/** What a baseline file holds before its `repositories`. */
export type BaselineHeader = Omit<BaselineFile, "repositories" | "elements">;

/** The schema patterns the line patterns are made of (read.test.ts compares them with the schemas). */
export const SCAN_PATTERNS = {
  uuid: "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}",
  version: "n[1-9][0-9]*:[0-9a-f]{16}",
  commit: "[0-9a-f]{40}([0-9a-f]{24})?",
  /** A repository name as a plain YAML scalar (workspace.schema.json `repository.name`). */
  name: "[a-z0-9][a-z0-9._-]*",
} as const;
const { uuid: UUID, version: VERSION, commit: COMMIT, name: NAME } = SCAN_PATTERNS;

/** The header keys in the order ReqSeq writes them; `selection` may be left out. */
const HEADER_KEYS = ["reqseq-baseline", "name", "date", "selection"] as const;

/** The line that ends the header. */
const REPOSITORIES = "\nrepositories:\n";

const REPOSITORY_LINE = new RegExp(`^  - \\{ name: (${NAME}), commit: (${COMMIT}) \\}$`);
const ELEMENT_LINE = new RegExp(
  `^  - \\{ id: (${UUID}), version: (${VERSION})(?:, repository: (${NAME}))? \\}$`,
);
const ID_LINE = new RegExp(`^    - (?:(${UUID})|\\{ id: (${UUID}), repository: (${NAME}) \\})$`);

/** Plain scalars that YAML 1.2 (core schema) reads as no string: booleans, null, numbers. */
const NOT_A_STRING = /^(?:true|false|null|[0-9]+(?:\.[0-9]*)?(?:e[-+]?[0-9]+)?|0o[0-7]+|0x[0-9a-f]+)$/;

const encoder = new TextEncoder();

type StoredId = NonNullable<NonNullable<BaselineHeader["selection"]>["ids"]>[number];

/**
 * The header text with its `selection.ids` lines replaced by `  ids: []`, and the items they hold;
 * the text as it is when it has no such lines in the layout ReqSeq writes.
 */
const takeIds = (header: string): { readonly yaml: string; readonly ids?: StoredId[] } => {
  const at = header.indexOf("\n  ids:\n");
  const selection = header.indexOf("\nselection:\n");
  if (at < 0 || selection < 0 || at < selection) {
    return { yaml: header };
  }
  const lines = header.slice(at + "\n  ids:\n".length).split("\n");
  const ids: StoredId[] = [];
  for (const line of lines) {
    const match = ID_LINE.exec(line);
    if (match === null) {
      break;
    }
    const repository = match[3];
    if (repository !== undefined && NOT_A_STRING.test(repository)) {
      return { yaml: header };
    }
    ids.push(repository === undefined ? String(match[1]) : { id: String(match[2]), repository });
  }
  // The header ends with LF, so a line follows the items; a deeper one is an item in another form.
  return ids.length === 0 || String(lines[ids.length]).startsWith("    ")
    ? { yaml: header }
    : { yaml: `${header.slice(0, at + 1)}  ids: []\n${lines.slice(ids.length).join("\n")}`, ids };
};

/** The header of `text`, which ends at `end` (the index of `REPOSITORIES`), or undefined. */
const headerBefore = (text: string, end: number): BaselineHeader | undefined => {
  const { yaml, ids } = takeIds(text.slice(0, end + 1));
  const parsed = parseYamlFileBytes("baseline.yaml", encoder.encode(yaml));
  if (parsed.kind === "problem" || parsed.content.warnings.length > 0) {
    return undefined;
  }
  const data: unknown = parsed.content.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return undefined;
  }
  const keys = Object.keys(data);
  const valid =
    (keys.length === 3 || keys.length === 4) &&
    keys.every((key, at) => key === HEADER_KEYS[at]) &&
    Object.entries(data).every(([key, value]) =>
      fileSchemaValidator(`baseline.schema.json#/properties/${key}`)(value),
    );
  if (!valid) {
    return undefined;
  }
  const header = data as BaselineHeader;
  return ids === undefined ? header : { ...header, selection: { ...header.selection, ids } };
};

/** The header of the baseline text `text` (the lines before `repositories:`), or undefined (see the file comment). */
export const baselineHeader = (text: string): BaselineHeader | undefined => {
  const end = text.indexOf(REPOSITORIES);
  return end < 0 ? undefined : headerBefore(text, end);
};

type Repository = BaselineFile["repositories"][number];
type Entry = BaselineFile["elements"][number];

/** The `repositories` lines at the start of `lines`, or undefined when one holds no string YAML would read. */
const scanRepositories = (lines: readonly string[]): Repository[] | undefined => {
  const repositories: Repository[] = [];
  for (const line of lines) {
    const match = REPOSITORY_LINE.exec(line);
    if (match === null) {
      break;
    }
    const name = String(match[1]);
    const commit = String(match[2]);
    if (NOT_A_STRING.test(name) || NOT_A_STRING.test(commit)) {
      return undefined;
    }
    repositories.push({ name, commit });
  }
  return repositories;
};

/** The `elements` entries of `lines`, each line one, in order and each once; else undefined. */
const scanElements = (lines: readonly string[]): Entry[] | undefined => {
  const elements: Entry[] = [];
  let previous = "";
  for (const line of lines) {
    const match = ELEMENT_LINE.exec(line);
    if (match === null) {
      return undefined;
    }
    const id = String(match[1]);
    const version = String(match[2]);
    const repository = match[3];
    const key = `${id}\n${repository ?? ""}`;
    if (key <= previous || (repository !== undefined && NOT_A_STRING.test(repository))) {
      return undefined;
    }
    previous = key;
    elements.push(repository === undefined ? { id, version } : { id, version, repository });
  }
  return elements;
};

/** The baseline the text `text` holds, or undefined when it is not in the layout ReqSeq writes (see the file comment). */
export const scanBaseline = (text: string): BaselineFile | undefined => {
  const end = text.indexOf(REPOSITORIES);
  const header = end < 0 ? undefined : headerBefore(text, end);
  if (header === undefined) {
    return undefined;
  }
  const lines = text.slice(end + REPOSITORIES.length).split("\n");
  const repositories = lines.pop() === "" ? scanRepositories(lines) : undefined;
  if (repositories === undefined || repositories.length === 0) {
    return undefined;
  }
  const rest = lines.slice(repositories.length);
  const elements =
    rest.length === 1 && rest[0] === "elements: []"
      ? []
      : rest.length > 1 && rest[0] === "elements:"
        ? scanElements(rest.slice(1))
        : undefined;
  return elements === undefined ? undefined : { ...header, repositories, elements };
};
