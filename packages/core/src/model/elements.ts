// Which parsed Markdown files are elements (ADR-0004, SR-003 AK2, spec question #145 option 1):
// those whose frontmatter is a mapping with `id` and `type`. Every other file is not an element; it
// is never written. A type the metamodel does not know still makes an element (SR-016 AK3).
import { isNode } from "yaml";
import type { Problem } from "../catalog.js";
import type { FileSnapshot, LineEnding, ParsedFile } from "../files/index.js";
import { fileSchemaValidator } from "../runtime/contracts.js";

/**
 * One element file as read from the working tree. Plain data and small (ADR-0008): neither the YAML
 * `Document` nor the raw frontmatter and Markdown text are kept; read the file again with
 * `readElementFile` for the text or for an edit (the write checks `snapshot` anyway).
 */
export interface ElementRecord {
  /** The UUID (D-017). */
  readonly id: string;
  /** The type key as written; it may be unknown to the metamodel (SR-016 AK3). */
  readonly type: string;
  /** Workspace name of the repository the file lies in. */
  readonly repository: string;
  /** Relative to the repository, `/` as separator. The folder is free (SR-003, D-056). */
  readonly file: string;
  /** The frontmatter as plain data (YAML 1.2 core schema). */
  readonly data: Readonly<Record<string, unknown>>;
  /** Line endings and byte order mark of the file (ADR-0007). */
  readonly eol: LineEnding;
  readonly closingEol: LineEnding | "";
  readonly bom: boolean;
  /** Pass to `writeFileAtomic`; the write is refused when the file changed since (SR-008 AK3). */
  readonly snapshot: FileSnapshot;
}

/**
 * The elements a reference names: one, none, or several (files that share a UUID, SR-088). The
 * function that returns it sets the order of `elements`.
 */
export type ElementMatch =
  | { readonly kind: "found"; readonly element: ElementRecord }
  | { readonly kind: "unknown" }
  | { readonly kind: "ambiguous"; readonly elements: readonly ElementRecord[] };

export type Classified =
  | { readonly kind: "element"; readonly element: ElementRecord }
  /** Not an element: no frontmatter mapping with `id` and `type` (SR-003 AK2). */
  | { readonly kind: "not-element" }
  /** Has `id` and `type`, but they are not valid; reported and not loaded. */
  | { readonly kind: "problem"; readonly problem: Problem };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A UUID as LogReq writes it: version 4, lower case (`common.schema.json#/$defs/uuid`, D-017). */
export const isUuid = (value: unknown): value is string =>
  fileSchemaValidator("common.schema.json#/$defs/uuid")(value);

/** The keys every element has (D-012): fields of their own, never properties. */
export const STRUCTURAL_KEYS: readonly string[] = ["id", "type", "status"];

/**
 * The line in the file of the value at `path` (a top-level key, then list indexes or keys; line 1
 * is the opening `---`): the first line of a block value. Undefined when the document cannot find
 * it by name, for example a key written as an alias (`*k : ...`).
 */
export const lineOf = (file: ParsedFile, path: readonly (string | number)[]): number | undefined => {
  const node: unknown = file.document.getIn(path, true);
  const range = isNode(node) ? node.range : undefined;
  if (!range) {
    return undefined;
  }
  return file.frontmatter.slice(0, range[0]).split("\n").length + 1;
};

const invalid = (repository: string, file: ParsedFile, key: string, message: string): Classified => {
  const line = lineOf(file, [key]);
  return {
    kind: "problem",
    problem: {
      code: "element.invalid",
      severity: "error",
      repository,
      file: file.path,
      ...(line === undefined ? {} : { line }),
      message: `${message}; the file is not read as an element`,
    },
  };
};

/** Decides whether a parsed file of `repository` is an element. */
export const classifyFile = (repository: string, file: ParsedFile): Classified => {
  const data = file.data;
  if (!isRecord(data) || !Object.hasOwn(data, "id") || !Object.hasOwn(data, "type")) {
    return { kind: "not-element" };
  }
  const { id, type } = data;
  if (!isUuid(id)) {
    return invalid(repository, file, "id", "id must be a UUID version 4 in lower case");
  }
  if (typeof type !== "string" || type === "") {
    return invalid(repository, file, "type", "type must be a type key");
  }
  const { eol, closingEol, bom, snapshot } = file;
  return {
    kind: "element",
    element: {
      id,
      type,
      repository,
      file: file.path,
      data,
      eol,
      closingEol,
      bom,
      snapshot,
    },
  };
};
