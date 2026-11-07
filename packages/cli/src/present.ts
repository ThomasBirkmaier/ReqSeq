// The default output of the CLI for people (ADR-0009, ThomasBirkmaier/ReqSeq-archive#310): compact lines instead of the whole output
// object. Pure layout (ADR-0002 rule 3: no logic, no command named here): the form follows only the
// shape of the output, and whether the command reads or writes (its catalog `effect`), so every
// command of the catalog is covered. `--json` prints the output unchanged, `--yaml` all of it.
//
// - An element (an object with `shortId` and `title`) is one line, `SHORT-ID  status  title`, with its
//   identifier next to the short ID when it has one (`SR-3c90b0 (SR-036)`, ThomasBirkmaier/ReqSeq-archive#305), `[emergent]` when it
//   is marked emergent (SR-035), and its verification status per view at the end, apart from its own
//   status (`[verification: core verified]`, SR-031, D-030; the children missing for SR-034 as
//   `core open (missing SR-0000b2)`, the criteria of SR-031 AK5 as `core open 2 of 3 criteria (AK3 not
//   verified)`), then its validation status (`[validation: validated]`, SR-038;
//   an inconclusive one with its reason on one line, `[validation: inconclusive — <reason>]`, SR-172);
//   a list of them one such line per element, a search hit with its snippet (SR-174) on the line
//   below it, `  text: …line…` or the property's name instead of `text`, on a terminal cut to its width
//   and the marked words strong, as the marked words of the title; a list whose elements carry their text (element.list
//   `withText`) shows below each line its properties without relation targets, its relations one line
//   each and its text, with a blank line between elements (#397). A read command (element.get) shows
//   the element's details below its line, a write command only the line; there, a property whose
//   value is a list of texts numbers its items from 1 (`1: ...`), as tests name acceptance criteria
//   (#401).
// - A chain (`nodes` with `depth`, and `edges`) is an indented tree per direction with the depth in
//   front, its gaps, cycles and the edges to an element listed elsewhere marked. Its `evidence` is
//   indented below the element it belongs to (`evidenceLines`); the root's `validationRecords` below
//   the root, `validation  DATE  RESULT  ITEM  BELEG  [version V]` (#646). An element reached by a relation
//   whose meaning is not `derivation` names its kind (`[has-stakeholder]`), and a direction with such
//   an element is headed `upward:` or `downward:` instead of `parents:` or `children:` (#643).
// - A graph (`nodes` of elements with a `level`) with `evidence` summaries (trace.graph `withEvidence`,
//   SR-111 AK3) lists its nodes, each with its summary on the line below it:
//   `evidence: 2 test cases, 1 record · 2 passed, 1 failed`; the edges stay YAML.
// - A list of evidence records (`kind`, `date`, `result`, the reason of an inconclusive one) is one line per record, a list of test cases
//   (`name`, `executions`) one line per test case with its last result and the number of executions
//   (evidence.list, #275); `--json` and `--yaml` keep every execution.
// - A matrix (`columns` with `name` and `direction`, `rows` of elements with one cell per column) lists
//   its columns numbered with the head of each (the count, or with minima `met of expected · share`, as
//   the app, SR-153), then per row the element line and one line of cells, `n: SHORT-ID, ...`, `–` for an
//   empty cell, `[gap]` after a cell the row's `gaps` names (trace.matrix, #629).
// - A grouped list (element.list `group`, SR-149): each group of the page under its heading, its name
//   and value (a package by short ID and title, `(no value)` for the last group) and its count,
//   `continued` when it began on an earlier page; its elements below it as in a plain or a tree
//   list. The note on a short page counts the rows, an element once per group.
// - A list of elements with a `tree` of their places (`depth`, `parent`; one per element, element.list
//   by hierarchy, SR-075 AK2) is indented two spaces per level; an element whose parent is not shown
//   before it (on an earlier page) names it, `[under X]`.
// - The elements of a list narrowed by element.list `fields` (#982) are in `partial`, which a grouped
//   and a tree list read as `elements`; a row without `title` is no element, so such a list stays YAML.
// - A list of findings other than `problems` (the hints of hint.list) is one line per finding: the
//   element's short ID, the kind, the message and the hint ID when it has one.
// - A verification degree (`share` next to `counts`, SR-037), at any depth of a value printed as YAML,
//   shows its share as a percentage rounded down to one decimal (`degreePercent` of core, the rule of
//   every access, spec question ThomasBirkmaier/ReqSeq-archive#592 Q3): `share: 60 %`.
// - `names` (the elements an output gives elsewhere by UUID only, `common.schema.json#/$defs/elementName`,
//   ThomasBirkmaier/ReqSeq-archive#588) is not printed: those UUIDs print as the element instead, `SHORT-ID (IDENTIFIER)  title` in a
//   value printed as YAML (the lists of evidence.coverage, a variant `view`, the details of an element) and in a list of UUIDs one per
//   line (the lists of variant.diff), `SHORT-ID (IDENTIFIER)` in
//   the verification status of an element line, and `SHORT-ID  title` as the variant of a record of a
//   chain (#676). A UUID that `names` leaves out stays as it is.
// - Every other value stays YAML. Problems come last, each once: those of the output and the hints
//   at an element it shows; then `No problems.`, or how many findings the output left out (`hidden`).
//
// On a terminal (`renderHuman`'s `terminal`, from bin.ts; stdout a TTY, `TERM` not `dumb`, #988) the
// shapes most commands share take a terminal layout, styled by `style.ts` when the terminal has colours
// (not with `NO_COLOR`); everything above is the plain text that pipes, files and tests get, unchanged:
// - an element line (one element, a plain, tree or grouped list): the identifier first, strong, the
//   short ID faint after it (`SR-036 SR-3c90b0`), the status in a column as wide as the list needs,
//   the title cut with `…` to the terminal width, the marks after it faint. The title stays whole when
//   details follow (element.get, `withText`), which do not repeat it, and when less than `MIN_TITLE`
//   characters would be left (the line wraps anyway);
// - a tree list draws its tree with `├ └ │` from the parent of each element; an element whose parent
//   is not shown before it (`[under X]`) starts a tree of its own; the line goes on beside details;
// - a grouped list heads each group at the left, with a blank line before it: its title (else name,
//   else value) strong, then faint what names it besides and the count, `Wind  R1 PKG-0000d1 · 2`;
//   the columns are as wide as the whole page needs;
// - hints and problems show their severity first, coloured by it; the line after them is faint.
// No style is keyed to a status: statuses come from the metamodel. A matrix, a chain, a graph and the
// comparisons keep the plain layout on a terminal.
import { degreePercent, degreeShareOf, minimumHeadText } from "@reqseq/core";
import { stringify } from "yaml";
import { hiddenOf, problemsEnd, renderProblem } from "./render.js";
import type { Style, Terminal } from "./style.js";
import { PLAIN, cut, padTo, styleOf, widthOf } from "./style.js";

type Rec = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The longest reason a line shows; a longer one ends in `…` (`--json` and `--yaml` keep it whole). */
const REASON_LENGTH = 120;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * A reason (SR-172) on one line: each run of white space and control characters one space, cut to
 * `REASON_LENGTH` characters as the reader sees them (graphemes), so an emoji is never split.
 */
const reasonText = (value: unknown): string => {
  const line = text(value)
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim();
  // A string never has more graphemes than UTF-16 units, so a short one needs no segmenting, and
  // a long one is segmented only up to the cut.
  if (line.length <= REASON_LENGTH) {
    return line;
  }
  const kept: string[] = [];
  for (const { segment } of GRAPHEMES.segment(line)) {
    if (kept.length === REASON_LENGTH) {
      return `${kept.slice(0, REASON_LENGTH - 1).join("")}…`;
    }
    kept.push(segment);
  }
  return line;
};

/** The parts that are not empty, two spaces apart. */
const join = (...parts: readonly string[]): string => parts.filter((part) => part !== "").join("  ");

// No anchors and aliases: a record that is both an execution and `last` of a test case reads in full twice.
const yamlOf = (value: unknown): string => stringify(value, { lineWidth: 0, aliasDuplicateObjects: false });

const indent = (lines: readonly string[], by = "  "): string[] => lines.map((line) => `${by}${line}`);

/** `value` when it is a list, else an empty one. */
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);

/** `value` as YAML lines. */
const yamlLines = (value: unknown): string[] => yamlOf(value).replace(/\n$/, "").split("\n");

