// The lines of the output page (SR-223 AK1, SR-073 AK2): the output of a catalog command that no other buffer
// shows, laid out by its shape alone. Its answer (`answer`, SR-224 AK1) heads the page (`resultAnswer`), the
// problems of its top-level problem lists follow, errors before warnings before infos under a heading each, and
// then the rest. Every value stands under its title from the catalog (`outputFields`, SR-224 AK3), never under
// its field name; a key of a map stays as it is, since it is data. A value the catalog marks technical (UUID,
// path, check value, commit, kind of a problem, duration: SR-224 AK3) and a value equal to the normal value it
// names are left out, and shown at their lines as details, in the second grey, while "Show details" is on for the
// buffer (SR-223 AK2, AK7); a technical UUID that `names` names is its element's row, never a detail. Elements are
// rows that open, with the status their record gives at the end, as a list row shows it (#276; the rows of
// `trace.chain` too); an entry of the field the catalog marks as the answer has its other fields below its row
// (SR-223 AK6), a problem is one line with its element and message (with details its kind and technical
// values), several problems of one kind and severity are one group line with the title of their kind and their
// count (SR-223 AK3), which opens to their lines and whose Enter or click opens the list of their elements, a
// test case is a line with its executions as runs (`runs.ts`, SR-223 AK4), everything else is a quiet indented
// outline. The share of a
// verification degree (`share` next to `counts`, SR-037) is a percentage by core's rule of every access
// (`degreePercent`, one decimal rounded down, ThomasBirkmaier/ReqSeq-archive#592 Q3). A UUID the output names in `names` (ThomasBirkmaier/ReqSeq-archive#588) is the row
// of its element, and `names` itself is not shown. A record of exactly two named UUIDs, such as a replaced
// row of `variant.diff` (`core`, `replacement`), is one line that opens both side by side, read-only
// (SR-044 AK2); a row with a third field would be an outline again. A UUID in two repositories (SR-088)
// opens in the repository `names` gives first. A top-level `total`, `view` and `incomplete` describe the
// answer and go to the modeline (#276); the page says under the answer that an output is incomplete (SR-006
// AK2). Layout only: nothing here knows a command, the titles and marks come from the catalog (ADR-0002).
import type { CatalogEntry } from "@reqseq/core";
import { problemTitle } from "@reqseq/core/problem-titles";
import { degreePercent, degreeShareOf } from "@reqseq/core/verification-degree";
import type { ElementBuffer, ListBuffer } from "./buffers.js";
import { shownId, shownIdTitle } from "./id-title.js";
import {
  elementBuffer,
  elementBufferOf,
  outputList,
  outputSelectionList,
  readOnlyBuffer,
} from "./buffers.js";
import { isTestCase, testCaseLines } from "./runs.js";
import type { NextStep } from "./next-steps.js";
import { NEXT_FIELD, nextStepsOf } from "./next-steps.js";

/**
 * One line of the result buffer; `open` is the element Enter or a click opens. A pair line opens `open`
 * and `beside` side by side.
 */
export interface ResultLine {
  /**
   * A heading opens the problems of one severity (SR-223 AK1); a group line stands for the problems of one kind
   * (SR-223 AK3).
   */
  readonly kind: "element" | "problem" | "text" | "pair" | "heading" | "group" | "step";
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
  /**
   * The status of an element row whose record gives one, as a list row shows it (#276); a problem's kind, which
   * is technical and shown only with "Show details" (SR-223 AK2).
   */
  readonly status?: string;
  /** A technical value, or one equal to its normal value, shown only with "Show details" (SR-223 AK2, AK7). */
  readonly detail?: true;
  /** The key of the group of problems the line heads or, unfolded, belongs to (`groupKey`, SR-223 AK3). */
  readonly group?: string;
  /** A group line: whether it is open, so that its problems follow it. */
  readonly unfolded?: boolean;
  /**
   * The list Enter or a click opens: of the elements of a group's problems (SR-223 AK3), or of the elements a number
   * of the output counts (SR-223 AK5, `countList`).
   */
  readonly list?: ListBuffer;
  /** A step line (SR-226 AK5): the next step Enter or a click runs; its text is the name of the step's command. */
  readonly step?: NextStep;
}

