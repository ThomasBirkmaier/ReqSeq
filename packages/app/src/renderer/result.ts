// The lines of the result buffer (SR-073 AK2): the output of a catalog command that no other buffer
// shows, laid out by its shape alone, like the CLI's text output. Elements are rows that open, problems and
// hints are one line each with their element, everything else is a quiet indented outline. The share of a
// verification degree (`share` next to `counts`, SR-037) is a percentage by core's rule of every access
// (`degreePercent`, one decimal rounded down, #592 Q3). A UUID the output names in `names` (#588) is the row
// of its element, and `names` itself is not shown. A record of exactly two named UUIDs, such as a replaced
// row of `variant.diff` (`core`, `replacement`), is one line that opens both side by side, read-only
// (SR-044 AK2). Layout only: nothing here knows a command (ADR-0002).
import { degreePercent, degreeShareOf } from "@reqseq/core/verification-degree";
import type { ElementBuffer } from "./buffers.js";
import { elementBuffer, elementBufferOf, readOnlyBuffer } from "./buffers.js";

/**
 * One line of the result buffer; `open` is the element Enter or a click opens. A pair line opens `open`
 * and `beside` side by side.
 */
export interface ResultLine {
  readonly kind: "element" | "problem" | "text" | "pair";
  /** Indentation level, from 0. */
  readonly depth: number;
  /** The ID of an element row; for any other line the key it stands under, or "". */
  readonly label: string;
  readonly text: string;
  readonly open?: ElementBuffer;
  /** The element a pair line shows beside `open`, in the other area. */
  readonly beside?: ElementBuffer;
}

/** The most lines shown; an output beyond it ends with a line that says how many more there are. */
export const MAX_RESULT_LINES = 2000;

type Rec = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

type Element = Parameters<typeof elementBufferOf>[0];

/** The elements an output names by UUID (`names`, #588), by UUID; the first of a UUID in two repositories. */
type Names = ReadonlyMap<string, Element>;

/** An element as outputs give it: an ID, its repository, a short ID and a title. */
const asElement = (value: Rec): Element | undefined => {
  const [id, repository, shortId, title] = [
    value["id"],
    value["repository"],
    value["shortId"],
    value["title"],
  ];
  return typeof id === "string" &&
    typeof repository === "string" &&
    typeof shortId === "string" &&
    typeof title === "string"
    ? { id, repository, shortId, title, identifier: str(value["identifier"]) }
    : undefined;
};

/** A problem or hint: a code, a severity and a message. */
const isProblem = (value: Rec): boolean =>
  typeof value["code"] === "string" &&
  typeof value["severity"] === "string" &&
  typeof value["message"] === "string";

const problemLine = (problem: Rec, depth: number, label: string): ResultLine => {
  const id = str(problem["elementId"]);
  // Safe fallback: a problem gives `elementRepository` only when its `repository` and `file` name another
  // file than the element's (schemas/common.schema.json, `problem`); otherwise a problem that names an element
  // is about the element's own file, so `repository` is the element's repository.
  const repository = str(problem["elementRepository"]) ?? str(problem["repository"]);
  const name = str(problem["elementIdentifier"]) ?? str(problem["elementShortId"]);
  return {
    kind: "problem",
    depth,
    label,
    text: [String(problem["severity"]), String(problem["code"]), name, String(problem["message"])]
      .filter((part) => part !== undefined)
      .join("  "),
    ...(id === undefined || repository === undefined
      ? {}
      : { open: elementBuffer(id, repository, name ?? id) }),
  };
};

const scalar = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/**
 * Collects the first `MAX_RESULT_LINES` lines and only counts the rest: a line past the limit is never built,
 * so a huge output costs a walk, not a line object per value.
 */
interface Sink {
  readonly lines: ResultLine[];
  rest: number;
}

const emit = (sink: Sink, line: () => ResultLine): void => {
  if (sink.lines.length < MAX_RESULT_LINES) {
    sink.lines.push(line());
  } else {
    sink.rest += 1;
  }
};

const elementLine = (element: Element, depth: number): ResultLine => ({
  kind: "element",
  depth,
  label: element.identifier ?? element.shortId,
  text: element.title,
  open: elementBufferOf(element),
});

