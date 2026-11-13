// The buffers of the main view (D-062): the window shows the most recent one, and after "Split window" a
// second one beside it (`window-layout.ts`, SR-115 AK3). A buffer is a list, a search result or an
// element. This module is the model and the reducer, no React.
import type {
  CommandTypes,
  DataExportRelation,
  ElementSelection,
  FilterSortKeyWithDefaults,
  TraceGraphInput,
} from "@reqseq/core";
import { fold } from "@reqseq/core/fold";
import { refIdTitle, shownIdTitle } from "./id-title.js";
import { hasSavedFilter } from "./list-filters.js";
import type { ListQuery, QueryChange } from "./list-query.js";
import { changeQuery, fitsView, queryIn } from "./list-query.js";

/** One step of a list filter: the text the label shows and what it adds to the selection (a condition or a saved filter). */
export interface FilterStep {
  readonly label: string;
  /** What the heading of the list says for this step instead of the label: the name of a type (SR-148). */
  readonly heading?: string;
  readonly selection: Pick<ElementSelection, "where" | "filter">;
  /**
   * The selection of a perspective (SR-214 AK2): the first step of its buffer, which "Clear list filter"
   * and "Clear all list filters" never take back.
   */
  readonly perspective?: true;
}

/** A perspective as `perspective.list` gives it. */
export type ListedPerspective = CommandTypes["perspective.list"]["output"]["perspectives"][number];

/**
 * What a perspective buffer shows (SR-214 AK2): the perspective by its name, and what was saved when the
 * buffer was opened (`saved`: the selection, grouping and sort; the grouping left out when it could no
 * longer be chosen at opening, SR-213 AK7). The buffer asks `element.list` with that, not with the name, so
 * a change of the file outside the app leaves the list as it is until the perspective is opened again
 * (SR-214, rationale). `warning` is core's warning that the grouping was left out, for a buffer that came
 * back at a restart: the minibuffer says it when the buffer is first shown, and it is then dropped.
 *
 * A buffer that came back at a restart for a name only a faulty file holds has nothing saved: it shows
 * core's refusal (`error`, `file.faulty`) and lists nothing, so it offers no list action and gives no
 * selection, until the perspective is opened again (`listing`).
 */
export type PerspectiveOrigin =
  | {
      readonly name: string;
      readonly saved: SavedPerspective;
      readonly warning?: string;
      readonly error?: undefined;
    }
  | {
      readonly name: string;
      readonly error: string;
      readonly saved?: undefined;
      readonly warning?: undefined;
    };

export interface SavedPerspective {
  readonly where: NonNullable<ElementSelection["where"]>;
  readonly filter?: string;
  readonly group?: string;
  readonly sort?: readonly FilterSortKeyWithDefaults[];
}

/**
 * The list of elements of the workspace: one buffer, changed in place when filtered, sorted or grouped. What
 * it asks is its query (`list-query.ts`): the steps, the sort and the grouping. The grouping is display
 * state like the sort, but not stored with the buffers (SR-149 AK5).
 */
export interface ListBuffer extends ListQuery {
  readonly kind: "list";
  readonly key: string;
  /** What the list holds: "All elements", or the labels of the steps joined by " · " ("type: need · status: draft"). */
  readonly label: string;
  /** What the steps select together, the input of `element.list` (`selectionOf`). */
  readonly selection?: ElementSelection;
  /**
   * The list shows as a traceability matrix (SR-125, D-062): the same selection and sort, `trace.matrix`
   * instead of `element.list`. A mode of the list buffer, not a buffer of its own; filtering, sorting and
   * clearing a filter keep it. The matrix shows no groups (`queryIn`).
   */
  readonly matrix?: true;
  /** Index of the selected row; `NO_ROW` while none is. */
  readonly cursor: number;
  /** The list is the buffer of a perspective (SR-214), keyed by its name (`perspectiveKey`). */
  readonly perspective?: PerspectiveOrigin;
}

/**
 * The hits of one search, filtered by steps and grouped like a list (SR-124 AK4, SR-149 AK6): its query
 * (`list-query.ts`) has steps and a grouping, no sort; the hits keep the order of the search.
 */
