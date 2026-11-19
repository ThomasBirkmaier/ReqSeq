// The lines of the output page (SR-223 AK1, SR-073 AK2): the output of a catalog command that no other buffer
// shows, laid out by its shape alone. Its answer (`answer`, SR-224 AK1) heads the page (`resultAnswer`), the
// problems of its top-level problem lists follow, errors before warnings before infos under a heading each, and
// then the rest. Every value stands under its title from the catalog (`outputFields`, SR-224 AK3), never under
// its field name; a value equal to the normal value the catalog names for it is left out (SR-223 AK7, shown with
// "Show details" by #1875); a key of a map stays as it is, since it is data. Elements are rows that open, with the
// status their record gives at the end, as a list row shows it (#276; the rows of `trace.chain` too), a problem is
// one line with its element and message, everything else is a quiet indented outline. The share of a
// verification degree (`share` next to `counts`, SR-037) is a percentage by core's rule of every access
// (`degreePercent`, one decimal rounded down, ThomasBirkmaier/ReqSeq-archive#592 Q3). A UUID the output names in `names` (ThomasBirkmaier/ReqSeq-archive#588) is the row
// of its element, and `names` itself is not shown. A record of exactly two named UUIDs, such as a replaced
// row of `variant.diff` (`core`, `replacement`), is one line that opens both side by side, read-only
// (SR-044 AK2); a row with a third field would be an outline again. A UUID in two repositories (SR-088)
// opens in the repository `names` gives first. A top-level `total`, `view` and `incomplete` describe the
// answer and go to the modeline (#276); the page says under the answer that an output is incomplete (SR-006
// AK2). Layout only: nothing here knows a command, the titles and marks come from the catalog (ADR-0002).
import type { CatalogEntry } from "@reqseq/core";
import { degreePercent, degreeShareOf } from "@reqseq/core/verification-degree";
import type { ElementBuffer } from "./buffers.js";
import { shownId, shownIdTitle } from "./id-title.js";
import { elementBuffer, elementBufferOf, readOnlyBuffer } from "./buffers.js";

/**
 * One line of the result buffer; `open` is the element Enter or a click opens. A pair line opens `open`
 * and `beside` side by side.
 */
export interface ResultLine {
  /** A heading opens the problems of one severity (SR-223 AK1). */
  readonly kind: "element" | "problem" | "text" | "pair" | "heading";
  /** Indentation level, from 0. */
  readonly depth: number;
  /** The ID of an element row; for any other line the title of the field it stands under, or "". */
  readonly label: string;
  /** The path of the field a value or a count line shows (`outputFields`, such as `degree.counts.open`). */
  readonly field?: string;
  readonly text: string;
  readonly open?: ElementBuffer;
  /** The element a pair line shows beside `open`, in the other area. */
  readonly beside?: ElementBuffer;
  /** Shown on hover: the whole text the line cuts, such as a long reason (#862). */
  readonly title?: string;
  /** The first line of an item of a list that is a record without a row of its own: a gap sets it apart. */
  readonly itemStart?: true;
  /** The status of an element row whose record gives one, as a list row shows it (#276); a problem's kind. */
  readonly status?: string;
}

/** A field of an output as the catalog describes it (`outputFields`, SR-224 AK3). */
export type OutputField = NonNullable<CatalogEntry["outputFields"]>[number];

/** The most lines shown; an output beyond it ends with a line that says how many more there are. */
export const MAX_RESULT_LINES = 2000;

type Rec = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

type Element = Parameters<typeof elementBufferOf>[0];

/** The elements an output names by UUID (`names`, ThomasBirkmaier/ReqSeq-archive#588), by UUID; the first of a UUID in two repositories. */
type Names = ReadonlyMap<string, Element>;

/** The fields of the output's command by their path (`outputFields`); empty without the catalog. */
type Fields = ReadonlyMap<string, OutputField>;

/** What every step of the walk shares: where the lines go, the named elements and the fields. */
interface Walk {
  readonly sink: Sink;
  readonly names: Names;
  readonly fields: Fields;
}

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
const isProblem = (value: unknown): value is Rec =>
  isRecord(value) &&
  typeof value["code"] === "string" &&
  typeof value["severity"] === "string" &&
  typeof value["message"] === "string";

/** The severities in the order the page shows them (SR-223 AK1), with the word of one and the heading of all. */
const SEVERITIES: readonly (readonly [string, string, string])[] = [
  ["error", "Error", "Errors"],
  ["warning", "Warning", "Warnings"],
  ["info", "Info", "Info"],
];

/** Where a severity stands among `SEVERITIES`; an unknown one after them. */
const rankOf = (problem: Rec): number => {
  const at = SEVERITIES.findIndex(([severity]) => severity === problem["severity"]);
  return at < 0 ? SEVERITIES.length : at;
};