/**
 * The call an output is the answer of, which a number of elements in it opens again as a list (SR-223 AK5): its
 * command and input, the name of its buffer, and whether it wrote (a write is never run again).
 */
export interface ResultOrigin {
  readonly command: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly written?: boolean;
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
  /** "Show details" is on for the buffer (SR-223 AK2): technical and normal values are shown, as details. */
  readonly details: boolean;
  /** The lines being walked belong to a technical or normal value, shown only with "Show details". */
  readonly detail: boolean;
  /** The keys of the groups of problems that are open (SR-223 AK3). */
  readonly unfolded: ReadonlySet<string>;
  /** The call of the output, for the lists its numbers of elements open (SR-223 AK5); none: they open nothing. */
  readonly origin?: ResultOrigin;
  /** The whole output, where a number of a write command finds the elements it counts. */
  readonly root: unknown;
  /** The items of the lists the walk is in, outermost first: the entries a number is keyed by (`x-key`). */
  readonly items: readonly Rec[];
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
 * Under a heading of its severity the line says no severity, elsewhere it starts with it; `kind`: its kind is shown.
 */
const problemLine = (problem: Rec, depth: number, headed: boolean, kind: boolean): ResultLine => {
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
    // The kind of a problem, which the catalog marks technical (SR-224 AK3): with "Show details" (SR-223 AK2).
    ...(kind ? { status: String(problem["code"]) } : {}),
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

/** Adds a line, marked as a detail inside a value "Show details" shows (`Walk.detail`). */
const emit = (walk: Walk, line: () => ResultLine): void => {
  const { sink } = walk;
  if (sink.lines.length < MAX_RESULT_LINES) {
    const made = line();
    sink.lines.push(walk.detail ? { ...made, detail: true } : made);
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

/**
 * The field at `path` of `record` is technical (SR-224 AK3), shown only with "Show details" (SR-223 AK2):
 * marked `true`, or `with-element` while the record, a problem, names an element (`elementId`).
 */
const isTechnical = (fields: Fields, path: string, record: Rec): boolean => {
  const technical = fields.get(path)?.technical;
  return technical === true || (technical === "with-element" && typeof record["elementId"] === "string");
};

/** A value "Show details" shows, under the title of its field (SR-223 AK2). */
export interface DetailValue {
  readonly label: string;
  readonly text: string;
}

/**
 * The technical values of `record`, an item at `path` of an output (`hints[]`), each under its title from
 * `fields` and in the order of the record, without the fields named in `except` and those without a value (`null`,
 * such as the commit of a file outside Git) (SR-223 AK2).
 */
export const technicalValues = (
  record: object,
  path: string,
  fields: readonly OutputField[],
  except: readonly string[] = [],
): DetailValue[] => {
  const byPath: Fields = new Map(fields.map((field) => [field.path, field]));
  return Object.entries(record).flatMap(([key, value]) => {
    const child = childOf(byPath, path, key);
    return except.includes(key) || value === null || !isTechnical(byPath, child.path, record as Rec)
      ? []
      : [{ label: child.label, text: scalar(value) }];
  });
};

/** The value is a UUID `names` names, or a non-empty list of them: the rows of their elements. */
const isNamed = (value: unknown, names: Names): boolean =>
  typeof value === "string"
    ? names.has(value)
    : Array.isArray(value) && value.length > 0 && value.every((each) => isNamed(each, names));

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
 * A problem's line (`problemLine`) at `path`, the path of its list; with "Show details" its kind at the end and
 * under it its technical values, each under its title (SR-223 AK2), such as the UUID of its element.
 */
const problemLines = (
  problem: Rec,
  depth: number,
  headed: boolean,
  path: string,
  walk: Walk,
  group?: string,
): void => {
  const kind = childOf(walk.fields, path, "code").path;
  // In a group, the group line names the kind.
  const shown = group === undefined && (walk.details || !isTechnical(walk.fields, kind, problem));
  emit(walk, () => {
    const line = problemLine(problem, depth, headed, shown);
    return group === undefined ? line : { ...line, group };
  });
  if (!walk.details) {
    return;
  }
  for (const [key, value] of Object.entries(problem)) {
    const child = childOf(walk.fields, path, key);
    if (key !== "code" && value !== null && isTechnical(walk.fields, child.path, problem)) {
      // As text, also a UUID `names` names: the problem's line already opens its element.
      emit(walk, () => ({
        kind: "text",
        depth: depth + 1,
        label: child.label,
        text: scalar(value),
        field: child.path,
        detail: true,
        ...(group === undefined ? {} : { group }),
      }));
    }
  }
};

/** The value at the dotted `path` of `value` (`a.b`, a leading dot allowed); undefined where it has none. */
const dig = (value: unknown, path: string): unknown =>
  path
    .split(".")
    .filter((part) => part !== "")
    .reduce<unknown>((at, part) => (isRecord(at) ? at[part] : undefined), value);

/**
 * The UUIDs of the elements at `path` of a write command's output, a field the catalog marks as the list a number
 * counts (`x-elements`); each `[]` of it is the item of that list the walk is in (`Walk.items`).
 */
const idsAt = (path: string, walk: Walk): string[] => {
  const parts = path.split("[]");
  const found = parts.reduce<unknown>(
    (_at, part, level) => dig(level === 0 ? walk.root : walk.items[level - 1], part),
    undefined,
  );
  return Array.isArray(found)
    ? found.flatMap((each: unknown) =>
        typeof each === "string" ? [each] : (str(isRecord(each) ? each["id"] : undefined) ?? []),
      )
    : [];
};

/**
 * The list of the elements a number of the output counts, which the catalog marks `x-elements` with the lists
 * or `selection` (SR-223 AK5): of a read command `selection.output` with the number (`count`: its field and, per
 * list it is in, the fields of its entry the catalog names, `x-key`), so the list holds exactly what the command
 * line, API and MCP give for it; of a write command, which is never run again, the elements of the lists the
 * catalog names in its own output. Its label is the name of the output's buffer, the values that name the entry
 * (not the technical ones) and the title of the number. Undefined for any other value, or without the call.
 */
const countList = (value: unknown, path: string, title: string, walk: Walk): ListBuffer | undefined => {
  const field = walk.fields.get(path);
  const elements = field?.elements;
  const { origin, items } = walk;
  const keys = field?.keys ?? [];
  if (
    typeof value !== "number" ||
    origin === undefined ||
    elements === undefined ||
    elements === true ||
    elements === "answer" ||
    keys.length !== items.length
  ) {
    return undefined;
  }
  const lists = path.split("[]");
  const key = keys.map((names, level) => {
    const item = items[level] ?? {};
    return Object.fromEntries(
      names.filter((name) => Object.hasOwn(item, name)).map((name) => [name, item[name]]),
    );
  });
  const naming = key.flatMap((entry, level) => {
    const list = lists.slice(0, level + 1).join("[]");
    return Object.entries(entry).flatMap(([name, each]) =>
      typeof each === "string" && walk.fields.get(`${list}[].${name}`)?.technical !== true ? [each] : [],
    );
  });
  const label = [origin.name, ...naming, title].join(" · ");
  if (origin.written === true) {
    const ids =
      typeof elements === "string" ? [] : [...new Set(elements.flatMap((each) => idsAt(each, walk)))];
    return ids.length === 0 ? undefined : outputList(label, ids);
  }
  return outputSelectionList(label, {
    command: origin.command,
    input: origin.input,
    count: { field: path, ...(keys.length === 0 ? {} : { key }) },
  });
};

/** The line of a value with the list its number of elements opens (`countList`), if it is one. */
const counted = (line: ResultLine, value: unknown, path: string, walk: Walk): ResultLine => {
  const list = countList(value, path, line.label, walk);
  return list === undefined ? line : { ...line, list };
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
  const { names } = walk;
  if (Array.isArray(value)) {
    if (label !== "") {
      emit(walk, () => ({ kind: "text", depth, label, text: String(value.length), field: path }));
    }
    // Problems of a list stand by severity, errors first (SR-223 AK1).
    const items = isProblemList(value) ? bySeverity(value) : (value as readonly unknown[]);
    const itemPath = `${path}[]`;
    for (const each of items) {
      const inside = isRecord(each) ? { ...walk, items: [...walk.items, each] } : walk;
      linesOf(each, label === "" ? depth : depth + 1, "", itemPath, inside, true);
    }
    return;
  }
  if (!isRecord(value)) {
    emit(walk, () => counted(leafLine(value, depth, label, path, names), value, path, walk));
    return;
  }
  const element = asElement(value);
  if (element !== undefined) {
    elementLines(element, value, depth, path, walk, item);
    return;
  }
  const pair = pairOf(value, names);
  if (pair !== undefined) {
    emit(walk, () => pairLine(pair, depth, childOf(walk.fields, path, pair.key).label));
    return;
  }
  if (isProblem(value)) {
    problemLines(value, depth, false, path, walk);
    return;
  }
  if (isTestCase(value)) {
    // Its executions as runs (SR-223 AK4), each variant by the title `names` gives it.
    for (const line of testCaseLines(value, depth, (id) => names.get(id)?.title, walk.details)) {
      emit(walk, () => line);
    }
    return;
  }
  outlineLines(value, depth, label, path, walk, item);
};

/**
 * The fields of an element entry its row shows or that name it (SR-223 AK6): its UUID, short ID, identifier, title
 * and status.
 */
const ROW_FIELDS: ReadonlySet<string> = new Set(["id", "shortId", "identifier", "title", "status"]);

/** The items at `path` (`elements[]`) are those of the field the catalog marks as the answer of the output. */
const isAnswer = (fields: Fields, path: string): boolean =>
  path.endsWith("[]") && fields.get(path.slice(0, -2))?.elements === "answer";

/**
 * The row of an element record with its status; an entry of the answer of an output page has its other fields below
 * its row, the state of the entry (SR-223 AK6).
 */
const elementLines = (
  element: Element,
  value: Rec,
  depth: number,
  path: string,
  walk: Walk,
  item: boolean,
): void => {
  emit(walk, () => withStatus(elementLine(element, depth), value));
  if (item && isAnswer(walk.fields, path)) {
    fieldLines(value, depth + 1, path, walk, ROW_FIELDS);
  }
};

/**
 * The fields of a record, each at its path under its title, without those of their normal value (SR-223 AK7) and
 * those of `skip`.
 */
const fieldLines = (
  value: Rec,
  depth: number,
  path: string,
  walk: Walk,
  skip: ReadonlySet<string> = new Set(),
): void => {
  const share = degreeShareOf(value);
  for (const [key, item] of Object.entries(value)) {
    const child = childOf(walk.fields, path, key);
    // A technical value that names elements is their rows, which are no detail (`isNamed`).
    const detail =
      isNormal(walk.fields, child.path, item) ||
      (isTechnical(walk.fields, child.path, value) && !isNamed(item, walk.names));
    if (!skip.has(key) && (walk.details || !detail)) {
      const shown = key === "share" && share !== undefined ? degreePercent(share) : item;
      linesOf(shown, depth, child.label, child.path, detail ? { ...walk, detail: true } : walk);
    }
  }
};

/** The UUID of an entry `names` names, which its row stands for. */
const ID_FIELD: ReadonlySet<string> = new Set(["id"]);

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
    emit(walk, () => elementLine(entry, depth));
    fieldLines(value, depth + 1, path, walk, ID_FIELD);
    return;
  }
  if (label !== "") {
    emit(walk, () => ({ kind: "text", depth, label, text: "", field: path }));
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

/** A problem of a top-level problem list with the path of its list, whose fields name what of it is technical. */
interface Listed {
  readonly problem: Rec;
  readonly path: string;
}

/** The key of the group of the problems of one kind and severity (SR-223 AK3). */
export const groupKey = (problem: Rec): string =>
  `${String(problem["severity"])}\u0000${String(problem["code"])}`;

/** The problems, in their order, by kind and severity: each group where its first problem stands. */
const groupsOf = (problems: readonly Listed[]): (readonly [Listed, ...Listed[]])[] => {
  const groups = new Map<string, [Listed, ...Listed[]]>();
  for (const listed of problems) {
    const key = groupKey(listed.problem);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [listed]);
    } else {
      group.push(listed);
    }
  }
  return [...groups.values()];
};

/**
 * Several problems of one kind (SR-223 AK3): one group line with the title of their kind (SR-224 AK6, its code
 * where the app knows no title) and their count, which opens the list of their elements; with "Show details"
 * the kind under it, as a detail. While it is open, each problem of the group follows it, one level in, with its
 * element (else its file and line) and its reason.
 */
const groupLines = (group: readonly [Listed, ...Listed[]], walk: Walk): void => {
  const [{ problem, path }] = group;
  const code = String(problem["code"]);
  const key = groupKey(problem);
  const title = problemTitle(code) ?? code;
  const unfolded = walk.unfolded.has(key);
  const ids = [...new Set(group.flatMap(({ problem: each }) => str(each["elementId"]) ?? []))];
  emit(walk, () => ({
    kind: "group",
    depth: 0,
    label: "",
    text: title,
    status: String(group.length),
    group: key,
    unfolded,
    ...(ids.length === 0 ? {} : { list: outputList(title, ids) }),
  }));
  if (walk.details) {
    const kind = childOf(walk.fields, path, "code");
    emit(walk, () => ({
      kind: "text",
      depth: 1,
      label: kind.label,
      text: code,
      field: kind.path,
      detail: true,
      group: key,
    }));
  }
  if (unfolded) {
    for (const { problem: each, path: from } of group) {
      problemLines(each, 1, true, from, walk, key);
    }
  }
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
  // Each problem with the path of its list, whose fields name what of it is technical.
  const listed = Object.entries(rest).flatMap(([key, value]) =>
    isProblemList(value) ? value.map((problem) => ({ problem, path: `${key}[]` })) : [],
  );
  // By severity, the order of the output kept within one (a stable sort).
  const problems = [...listed].sort((a, b) => rankOf(a.problem) - rankOf(b.problem));
  let heading: string | undefined;
  for (const group of groupsOf(problems)) {
    const [{ problem, path }] = group;
    const [, , title] = SEVERITIES[rankOf(problem)] ?? ["", "", "Other problems"];
    if (title !== heading) {
      heading = title;
      emit(walk, () => ({ kind: "heading", depth: 0, label: "", text: title }));
    }
    if (group.length === 1) {
      problemLines(problem, 0, true, path, walk);
    } else {
      groupLines(group, walk);
    }
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
 * rest; `fields` are the `outputFields` of its command, which give the titles, the normal values and what is
 * technical. Technical values and values equal to their normal value are left out, and shown as details while
 * `details` is on ("Show details", SR-223 AK2, AK7). `unfolded`: the keys of the groups of problems that are
 * open (`groupKey`, SR-223 AK3).
 */
export const resultLines = (
  output: unknown,
  fields: readonly OutputField[] = [],
  details = false,
  unfolded: readonly string[] = [],
  origin?: ResultOrigin,
): ResultLine[] => {
  const sink: Sink = { lines: [], rest: 0 };
  if (output !== undefined) {
    const { names, shown } = namesOf(output);
    const byPath = new Map(fields.map((field) => [field.path, field]));
    // The next steps are the last lines (SR-226 AK5), after the rest of the output; a list `next`, also an empty
    // one, is never a line of its own.
    const { rest: page } = splitSummary(shown, names);
    pageLines(isRecord(page) && Array.isArray(page[NEXT_FIELD]) ? withoutSteps(page) : page, {
      sink,
      names,
      fields: byPath,
      details,
      detail: false,
      unfolded: new Set(unfolded),
      ...(origin === undefined ? {} : { origin }),
      root: output,
      items: [],
    });
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
  const steps = nextStepsOf(output);
  if (steps.length > 0) {
    const title = fields.find((field) => field.path === NEXT_FIELD)?.title ?? NEXT_STEPS;
    lines.push({ kind: "heading", depth: 0, label: "", text: title });
    for (const step of steps) {
      lines.push({ kind: "step", depth: 0, label: "", text: step.command, step });
    }
  }
  return lines;
};

/** The heading of the next steps when the catalog gives their field no title. */
export const NEXT_STEPS = "Next steps";

/** The output without its next steps, which stand under their own heading at the end. */
const withoutSteps = (page: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> =>
  Object.fromEntries(Object.entries(page).filter(([key]) => key !== NEXT_FIELD));

/** The summary fields of an output (`splitSummary`) the modeline shows. */
export const resultSummary = (output: unknown): ResultSummary => {
  const { names, shown } = namesOf(output);
  return splitSummary(shown, names).summary;
};

/** The answer of an output (`answer`, SR-224 AK1), which heads its page (SR-223 AK1); undefined without one. */
export const resultAnswer = (output: unknown): string | undefined =>
  isRecord(output) ? str(output["answer"]) : undefined;