/** `value` with the share of every verification degree in it, in objects and lists, as its percentage (SR-037). */
const withPercent = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return (value as unknown[]).map(withPercent);
  }
  if (!isRecord(value)) {
    return value;
  }
  const share = degreeShareOf(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === "share" && share !== undefined ? degreePercent(share) : withPercent(item),
    ]),
  );
};

/** An element as outputs name it: at least its short ID and title. */
const isElement = (value: unknown): value is Rec & { readonly shortId: string; readonly title: string } =>
  isRecord(value) && typeof value["shortId"] === "string" && typeof value["title"] === "string";

/** A finding: `common.schema.json#/$defs/problem`. */
const isProblem = (value: unknown): value is Rec =>
  isRecord(value) &&
  typeof value["code"] === "string" &&
  typeof value["severity"] === "string" &&
  typeof value["message"] === "string";

/**
 * A short ID with the identifier next to it when there is one (ThomasBirkmaier/ReqSeq-archive#305): `SR-3c90b0 (SR-036)`; the
 * short ID alone otherwise.
 */
const withIdentifier = (shortId: string, identifier: unknown): string =>
  text(identifier) === "" ? shortId : `${shortId} (${text(identifier)})`;

/**
 * An element named on a terminal (#988): its identifier first, strong, the short ID faint after it,
 * `SR-036 SR-3c90b0`; the short ID alone, strong, when it has none. `withIdentifier` in plain text.
 */
const nameOn = (style: Style | undefined, shortId: string, identifier: unknown): string => {
  if (style === undefined) {
    return withIdentifier(shortId, identifier);
  }
  return text(identifier) === ""
    ? style.strong(shortId)
    : `${style.strong(text(identifier))} ${style.faint(shortId)}`;
};

/** Names an element by repository and UUID: its short ID when the list has it, else its UUID. */
type Namer = (repository: string, id: string) => string;

/** An element as `names` gives it (`common.schema.json#/$defs/elementName`, ThomasBirkmaier/ReqSeq-archive#588). */
const isElementName = (value: unknown): value is Rec & { readonly shortId: string; readonly title: string } =>
  isElement(value) && typeof value["id"] === "string" && typeof value["repository"] === "string";

/** The elements of `names` by UUID (the first of a UUID), when the output has them (ThomasBirkmaier/ReqSeq-archive#588). */
type Names = ReadonlyMap<string, Rec & { readonly shortId: string; readonly title: string }>;

/** `names` of an output by UUID (core gives each UUID once); empty when it has none or it is not a list of names. */
const namesIn = (output: Rec): Names => {
  const names = output["names"];
  if (!Array.isArray(names) || !names.every(isElementName)) {
    return new Map();
  }
  return new Map(names.map((name) => [text(name["id"]), name] as const));
};

/** A named element in a line: `SHORT-ID (IDENTIFIER)  title`. */
const nameText = (name: Rec & { readonly shortId: string; readonly title: string }): string =>
  join(withIdentifier(name.shortId, name["identifier"]), name.title);

/** A variant of a record by `nameText` when `names` has it, else its UUID (#676). */
const variantName = (id: string, names: Names): string => {
  const name = names.get(id);
  return name === undefined ? id : nameText(name);
};

/** `value` with every string that is a UUID of `names` as the element it names (`nameText`), in objects and lists. */
const withNames = (value: unknown, names: Names): unknown => {
  if (names.size === 0) {
    return value;
  }
  if (typeof value === "string") {
    const name = names.get(value);
    return name === undefined ? value : nameText(name);
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) => withNames(item, names));
  }
  return isRecord(value)
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withNames(item, names)]))
    : value;
};

/** A namer from the elements of a list. */
const namerOf =
  (elements: readonly Rec[]): Namer =>
  (repository, id) =>
    text(elements.find((e) => e["id"] === id && e["repository"] === repository)?.["shortId"]) || id;

/**
 * How an element points at the one before it on its path (trace.affected `via`, `path`, SR-024 AK1
 * "mit Weg und Abstand"): `[via derives-from from SR-00b002]`; without `from` when the one before
 * is the element asked for, the start of the path.
 */
const viaText = (element: Rec, name: Namer): string => {
  const via = element["via"];
  if (!isRecord(via)) {
    return "";
  }
  const how = via["kind"] === "reference" ? "reference" : text(via["key"]);
  const path = listOf(element["path"]).filter(isRecord);
  const before = path.length > 2 ? path[path.length - 2] : undefined;
  const from = before === undefined ? "" : ` from ${name(text(before["repository"]), text(before["id"]))}`;
  return `[via ${how}${from}]`;
};

/** Names a view of `verification` (`core` or a variant's UUID): the variant's short ID when the list has it. */
type ViewNamer = (view: string) => string;

/**
 * A view namer from the elements of a list; the elements of `names` first, with their identifier
 * (`SR-3c90b0 (SR-036)`, ThomasBirkmaier/ReqSeq-archive#588).
 */
const viewNamerOf =
  (elements: readonly Rec[], names: Names = new Map()): ViewNamer =>
  (view) => {
    const name = names.get(view);
    return name === undefined
      ? text(elements.find((e) => e["id"] === view)?.["shortId"]) || view
      : withIdentifier(name.shortId, name["identifier"]);
  };

/**
 * The acceptance criteria of a verification entry (SR-031 AK5): ` 2 of 3 criteria (AK3 not
 * verified)`; nothing without `criteria`.
 */
const criteriaCountText = (criteria: unknown): string => {
  if (!isRecord(criteria)) {
    return "";
  }
  const open = listOf(criteria["notVerified"]).map((n) => `AK${String(n)}`);
  return ` ${String(criteria["verified"])} of ${String(criteria["total"])} criteria${open.length === 0 ? "" : ` (${open.join(", ")} not verified)`}`;
};

/**
 * The verification status of an element per view (SR-031), apart from its own status:
 * `[verification: core verified, VAR-0000c1 open (missing SR-0000b2, SR-0000b3)]`; nothing for an
 * element without one. The children that are missing for an indirect verification (SR-034 AK2) follow
 * their view. A variant or child is named by its short ID from the list, else from the element's own
 * relations (its validity, its incoming relations), else by its UUID: the output gives UUIDs only
 * (`missingChildren`, the open export format), so a child that neither lists is shown as its UUID. An
 * output that names them in `names` (ThomasBirkmaier/ReqSeq-archive#588) gives them all (`view` takes those first).
 */
const verificationText = (element: Rec, view: ViewNamer): string => {
  const entries = listOf(element["verification"]).filter(isRecord);
  const own = viewNamerOf(listOf(element["relations"]).filter(isRecord));
  const named = (id: string): string => {
    const listed = view(id);
    return listed === id ? own(id) : listed;
  };
  const entryText = (e: Rec): string => {
    const missing = listOf(e["missingChildren"]).map((id) => named(text(id)));
    return `${named(text(e["view"]))} ${text(e["status"])}${criteriaCountText(e["criteria"])}${missing.length === 0 ? "" : ` (missing ${missing.join(", ")})`}`;
  };
  return entries.length === 0 ? "" : `[verification: ${entries.map(entryText).join(", ")}]`;
};

/**
 * The validation status of an element (SR-038), apart from its verification status: `[validation: validated]`,
 * `[validation: inconclusive — <reason>]` with the reason of an inconclusive one (SR-172 AK2).
 */
const validationText = (element: Rec): string => {
  const validation = text(element["validation"]);
  const reason = reasonText(element["validationReason"]);
  return validation === "" ? "" : `[validation: ${validation}${reason === "" ? "" : ` — ${reason}`}]`;
};

/** `[emergent]` for an element marked emergent (SR-035), next to the `open` it explains; else nothing. */
const emergentText = (element: Rec): string => (element["emergent"] === true ? "[emergent]" : "");

/**
 * What an element line shows after the title: how it points, its mark emergent, its verification
 * status per view and its validation status (the plain and the terminal line alike).
 */
const marksOf = (element: Rec, name: Namer, view: ViewNamer): string[] => [
  viaText(element, name),
  emergentText(element),
  verificationText(element, view),
  validationText(element),
];

/**
 * `SHORT-ID  status  title`; an element with a distance has it in front, how it points behind, its
 * mark emergent and its verification status per view last.
 */
const elementLine = (
  element: Rec & { readonly shortId: string; readonly title: string },
  name: Namer = namerOf([]),
  view: ViewNamer = viewNamerOf([]),
): string => {
  const distance = element["distance"];
  return join(
    typeof distance === "number" ? String(distance) : "",
    withIdentifier(element.shortId, element["identifier"]),
    text(element["status"]),
    element.title,
    ...marksOf(element, name, view),
  );
};