/** The problems in the order of their severity, the order of the output kept within one (a stable sort). */
const bySeverity = (problems: readonly Rec[]): Rec[] => [...problems].sort((a, b) => rankOf(a) - rankOf(b));

/** A non-empty list whose items are all problems. */
const isProblemList = (value: unknown): value is readonly Rec[] =>
  Array.isArray(value) && value.length > 0 && value.every(isProblem);

/**
 * One problem: its element (SR-084 AK4), else the file and line it is about, then its message; its kind at the end.
 * Under a heading of its severity the line says no severity, elsewhere it starts with it.
 */
const problemLine = (problem: Rec, depth: number, headed: boolean): ResultLine => {
  const id = str(problem["elementId"]);
  // Safe fallback: a problem gives `elementRepository` only when its `repository` and `file` name another
  // file than the element's (schemas/common.schema.json, `problem`); otherwise a problem that names an element
  // is about the element's own file, so `repository` is the element's repository.
  const repository = str(problem["elementRepository"]) ?? str(problem["repository"]);
  // The element as everywhere it is named (SR-084 AK4): short ID with identifier, else what there is.
  const shortId = str(problem["elementShortId"]);
  const identifier = str(problem["elementIdentifier"]);
  const name = shortId === undefined ? identifier : shownId(shortId, identifier);
  const file = str(problem["file"]);
  const line = problem["line"];
  const place = file === undefined ? undefined : typeof line === "number" ? `${file}:${String(line)}` : file;
  const severity =
    SEVERITIES.find(([key]) => key === problem["severity"])?.[1] ?? String(problem["severity"]);
  return {
    kind: "problem",
    depth,
    label: [...(headed ? [] : [severity]), name ?? place ?? ""].filter((part) => part !== "").join(" "),
    text: String(problem["message"]),
    status: String(problem["code"]),
    ...(id === undefined || repository === undefined
      ? {}
      : { open: elementBuffer(id, repository, name ?? id) }),
  };
};

/** A value as a line shows it: text as it is, yes or no for a flag, any other value as JSON. */
const scalar = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "boolean"
      ? value
        ? "yes"
        : "no"
      : JSON.stringify(value);

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

/**
 * The field `key` of the value at `path`: its path and the label it stands under, its title. A key of a map
 * (`path.*`) is data and is its own label; a field the catalog does not list keeps its key.
 */
const childOf = (
  fields: Fields,
  path: string,
  key: string,
): { readonly path: string; readonly label: string } => {
  const named = path === "" ? key : `${path}.${key}`;
  const field = fields.get(named);
  if (field !== undefined) {
    return { path: named, label: field.title ?? key };
  }
  // A map at the top is `.*`, as the generator writes the path of its values (`outputFieldsOf`).
  const map = `${path}.*`;
  return fields.has(map) ? { path: map, label: key } : { path: named, label: key };
};

/** The value equals the normal value the catalog names for its field (SR-223 AK7): it is left out. */
const isNormal = (fields: Fields, path: string, value: unknown): boolean => {
  const normal = fields.get(path)?.normal;
  return normal !== undefined && JSON.stringify(normal) === JSON.stringify(value);
};

/** The row with the `status` its record gives, if any: the only field of an element record a row shows. */
const withStatus = (line: ResultLine, record: Rec): ResultLine => {
  const status = str(record["status"]);
  return status === undefined ? line : { ...line, status };
};