export interface SearchBuffer extends Omit<ListQuery, "sort"> {
  readonly kind: "search";
  readonly key: string;
  readonly query: string;
  /**
   * The fields the search is restricted to (SR-216 AK10), as `element.searchFields` names them; none: all fields.
   * They are no filter step: clearing the steps keeps them.
   */
  readonly fields?: readonly SearchField[];
  /** What the steps select together, the `selection` of `element.search` (`selectionOf`). */
  readonly selection?: ElementSelection;
  /** Index of the selected row; `NO_ROW` while none is. */
  readonly cursor: number;
}

/** A field a search can be restricted to (SR-216 AK3): its key for `element.search` `fields`, and its name. */
export interface SearchField {
  readonly key: string;
  readonly name: string;
}

/** The `fields` of `element.search` for the chosen fields: none without them, so the search is over all fields. */
export const fieldsInput = (
  fields: readonly SearchField[] | undefined,
): { readonly fields?: readonly string[] } =>
  fields === undefined || fields.length === 0 ? {} : { fields: fields.map((field) => field.key) };

/** One element. `repository` and `id` identify it: a UUID may exist in several repositories. */
export interface ElementBuffer {
  readonly kind: "element";
  readonly key: string;
  readonly id: string;
  readonly repository: string;
  /** "<short ID> (<identifier>) <title>" (SR-084 AK4). */
  readonly name: string;
  /**
   * The element is shown read-only (`readOnlyBuffer`), as a comparison shows it (SR-044 AK2): a buffer of
   * its own beside the element's editable one, whose input it never takes.
   */
  readonly readOnly?: true;
  /** A package page (SR-112): how its elements are sorted, kept while the buffer is open (as `ListBuffer.sort`). */
  readonly memberSort?: readonly FilterSortKeyWithDefaults[] | undefined;
  /** A package page (SR-112 AK2): the filter steps on its elements, as `ListBuffer.steps`; none when unset. */
  readonly memberSteps?: readonly FilterStep[];
  /** A package page: the selected row of its elements; set once the reader has used them. */
  readonly memberCursor?: number;
}

/** The calm start (SR-118): one line per element type with its count, then the elements opened last. */
export interface OverviewBuffer {
  readonly kind: "overview";
  readonly key: "overview";
  /** Index of the selected row; `NO_ROW` while none is. */
  readonly cursor: number;
}

/**
 * The neighbourhood of one element (SR-107): its parents, the tree of its children and its incoming
 * relations. `repository` and `id` identify the element as in `ElementBuffer`.
 */
export interface NeighbourhoodBuffer {
  readonly kind: "neighbourhood";
  readonly key: string;
  readonly id: string;
  readonly repository: string;
  /** "<short ID> (<identifier>) <title>" (SR-084 AK4) of the element. */
  readonly name: string;
  /** The rows of the tree whose children are shown, as `<repository>:<id>`. */
  readonly open: readonly string[];
  /** Index of the selected row: first the rows of the tree, then those of the incoming groups; `NO_ROW` while none is. */
  readonly cursor: number;
}

/**
 * The output of a catalog command that no other buffer shows (SR-073 AK2), laid out by its shape
 * (`result.ts`). It holds the output of the call that opened it, with the revision of the workspace it is
 * from; when the workspace changed, the view asks again with the same input.
 */
export interface ResultBuffer {
  readonly kind: "result";
  readonly key: string;
  readonly command: keyof CommandTypes;
  readonly input: Readonly<Record<string, unknown>>;
  /** The title of the command and the values given, as the command prompt showed them. */
  readonly name: string;
  readonly output: unknown;
  /** Why the last call failed; the output is then undefined. */
  readonly error?: string;
  readonly revision: number;
  readonly cursor: number;
  /**
   * The output of a write command (ThomasBirkmaier/ReqSeq-archive#85): shown as it came and never asked again when the workspace
   * changes, since asking again would write again.
   */
  readonly written?: true;
}

/** How far a graph goes from its element: a number of levels, or the whole chain (SR-111 AK2). */
export type GraphDepth = number | "all";

/**
 * The graph of one element (SR-111, D-063): the element and what hangs on it, in layers. The buffer holds
 * the input of `trace.graph` (the element, the depth, the kinds and meanings followed, the view); the app
 * only adds the size limit. `repository` and `id` identify the element as in `ElementBuffer`.
 */
export interface GraphBuffer {
  readonly kind: "graph";
  readonly key: string;
  readonly id: string;
  readonly repository: string;
  /** "<short ID> (<identifier>) <title>" (SR-084 AK4) of the element. */
  readonly name: string;
  readonly depth: GraphDepth;
  readonly kinds?: TraceGraphInput["kinds"];
  readonly meanings?: TraceGraphInput["meanings"];
  /** Also the summaries of the evidence below the nodes (SR-111 AK3, "Evidence" in the kind prompts). */
  readonly withEvidence?: true;
  readonly view?: TraceGraphInput["view"];
  /** The selected node as `<repository>:<id>`; not set: the element. */
  readonly selected?: string;
}

