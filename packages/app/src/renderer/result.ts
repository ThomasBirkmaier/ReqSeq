// The lines of the result buffer (SR-073 AK2): the output of a catalog command that no other buffer
// shows, laid out by its shape alone, like the CLI's text output. Elements are rows that open, with the
// status their record gives at the end, as a list row shows it (#276; the rows of `trace.chain` too), problems
// and hints are one line each with their element, everything else is a quiet indented outline. The share of a
// verification degree (`share` next to `counts`, SR-037) is a percentage by core's rule of every access
// (`degreePercent`, one decimal rounded down, ThomasBirkmaier/ReqSeq-archive#592 Q3). A UUID the output names in `names` (ThomasBirkmaier/ReqSeq-archive#588) is the row
// of its element, and `names` itself is not shown. A record of exactly two named UUIDs, such as a replaced
// row of `variant.diff` (`core`, `replacement`), is one line that opens both side by side, read-only
// (SR-044 AK2); a row with a third field would be an outline again. A UUID in two repositories (SR-088)
// opens in the repository `names` gives first. A top-level `total`, `view` and `incomplete` describe the
// answer and go to the modeline (#276). Layout only: nothing here knows a command (ADR-0002).
import { degreePercent, degreeShareOf } from "@reqseq/core/verification-degree";
import type { ElementBuffer } from "./buffers.js";
import { idTitle } from "./id-title.js";
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
  /** Shown on hover: the whole text the line cuts, such as a long reason (#862). */
  readonly title?: string;
  /** The status of an element row whose record gives one, as a list row shows it (#276). */
  readonly status?: string;
}

/** The most lines shown; an output beyond it ends with a line that says how many more there are. */
export const MAX_RESULT_LINES = 2000;

type Rec = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

type Element = Parameters<typeof elementBufferOf>[0];

/** The elements an output names by UUID (`names`, ThomasBirkmaier/ReqSeq-archive#588), by UUID; the first of a UUID in two repositories. */
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

/** The row with the `status` its record gives, if any: the only field of an element record a row shows. */
const withStatus = (line: ResultLine, record: Rec): ResultLine => {
  const status = str(record["status"]);
  return status === undefined ? line : { ...line, status };
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

/**
 * The element a record names by its `id` (`names`), in the record's own `repository` when it gives one (a
 * UUID in two repositories, SR-088); undefined when `id` names none.
 */
const entryOf = (value: Rec, names: Names): Element | undefined => {
  const id = str(value["id"]);
  const named = id === undefined ? undefined : names.get(id);
  const repository = str(value["repository"]);
  return named === undefined || repository === undefined ? named : { ...named, repository };
};

const pairLine = (pair: NonNullable<ReturnType<typeof pairOf>>, depth: number): ResultLine => {
  const { first, second, key } = pair;
  return {
    kind: "pair",
    depth,
    label: first.identifier ?? first.shortId,
    text: `${first.title} · ${key}: ${idTitle(second.identifier ?? second.shortId, second.title)}`,
    open: readOnlyBuffer(elementBufferOf(first)),
    beside: readOnlyBuffer(elementBufferOf(second)),
  };
};

/**
 * A value that is no list and no record: its text, or the row of the element a named UUID is. Under a key
 * (`variant`, `id`) the row keeps it in its label ("variant: VAR-1"); an item of a list has its key on the count
 * line above.
 */
const leafLine = (value: unknown, depth: number, label: string, names: Names): ResultLine => {
  const named = typeof value === "string" ? names.get(value) : undefined;
  if (named === undefined) {
    return { kind: "text", depth, label, text: scalar(value) };
  }
  const row = elementLine(named, depth);
  return label === "" ? row : { ...row, label: `${label}: ${row.label}` };
};

/** `item`: the value is an item of a list (an entry whose `id` names an element is that element's row). */
const linesOf = (
  value: unknown,
  depth: number,
  label: string,
  sink: Sink,
  names: Names,
  item = false,
): void => {
  if (Array.isArray(value)) {
    if (label !== "") {
      emit(sink, () => ({ kind: "text", depth, label, text: String(value.length) }));
    }
    for (const each of value as readonly unknown[]) {
      linesOf(each, label === "" ? depth : depth + 1, "", sink, names, true);
    }
    return;
  }
  if (!isRecord(value)) {
    emit(sink, () => leafLine(value, depth, label, names));
    return;
  }
  const element = asElement(value);
  if (element !== undefined) {
    emit(sink, () => withStatus(elementLine(element, depth), value));
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
  outlineLines(value, depth, label, sink, names, item);
};

/**
 * Any other record as an outline: under its label, or, as an item of a list whose `id` `names` names, under
 * the row of that element, with its other fields.
 */
const outlineLines = (
  value: Rec,
  depth: number,
  label: string,
  sink: Sink,
  names: Names,
  item: boolean,
): void => {
  const entry = item ? entryOf(value, names) : undefined;
  if (entry !== undefined) {
    emit(sink, () => elementLine(entry, depth));
    for (const [key, item] of Object.entries(value)) {
      if (key !== "id") {
        linesOf(item, depth + 1, key, sink, names);
      }
    }
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
 * The elements `names` of an output gives (ThomasBirkmaier/ReqSeq-archive#588), and the output without `names`, which only names what the
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

/** What the modeline says about an output (#276): its `total`, its `view` and whether it is `incomplete`. */
export interface ResultSummary {
  /** The count of the whole answer; undefined without one. */
  readonly total: number | undefined;
  /** The view the answer holds for: "Core", or the title of the variant `names` gives (else its ID). */
  readonly view: string | undefined;
  readonly incomplete: boolean;
}

/** The type each summary field has at the top of an output; with another type it is content. */
const SUMMARY_FIELDS: Readonly<Record<string, string>> = {
  total: "number",
  view: "string",
  incomplete: "boolean",
};

/**
 * An output split into its summary fields (`SUMMARY_FIELDS`), which describe the answer and go to the
 * modeline (#276), and the rest, which the lines show.
 */
const splitSummary = (
  output: unknown,
  names: Names,
): { readonly summary: ResultSummary; readonly rest: unknown } => {
  if (!isRecord(output)) {
    return { summary: { total: undefined, view: undefined, incomplete: false }, rest: output };
  }
  const isSummary = (key: string, value: unknown): boolean =>
    Object.hasOwn(SUMMARY_FIELDS, key) && typeof value === SUMMARY_FIELDS[key];
  const field = (key: string): unknown => (isSummary(key, output[key]) ? output[key] : undefined);
  const view = field("view") as string | undefined;
  const named = view === undefined ? undefined : names.get(view);
  return {
    summary: {
      total: field("total") as number | undefined,
      view: view === "core" ? "Core" : (named?.title ?? view),
      incomplete: field("incomplete") === true,
    },
    rest: Object.fromEntries(Object.entries(output).filter(([key, value]) => !isSummary(key, value))),
  };
};

/** The lines of an output (none while there is none), at most `MAX_RESULT_LINES` and a last one that counts the rest. */
export const resultLines = (output: unknown): ResultLine[] => {
  const sink: Sink = { lines: [], rest: 0 };
  if (output !== undefined) {
    const { names, shown } = namesOf(output);
    linesOf(splitSummary(shown, names).rest, 0, "", sink, names);
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

/** The summary fields of an output (`splitSummary`) the modeline shows. */
export const resultSummary = (output: unknown): ResultSummary => {
  const { names, shown } = namesOf(output);
  return splitSummary(shown, names).summary;
};