const elementLine = (element: Element, depth: number): ResultLine => ({
  kind: "element",
  depth,
  label: shownId(element.shortId, element.identifier),
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

/** The pair line; `title` is the title of the field of the second element. */
const pairLine = (pair: NonNullable<ReturnType<typeof pairOf>>, depth: number, title: string): ResultLine => {
  const { first, second } = pair;
  return {
    kind: "pair",
    depth,
    label: shownId(first.shortId, first.identifier),
    text: `${first.title} · ${title}: ${shownIdTitle(second.shortId, second.identifier, second.title)}`,
    open: readOnlyBuffer(elementBufferOf(first)),
    beside: readOnlyBuffer(elementBufferOf(second)),
  };
};

/**
 * A value that is no list and no record: its text, or the row of the element a named UUID is. Under a field
 * (`variant`, `id`) the row keeps its title in its label ("Variant: VAR-1"); an item of a list has its title on
 * the count line above.
 */
const leafLine = (value: unknown, depth: number, label: string, path: string, names: Names): ResultLine => {
  const named = typeof value === "string" ? names.get(value) : undefined;
  if (named === undefined) {
    return { kind: "text", depth, label, text: scalar(value), ...(label === "" ? {} : { field: path }) };
  }
  const row = elementLine(named, depth);
  return label === "" ? row : { ...row, label: `${label}: ${row.label}` };
};

/**
 * The lines of `value` at `path` (`""` the output itself), under `label` (`""` none). `item`: the value is an
 * item of a list (an entry whose `id` names an element is that element's row).
 */
const linesOf = (
  value: unknown,
  depth: number,
  label: string,
  path: string,
  walk: Walk,
  item = false,
): void => {
  const { sink, names } = walk;
  if (Array.isArray(value)) {
    if (label !== "") {
      emit(sink, () => ({ kind: "text", depth, label, text: String(value.length), field: path }));
    }
    // Problems of a list stand by severity, errors first (SR-223 AK1).
    const items = isProblemList(value) ? bySeverity(value) : (value as readonly unknown[]);
    const itemPath = `${path}[]`;
    for (const each of items) {
      linesOf(each, label === "" ? depth : depth + 1, "", itemPath, walk, true);
    }
    return;
  }
  if (!isRecord(value)) {
    emit(sink, () => leafLine(value, depth, label, path, names));
    return;
  }
  const element = asElement(value);
  if (element !== undefined) {
    emit(sink, () => withStatus(elementLine(element, depth), value));
    return;
  }
  const pair = pairOf(value, names);
  if (pair !== undefined) {
    emit(sink, () => pairLine(pair, depth, childOf(walk.fields, path, pair.key).label));
    return;
  }
  if (isProblem(value)) {
    emit(sink, () => problemLine(value, depth, false));
    return;
  }
  outlineLines(value, depth, label, path, walk, item);
};

/** The fields of a record, each at its path under its title, without those of their normal value (SR-223 AK7). */
const fieldLines = (value: Rec, depth: number, path: string, walk: Walk, skip?: string): void => {
  const share = degreeShareOf(value);
  for (const [key, item] of Object.entries(value)) {
    const child = childOf(walk.fields, path, key);
    if (key !== skip && !isNormal(walk.fields, child.path, item)) {
      const shown = key === "share" && share !== undefined ? degreePercent(share) : item;
      linesOf(shown, depth, child.label, child.path, walk);
    }
  }
};

/**
 * Any other record as an outline: under its label, or, as an item of a list whose `id` `names` names, under
 * the row of that element, with its other fields.
 */
const outlineLines = (
  value: Rec,
  depth: number,
  label: string,
  path: string,
  walk: Walk,
  item: boolean,
): void => {
  const entry = item ? entryOf(value, walk.names) : undefined;
  if (entry !== undefined) {
    emit(walk.sink, () => elementLine(entry, depth));
    fieldLines(value, depth + 1, path, walk, "id");
    return;
  }
  if (label !== "") {
    emit(walk.sink, () => ({ kind: "text", depth, label, text: "", field: path }));
  }
  const first = walk.sink.lines.length;
  fieldLines(value, label === "" ? depth : depth + 1, path, walk);
  const start = walk.sink.lines[first];
  if (item && start !== undefined) {
    walk.sink.lines[first] = { ...start, itemStart: true };
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
 * modeline (#276), and the rest, which the lines show, without the answer itself, which heads the page
 * (SR-224 AK1, SR-223 AK1).
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
    rest: Object.fromEntries(
      Object.entries(output).filter(
        ([key, value]) => !isSummary(key, value) && !(key === "answer" && typeof value === "string"),
      ),
    ),
  };
};

/**
 * The problems of the top-level problem lists of an output first, a heading per severity, errors before
 * warnings before infos (SR-223 AK1); then the other fields.
 */
const pageLines = (rest: unknown, walk: Walk): void => {
  if (!isRecord(rest)) {
    linesOf(rest, 0, "", "", walk);
    return;
  }
  const problems = bySeverity(Object.values(rest).filter(isProblemList).flat());
  let heading: string | undefined;
  for (const problem of problems) {
    const [, , title] = SEVERITIES[rankOf(problem)] ?? ["", "", "Other problems"];
    if (title !== heading) {
      heading = title;
      emit(walk.sink, () => ({ kind: "heading", depth: 0, label: "", text: title }));
    }
    emit(walk.sink, () => problemLine(problem, 0, true));
  }
  fieldLines(
    Object.fromEntries(Object.entries(rest).filter(([, value]) => !isProblemList(value))),
    0,
    "",
    walk,
  );
};

/**
 * The lines of an output (none while there is none), at most `MAX_RESULT_LINES` and a last one that counts the
 * rest; `fields` are the `outputFields` of its command, which give the titles and normal values.
 */
export const resultLines = (output: unknown, fields: readonly OutputField[] = []): ResultLine[] => {
  const sink: Sink = { lines: [], rest: 0 };
  if (output !== undefined) {
    const { names, shown } = namesOf(output);
    const byPath = new Map(fields.map((field) => [field.path, field]));
    pageLines(splitSummary(shown, names).rest, { sink, names, fields: byPath });
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

/** The answer of an output (`answer`, SR-224 AK1), which heads its page (SR-223 AK1); undefined without one. */
export const resultAnswer = (output: unknown): string | undefined =>
  isRecord(output) ? str(output["answer"]) : undefined;