/**
 * The metamodel of the open workspace (SR-130), from `metamodel.get`: as a graph of its types,
 * inheritance, relation kinds and relation properties, or as text (AK5). One per workspace; Ctrl/Cmd+T
 * switches the mode (AK4) and the selected type stays.
 */
export interface MetamodelBuffer {
  readonly kind: "metamodel";
  readonly key: typeof METAMODEL_KEY;
  readonly mode: "graph" | "text";
  /**
   * The selected type, shared by the graph and the text: `type:<key>`, or `any` in the graph
   * (`@reqseq/core/metamodel-graph`); not set: the first type.
   */
  readonly selected?: string;
  /**
   * The selected row of the text when it is a relation kind (`relation:<key>`, `metamodel-text.ts`); not
   * set: the row of the selected type. The graph keeps its type then.
   */
  readonly row?: string;
}

export type Buffer =
  | ListBuffer
  | SearchBuffer
  | ElementBuffer
  | OverviewBuffer
  | NeighbourhoodBuffer
  | ResultBuffer
  | GraphBuffer
  | MetamodelBuffer;

/** Open buffers, the most recent first; the first one is shown. */
export type Buffers = readonly Buffer[];

export type BufferAction =
  /**
   * Shows `buffer`; one with the same key is replaced and moved to the front. `replacing` names a buffer
   * that `buffer` takes the place of under another key, which closes (a list saved as a perspective,
   * SR-214 AK5, becomes the buffer of that perspective).
   */
  | { readonly type: "open"; readonly buffer: Buffer; readonly replacing?: string }
  /** Shows the open buffer with this key. */
  | { readonly type: "switch"; readonly key: string }
  /**
   * Replaces the open buffer with the key of `buffer` where it is, without showing it (a view that read
   * its data again, SR-115 AK3: a buffer in the inactive area stays there); nothing when none is open.
   */
  | { readonly type: "update"; readonly buffer: Buffer }
  /** Closes the buffer; the next most recent one is shown, or the overview when none is left. */
  | { readonly type: "close"; readonly key: string }
  /** The workspace was opened: only `buffer` is open, or none. */
  | { readonly type: "reset"; readonly buffer?: Buffer }
  /**
   * The buffers open when the workspace was last left (SR-115 AK4): behind the open ones, so the shown
   * buffer (the overview, SR-118 AK1) stays; one with the key of an open buffer is left out.
   */
  | { readonly type: "restore"; readonly buffers: Buffers }
  /** The selected row of a list or search buffer, or of the elements of a package page. */
  | { readonly type: "cursor"; readonly key: string; readonly cursor: number }
  /**
   * The selected node of a graph, as `<repository>:<id>`, or the selected box or row of the metamodel
   * (`type:<key>`, `any`, `relation:<key>`).
   */
  | { readonly type: "select"; readonly key: string; readonly node: string }
  | RenameAction;

/**
 * The element was read or saved with this name (#273): its open element, read-only, neighbourhood and
 * graph buffers take it, where they are; the same buffers when none has another name.
 */
export interface RenameAction {
  readonly type: "rename";
  readonly id: string;
  readonly repository: string;
  readonly name: string;
}

/** The most buffers kept; the least recent one goes first. */
export const MAX_BUFFERS = 30;

export const LIST_KEY = "list";

export const OVERVIEW_KEY = "overview";

export const METAMODEL_KEY = "metamodel";

/**
 * The cursor of a list that has no row selected. A fresh list of the main window starts with none (SR-122
 * AK4): Down or Ctrl+N selects the first row, Enter opens it, and Ctrl+P stays "Go to" (AK5).
 */
export const NO_ROW = -1;

export const overviewBuffer = (): OverviewBuffer => ({ kind: "overview", key: OVERVIEW_KEY, cursor: NO_ROW });

/** Exactly one buffer is open and it is the overview: there is nothing to close. */
export const onlyOverview = (buffers: Buffers): boolean =>
  buffers.length === 1 && buffers[0]?.kind === "overview";

