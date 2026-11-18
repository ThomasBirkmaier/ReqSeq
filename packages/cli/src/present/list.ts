// Part of the CLI output for people (`../present.ts`, whose comment describes the layout): one value
// by its shape, and the lists of elements: plain, tree and grouped, in plain text and on a terminal.
import type { Style } from "../style.js";
import { padTo, widthOf } from "../style.js";
import type { Namer, Names, Rec } from "./common.js";
import {
  indent,
  isElement,
  isProblem,
  isRecord,
  join,
  listOf,
  nameOn,
  namerOf,
  text,
  withIdentifier,
  withNames,
  withPercent,
  yamlLines,
} from "./common.js";
import type { ViewNamer, criterionReferencesIn } from "./element.js";
import {
  criterionEntryLabel,
  elementDetails,
  elementLine,
  findingLine,
  listedElementDetails,
  markedText,
  marksOf,
  snippetLines,
  viewNamerOf,
} from "./element.js";
import { isEvidenceRecord, isTestCase, listedRecordLine, testCaseLine } from "./evidence.js";

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
export const valueLines = (
  key: string,
  value: unknown,
  details: boolean,
  lifted: unknown[],
  names: Names = new Map(),
  style?: Style,
  references?: ReturnType<typeof criterionReferencesIn>,
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
      ...(details ? elementDetails(value, names, references) : []),
    ];
  }
  // The criterion a reference names (element.resolve, SR-205 AK5): `criterion: AK2 (k7f3) [SR-036/AK-k7f3]: text`.
  if (key === "criterion" && isRecord(value) && typeof value["text"] === "string") {
    return [`criterion: ${criterionEntryLabel(value)}: ${value["text"]}`];
  }
  return (
    (Array.isArray(value) ? arrayLines(key, value, names, style) : undefined) ??
    yamlLines({ [key]: withNames(withPercent(value), names) })
  );
};

/** A list of one output value by the shape of its items; undefined for a list of another shape. */
const arrayLines = (
  key: string,
  value: readonly unknown[],
  names: Names,
  style: Style | undefined,
): string[] | undefined => {
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
  return undefined;
};

/** A place in a tree list: its depth, and the element it is shown below. */
interface Place extends Rec {
  readonly depth: number;
}

const isPlace = (value: unknown): value is Place => isRecord(value) && typeof value["depth"] === "number";

type Placed = readonly [Rec & { readonly shortId: string; readonly title: string }, Place];

/** The elements of a tree list with their places, in order; undefined when `tree` does not fit them. */
export const treeListOf = (
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
export const treeListLines = (
  placed: readonly Placed[],
  style: Style | undefined,
  key = "elements",
): string[] => {
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
 * names it besides (the short ID and identifier of a package, SR-084 AK4; the value next to a name) and
 * the count faint: `Wind  PKG-0000d1 (R1) · 2`, `Draft  draft · 2`, `(no value)  4`.
 */
const terminalGroupHeading = (group: ListGroup, continued: boolean, style: Style): string => {
  const value = typeof group["value"] === "string" ? group["value"] : JSON.stringify(group["value"]);
  const title = text(group["title"]);
  const name = text(group["name"]);
  const [main, aside] =
    group["value"] === undefined
      ? ["(no value)", ""]
      : title !== ""
        ? [title, withIdentifier(value, group["identifier"])]
        : typeof group["identifier"] === "string"
          ? [withIdentifier(value, group["identifier"]), ""]
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
export const elementsKey = (rest: Rec): "elements" | "partial" | "hits" =>
  rest["partial"] !== undefined ? "partial" : rest["hits"] !== undefined ? "hits" : "elements";

/**
 * A grouped list (element.list or element.search `group`, SR-149): each group on the page under its
 * heading, its elements indented below it as in a plain or a tree list, a hit with its snippet;
 * undefined for any other output.
 */
export const groupedListLines = (rest: Rec, names: Names, style: Style | undefined): string[] | undefined => {
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
