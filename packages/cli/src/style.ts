// The style of the output for people (#988): bold, dim and colour on Node's own `util.styleText`
// (ADR-0015: no dependency for it), only when stdout is a terminal and `NO_COLOR` is not set. Otherwise
// the output is plain text exactly as before, in pipes, files and tests. The entry point (bin.ts) asks
// the process once (`terminalOf`) and passes the answer in, so the renderers read no global state.
// Layout only (ADR-0002 rule 3): styles follow what the output itself says, never a status name of a
// metamodel; the severities are the fixed ones of a finding (`common.schema.json#/$defs/problem`).
import { stripVTControlCharacters, styleText } from "node:util";

/** The terminal stdout is, when the output is styled for one: its width in columns. */
export interface Terminal {
  readonly columns: number;
}

/** The width a terminal is taken to have when it does not say. */
export const DEFAULT_COLUMNS = 80;

/** What `terminalOf` reads of stdout. */
export interface OutputTarget {
  readonly isTTY?: boolean | undefined;
  readonly columns?: number | undefined;
}

/**
 * The terminal to style for: stdout is a terminal and `NO_COLOR` is not set (an empty `NO_COLOR` counts
 * as not set, as no-color.org says); undefined for plain text.
 */
export const terminalOf = (
  stdout: OutputTarget,
  env: Readonly<Record<string, string | undefined>>,
): Terminal | undefined => {
  if (stdout.isTTY !== true || (env["NO_COLOR"] ?? "") !== "") {
    return undefined;
  }
  const columns = stdout.columns;
  return { columns: typeof columns === "number" && columns > 0 ? columns : DEFAULT_COLUMNS };
};

/** The severity of a finding. */
type Severity = "error" | "warning" | "info";

/** How the output for people styles its parts. */
export interface Style {
  /** The width a line is cut to (`cut`); unlimited for plain text, which is never cut. */
  readonly width: number;
  /** A heading or the name a line starts with. */
  readonly strong: (text: string) => string;
  /** What is there for reference: a short ID next to the identifier, counts, marks, tree lines. */
  readonly faint: (text: string) => string;
  /** The severity of a finding, coloured by it; other values as they are. */
  readonly severity: (severity: string, text: string) => string;
}

const same = (text: string): string => text;

/** Plain text: nothing styled, nothing cut. */
export const PLAIN: Style = {
  width: Number.POSITIVE_INFINITY,
  strong: same,
  faint: same,
  severity: (_severity, text) => text,
};

// The stream is not checked here: `terminalOf` decided already, from what the entry point passed in.
const styled = (format: Parameters<typeof styleText>[0], text: string): string =>
  text === "" ? text : styleText(format, text, { validateStream: false });

const SEVERITY: Readonly<Record<Severity, Parameters<typeof styleText>[0]>> = {
  error: ["bold", "red"],
  warning: "yellow",
  info: "cyan",
};

const isSeverity = (value: string): value is Severity => Object.hasOwn(SEVERITY, value);

/** The style for a terminal of `columns` columns. */
export const terminalStyle = (terminal: Terminal): Style => ({
  width: terminal.columns,
  strong: (text) => styled("bold", text),
  faint: (text) => styled("dim", text),
  severity: (severity, text) => (isSeverity(severity) ? styled(SEVERITY[severity], text) : text),
});

/** The style for `terminal`, plain without one. */
export const styleOf = (terminal: Terminal | undefined): Style =>
  terminal === undefined ? PLAIN : terminalStyle(terminal);

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The columns `text` takes, one per character as the reader sees it (grapheme), styles not counted.
 * Wide characters (East Asian, most emoji) take two columns in a terminal and count one here, so such a
 * line may still wrap.
 */
export const widthOf = (text: string): number =>
  [...GRAPHEMES.segment(stripVTControlCharacters(text))].length;

/** `text` (unstyled) cut to `room` columns, ending in `…` when it was longer; at least one character. */
export const cut = (text: string, room: number): string => {
  const keep = Math.max(1, room);
  if (text.length <= keep) {
    return text;
  }
  const kept: string[] = [];
  for (const { segment } of GRAPHEMES.segment(text)) {
    if (kept.length === keep) {
      return `${kept.slice(0, keep - 1).join("")}…`;
    }
    kept.push(segment);
  }
  return text;
};

/** `text` with spaces after it up to `width` columns. */
export const padTo = (text: string, width: number): string =>
  `${text}${" ".repeat(Math.max(0, width - widthOf(text)))}`;
