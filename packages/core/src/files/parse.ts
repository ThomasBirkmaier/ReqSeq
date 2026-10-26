// Parsing the bytes of an element file (ADR-0007, SR-008): UTF-8, conflict-marker scan, own
// frontmatter split, YAML via `parseDocument` with line and column. Used by reading and, on the
// current bytes on disk, by writing, so a faulty file is never written.
import { LineCounter, parseDocument, visit } from "yaml";
import type { Document } from "yaml";
import type { Problem, ProblemCode } from "../generated/types.js";
import { findConflictMarker } from "./conflict-markers.js";
import type { LineEnding } from "./frontmatter.js";
import { splitFrontmatter } from "./frontmatter.js";

/** The content of a file whose frontmatter parsed. */
export interface ParsedContent {
  /** Raw YAML text between the `---` lines, unchanged; `editElementFile` splices it (ADR-0007). */
  readonly frontmatter: string;
  /**
   * The parsed YAML document (comments included, no source tokens). The writer does not need it;
   * it parses the raw `frontmatter` itself.
   */
  readonly document: Document;
  /** The frontmatter as plain data. */
  readonly data: unknown;
  /** Markdown text after the frontmatter, unchanged. */
  readonly body: string;
  readonly eol: LineEnding;
  /** Line ending of the closing `---` line, `""` when the file ends right after it; kept on write. */
  readonly closingEol: LineEnding | "";
  /** The file started with a UTF-8 byte order mark (removed from the texts above, kept on write). */
  readonly bom: boolean;
  /** YAML warnings (for example an unknown tag), severity `warning`. */
  readonly warnings: readonly Problem[];
}

export type ParseOutcome =
  | { readonly kind: "parsed"; readonly content: ParsedContent }
  /** No frontmatter: not an element, ignored and never changed (ADR-0004, SR-003 AK2). */
  | { readonly kind: "no-frontmatter" }
  | { readonly kind: "problem"; readonly problem: Problem };

/** First line of frontmatter YAML is line 2 of the file (line 1 is the opening `---`). */
const FRONTMATTER_FIRST_LINE = 2;
const BOM = "\uFEFF";

export const fileProblem = (code: ProblemCode, file: string, message: string, line?: number): Problem =>
  line === undefined
    ? { code, severity: "error", file, message }
    : { code, severity: "error", file, message, line };

interface Failed {
  readonly kind: "problem";
  readonly problem: Problem;
}

const failed = (problem: Problem): Failed => ({ kind: "problem", problem });

/** Where the YAML text sits in the file and what to call it in messages. */
interface YamlPlace {
  readonly firstLine: number;
  readonly label: string;
}

const FRONTMATTER: YamlPlace = { firstLine: FRONTMATTER_FIRST_LINE, label: "Invalid YAML frontmatter" };
const WHOLE_FILE: YamlPlace = { firstLine: 1, label: "Invalid YAML" };

const invalidYaml = (file: string, place: YamlPlace, line: number, column: number, reason: string): Failed =>
  failed(
    fileProblem(
      "file.invalid-yaml",
      file,
      `${place.label} at line ${String(line)}, column ${String(column)}: ${reason}`,
      line,
    ),
  );

/**
 * The first alias without a matching anchor, with its source offset (0 for an alias that was
 * created in code and has no source). `parseDocument` does not report these as errors.
 */
export const findUnresolvedAlias = (document: Document): { offset: number; source: string } | undefined => {
  let unresolved: { offset: number; source: string } | undefined;
  visit(document, {
    Alias(_key, node) {
      if (node.resolve(document) === undefined) {
        unresolved = { offset: node.range?.[0] ?? 0, source: node.source };
        return visit.BREAK;
      }
      return undefined;
    },
  });
  return unresolved;
};

type YamlOutcome =
  | {
      readonly kind: "ok";
      readonly document: Document;
      readonly data: unknown;
      readonly warnings: Problem[];
      readonly lines: LineCounter;
    }
  | Failed;

const parseYaml = (file: string, yaml: string, place: YamlPlace): YamlOutcome => {
  const lines = new LineCounter();
  const document = parseDocument(yaml, {
    version: "1.2",
    schema: "core",
    prettyErrors: false,
    lineCounter: lines,
  });
  // Errors found only at the end (an unclosed quote or bracket) are reported on the last line of
  // the YAML text, not on the closing `---` or past the end of the file.
  const lastLine = Math.max(1, yaml.replace(/\n$/, "").split("\n").length);
  const at = (offset: number): { line: number; col: number } => {
    const pos = lines.linePos(offset);
    return pos.line > lastLine
      ? { line: lastLine + place.firstLine - 1, col: 1 }
      : { line: pos.line + place.firstLine - 1, col: pos.col };
  };
  const [error] = document.errors;
  if (error !== undefined) {
    const pos = at(error.pos[0]);
    return invalidYaml(file, place, pos.line, pos.col, error.message);
  }
  const unresolved = findUnresolvedAlias(document);
  if (unresolved !== undefined) {
    const pos = at(unresolved.offset);
    return invalidYaml(file, place, pos.line, pos.col, `Unresolved alias *${unresolved.source}`);
  }
  const warnings = document.warnings.map((w): Problem => {
    const pos = at(w.pos[0]);
    return {
      code: "file.yaml-warning",
      severity: "warning",
      file,
      line: pos.line,
      message: `YAML warning at line ${String(pos.line)}, column ${String(pos.col)}: ${w.message}`,
    };
  });
  try {
    return { kind: "ok", document, data: document.toJS(), warnings, lines };
  } catch (e) {
    // For example more aliases than allowed (protection against alias bombs).
    return invalidYaml(file, place, place.firstLine, 1, (e as Error).message);
  }
};