const makeList = (
  label: string,
  steps: readonly FilterStep[],
  selection: ElementSelection | undefined,
  sort: readonly FilterSortKeyWithDefaults[] | undefined,
  matrix: boolean,
  perspective?: PerspectiveOrigin,
): ListBuffer => ({
  kind: "list",
  key: perspective === undefined ? LIST_KEY : perspectiveKey(perspective.name),
  label,
  steps,
  cursor: NO_ROW,
  ...(selection === undefined ? {} : { selection }),
  ...(sort === undefined ? {} : { sort }),
  ...(matrix ? { matrix: true as const } : {}),
  ...(perspective === undefined ? {} : { perspective }),
});

/**
 * The key of the buffer of the perspective `name`: its name folded as core compares perspective names
 * (case, Unicode normal form), so the same perspective saved again in other case is the same buffer.
 */
export const perspectiveKey = (name: string): string => `perspective:${fold(name)}`;

/** The first step of a perspective buffer: its selection, headed by its name (SR-214 AK2). */
const perspectiveStep = (perspective: PerspectiveOrigin): FilterStep => ({
  label: `perspective: ${perspective.name}`,
  heading: perspective.name,
  selection:
    perspective.saved === undefined
      ? {}
      : {
          where: perspective.saved.where,
          ...(perspective.saved.filter === undefined ? {} : { filter: perspective.saved.filter }),
        },
  perspective: true,
});

/** What `perspective.list` gives as `saved`: the sort with its order, as `element.list` reads it. */
export const savedOf = (listed: ListedPerspective, grouped: boolean): SavedPerspective => ({
  where: listed.where,
  ...(listed.filter === undefined ? {} : { filter: listed.filter }),
  ...(listed.group === undefined || !grouped ? {} : { group: listed.group }),
  ...(listed.sort === undefined
    ? {}
    : { sort: listed.sort.map((key) => ({ by: key.by, order: key.order ?? "asc" })) }),
});

/**
 * The buffer of a perspective as it is saved (SR-214 AK2, AK4): its selection as the first step, its
 * grouping and its sort, a list (not the matrix), no row selected.
 */
export const perspectiveBuffer = (perspective: PerspectiveOrigin): ListBuffer => {
  const steps = [perspectiveStep(perspective)];
  const list = makeList(
    steps[0]?.label ?? perspective.name,
    steps,
    selectionOf(steps),
    perspective.saved?.sort,
    false,
    perspective,
  );
  const group = perspective.saved?.group;
  return group === undefined ? list : { ...list, group };
};

/** The steps of a list that its filter actions can take back: all but the selection of a perspective. */
export const ownSteps = (steps: readonly FilterStep[]): number =>
  steps.filter((step) => step.perspective !== true).length;

/** A list with one step: the selection under its label (or every element, without a selection). */
export const listBuffer = (
  label: string,
  selection?: ElementSelection,
  sort?: readonly FilterSortKeyWithDefaults[],
): ListBuffer =>
  makeList(label, selection === undefined ? [] : [{ label, selection }], selection, sort, false);

/**
 * What the steps select together (SR-124 AK1): the conditions of all steps in order, one alone as it
 * is, several as `all`, and the saved filter of the step that has one; undefined without steps. This
 * only builds the input of `element.list`; the core applies it (ADR-0002).
 */
export const selectionOf = (steps: readonly FilterStep[]): ElementSelection | undefined => {
  const conditions = steps.flatMap((step) =>
    step.selection.where === undefined ? [] : [step.selection.where],
  );
  const filter = steps.find((step) => step.selection.filter !== undefined)?.selection.filter;
  const [only] = conditions;
  const where = conditions.length > 1 ? { all: conditions } : only;
  const selection: ElementSelection = {
    ...(filter === undefined ? {} : { filter }),
    ...(where === undefined ? {} : { where }),
  };
  return Object.keys(selection).length === 0 ? undefined : selection;
};

/**
 * The list the steps give: "All elements" without steps, else the step labels joined by " · ". `matrix`
 * keeps the matrix mode (SR-125): every action that rebuilds a list passes the mode of the list it came from.
 */
export const filteredList = (
  steps: readonly FilterStep[],
  sort?: readonly FilterSortKeyWithDefaults[],
  matrix = false,
  perspective?: PerspectiveOrigin,
): ListBuffer =>
  makeList(
    steps.length === 0 ? "All elements" : steps.map((step) => step.label).join(" · "),
    steps,
    selectionOf(steps),
    sort,
    matrix,
    perspective,
  );