/** One relation of an element: `-> kind  SHORT-ID  title`, the target state when it is not available. */
const relationLine = (r: Rec): string => {
  const state = text(r["targetState"]);
  return join(
    `${r["direction"] === "in" ? "<-" : "->"} ${text(r["kind"])}`,
    text(r["shortId"]) === "" ? text(r["id"]) : withIdentifier(text(r["shortId"]), r["identifier"]),
    text(r["title"]),
    state === "available" || state === "" ? "" : `[${state}]`,
  );
};

/**
 * Properties with every list of texts as a map from its item number, counted from 1, to the item, so
 * the YAML shows `1: ...` (#401); other values as they are.
 */
const numberedProperties = (properties: unknown): unknown =>
  isRecord(properties)
    ? Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
          key,
          Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string")
            ? new Map(value.map((item, i) => [i + 1, item]))
            : value,
        ]),
      )
    : properties;

/**
 * The details of an element below its line: what the line does not show, type and file first, the
 * relations one line each, the text last. The UUIDs of `names` in the values other than the
 * properties (shown as stored) print as the elements they name (`replacedBy`, `excludedBy`, SR-046 AK3).
 */
const elementDetails = (element: Rec, names: Names): string[] => {
  const {
    id,
    shortId: _shortId,
    identifier: _identifier,
    status: _status,
    title: _title,
    problems: _problems,
    verification: _verification,
    validation: _validation,
    validationReason: _validationReason,
    emergent: _emergent,
    repository,
    file,
    relations,
    text: body,
    ...rest
  } = element;
  const details: Record<string, unknown> = {
    id,
    type: rest["type"],
    file: `${text(repository)}:${text(file)}`,
    ...Object.fromEntries(
      Object.entries(rest).map(([key, value]) => [
        key,
        key === "properties" ? numberedProperties(value) : withNames(value, names),
      ]),
    ),
    relations: (Array.isArray(relations) ? relations : []).filter(isRecord).map(relationLine),
    text: body,
  };
  return indent(yamlLines(details));
};

/**
 * An element of a list that carries its text (element.list `withText`, #397), below its line: its
 * properties with lists of texts numbered from 1 (`1: ...`, the acceptance criteria), without those
 * that hold relation targets, which the relations show; the relations one line each; the text last.
 * Compact for review, smaller than the files (`--json` and `--yaml` keep everything).
 */
const listedElementDetails = (element: Rec): string[] => {
  const relations = listOf(element["relations"]).filter(isRecord);
  const targetKeys = new Set(relations.filter((r) => r["property"] === true).map((r) => text(r["kind"])));
  const properties = Object.fromEntries(
    Object.entries(isRecord(element["properties"]) ? element["properties"] : {}).filter(
      ([key]) => !targetKeys.has(key),
    ),
  );
  const details: Record<string, unknown> = {
    ...(Object.keys(properties).length > 0 ? { properties: numberedProperties(properties) } : {}),
    ...(relations.length > 0 ? { relations: relations.map(relationLine) } : {}),
    text: element["text"],
  };
  return indent(yamlLines(details));
};

/**
 * A hint of a list: who, in the form of a problem line (`element → target`, #252; the element by
 * short ID with identifier, else its file, the target the same way when core names it, #172), the
 * kind, the message and the hint ID.
 */
const findingLine = (finding: Rec, style?: Style): string => {
  // By short ID with identifier, as the other list lines of the CLI name elements: an identifier is
  // unique per type only, so alone it could name the wrong element (`--ref`).
  const elementShortId = text(finding["elementShortId"]);
  const element =
    elementShortId === ""
      ? text(finding["file"])
      : nameOn(style, elementShortId, finding["elementIdentifier"]);
  const targetShortId = text(finding["targetShortId"]);
  const target = targetShortId === "" ? "" : nameOn(style, targetShortId, finding["targetIdentifier"]);
  const who = target === "" ? element : element === "" ? `→ ${target}` : `${element} → ${target}`;
  const hintId = text(finding["hintId"]);
  const hint = hintId === "" ? "" : `hint: ${hintId}`;
  if (style === undefined) {
    return join(who, text(finding["code"]), text(finding["message"]), hint);
  }
  // On a terminal (#988) its severity first, coloured by it, the hint ID faint.
  const severity = text(finding["severity"]);
  return join(
    style.severity(severity, severity),
    who,
    text(finding["code"]),
    text(finding["message"]),
    style.faint(hint),
  );
};

/**
 * `line` cut to `room` columns (`cut`) with the words that `marks` names strong (core's marks of a
 * search hit, SR-174: never computed here); a mark the cut ends is strong up to the cut.
 */
const markedText = (line: string, marks: unknown, style: Style, room: number): string => {
  const shown = cut(line, room);
  const kept = shown === line ? line.length : shown.length - 1;
  let out = "";
  let at = 0;
  for (const mark of listOf(marks).filter(isRecord)) {
    const start = Math.max(at, Math.min(Number(mark["start"]), kept));
    const end = Math.max(start, Math.min(Number(mark["end"]), kept));
    out += `${line.slice(at, start)}${style.strong(line.slice(start, end))}`;
    at = end;
  }
  return `${out}${shown.slice(at)}`;
};

/**
 * The snippet of a search hit (element.search, SR-174), below its line: where it was found (`text`, or
 * the property's name) and the line core gives, on a terminal cut to its width past `indent`
 * columns, the marked words strong.
 */
const snippetLines = (element: Rec, style: Style = PLAIN, indent = 0): string[] => {
  const snippet = element["snippet"];
  if (!isRecord(snippet) || typeof snippet["text"] !== "string") {
    return [];
  }
  const where = `${snippet["field"] === "text" ? "text" : text(snippet["propertyName"])}:`;
  const room = style.width - indent - widthOf(where) - 3;
  return [`  ${style.faint(where)} ${markedText(snippet["text"], snippet["marks"], style, room)}`];
};

/** The lines of a plain list of elements below its key, on a terminal as `terminalListLines` (#988). */
const elementListLines = (
  elements: readonly (Rec & { readonly shortId: string; readonly title: string })[],
  names: Names,
  style: Style | undefined,
): string[] => {
  const name = namerOf(elements);
  const view = viewNamerOf(elements, names);
  if (style !== undefined) {
    return terminalListLines(
      elements.map((element) => [element, undefined]),
      "  ",
      style,
      name,
      view,
    );
  }
  // With their texts (element.list `withText`), each element with its details and a blank line
  // between them (#397); else one line each.
  if (elements.some((element) => typeof element["text"] === "string")) {
    return elements.flatMap((element, i) => [
      ...(i === 0 ? [] : [""]),
      ...indent([elementLine(element, name, view), ...listedElementDetails(element)]),
    ]);
  }
  return indent(elements.flatMap((element) => [elementLine(element, name, view), ...snippetLines(element)]));
};

/**
 * One output value, by its shape; the problems of an element it shows go to `lifted`. The UUIDs of
 * `names` print as the elements they name.
 */
