// Which parsed Markdown files are elements (ADR-0004, SR-003 AK2, spec question #145 option 1):
// those whose frontmatter is a mapping with `id` and `type`. Every other file is not an element; it
// is never written. A type the metamodel does not know still makes an element (SR-016 AK3).
import { Scalar, isMap, isNode, isScalar } from "yaml";
import type { Problem } from "../catalog.js";
import type { FileSnapshot, LineEnding, ParsedContent, ParsedFile } from "../files/index.js";
import { FRONTMATTER_FIRST_LINE } from "../files/index.js";
import type { BareReference, PropertyReference, StoredUnresolvedLink, TextReference } from "./references.js";
import { elementLinks } from "./references.js";
import { isUuid } from "./uuid.js";

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
  /**
   * The inline references of the text (ADR-0004, D-058) in text order, with their lines in the
   * file; left out when the text has none. The text itself is not kept.
   */
  readonly references?: readonly TextReference[];
  /**
   * The inline references in the string values of the frontmatter (SR-127), whatever the key, in
   * file order; left out when it has none. Whether one counts is up to the metamodel
   * (`referencesOf`): only properties marked `markdown` hold references.
   */
  readonly propertyReferences?: readonly PropertyReference[];
  /**
   * The `reqseq:` links whose target is no UUID (#176), in the properties (whatever the key) and
   * then in the text; left out when there is none. `workspace.check` reports those that count.
   */
  readonly unresolvedLinks?: readonly StoredUnresolvedLink[];
  /**
   * The `reqseq:` references of the text written outside a Markdown link and outside code (#633),
   * with their lines in the file; left out when there is none. `workspace.check` reports each.
   */
  readonly bareReferences?: readonly BareReference[];
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

export { isUuid } from "./uuid.js";

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

/**
 * The line of each top-level key of the frontmatter (line 1 is the opening `---`), the first of a
 * name that appears twice, in one pass over the keys and the text: linear in the size of the
 * frontmatter, also for one with many thousand keys (SR-028: records from other tools). Keys that
 * are no plain string (an alias `*k : ...`, a number, `null`) are left out; empty for a frontmatter
 * that is no mapping.
 */
export const keyLinesOf = (
  file: Pick<ParsedContent, "document" | "frontmatter">,
): ReadonlyMap<string, number> => {
  const { contents } = file.document;
  const lines = new Map<string, number>();
  let at = 0;
  let line = FRONTMATTER_FIRST_LINE;
  // The keys of a mapping are in the order of the text, so the newlines are counted once.
  for (const pair of isMap(contents) ? contents.items : []) {
    const key = isScalar(pair.key) && typeof pair.key.value === "string" ? pair.key : undefined;
    const range = key?.range;
    if (!range) {
      continue;
    }
    for (let nl = file.frontmatter.indexOf("\n", at); nl !== -1 && nl < range[0];) {
      line += 1;
      nl = file.frontmatter.indexOf("\n", nl + 1);
    }
    at = range[0];
    if (!lines.has(key.value as string)) {
      lines.set(key.value as string, line);
    }
  }
  return lines;
};

/**
 * The line of the top-level key `key` itself (line 1 is the opening `---`): for a block value the
 * line above its first line. Undefined when no plain key has that name, for example a key written
 * as an alias (`*k : ...`), or when the frontmatter is no mapping.
 */
export const keyLineOf = (file: ParsedFile, key: string): number | undefined => keyLinesOf(file).get(key);

/** The line of the value at `key` (and list position `item`) and whether it is a block scalar. */
const placeOf = (
  file: ParsedFile,
  key: string,
  item: number | undefined,
): { line: number; block: boolean } | undefined => {
  const path = item === undefined ? [key] : [key, item];
  const line = lineOf(file, path);
  if (line === undefined) {
    return undefined;
  }
  const node: unknown = file.document.getIn(path, true);
  return {
    line,
    block: isScalar(node) && (node.type === Scalar.BLOCK_LITERAL || node.type === Scalar.BLOCK_FOLDED),
  };
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
  const {
    references,
    propertyReferences: inProperties,
    unresolvedLinks: unresolved,
    bareReferences: bare,
  } = elementLinks(file.frontmatter, file.body, data, (key, item) => placeOf(file, key, item));
  return {
    kind: "element",
    element: {
      id,
      type,
      repository,
      file: file.path,
      data,
      ...(references.length === 0 ? {} : { references }),
      ...(inProperties.length === 0 ? {} : { propertyReferences: inProperties }),
      ...(unresolved.length === 0 ? {} : { unresolvedLinks: unresolved }),
      ...(bare.length === 0 ? {} : { bareReferences: bare }),
      eol,
      closingEol,
      bom,
      snapshot,
    },
  };
};