/** The buffer is a list in matrix mode (SR-125). */
export const inMatrix = (buffer: Buffer | undefined): buffer is ListBuffer =>
  buffer?.kind === "list" && buffer.matrix === true;

/** The view a list shows its query in. */
export const listView = (list: ListBuffer): "list" | "matrix" => (list.matrix === true ? "matrix" : "list");

/** What `list` asks: its steps, sort and grouping. */
export const queryOf = (list: ListBuffer): ListQuery => ({
  steps: list.steps,
  ...(list.sort === undefined ? {} : { sort: list.sort }),
  ...(list.group === undefined ? {} : { group: list.group }),
});

/**
 * The list that asks `query`, in `view`, from its first row: the parts the view does not show are dropped,
 * except in the buffer of a perspective (`perspective`), which keeps its grouping in the matrix and asks
 * without it there (`listGroup`), so it is grouped again as a list.
 */
export const listOf = (
  query: ListQuery,
  view: "list" | "matrix",
  perspective?: PerspectiveOrigin,
): ListBuffer => {
  const shown = queryIn(query, perspective === undefined ? view : "list");
  const list = filteredList(shown.steps, shown.sort, view === "matrix", perspective);
  return shown.group === undefined ? list : { ...list, group: shown.group };
};

/**
 * The same list with some parts of its query changed (other steps, another sort or grouping), from its
 * first row; the other parts, the mode and the perspective stay (SR-124, SR-149 AK3).
 */
export const withQuery = (list: ListBuffer, change: QueryChange): ListBuffer =>
  listOf(
    changeQuery(queryOf(list), change, list.perspective === undefined ? listView(list) : "list"),
    listView(list),
    list.perspective,
  );

/**
 * The same list in matrix mode, or (`on` false) as a list. The row and everything else stay, unless the
 * view drops a part of the query (the matrix shows no groups, SR-149): then the rows change and it starts
 * from the first row, since a row of the groups is another element in the matrix. A perspective buffer
 * keeps its grouping (`listOf`), and starts from the first row too.
 */
export const withMatrix = (list: ListBuffer, on: boolean): ListBuffer => {
  const view = on ? "matrix" : "list";
  if (!fitsView(queryOf(list), view)) {
    return listOf(queryOf(list), view, list.perspective);
  }
  const { matrix: _before, ...rest } = list;
  return on ? { ...rest, matrix: true } : rest;
};

/**
 * The buffer is a list that lists elements: not the buffer of a perspective that came back with nothing
 * saved (`PerspectiveOrigin`), which only shows why it cannot. The list actions and every command that takes
 * the shown list's selection act only on such a list.
 */
export const listing = (buffer: Buffer | undefined): buffer is ListBuffer =>
  buffer?.kind === "list" && buffer.perspective?.error === undefined;

/** The grouping a list asks for: none in the matrix, which shows no groups (SR-149). */
export const listGroup = (list: ListBuffer): string | undefined =>
  list.matrix === true ? undefined : list.group;

/** The same list grouped by `group`, or without groups (undefined), from its first row (SR-149 AK3). */
export const withGroup = (list: ListBuffer, group: string | undefined): ListBuffer =>
  withQuery(list, { group });

/**
 * The hits of `query` in `fields` (none: all fields) within the steps, grouped by `group` (none: not grouped), from
 * the first row. The same text in other fields is another buffer (SR-216 AK10).
 */
export const searchBuffer = (
  query: string,
  steps: readonly FilterStep[] = [],
  group?: string,
  fields: readonly SearchField[] = [],
): SearchBuffer => {
  const selection = selectionOf(steps);
  const keys = fields.map((field) => field.key).join(",");
  return {
    kind: "search",
    key: fields.length === 0 ? `search:${query}` : `search[${keys}]:${query}`,
    query,
    steps,
    cursor: NO_ROW,
    ...(fields.length === 0 ? {} : { fields }),
    ...(selection === undefined ? {} : { selection }),
    ...(group === undefined ? {} : { group }),
  };
};

/** What `search` asks besides its query: its steps and grouping. */
export const searchQueryOf = (search: SearchBuffer): ListQuery => ({
  steps: search.steps,
  ...(search.group === undefined ? {} : { group: search.group }),
});

/** The same search with some parts of its query changed (SR-124 AK4, SR-149 AK6), from its first row. */
export const withSearchQuery = (search: SearchBuffer, change: QueryChange): SearchBuffer => {
  const query = changeQuery(searchQueryOf(search), change, "search");
  return searchBuffer(search.query, query.steps, query.group, search.fields);
};