const valueLines = (
  key: string,
  value: unknown,
  details: boolean,
  lifted: unknown[],
  names: Names = new Map(),
  style?: Style,
): string[] => {
  if (key === "incomplete" && typeof value === "boolean") {
    return value ? ["incomplete: true (a repository of the workspace is not on this machine)"] : [];
  }
  if (isElement(value)) {
    lifted.push(...listOf(value["problems"]));
    const view = viewNamerOf([], names);
    return [
      style === undefined
        ? elementLine(value, namerOf([]), view)
        : terminalElementLine(value, style, view, details),
      ...(details ? elementDetails(value, names) : []),
    ];
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${key}: none`];
    }
    if (value.every(isElement)) {
      return [`${key}:`, ...elementListLines(value, names, style)];
    }
    if (value.every(isProblem)) {
      return [`${key}:`, ...indent(value.map((finding) => findingLine(finding, style)))];
    }
    if (value.every(isEvidenceRecord)) {
      return [`${key}:`, ...indent(value.map(listedRecordLine))];
    }
    if (value.every(isTestCase)) {
      return [`${key}:`, ...indent(value.map(testCaseLine))];
    }
    if (value.every((item) => typeof item === "string")) {
      return [`${key}:`, ...indent(value.map((item) => text(withNames(item, names))))];
    }
  }
  return yamlLines({ [key]: withNames(withPercent(value), names) });
};

/** A node of a chain (trace.chain `nodes`), as far as the tree reads it. */
interface ChainNode extends Rec {
  readonly id: string;
  readonly repository: string;
  readonly shortId: string;
  readonly title: string;
  readonly depth: number;
}

/** An edge of a chain: from the child that stores it (`source`) to its parent (`target`). */
interface ChainEdge extends Rec {
  readonly source: string;
  readonly sourceRepository: string;
  readonly target: string;
  readonly targetRepository: string;
  readonly direction: string;
  readonly cyclic: boolean;
}

/**
 * How a trace.neighbourhood edge (one with `link`) relates when its meaning is not `derivation`: the
 * relation kind, else the link (`reference`); "" for a derivation and for an edge of trace.chain (#643).
 */
const otherKindOf = (edge: ChainEdge): string => {
  if (typeof edge["link"] !== "string" || edge["meaning"] === "derivation") {
    return "";
  }
  return typeof edge["kind"] === "string" ? edge["kind"] : edge["link"];
};

/** What the tree of a chain reads (`trace.chain`); gaps and unresolved derivations are read loosely. */
interface Chain extends Rec {
  readonly nodes: readonly ChainNode[];
  readonly edges: readonly ChainEdge[];
}

const isChainNode = (value: unknown): value is ChainNode =>
  isElement(value) &&
  typeof value["id"] === "string" &&
  typeof value["repository"] === "string" &&
  typeof value["depth"] === "number";

const isChainEdge = (value: unknown): value is ChainEdge =>
  isRecord(value) &&
  ["source", "sourceRepository", "target", "targetRepository", "direction"].every(
    (key) => typeof value[key] === "string",
  ) &&
  typeof value["cyclic"] === "boolean";

/** A chain: nodes with an ID, repository and depth, and edges between them. */
const isChain = (output: Rec): output is Chain =>
  Array.isArray(output["nodes"]) &&
  Array.isArray(output["edges"]) &&
  output["nodes"].every(isChainNode) &&
  output["edges"].every(isChainEdge);

const nodeKey = (direction: string, repository: string, id: string): string =>
  JSON.stringify([direction, repository, id]);

/** The short ID of an element of the chain, its UUID when it is not on this page. */
const shortIdIn = (chain: Chain, repository: string, id: string): string =>
  chain.nodes.find((n) => n.id === id && n.repository === repository)?.shortId ?? id;

/**
 * A derivation the chain could not follow: `up from SHORT-ID  kind  SHORT-ID  title  [state]`, the
 * other end by short ID when it has one, else by UUID.
 */
const unresolvedLine = (item: Rec, chain: Chain): string => {
  const other = text(item["shortId"]);
  return join(
    `${text(item["direction"])} from ${shortIdIn(chain, text(item["fromRepository"]), text(item["from"]))}`,
    text(item["kind"]),
    other === "" ? text(item["id"]) : withIdentifier(other, item["identifier"]),
    text(item["title"]),
    `[${text(item["targetState"])}]`,
  );
};

/** A place in a tree list: its depth, and the element it is shown below. */
interface Place extends Rec {
  readonly depth: number;
}

const isPlace = (value: unknown): value is Place => isRecord(value) && typeof value["depth"] === "number";

type Placed = readonly [Rec & { readonly shortId: string; readonly title: string }, Place];

/** The elements of a tree list with their places, in order; undefined when `tree` does not fit them. */
const treeListOf = (
  elements: readonly unknown[],
  tree: readonly unknown[],
): readonly Placed[] | undefined => {
  if (elements.length !== tree.length) {
    return undefined;
  }
  const placed: Placed[] = [];
  for (const [index, place] of tree.entries()) {
    const element = elements[index];
    if (!isElement(element) || !isPlace(place)) {
      return undefined;
    }
    placed.push([element, place]);
  }
  return placed;
};

/** An element of a list, with its place when the list is a tree. */
type Listed = readonly [Rec & { readonly shortId: string; readonly title: string }, Place | undefined];

/**
 * The lines of a run of listed elements, indented two spaces and two more per level of a tree: an
 * element whose parent is not shown before it in the run names it (`[under X]`); with their texts
 * (`withText`), each element with its details at its depth and a blank line between them (#397); a
 * search hit with its snippet below it.
 */
const listedLines = (listed: readonly Listed[], name: Namer, view?: ViewNamer): string[] => {
  const keyOf = (repository: unknown, id: unknown): string => JSON.stringify([text(repository), text(id)]);
  const before = new Set<string>();
  const lines: string[] = [];
  const withText = listed.some(([element]) => typeof element["text"] === "string");
  for (const [element, place] of listed) {
    const parent = place?.["parent"];
    const away = isRecord(parent) && !before.has(keyOf(parent["repository"], parent["id"]));
    const under = away ? `[under ${name(text(parent["repository"]), text(parent["id"]))}]` : "";
    const at = `  ${"  ".repeat(place?.depth ?? 0)}`;
    if (withText && lines.length > 0) {
      lines.push("");
    }
    lines.push(`${at}${join(elementLine(element, name, view), under)}`);
    // A search hit with its snippet (SR-174); none for an element of element.list.
    lines.push(...indent(snippetLines(element), at));
    if (withText) {
      lines.push(...indent(listedElementDetails(element), at));
    }
    before.add(keyOf(element["repository"], element["id"]));
  }
  return lines;
};

/** An element line on a terminal (#988): what goes before and after the element. */
interface Row {
  readonly element: Rec & { readonly shortId: string; readonly title: string };
  /** The tree lines in front of it (`├ `, `└ `, `│ `), already styled. */
  readonly lead: string;
  /** The tree lines in front of its details: `│ ` where a line goes on past them. */
  readonly below: string;
  /** `[under X]` when its parent is not shown before it. */
  readonly under: string;
}

/**
 * The tree lines of a run (#988), from the parent of each element (its index in the run, -1 for a
 * root: an element at depth 0, or one whose parent is not shown before it, `[under X]`, which starts
 * a tree of its own). An element is `├ ` when a later one has the same parent, else `└ `; each
 * ancestor below the root adds `│ ` when a later one has its parent, else two spaces.
 */
const treeLeads = (parents: readonly number[]): { lead: string; below: string }[] => {
  const later = new Set<number>();
  const more = parents.map(() => false);
  for (let i = parents.length - 1; i >= 0; i -= 1) {
    const parent = parents[i] ?? -1;
    more[i] = parent !== -1 && later.has(parent);
    later.add(parent);
  }
  // The lines in front of each element's children and details.
  const inner: string[] = [];
  return parents.map((parent, i) => {
    const outer = parent === -1 ? "" : (inner[parent] ?? "");
    const lead = parent === -1 ? "" : `${outer}${more[i] === true ? "├ " : "└ "}`;
    inner[i] = parent === -1 ? "" : `${outer}${more[i] === true ? "│ " : "  "}`;
    return { lead, below: inner[i] ?? "" };
  });
};

/**
 * The parent of each element of a run by its index, -1 for a root (see `treeLeads`): the nearest
 * element before it that its place names; without a named parent, the nearest one a level above it.
 */
const parentsOf = (listed: readonly Listed[]): { readonly parents: number[]; readonly away: boolean[] } => {
  const keyOf = (repository: unknown, id: unknown): string => JSON.stringify([text(repository), text(id)]);
  const shown = new Map<string, number>();
  const depths: number[] = [];
  const parents: number[] = [];
  const away: boolean[] = [];
  for (const [i, [element, place]] of listed.entries()) {
    const depth = place?.depth ?? 0;
    const parent = place?.["parent"];
    const index = isRecord(parent)
      ? (shown.get(keyOf(parent["repository"], parent["id"])) ?? -1)
      : depth > 0
        ? depths.lastIndexOf(depth - 1)
        : -1;
    away.push(isRecord(parent) && index === -1);
    parents.push(index);
    depths.push(depth);
    shown.set(keyOf(element["repository"], element["id"]), i);
  }
  return { parents, away };
};

/** The rows of a run of listed elements (#988): tree lines when it is a tree, `[under X]` as `listedLines`. */
const rowsOf = (listed: readonly Listed[], name: Namer, style: Style): Row[] => {
  const { parents, away } = parentsOf(listed);
  const leads = treeLeads(parents);
  return listed.map(([element, place], i) => {
    const parent = place?.["parent"];
    return {
      element,
      lead: style.faint(leads[i]?.lead ?? ""),
      below: style.faint(leads[i]?.below ?? ""),
      under:
        away[i] === true && isRecord(parent)
          ? `[under ${name(text(parent["repository"]), text(parent["id"]))}]`
          : "",
    };
  });
};

/** The widths of the columns of element lines on a terminal: the name (with tree lines) and the status. */
interface Columns {
  readonly name: number;
  readonly status: number;
}

/**
 * The name of an element on a terminal (#988, `nameOn`), the tree lines and the distance in front
 * when it has them.
 */
const terminalName = (row: Row, style: Style): string => {
  const { element } = row;
  const distance = element["distance"];
  return `${row.lead}${join(
    typeof distance === "number" ? String(distance) : "",
    nameOn(style, element.shortId, element["identifier"]),
  )}`;
};

const columnsOf = (rows: readonly Row[], style: Style): Columns => ({
  name: Math.max(0, ...rows.map((row) => widthOf(terminalName(row, style)))),
  status: Math.max(0, ...rows.map((row) => widthOf(text(row.element["status"])))),
});

/** The fewest characters of a title worth cutting it to; with less room it stays whole and the line wraps. */
const MIN_TITLE = 12;

/**
 * An element line on a terminal (#988): the name and the status each in a column of the list's width,
 * the title cut with `…` so the line fits the terminal, then the marks of `elementLine`, faint. The
 * title stays whole when details follow (`whole`: they do not repeat it) and when even a cut title
 * would not fit (less room than `MIN_TITLE`).
 */
const terminalLine = (
  row: Row,
  columns: Columns,
  at: string,
  style: Style,
  marks: { readonly name: Namer; readonly view: ViewNamer; readonly whole: boolean },
): string => {
  const { element } = row;
  const head = `${at}${padTo(terminalName(row, style), columns.name)}  ${
    columns.status === 0 ? "" : `${padTo(text(element["status"]), columns.status)}  `
  }`;
  const tail = join(...marksOf(element, marks.name, marks.view), row.under);
  const room = style.width - widthOf(head) - (tail === "" ? 0 : widthOf(tail) + 2);
  const title = markedText(
    element.title,
    element["titleMarks"],
    style,
    marks.whole || room < MIN_TITLE ? Number.POSITIVE_INFINITY : room,
  );
  return `${head}${join(title, style.faint(tail))}`;
};

/**
 * The lines of rows on a terminal, at `at`: each its line, with its texts (`withText`) its details
 * below, past the tree lines, and a blank line between elements, as `listedLines`.
 */
const terminalLines = (
  rows: readonly Row[],
  columns: Columns,
  at: string,
  style: Style,
  name: Namer,
  view: ViewNamer,
): string[] => {
  const withText = rows.some((row) => typeof row.element["text"] === "string");
  return rows.flatMap((row, i) => [
    ...(withText && i > 0 ? [""] : []),
    terminalLine(row, columns, at, style, { name, view, whole: withText }),
    ...indent(snippetLines(row.element, style, widthOf(`${at}${row.below}`)), `${at}${row.below}`),
    ...(withText ? indent(listedElementDetails(row.element), `${at}${row.below}`) : []),
  ]);
};

/** A run of listed elements on a terminal, its columns as wide as its own rows need. */
const terminalListLines = (
  listed: readonly Listed[],
  at: string,
  style: Style,
  name: Namer,
  view: ViewNamer,
): string[] => {
  const rows = rowsOf(listed, name, style);
  return terminalLines(rows, columnsOf(rows, style), at, style, name, view);
};

/** One element on a terminal, its line alone; with its details below (`whole`) its title is never cut. */
const terminalElementLine = (
  element: Rec & { readonly shortId: string; readonly title: string },
  style: Style,
  view: ViewNamer,
  whole: boolean,
): string => {
  const row: Row = { element, lead: "", below: "", under: "" };
  return terminalLine(row, columnsOf([row], style), "", style, { name: namerOf([]), view, whole });
};

/** A tree list (see the file comment), headed by `key`. */
const treeListLines = (placed: readonly Placed[], style: Style | undefined, key = "elements"): string[] => {
  if (placed.length === 0) {
    return [`${key}: none`];
  }
  const name = namerOf(placed.map(([element]) => element));
  return [
    `${key}:`,
    ...(style === undefined
      ? listedLines(placed, name)
      : terminalListLines(placed, "  ", style, name, viewNamerOf([]))),
  ];
};

/** A group of a grouped list (element.list `group`, SR-149), as far as its heading reads it. */
interface ListGroup extends Rec {
  readonly count: number;
  readonly offset: number;
}

const isListGroup = (value: unknown): value is ListGroup =>
  isRecord(value) && typeof value["count"] === "number" && typeof value["offset"] === "number";

/**
 * The heading of a group: `Draft (draft) · 2`, a package `PKG-0000d1 (R1)  Wind · 2`, the last group
 * `(no value) · 4`; `, continued` when it started on an earlier page.
 */
const groupHeading = (group: ListGroup, continued: boolean): string => {
  // A value is a text, a number or a boolean; numbers and booleans as JSON writes them.
  const value = typeof group["value"] === "string" ? group["value"] : JSON.stringify(group["value"]);
  const name = text(group["name"]);
  const label =
    group["value"] === undefined
      ? "(no value)"
      : typeof group["title"] === "string" || typeof group["identifier"] === "string"
        ? join(withIdentifier(value, group["identifier"]), text(group["title"]))
        : name === ""
          ? value
          : `${name} (${value})`;
  // The last group of a grouping by package or another relation property counts the elements whose
  // targets are all not available (not on this machine or not in the workspace, spec-frage #978).
  const unavailable = group["unavailable"];
  const missing =
    typeof unavailable === "number" ? `, ${String(unavailable)} with targets not available` : "";
  return `${label} · ${String(group.count)}${missing}${continued ? ", continued" : ""}`;
};

/**
 * The heading of a group on a terminal (#988): its title, else its name, else its value, strong; what
 * names it besides (the identifier and short ID of a package, the value next to a name) and the count
 * faint: `Wind  R1 PKG-0000d1 · 2`, `Draft  draft · 2`, `(no value)  4`.
 */
const terminalGroupHeading = (group: ListGroup, continued: boolean, style: Style): string => {
  const value = typeof group["value"] === "string" ? group["value"] : JSON.stringify(group["value"]);
  const title = text(group["title"]);
  const name = text(group["name"]);
  const [main, aside] =
    group["value"] === undefined
      ? ["(no value)", ""]
      : title !== ""
        ? [title, [text(group["identifier"]), value].filter((part) => part !== "").join(" ")]
        : typeof group["identifier"] === "string"
          ? [text(group["identifier"]), value]
          : name === ""
            ? [value, ""]
            : [name, value];
  const unavailable = group["unavailable"];
  const count = `${String(group.count)}${
    typeof unavailable === "number" ? `, ${String(unavailable)} with targets not available` : ""
  }${continued ? ", continued" : ""}`;
  return join(style.strong(main), style.faint([aside, count].filter((part) => part !== "").join(" · ")));
};

/**
 * A grouped list on a terminal (#988): each group under its heading at the left with a blank line
 * before it, its elements below it, the columns as wide as the whole page needs.
 */
const terminalGroupedLines = (
  groups: readonly ListGroup[],
  listed: readonly Listed[],
  start: number,
  style: Style,
  name: Namer,
  view: ViewNamer,
): string[] => {
  const end = start + listed.length;
  const shown = groups.flatMap((group) => {
    const first = Math.max(group.offset, start);
    const last = Math.min(group.offset + group.count, end);
    return first < last
      ? [
          {
            group,
            continued: first > group.offset,
            rows: rowsOf(listed.slice(first - start, last - start), name, style),
          },
        ]
      : [];
  });
  const columns = columnsOf(
    shown.flatMap(({ rows }) => rows),
    style,
  );
  return shown.flatMap(({ group, continued, rows }, i) => [
    ...(i === 0 ? [] : [""]),
    terminalGroupHeading(group, continued, style),
    ...terminalLines(rows, columns, "  ", style, name, view),
  ]);
};

/**
 * The key of the elements of a list: `partial` when they have only some fields (element.list `fields`,
 * #982), `hits` for the hits of a search (element.search `group`, SR-149 AK6).
 */
const elementsKey = (rest: Rec): "elements" | "partial" | "hits" =>
  rest["partial"] !== undefined ? "partial" : rest["hits"] !== undefined ? "hits" : "elements";

/**
 * A grouped list (element.list or element.search `group`, SR-149): each group on the page under its
 * heading, its elements indented below it as in a plain or a tree list, a hit with its snippet;
 * undefined for any other output.
 */
const groupedListLines = (rest: Rec, names: Names, style: Style | undefined): string[] | undefined => {
  const groups = rest["groups"];
  const key = elementsKey(rest);
  const elements = listOf(rest[key]);
  if (!Array.isArray(groups) || !groups.every(isListGroup) || !elements.every(isElement)) {
    return undefined;
  }
  if (elements.length === 0) {
    return [`${key}: none`];
  }
  const tree = Array.isArray(rest["tree"]) ? treeListOf(elements, rest["tree"]) : undefined;
  const listed: readonly Listed[] = tree ?? elements.map((element) => [element, undefined]);
  const name = namerOf(elements);
  const view = viewNamerOf(elements, names);
  const start = typeof rest["offset"] === "number" ? rest["offset"] : 0;
  if (style !== undefined) {
    return terminalGroupedLines(groups, listed, start, style, name, view);
  }
  const end = start + elements.length;
  // With their texts (`withText`), a blank line also before each heading but the first (#397).
  const withText = elements.some((element) => typeof element["text"] === "string");
  let headed = false;
  return [
    `${key}:`,
    ...groups.flatMap((group) => {
      const first = Math.max(group.offset, start);
      const last = Math.min(group.offset + group.count, end);
      if (first >= last) {
        return [];
      }
      const gap = withText && headed ? [""] : [];
      headed = true;
      return [
        ...gap,
        `  ${groupHeading(group, first > group.offset)}`,
        // The blank line between elements with texts stays empty.
        ...listedLines(listed.slice(first - start, last - start), name, view).map((line) =>
          line === "" ? line : `  ${line}`,
        ),
      ];
    }),
  ];
};

/** The key of the root among the nodes; `root/up` and `root/down` hold its parents and children. */
const ROOT = "root";

/** Marks by node key: `JSON` of `[direction, repository, id]`, or `root`. */
type Marks = Map<string, string[]>;

const mark = (marks: Marks, key: string, text: string): void => {
  marks.set(key, [...(marks.get(key) ?? []), text]);
};

/**
 * The mark of a gap: `[gap: no evidence]`; a requirement the view does not hold is no gap (#674):
 * `[not in view, holds in core, VAR-x]`, the variants by short ID when `names` has them.
 */
const gapMark = (gap: Rec, names: Names): string => {
  if (gap["kind"] !== "not-in-view") {
    return `[gap: ${text(gap["kind"]).replaceAll("-", " ")}]`;
  }
  const views = listOf(gap["views"]).map((view) => names.get(text(view))?.shortId ?? text(view));
  return `[not in view${views.length === 0 ? ", holds in no view" : `, holds in ${views.join(", ")}`}]`;
};

/** The marks of the gaps of each element of the chain, by `nodeKey("", repository, id)`. */
const gapMarks = (chain: Chain, names: Names): Marks => {
  const gaps: Marks = new Map();
  for (const gap of listOf(chain["gaps"]).filter(isRecord)) {
    mark(gaps, nodeKey("", text(gap["repository"]), text(gap["id"])), gapMark(gap, names));
  }
  return gaps;
};

/** The evidence items of a chain (`evidence`) by `nodeKey("", repository, id)`, read loosely. */
const evidenceByNode = (chain: Chain): ReadonlyMap<string, Rec> =>
  new Map(
    listOf(chain["evidence"])
      .filter(isRecord)
      .map((item) => [nodeKey("", text(item["repository"]), text(item["id"])), item]),
  );

/** The acceptance criteria a record names (D-072), `[criteria 1, 3]`; empty for one that holds for all. */
const criteriaText = (criteria: unknown): string => {
  const numbers = listOf(criteria).filter((n): n is number => typeof n === "number");
  return numbers.length === 0 ? "" : `[criteria ${numbers.join(", ")}]`;
};

/**
 * A record as one line: date, method (`withMethod`), result, the reason of an inconclusive one (SR-172),
 * item, Beleg, variant and criteria (D-072), the variant by
 * its short ID when `names` has it (#676).
 */
const recordLine = (record: Rec, withMethod: boolean, names: Names): string =>
  join(
    text(record["date"]),
    withMethod ? text(record["method"]) : "",
    text(record["result"]),
    reasonText(record["reason"]),
    text(record["item"]),
    // Where the Beleg is, as core gives it (#821).
    text(record["evidenceSource"]),
    text(record["variant"]) === "" ? "" : `[variant ${variantName(text(record["variant"]), names)}]`,
    criteriaText(record["criteria"]),
  );

/** An evidence record (`data-export.schema.json#/$defs/evidenceRecord`), as far as a line reads it. */
const isEvidenceRecord = (value: unknown): value is Rec =>
  isRecord(value) && ["kind", "date", "result"].every((key) => typeof value[key] === "string");

/** A test case with its executions (`data-export.schema.json#/$defs/testCase`). */
const isTestCase = (value: unknown): value is Rec =>
  isRecord(value) && typeof value["name"] === "string" && Array.isArray(value["executions"]);

/**
 * A record of a list of records (evidence.list, trace.affected, #275): `recordLine`, its kind when it
 * is no verification, the version it was recorded against and the baselines that hold that version.
 */
const listedRecordLine = (record: Rec): string => {
  const baselines = listOf(record["baselines"]).map(text);
  return join(
    record["kind"] === "verification" ? "" : text(record["kind"]),
    recordLine(record, true, new Map()),
    text(record["version"]) === "" ? "" : `[version ${text(record["version"])}]`,
    baselines.length === 0 ? "" : `[baselines: ${baselines.join(", ")}]`,
  );
};

/** A test case of a list as one line (#275): its name, then its last result and date and the number of executions. */
const testCaseLine = (test: Rec): string => {
  const className = text(test["className"]);
  const name = className === "" ? text(test["name"]) : `${className} › ${text(test["name"])}`;
  const last = test["last"];
  const executions = listOf(test["executions"]).length;
  return join(
    name,
    isRecord(last) ? `last: ${join(text(last["result"]), text(last["date"]))}` : "",
    test["executed"] === false ? "[not executed]" : "",
    `executions: ${String(executions)}`,
  );
};

/**
 * The evidence below an element of a chain (SR-033): per test case `test case  CLASS › NAME`, marked
 * `[not executed]` when it has no execution, with one line per execution below it (date, result,
 * item, Beleg); then one line per record without a test case, `record  DATE  METHOD  RESULT  ITEM
 * BELEG`. `item` gives the lines of the test cases and records, `under` those of the executions.
 */
const evidenceLines = (item: Rec, at: string, under: string, names: Names): string[] => {
  const lines: string[] = [];
  for (const test of listOf(item["testCases"]).filter(isRecord)) {
    const className = text(test["className"]);
    const name = className === "" ? text(test["name"]) : `${className} › ${text(test["name"])}`;
    lines.push(`${at}${join("test case", name, test["executed"] === false ? "[not executed]" : "")}`);
    for (const execution of listOf(test["executions"]).filter(isRecord)) {
      lines.push(`${under}${recordLine(execution, false, names)}`);
    }
  }
  for (const record of listOf(item["records"]).filter(isRecord)) {
    lines.push(`${at}${join("record", recordLine(record, true, names))}`);
  }
  return lines;
};

/**
 * The mark of an edge from another page on the node it leads to: `[under X]` for the edge the node
 * was reached by (`first`; never the root, which no edge reaches: an edge into it closes a cycle),
 * else `[cycle from X]` or `[also under X]`.
 */
const offPageMark = (first: boolean, cyclic: boolean, from: string): string =>
  first ? `[under ${from}]` : cyclic ? `[cycle from ${from}]` : `[also under ${from}]`;

/** The tree of a chain (see `treeOf`). */
interface Tree {
  readonly children: ReadonlyMap<
    string,
    readonly { readonly key: string; readonly node: ChainNode; readonly kind: string }[]
  >;
  /** References printed below the node an edge starts at (that node is on the page). */
  readonly references: ReadonlyMap<string, readonly string[]>;
  /** Marks on the node an edge leads to, for edges that start on another page. */
  readonly marks: Marks;
  readonly placed: ReadonlySet<string>;
}

/**
 * Tree edges: the first edge that reaches a node from a node of this page one level nearer the root.
 * Every other edge to it is a reference: below the node it starts at (`SHORT-ID  [cycle]`,
 * `SHORT-ID  [listed elsewhere]`), or, when that node is on another page, a mark on the node it leads
 * to: `[under X]` for the first edge to it (the one it was reached by), then `[cycle from X]` or
 * `[also under X]`.
 */
const treeOf = (chain: Chain, nodes: ReadonlyMap<string, ChainNode>, root: ChainNode | undefined): Tree => {
  const children = new Map<
    string,
    { readonly key: string; readonly node: ChainNode; readonly kind: string }[]
  >();
  const references: Marks = new Map();
  const marks: Marks = new Map();
  const placed = new Set<string>();
  const isRoot = (repository: string, id: string): boolean =>
    root?.repository === repository && root.id === id;
  for (const edge of chain.edges) {
    const [nearRepository, near, farRepository, far] =
      edge.direction === "up"
        ? [edge.sourceRepository, edge.source, edge.targetRepository, edge.target]
        : [edge.targetRepository, edge.target, edge.sourceRepository, edge.source];
    const nearKey = isRoot(nearRepository, near)
      ? `${ROOT}/${edge.direction}`
      : nodeKey(edge.direction, nearRepository, near);
    const nearNode = isRoot(nearRepository, near) ? root : nodes.get(nearKey);
    const farKey = isRoot(farRepository, far) ? ROOT : nodeKey(edge.direction, farRepository, far);
    const farNode = nodes.get(farKey);
    const farLabel = shortIdIn(chain, farRepository, far);
    const nearLabel = shortIdIn(chain, nearRepository, near);
    if (nearNode === undefined) {
      // The edge starts on another page: shown at the node it leads to.
      const first = farKey !== ROOT && !placed.has(farKey) && !marks.has(farKey);
      mark(marks, farKey, offPageMark(first, edge.cyclic, nearLabel));
    } else if (farNode !== undefined && !placed.has(farKey) && nearNode.depth === farNode.depth - 1) {
      placed.add(farKey);
      children.set(nearKey, [
        ...(children.get(nearKey) ?? []),
        { key: farKey, node: farNode, kind: otherKindOf(edge) },
      ]);
    } else {
      mark(references, nearKey, join(farLabel, edge.cyclic ? "[cycle]" : "[listed elsewhere]"));
    }
  }
  return { children, references, marks, placed };
};

/** The chain as a tree per direction: the root, then `parents:` and `children:` (see the file comment). */
const chainLines = (chain: Chain, names: Names): string[] => {
  const width = String(Math.max(...chain.nodes.map((n) => n.depth), 0)).length;
  const gaps = gapMarks(chain, names);
  const keyOf = (node: ChainNode): string =>
    node.depth === 0 ? ROOT : nodeKey(text(node["direction"]), node.repository, node.id);
  const nodes = new Map(chain.nodes.map((node) => [keyOf(node), node]));
  const root = nodes.get(ROOT);
  const { children, references, marks, placed } = treeOf(chain, nodes, root);
  const evidence = evidenceByNode(chain);
  const line = (node: ChainNode, kind = ""): string =>
    join(
      elementLine(node),
      kind === "" ? "" : `[${kind}]`,
      ...(gaps.get(nodeKey("", node.repository, node.id)) ?? []),
      node["expanded"] === false ? "[not expanded]" : "",
      ...(marks.get(keyOf(node)) ?? []),
    );
  // The depth in front, then two spaces per level of the tree below the first.
  const prefix = (depth: number, level: number): string =>
    `  ${String(depth).padStart(width)}  ${"  ".repeat(level - 1)}`;
  const lines: string[] = root === undefined ? [] : [line(root)];
  // The evidence of a node of the downward chain (or the root) one level below it.
  const evidenceOf = (node: ChainNode, level: number): void => {
    const item = node["direction"] === "up" ? undefined : evidence.get(nodeKey("", node.repository, node.id));
    if (item !== undefined) {
      const at = prefix(node.depth + 1, level + 1);
      lines.push(...evidenceLines(item, at, `${" ".repeat(at.length)}  `, names));
    }
  };
  if (root !== undefined) {
    evidenceOf(root, 0);
    // The root's validation records (#646), one level below it, each with its version (SR-038 AK2).
    for (const record of listOf(chain["validationRecords"]).filter(isRecord)) {
      lines.push(
        `${prefix(1, 1)}${join(
          "validation",
          recordLine(record, true, names),
          text(record["version"]) === "" ? "" : `[version ${text(record["version"])}]`,
        )}`,
      );
    }
  }
  const walk = (key: string, depth: number, level: number): void => {
    for (const child of children.get(key) ?? []) {
      lines.push(`${prefix(child.node.depth, level + 1)}${line(child.node, child.kind)}`);
      evidenceOf(child.node, level + 1);
      walk(child.key, child.node.depth, level + 1);
    }
    for (const reference of references.get(key) ?? []) {
      lines.push(`${prefix(depth + 1, level + 1)}${reference}`);
    }
  };
  for (const [direction, label, otherLabel] of [
    ["up", "parents:", "upward:"],
    ["down", "children:", "downward:"],
  ] as const) {
    const section = chain.nodes.filter((node) => node["direction"] === direction);
    if (section.length > 0) {
      const derivedOnly = chain.edges.every(
        (edge) => edge.direction !== direction || otherKindOf(edge) === "",
      );
      lines.push(derivedOnly ? label : otherLabel);
      walk(`${ROOT}/${direction}`, 0, 0);
      // Nodes whose parent is on another page: not nested, the parent named by `[under X]`.
      for (const node of section) {
        const key = keyOf(node);
        if (!placed.has(key)) {
          lines.push(`${prefix(node.depth, 1)}${line(node)}`);
          evidenceOf(node, 1);
          walk(key, node.depth, 1);
        }
      }
    }
  }
  const unresolved = listOf(chain["unresolved"])
    .filter(isRecord)
    .map((item) => `  ${unresolvedLine(item, chain)}`);
  return [...lines, ...(unresolved.length === 0 ? [] : ["unresolved:", ...unresolved])];
};

/** A summary of the evidence below a node of a graph (trace.graph `evidence`). */
type EvidenceSummary = Rec & { readonly testCases: number; readonly records: number; readonly results: Rec };

const isEvidenceSummary = (value: unknown): value is EvidenceSummary =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["testCases"] === "number" &&
  typeof value["records"] === "number" &&
  isRecord(value["results"]);

/** A graph with evidence: `nodes` of elements with a `level`, and `evidence` summaries. */
const isGraphWithEvidence = (output: Rec): boolean => {
  const { nodes, evidence } = output;
  return (
    Array.isArray(nodes) &&
    nodes.length > 0 &&
    nodes.every((n) => isElement(n) && typeof n["level"] === "number") &&
    Array.isArray(evidence) &&
    evidence.every(isEvidenceSummary)
  );
};

/** `n thing`, `n things`. */
const counted = (n: number, thing: string): string => `${String(n)} ${thing}${n === 1 ? "" : "s"}`;

/** `evidence: 2 test cases, 1 record · 2 passed, 1 failed` (a count of 0 left out). */
const evidenceSummaryLine = (summary: EvidenceSummary): string => {
  const kinds = [
    summary.testCases > 0 ? counted(summary.testCases, "test case") : "",
    summary.records > 0 ? counted(summary.records, "record") : "",
  ]
    .filter((part) => part !== "")
    .join(", ");
  const results = Object.entries(summary.results)
    .map(([result, n]) => `${String(n)} ${result}`)
    .join(", ");
  return `evidence: ${[kinds, results].filter((part) => part !== "").join(" · ")}`;
};

/** The nodes of a graph, each with the summary of its evidence on the line below (SR-111 AK3). */
const graphNodeLines = (output: Rec): string[] => {
  const nodes = listOf(output["nodes"]).filter(isElement);
  const summaries = new Map(
    listOf(output["evidence"])
      .filter(isEvidenceSummary)
      .map((summary) => [nodeKey("", text(summary["repository"]), text(summary["id"])), summary]),
  );
  const lines = ["nodes:"];
  for (const node of nodes) {
    lines.push(`  ${elementLine(node)}`);
    const summary = summaries.get(nodeKey("", text(node["repository"]), text(node["id"])));
    if (summary !== undefined) {
      lines.push(`    ${evidenceSummaryLine(summary)}`);
    }
  }
  return lines;
};

/** A column of a matrix (trace.matrix `columns`): a name and a direction. */
const isMatrixColumn = (value: unknown): value is Rec =>
  isRecord(value) && typeof value["name"] === "string" && typeof value["direction"] === "string";

/** A matrix: `columns`, and `rows` of elements whose `cells` hold one list per column (#629). */
const isMatrix = (output: Rec): boolean => {
  const { columns, rows } = output;
  return (
    Array.isArray(columns) &&
    columns.every(isMatrixColumn) &&
    Array.isArray(rows) &&
    rows.every(
      (row) => isElement(row) && Array.isArray(row["cells"]) && row["cells"].length === columns.length,
    )
  );
};

/** A relation in a cell: the other end by short ID (else its UUID), `[outdated]` when it is. */
const cellItem = (relation: unknown): string => {
  if (!isRecord(relation)) {
    return "";
  }
  const shortId = text(relation["shortId"]);
  const state = text(relation["targetState"]);
  return join(
    shortId === "" ? text(relation["id"]) : withIdentifier(shortId, relation["identifier"]),
    state === "" || state === "available" ? "" : `[${state}]`,
    relation["outdated"] === true ? "[outdated]" : "",
  );
};

/**
 * The head of a matrix column (SR-153): with minima `met of expected · share` (core's `minimumHeadText`, as
 * the app), else the count of the rows with a relation.
 */
const columnHead = (column: Rec): string => {
  const { count, expected, met, share } = column;
  if (typeof share === "number" && typeof expected === "number" && typeof met === "number") {
    return minimumHeadText(met, expected, share);
  }
  return typeof count === "number" ? String(count) : "";
};

/** The columns of a matrix (#629), numbered, with their heads. */
const matrixColumnLines = (output: Rec): string[] => {
  const columns = listOf(output["columns"]).filter(isRecord);
  const lines = columns.length === 0 ? ["columns: none"] : ["columns:"];
  for (const [index, column] of columns.entries()) {
    lines.push(
      `  ${join(
        `${String(index + 1)}:`,
        text(column["name"]),
        `(${text(column["kind"])}, ${text(column["direction"])})`,
        columnHead(column),
      )}`,
    );
  }
  return lines;
};

/** The indexes of the columns that the row's `gaps` names (SR-153). */
const gapColumns = (row: Rec): ReadonlySet<number> =>
  new Set(
    listOf(row["gaps"])
      .filter(isRecord)
      .map((gap) => gap["column"])
      .filter((column): column is number => typeof column === "number"),
  );

/**
 * The rows of a matrix (#629): per row its element line and one line of cells, `n: SHORT-ID, ...` per
 * column, `–` for an empty cell, the target state when it is not available, `[gap]` after a cell below a
 * minimum (SR-153), and its test cases when the row has them (SR-126).
 */
const matrixRowLines = (output: Rec, names: Names): string[] => {
  const rows = listOf(output["rows"]).filter(isElement);
  if (rows.length === 0) {
    return ["rows: none"];
  }
  const lines = ["rows:"];
  const name = namerOf(rows);
  const view = viewNamerOf(rows, names);
  for (const row of rows) {
    const depth = row["depth"];
    lines.push(`  ${typeof depth === "number" ? "  ".repeat(depth) : ""}${elementLine(row, name, view)}`);
    const gaps = gapColumns(row);
    const cells = listOf(row["cells"]).map((cell, index) => {
      const items = listOf(cell).map(cellItem);
      return `${String(index + 1)}: ${items.length === 0 ? "–" : items.join(", ")}${gaps.has(index) ? " [gap]" : ""}`;
    });
    const tests = row["testCases"];
    const testText = Array.isArray(tests)
      ? `tests: ${
          tests.length === 0
            ? "–"
            : listOf(tests)
                .filter(isRecord)
                .map((t) => text(t["name"]))
                .join(", ")
        }`
      : "";
    const cellLine = join(...cells, testText);
    if (cellLine !== "") {
      lines.push(`    ${cellLine}`);
    }
  }
  return lines;
};

/**
 * The note on a page shorter than `total`. The page is the list of elements or findings: the nodes of a
 * chain, the elements of a list (never `names`), the hints of a list of hints (never `problems`).
 */
const pageNote = (output: Rec): string[] => {
  // A grouped list (SR-149) pages over its rows, an element once per group.
  const total = typeof output["rows"] === "number" ? output["rows"] : output["total"];
  const page = Object.entries(output).find(
    (entry): entry is [string, unknown[]] =>
      entry[0] !== "names" &&
      Array.isArray(entry[1]) &&
      entry[1].length > 0 &&
      // The rows of `partial` (element.list `fields`, #982) also without a title.
      (entry[1].every(isElement) ||
        entry[1].every(isProblem) ||
        (entry[0] === "partial" && entry[1].every(isRecord))),
  )?.[1];
  return typeof total === "number" && page !== undefined && page.length < total
    ? [`Showing ${String(page.length)} of ${String(total)}; ask for more with --offset and --limit.`]
    : [];
};

/**
 * The lines of a graph with evidence (its nodes with their summaries), of a grouped list or of a list
 * of elements with a `tree`, adding the keys they show to `shown`; none for any other output.
 */
const nodeListLines = (rest: Rec, shown: Set<string>, style: Style | undefined): string[] => {
  if (isGraphWithEvidence(rest)) {
    shown.add("nodes");
    shown.add("evidence");
    return graphNodeLines(rest);
  }
  const grouped = groupedListLines(rest, namesIn(rest), style);
  if (grouped !== undefined) {
    for (const key of [elementsKey(rest), "tree", "groups", "offset", "rows"]) {
      shown.add(key);
    }
    return grouped;
  }
  const tree = rest["tree"];
  const treeList = Array.isArray(tree) ? treeListOf(listOf(rest[elementsKey(rest)]), tree) : undefined;
  if (treeList === undefined) {
    return [];
  }
  shown.add(elementsKey(rest));
  shown.add("tree");
  return treeListLines(treeList, style, elementsKey(rest));
};

/**
 * The output for people (see the file comment). `details`: show an element's details below its line
 * (commands that read). `terminal`: the terminal stdout is, when the output is styled for one (#988);
 * plain text without it.
 */
export function renderHuman(output: unknown, details = true, terminal?: Terminal): string {
  const style = terminal === undefined ? undefined : styleOf(terminal);
  if (!isRecord(output)) {
    return output === undefined ? "" : yamlOf(output);
  }
  const { problems, ...rest } = output;
  const lines: string[] = [];
  const lifted: unknown[] = [];
  const chain = isChain(rest);
  if (chain) {
    lines.push(...chainLines(rest, namesIn(rest)));
  }
  const shown = chain
    ? new Set(["root", "nodes", "edges", "gaps", "evidence", "validationRecords", "unresolved"])
    : new Set<string>();
  if (isMatrix(rest)) {
    // The evidence header (the degree, SR-126 AK4) stands above the rows that hold the status.
    lines.push(...matrixColumnLines(rest));
    if (rest["evidence"] !== undefined) {
      lines.push(...valueLines("evidence", rest["evidence"], details, lifted, namesIn(rest)));
    }
    lines.push(...matrixRowLines(rest, namesIn(rest)));
    shown.add("columns");
    shown.add("evidence");
    shown.add("rows");
  }
  lines.push(...nodeListLines(rest, shown, style));
  // The findings left out are said after the problems (`problemsEnd`).
  if (hiddenOf(rest) !== undefined) {
    shown.add("hidden");
  }
  // The elements named by UUID elsewhere name those UUIDs instead of being printed (ThomasBirkmaier/ReqSeq-archive#588).
  const names = namesIn(rest);
  if (names.size > 0) {
    shown.add("names");
  }
  for (const [key, value] of Object.entries(rest)) {
    if (!shown.has(key)) {
      lines.push(...valueLines(key, value, details, lifted, names, style));
    }
  }
  lines.push(...pageNote(rest));
  return `${lines.map((line) => `${line}\n`).join("")}${problemsText(problems, lifted, rest, style ?? PLAIN)}`;
}

/**
 * The problems of the output and those lifted from the elements it shows, each once, then the line
 * after them (`problemsEnd`), faint on a terminal (#988).
 */
const problemsText = (problems: unknown, lifted: readonly unknown[], rest: Rec, style: Style): string => {
  const seen = new Set<string>();
  const all = [...listOf(problems), ...lifted].filter((problem) => {
    const key = JSON.stringify(problem);
    const first = !seen.has(key);
    seen.add(key);
    return first;
  });
  const end = Array.isArray(problems) ? problemsEnd(rest, all.length) : "";
  const shownEnd = end === "" ? end : `${style.faint(end.replace(/\n$/, ""))}\n`;
  return `${all.map((problem) => renderProblem(problem, style)).join("")}${shownEnd}`;
};
