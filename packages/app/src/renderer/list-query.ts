// What a list asks `element.list` (#993): the filter steps (SR-124), the sort and the grouping (SR-149),
// one value for the list buffer and for the elements of a package page (SR-112). Each view says which
// parts it shows, and a list that moves into a view drops the others; one rule says which parts are kept
// across a restart (`buffer-session.ts`, SR-115 AK4). A new part of a query is added here, and each view
// and the restart rule decide on it in one place. Only the input of the core is built (ADR-0002).
import type { FilterSortKeyWithDefaults } from "@reqseq/core";
import type { FilterStep } from "./buffers.js";

export interface ListQuery {
  /** The filter steps, each narrowing the list of the one before (SR-124 AK1); none: every element. */
  readonly steps: readonly FilterStep[];
  /**
   * How the list is sorted. Not set: nothing chosen yet, `listSort` tells what is asked for. `[]`: the
   * workspace order (the order of the store). Else the keys as `element.list` takes them.
   */
  readonly sort?: readonly FilterSortKeyWithDefaults[];
  /** The `group` of `element.list` (`type`, `status`, `package` or a property key); none: no groups. */
  readonly group?: string;
}

export type QueryPart = keyof ListQuery;

/** A change of some parts of a query; a part given as undefined is removed. */
export type QueryChange = { readonly [Part in Exclude<QueryPart, "steps">]?: ListQuery[Part] | undefined } & {
  readonly steps?: readonly FilterStep[];
};

/**
 * Where a query is shown: a list, a list in matrix mode (SR-125), the elements of a package page, the
 * hits of a search. The matrix lists each element once and has no groups; a package page has no groups
 * yet; a search is not sorted, its hits keep the order of the search (SR-124 AK4, SR-149 AK6).
 */
export type QueryView = "list" | "matrix" | "members" | "search";

/** Every display a query target can have. */
export const QUERY_VIEWS: readonly QueryView[] = ["list", "matrix", "members", "search"];

const VIEW_PARTS: Readonly<Record<QueryView, ReadonlySet<QueryPart>>> = {
  list: new Set(["steps", "sort", "group"]),
  matrix: new Set(["steps", "sort"]),
  members: new Set(["steps", "sort"]),
  search: new Set(["steps", "group"]),
};

/** The parts kept when the app starts again (SR-115 AK4): not the grouping (SR-149 AK5). */
const KEPT_PARTS: ReadonlySet<QueryPart> = new Set(["steps", "sort"]);

/** `view` shows the part `part` of a query: the actions that set it are offered there. */
export const supports = (view: QueryView, part: QueryPart): boolean => VIEW_PARTS[view].has(part);

const only = (query: ListQuery, parts: ReadonlySet<QueryPart>): ListQuery => ({
  steps: parts.has("steps") ? query.steps : [],
  ...(query.sort === undefined || !parts.has("sort") ? {} : { sort: query.sort }),
  ...(query.group === undefined || !parts.has("group") ? {} : { group: query.group }),
});

/** The query as `view` shows it: without the parts the view does not show. */
export const queryIn = (query: ListQuery, view: QueryView): ListQuery => only(query, VIEW_PARTS[view]);

/** The query as a restart keeps it. */
export const keptQuery = (query: ListQuery): ListQuery => only(query, KEPT_PARTS);

/** `query` with `change`, as `view` shows it. */
export const changeQuery = (query: ListQuery, change: QueryChange, view: QueryView): ListQuery => {
  const has = (part: QueryPart): boolean => Object.hasOwn(change, part);
  const sort = has("sort") ? change.sort : query.sort;
  const group = has("group") ? change.group : query.group;
  return queryIn(
    {
      steps: change.steps ?? query.steps,
      ...(sort === undefined ? {} : { sort }),
      ...(group === undefined ? {} : { group }),
    },
    view,
  );
};

/** Whether `view` shows every part of `query`, so moving it there changes no row. */
export const fitsView = (query: ListQuery, view: QueryView): boolean => {
  // By presence, not by object: a view that drops a part gives a new value for it.
  const shown = queryIn(query, view);
  return (
    shown.steps.length === query.steps.length &&
    (shown.sort === undefined) === (query.sort === undefined) &&
    (shown.group === undefined) === (query.group === undefined)
  );
};