/**
 * " · in Rationale, Text · type: need · grouped by status": the fields, the steps and the grouping of a search,
 * nothing without them.
 */
const searchParts = (search: SearchBuffer): string =>
  `${search.fields === undefined ? "" : ` · in ${search.fields.map((field) => field.name).join(", ")}`}${search.steps.map((step) => ` · ${step.label}`).join("")}${
    search.group === undefined ? "" : ` · grouped by ${search.group}`
  }`;

export const elementBuffer = (id: string, repository: string, name: string): ElementBuffer => ({
  kind: "element",
  key: `element:${repository}:${id}`,
  id,
  repository,
  name,
});

/** The element of `buffer` shown read-only (SR-044 AK2), in a buffer of its own. */
export const readOnlyBuffer = (buffer: ElementBuffer): ElementBuffer => ({
  kind: "element",
  key: `read-only:${buffer.repository}:${buffer.id}`,
  id: buffer.id,
  repository: buffer.repository,
  name: buffer.name,
  readOnly: true,
});

export const neighbourhoodBuffer = (id: string, repository: string, name: string): NeighbourhoodBuffer => ({
  kind: "neighbourhood",
  key: `neighbourhood:${repository}:${id}`,
  id,
  repository,
  name,
  open: [],
  cursor: NO_ROW,
});

/** The result buffer of `command` with `input`: one per command and input, so running it again replaces it. */
export const resultBuffer = (
  command: keyof CommandTypes,
  input: Readonly<Record<string, unknown>>,
  name: string,
  output: unknown,
  revision: number,
  written = false,
): ResultBuffer => ({
  kind: "result",
  key: `result:${command}:${JSON.stringify(input)}`,
  command,
  input,
  name,
  output,
  revision,
  cursor: NO_ROW,
  ...(written ? { written: true } : {}),
});

/** The graph of an element, the direct neighbours over every kind (SR-111 AK2: the depth starts at 1). */
export const graphBuffer = (id: string, repository: string, name: string): GraphBuffer => ({
  kind: "graph",
  key: `graph:${repository}:${id}`,
  id,
  repository,
  name,
  depth: 1,
});

/** The metamodel buffer as a graph or as text, its first type selected. */
export const metamodelBuffer = (mode: MetamodelBuffer["mode"] = "graph"): MetamodelBuffer => ({
  kind: "metamodel",
  key: METAMODEL_KEY,
  mode,
});

/**
 * The selection of the metamodel buffer once `node` is selected: a type (or "Any type") is the selected
 * type of both modes; a relation kind, which only the text has as a row, leaves the type as it was.
 */
const selectIn = (buffer: MetamodelBuffer, node: string): MetamodelBuffer => {
  const { row: _before, ...rest } = buffer;
  return node.startsWith("relation:") ? { ...buffer, row: node } : { ...rest, selected: node };
};

/** The buffer of an element as a list row, a hit or a read element shows it. */
export const elementBufferOf = (element: {
  readonly id: string;
  readonly repository: string;
  readonly shortId: string;
  readonly identifier?: string | undefined;
  readonly title: string;
}): ElementBuffer =>
  elementBuffer(
    element.id,
    element.repository,
    shownIdTitle(element.shortId, element.identifier, element.title),
  );

/**
 * The action that names the buffers of `element` as it was read or saved (#273): a title changed in the
 * app or outside it shows in their names, in Go to and in "Saved <name>".
 */
export const renameAction = (element: Parameters<typeof elementBufferOf>[0]): RenameAction => ({
  type: "rename",
  id: element.id,
  repository: element.repository,
  name: elementBufferOf(element).name,
});

/**
 * The buffer of the element a relation points at (ThomasBirkmaier/ReqSeq-archive#416): its UUID in the repository of the target, named as
 * the relation shows it; undefined when the relation names no repository (a stored `repository` that is
 * not text).
 */
export const relationBuffer = (
  relation: Pick<DataExportRelation, "id" | "repository" | "shortId" | "identifier" | "title">,
): ElementBuffer | undefined =>
  relation.repository === undefined
    ? undefined
    : elementBuffer(relation.id, relation.repository, refIdTitle(relation));