type Decoded = { readonly kind: "text"; readonly text: string; readonly bom: boolean } | Failed;

/** UTF-8 (strict), byte order mark removed, conflict markers refused. */
const decode = (file: string, bytes: Uint8Array): Decoded => {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return failed(fileProblem("file.unreadable", file, "File is not valid UTF-8 text"));
  }
  const bom = text.startsWith(BOM);
  if (bom) {
    text = text.slice(BOM.length);
  }
  const conflictLine = findConflictMarker(text);
  if (conflictLine !== undefined) {
    return failed(
      fileProblem(
        "file.conflict-markers",
        file,
        `File has an unresolved Git merge conflict starting at line ${String(conflictLine)}`,
        conflictLine,
      ),
    );
  }
  return { kind: "text", text, bom };
};

/**
 * The Markdown text after the frontmatter of an element file's bytes, as `parseFileBytes` gives it
 * (`body`), without parsing the YAML: for bytes that parsed before (the model reads a file again
 * for its text, ADR-0008). Undefined when the bytes are not UTF-8, hold conflict markers or have no
 * closed frontmatter.
 */
export const elementBody = (file: string, bytes: Uint8Array): string | undefined =>
  elementParts(file, bytes)?.body;

/**
 * The YAML text of the frontmatter of an element file's bytes, as `parseFileBytes` gives it
 * (`frontmatter`, starting at line 2 of the file), without parsing it: for bytes that parsed before
 * (the lines of findings, ADR-0008). Undefined as for `elementBody`.
 */
export const elementFrontmatter = (file: string, bytes: Uint8Array): string | undefined =>
  elementParts(file, bytes)?.yaml;

/** The frontmatter and the text of an element file's bytes, split without parsing; undefined as for `elementBody`. */
const elementParts = (file: string, bytes: Uint8Array): { yaml: string; body: string } | undefined => {
  const decoded = decode(file, bytes);
  const split = decoded.kind === "text" ? splitFrontmatter(decoded.text) : undefined;
  return split?.kind === "frontmatter" ? split : undefined;
};

/** Parses the bytes of an element file `file` (relative path, `/` separators). Never throws. */
export const parseFileBytes = (file: string, bytes: Uint8Array): ParseOutcome => {
  const decoded = decode(file, bytes);
  if (decoded.kind === "problem") {
    return decoded;
  }
  const { text, bom } = decoded;
  const split = splitFrontmatter(text);
  switch (split.kind) {
    case "none":
      return { kind: "no-frontmatter" };
    case "unclosed":
      return failed(
        fileProblem(
          "file.invalid-yaml",
          file,
          "Invalid YAML frontmatter at line 1: the frontmatter starts with --- but has no closing --- line",
          1,
        ),
      );
    case "frontmatter": {
      const yaml = parseYaml(file, split.yaml, FRONTMATTER);
      if (yaml.kind !== "ok") {
        return yaml;
      }
      const { document, data, warnings } = yaml;
      return {
        kind: "parsed",
        content: {
          frontmatter: split.yaml,
          document,
          data,
          body: split.body,
          eol: split.eol,
          closingEol: split.closingEol,
          bom,
          warnings,
        },
      };
    }
  }
};

/** The content of a whole-file YAML document (metamodel, workspace, baseline, filter, mapping). */
export interface ParsedYaml {
  /** The text of the file without the byte order mark, for in-place edits (`editYamlDocument`). */
  readonly text: string;
  readonly document: Document;
  readonly data: unknown;
  readonly bom: boolean;
  readonly warnings: readonly Problem[];
  /**
   * Line starts of the text: `lines.linePos(node.range[0]).line` is the line (from 1) of a node,
   * e.g. for a schema violation in a metamodel file.
   */
  readonly lines: LineCounter;
}

export type YamlParseOutcome = { readonly kind: "parsed"; readonly content: ParsedYaml } | Failed;

/** Parses the bytes of a YAML file: the whole file must be YAML 1.2 without errors. Never throws. */
export const parseYamlFileBytes = (file: string, bytes: Uint8Array): YamlParseOutcome => {
  const decoded = decode(file, bytes);
  if (decoded.kind === "problem") {
    return decoded;
  }
  const yaml = parseYaml(file, decoded.text, WHOLE_FILE);
  if (yaml.kind === "problem") {
    return yaml;
  }
  const { document, data, warnings, lines } = yaml;
  return {
    kind: "parsed",
    content: { text: decoded.text, document, data, bom: decoded.bom, warnings, lines },
  };
};