/** The two elements of a record of exactly two named UUIDs, with the key of the second; else undefined. */
const pairOf = (
  value: Rec,
  names: Names,
): { readonly first: Element; readonly second: Element; readonly key: string } | undefined => {
  const entries = Object.entries(value);
  if (entries.length !== 2) {
    return undefined;
  }
  const [[, a], [key, b]] = entries as [[string, unknown], [string, unknown]];
  const first = typeof a === "string" ? names.get(a) : undefined;
  const second = typeof b === "string" ? names.get(b) : undefined;
  return first === undefined || second === undefined ? undefined : { first, second, key };
};

const pairLine = (pair: NonNullable<ReturnType<typeof pairOf>>, depth: number): ResultLine => {
  const { first, second, key } = pair;
  return {
    kind: "pair",
    depth,
    label: first.identifier ?? first.shortId,
    text: `${first.title} · ${key}: ${second.identifier ?? second.shortId} ${second.title}`,
    open: readOnlyBuffer(elementBufferOf(first)),
    beside: readOnlyBuffer(elementBufferOf(second)),
  };
};

/** A value that is no list and no record: the row of the element a named UUID is, else its text. */
const leafLine = (value: unknown, depth: number, label: string, names: Names): ResultLine => {
  const named = typeof value === "string" ? names.get(value) : undefined;
  return named === undefined
    ? { kind: "text", depth, label, text: scalar(value) }
    : elementLine(named, depth);
};

const linesOf = (value: unknown, depth: number, label: string, sink: Sink, names: Names): void => {
  if (Array.isArray(value)) {
    if (label !== "") {
      emit(sink, () => ({ kind: "text", depth, label, text: String(value.length) }));
    }
    for (const item of value as readonly unknown[]) {
      linesOf(item, label === "" ? depth : depth + 1, "", sink, names);
    }
    return;
  }
  if (!isRecord(value)) {
    emit(sink, () => leafLine(value, depth, label, names));
    return;
  }
  const element = asElement(value);
  if (element !== undefined) {
    emit(sink, () => elementLine(element, depth));
    return;
  }
  const pair = pairOf(value, names);
  if (pair !== undefined) {
    emit(sink, () => pairLine(pair, depth));
    return;
  }
  if (isProblem(value)) {
    emit(sink, () => problemLine(value, depth, label));
    return;
  }
  const inner = label === "" ? depth : depth + 1;
  if (label !== "") {
    emit(sink, () => ({ kind: "text", depth, label, text: "" }));
  }
  const share = degreeShareOf(value);
  for (const [key, item] of Object.entries(value)) {
    linesOf(key === "share" && share !== undefined ? degreePercent(share) : item, inner, key, sink, names);
  }
};

/**
 * The elements `names` of an output gives (#588), and the output without `names`, which only names what the
 * rest gives by UUID; an output without them as it is.
 */
const namesOf = (output: unknown): { readonly names: Names; readonly shown: unknown } => {
  const listed = isRecord(output) ? output["names"] : undefined;
  if (!isRecord(output) || !Array.isArray(listed)) {
    return { names: new Map(), shown: output };
  }
  const names = new Map<string, Element>();
  for (const item of listed as readonly unknown[]) {
    const element = isRecord(item) ? asElement(item) : undefined;
    if (element !== undefined && !names.has(element.id)) {
      names.set(element.id, element);
    }
  }
  const { names: _names, ...shown } = output;
  return { names, shown };
};

/** The lines of an output (none while there is none), at most `MAX_RESULT_LINES` and a last one that counts the rest. */
export const resultLines = (output: unknown): ResultLine[] => {
  const sink: Sink = { lines: [], rest: 0 };
  if (output !== undefined) {
    const { names, shown } = namesOf(output);
    linesOf(shown, 0, "", sink, names);
  }
  const { lines, rest } = sink;
  if (rest > 0) {
    lines.push({
      kind: "text",
      depth: 0,
      label: "",
      text: `${String(rest)} more line${rest === 1 ? "" : "s"}`,
    });
  }
  return lines;
};

/** The count an output gives for its whole answer (`total`), for the modeline; undefined without one. */
export const resultTotal = (output: unknown): number | undefined =>
  isRecord(output) && typeof output["total"] === "number" ? output["total"] : undefined;