/**
 * The order the lists of the app start with (ThomasBirkmaier/ReqSeq-archive#418): by type in the order of the metamodel, then by the
 * identifier, digit runs as numbers (SR-9 before SR-10). The app chooses this input; `element.list`
 * without `sort` keeps the workspace order for every other access (ADR-0002, D-029). A frozen constant,
 * so the list does not ask again for another object with the same keys.
 */
export const DEFAULT_SORT: readonly FilterSortKeyWithDefaults[] = Object.freeze([
  Object.freeze({ by: "type", order: "asc" }),
  Object.freeze({ by: "identifier", order: "asc" }),
] as const);

/**
 * The `sort` a list asks `element.list` for: the one chosen; else, with a saved filter among the
 * steps, none, so the sort of the filter holds (SR-070 AK3); else `DEFAULT_SORT`. A perspective buffer
 * asks with the sort as saved and nothing of its own (SR-213 AK4): without one, the sort of its saved
 * filter or the workspace order holds, as for `element.list` with the perspective.
 */
export const listSort = (buffer: ListBuffer): readonly FilterSortKeyWithDefaults[] | undefined =>
  buffer.sort ??
  (hasSavedFilter(buffer.steps) || buffer.perspective !== undefined ? undefined : DEFAULT_SORT);

const sameSort = (
  a: readonly FilterSortKeyWithDefaults[],
  b: readonly FilterSortKeyWithDefaults[],
): boolean =>
  a.length === b.length && a.every((key, index) => key.by === b[index]?.by && key.order === b[index].order);

/**
 * The buffer of a perspective no longer shows it as saved (SR-214 AK6): a filter step was added, or its
 * sort or grouping differs from the saved one. The mode does not count: in the matrix the buffer keeps its
 * grouping (`listOf`), so the matrix and back again change nothing. Saving under its name or opening it
 * again gives a buffer as saved (`perspectiveBuffer`).
 */
export const perspectiveModified = (list: ListBuffer): boolean => {
  const saved = list.perspective?.saved;
  if (saved === undefined) {
    return false;
  }
  const sortKept =
    list.sort === undefined || saved.sort === undefined
      ? list.sort === saved.sort
      : sameSort(list.sort, saved.sort);
  return ownSteps(list.steps) > 0 || !sortKept || list.group !== saved.group;
};

const SORT_WORDS: Readonly<Record<string, string>> = {
  id: "ID",
  title: "title",
  identifier: "ID",
  type: "type",
  status: "status",
};

/**
 * " · tree", " · sorted by title" (descending: "... descending"), " · workspace order" for `[]`, and
 * nothing for the default (not chosen, or chosen as "Type and ID"): the default says nothing (D-062).
 */
export const sortLabel = (sort: readonly FilterSortKeyWithDefaults[] | undefined): string => {
  if (sort === undefined || sameSort(sort, DEFAULT_SORT)) {
    return "";
  }
  const first = sort[0];
  if (first === undefined) {
    return " · workspace order";
  }
  if (first.by === "hierarchy") {
    return " · tree";
  }
  return ` · sorted by ${SORT_WORDS[first.by] ?? first.by}${first.order === "desc" ? " descending" : ""}`;
};

/**
 * The heading over the rows of a list or of a search result (SR-148): what the list shows, without a
 * description. A list says its steps, each by its heading if it has one (the name of a type), else by its
 * label; without steps, its label ("All elements").
 */
export const listHeading = (buffer: ListBuffer | SearchBuffer): string =>
  buffer.kind === "search"
    ? `Search: ${buffer.query}${buffer.steps.map((step) => ` · ${step.heading ?? step.label}`).join("")}`
    : buffer.steps.length === 0
      ? buffer.label
      : buffer.steps.map((step) => step.heading ?? step.label).join(" · ");

/** " · grouped by <key>", or nothing without a grouping. */
const groupLabel = (group: string | undefined): string =>
  group === undefined ? "" : ` · grouped by ${group}`;

/** The name of a buffer, as the minibuffer lists it and the sheet is labelled. */
export const bufferName = (buffer: Buffer): string => {
  switch (buffer.kind) {
    case "list":
      return `${buffer.label}${sortLabel(buffer.sort)}${groupLabel(listGroup(buffer))}${buffer.matrix === true ? " · matrix" : ""}`;
    case "search":
      return `Search: ${buffer.query}${searchParts(buffer)}`;
    case "element":
      return buffer.readOnly === true ? `${buffer.name} · read-only` : buffer.name;
    case "overview":
      return "Overview";
    case "neighbourhood":
      return `Neighbourhood: ${buffer.name}`;
    case "result":
      return buffer.name;
    case "graph":
      return `Graph: ${buffer.name}`;
    case "metamodel":
      return buffer.mode === "text" ? "Metamodel · text" : "Metamodel";
  }
};

const front = (buffers: Buffers, key: string, replacement?: Buffer): Buffers => {
  const found = buffers.find((buffer) => buffer.key === key);
  if (found === undefined) {
    return buffers;
  }
  return [replacement ?? found, ...buffers.filter((buffer) => buffer.key !== key)];
};

/** The open buffer with the key of `buffer` replaced by it where it is; the same buffers when none is open. */
const replaced = (buffers: Buffers, buffer: Buffer): Buffers =>
  buffers.some((open) => open.key === buffer.key)
    ? buffers.map((open) => (open.key === buffer.key ? buffer : open))
    : buffers;

/** `more` behind the open buffers, without one whose key is open. */
const restored = (buffers: Buffers, more: Buffers): Buffers => {
  const open = new Set(buffers.map((buffer) => buffer.key));
  const behind = more.filter((buffer) => !open.has(buffer.key));
  return behind.length === 0 ? buffers : [...buffers, ...behind].slice(0, MAX_BUFFERS);
};

/** The buffers of an element: those that carry its name. */
const namedAfter = (buffer: Buffer): buffer is ElementBuffer | NeighbourhoodBuffer | GraphBuffer =>
  buffer.kind === "element" || buffer.kind === "neighbourhood" || buffer.kind === "graph";

/** The buffers of the element `id` in `repository` named `name`; the same buffers when all are already. */
const renamed = (buffers: Buffers, id: string, repository: string, name: string): Buffers => {
  const stale = (buffer: Buffer): boolean =>
    namedAfter(buffer) && buffer.id === id && buffer.repository === repository && buffer.name !== name;
  return buffers.some(stale)
    ? buffers.map((buffer) => (stale(buffer) ? { ...buffer, name } : buffer))
    : buffers;
};

/** `buffer` in front, in place of the one with its key or with the key `replacing`. */
const opened = (buffers: Buffers, buffer: Buffer, replacing: string | undefined): Buffers => {
  const kept =
    replacing === undefined || replacing === buffer.key
      ? buffers
      : buffers.filter((open) => open.key !== replacing);
  const moved = front(kept, buffer.key, buffer);
  return (moved === kept ? [buffer, ...kept] : moved).slice(0, MAX_BUFFERS);
};

export const reduceBuffers = (buffers: Buffers, action: BufferAction): Buffers => {
  switch (action.type) {
    case "open":
      return opened(buffers, action.buffer, action.replacing);
    case "switch":
      return front(buffers, action.key);
    case "update":
      return replaced(buffers, action.buffer);
    case "close": {
      const rest = buffers.filter((buffer) => buffer.key !== action.key);
      if (rest.length === buffers.length) {
        return buffers;
      }
      if (rest.length > 0) {
        return rest;
      }
      // The last buffer closed: the window shows the overview, never an empty sheet (SR-118). The lone
      // overview stays as it is.
      return onlyOverview(buffers) ? buffers : [overviewBuffer()];
    }
    case "reset":
      return action.buffer === undefined ? [] : [action.buffer];
    case "restore":
      return restored(buffers, action.buffers);
    case "cursor":
      return buffers.map((buffer) => {
        if (buffer.key !== action.key || buffer.kind === "graph" || buffer.kind === "metamodel") {
          return buffer;
        }
        return buffer.kind === "element"
          ? { ...buffer, memberCursor: action.cursor }
          : { ...buffer, cursor: action.cursor };
      });
    case "select":
      return buffers.map((buffer) => {
        if (buffer.key !== action.key) {
          return buffer;
        }
        return buffer.kind === "graph"
          ? { ...buffer, selected: action.node }
          : buffer.kind === "metamodel"
            ? selectIn(buffer, action.node)
            : buffer;
      });
    case "rename":
      return renamed(buffers, action.id, action.repository, action.name);
  }
};

/** Shows the buffer: the open one with its key (its text and rows kept), else `buffer`, a new one. */
export const showBuffer = (
  context: { readonly buffers: Buffers; readonly dispatch: (action: BufferAction) => void },
  buffer: Buffer,
): void => {
  context.dispatch(
    context.buffers.some((open) => open.key === buffer.key)
      ? { type: "switch", key: buffer.key }
      : { type: "open", buffer },
  );
};
