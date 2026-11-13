// The actions on a list, on the elements of a package page and on the hits of a search (SR-124, SR-125,
// SR-149, SR-112): filter, sort, group and the matrix. Each acts on a query target, the shown list, the
// elements of the shown package page or the shown search, and changes its query (`list-query.ts`); what
// the target's view does not show is not offered (a search is not sorted). Only the input of
// `element.list` and `element.search` is built (ADR-0002).
import type { ElementSelection, FilterSortKeyWithDefaults } from "@reqseq/core";
import type { Action, ActionContext, Choice, CommandIn } from "./actions.js";
import type { ElementBuffer, FilterStep, ListBuffer } from "./buffers.js";
import {
  DEFAULT_SORT,
  inMatrix,
  listBuffer,
  listOf,
  listView,
  ownSteps,
  queryOf,
  searchQueryOf,
  selectionOf,
  withMatrix,
  withQuery,
  withSearchQuery,
} from "./buffers.js";
import type { Answer, Call } from "./call.js";
import type { Shortcut } from "./keys.js";
import {
  hasSavedFilter,
  propertyChoices,
  savedStep,
  statusStep,
  textStep,
  typeStep,
} from "./list-filters.js";
import { groupChoices } from "./list-groups.js";
import type { ListQuery, QueryChange, QueryPart, QueryView } from "./list-query.js";
import { QUERY_VIEWS, queryIn, supports } from "./list-query.js";
import { PERSPECTIVE_ACTIONS } from "./perspective-actions.js";
import { memberQuery, memberSelection, packageSelection, withMemberQuery } from "./package-page.js";

/** Ctrl/Cmd+T shows the list as a traceability matrix (SR-125), and the matrix as a list again. */
export const MATRIX_SHORTCUT: Shortcut = { mod: true, shift: false, key: "t" };

export const currentList = (context: ActionContext): ListBuffer | undefined => {
  const current = context.buffers[0];
  return current?.kind === "list" ? current : undefined;
};

const isMatrix = (context: ActionContext): boolean => inMatrix(context.buffers[0]);

/** The shown element buffer when it is a package page (SR-112); its elements are a list that sorts like any list. */
export const packagePage = (context: ActionContext): ElementBuffer | undefined => {
  const shown = context.buffers[0];
  return shown?.kind === "element" && context.element?.members === true ? shown : undefined;
};

/**
 * What the list actions act on: the shown list, the elements of the shown package page (SR-112 AK2) or
 * the shown search (SR-124 AK4, SR-149 AK6). `query` is what it asks, `view` where it shows it,
 * `selection` what the steps select (on a page with the package, in a search with its text), the input of
 * `element.facets`; `apply` shows the same list, page or search with the query changed.
 */
interface QueryTarget {
  readonly query: ListQuery;
  readonly view: QueryView;
  readonly selection: ElementSelection | undefined;
  readonly apply: (change: QueryChange) => void;
}

const queryTarget = (context: ActionContext): QueryTarget | undefined => {
  const list = currentList(context);
  if (list !== undefined) {
    return {
      // As the view shows it: a perspective buffer in the matrix keeps a grouping it does not show.
      query: queryIn(queryOf(list), listView(list)),
      view: listView(list),
      selection: list.selection,
      apply: (change) => {
        context.dispatch({ type: "open", buffer: withQuery(list, change) });
      },
    };
  }
  const shown = context.buffers[0];
  if (shown?.kind === "search") {
    return {
      query: searchQueryOf(shown),
      view: "search",
      // What the filters offer are the values of the hits: the selection with the search's own text
      // condition, which selects what element.search finds (SR-068 AK3).
      selection: selectionOf([textStep(shown.query), ...shown.steps]),
      apply: (change) => {
        context.dispatch({ type: "open", buffer: withSearchQuery(shown, change) });
      },
    };
  }
  const page = packagePage(context);
  if (page === undefined) {
    return undefined;
  }
  const query = memberQuery(page);
  return {
    query,
    view: "members",
    selection: memberSelection(page.id, query.steps),
    // The page stays the element buffer (editor and draft included): the same key replaces it.
    apply: (change) => {
      context.dispatch({ type: "open", buffer: withMemberQuery(page, change) });
    },
  };
};

/** The catalog command each display of a query target runs (SR-210 AK5). */
const DISPLAY_COMMANDS: Readonly<Record<QueryView, CommandIn>> = {
  list: { where: "in the list", command: "element.list" },
  matrix: { where: "in the traceability matrix", command: "trace.matrix" },
  members: { where: "on the package page", command: "element.list" },
  search: { where: "in the list of search hits", command: "element.search" },
};

/** The catalog commands an action that sets `part` of the query runs, by the displays that show that part. */
const runsWhere = (part: QueryPart): readonly CommandIn[] =>
  QUERY_VIEWS.filter((view) => supports(view, part)).map((view) => DISPLAY_COMMANDS[view]);

/** The shown target sets `part` of its query: the action for it is offered. */
const sets =
  (part: QueryPart) =>
  (context: ActionContext): boolean => {
    const target = queryTarget(context);
    return target !== undefined && supports(target.view, part);
  };

const canFilter = sets("steps");
/** The target has a step its filter actions can take back: not the selection of a perspective (SR-214 AK6). */
const isFiltered = (context: ActionContext): boolean => {
  const steps = queryTarget(context)?.query.steps ?? [];
  return ownSteps(steps) > 0;
};

/** The steps the filter actions never take back: the selection of a perspective, first in its buffer. */
const fixedSteps = (steps: readonly FilterStep[]): readonly FilterStep[] =>
  steps.slice(0, steps.length - ownSteps(steps));

/** An action on the shown list or package page; without one it does nothing. */
const onTarget =
  (run: (context: ActionContext, target: QueryTarget) => void) =>
  (context: ActionContext): void => {
    const target = queryTarget(context);
    if (target !== undefined) {
      run(context, target);
    }
  };

/** An action on the shown list; without one it does nothing. */
const onList =
  (run: (context: ActionContext, list: ListBuffer) => void) =>
  (context: ActionContext): void => {
    const list = currentList(context);
    if (list !== undefined) {
      run(context, list);
    }
  };

export const choice = (name: string, run: () => void): Choice => ({ id: name, name, run });

// "Type and ID" is the explicit default and "Workspace order" is `[]`, so a choice holds on a list with a
// saved filter too (it does not fall back to the sort of the filter). "ID" is what the rows show.
const SORTS: readonly (readonly [string, readonly FilterSortKeyWithDefaults[]])[] = [
  ["Type and ID", DEFAULT_SORT],
  ["Workspace order", []],
  ["ID ascending", [{ by: "identifier", order: "asc" }]],
  ["ID descending", [{ by: "identifier", order: "desc" }]],
  ["Title ascending", [{ by: "title", order: "asc" }]],
  ["Title descending", [{ by: "title", order: "desc" }]],
  ["Type ascending", [{ by: "type", order: "asc" }]],
  ["Type descending", [{ by: "type", order: "desc" }]],
  ["Status ascending", [{ by: "status", order: "asc" }]],
  ["Status descending", [{ by: "status", order: "desc" }]],
  ["Hierarchy (tree)", [{ by: "hierarchy", order: "asc" }]],
];

/** The choices of the prompt "Sort by"; `apply` gets the sort of the one that is taken. */
const sortChoices = (apply: (sort: readonly FilterSortKeyWithDefaults[]) => void): Choice[] =>
  SORTS.map(([name, sort]) =>
    choice(name, () => {
      apply(sort);
    }),
  );

/** The names a filter can be chosen from, or why there are none. */
type Names =
  { readonly ok: true; readonly names: readonly string[] } | { readonly ok: false; readonly message: string };

interface FilterBy {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** The label of the prompt. */
  readonly label: string;
  readonly nothing: string;
  /** Without it, whenever a list is shown. */
  readonly available?: (context: ActionContext) => boolean;
  readonly names: (call: Call, target: QueryTarget) => Promise<Names>;
  readonly step: (name: string) => FilterStep;
}

/** The list or page with one more step; the rest of its query stays. */
const addStep = (target: QueryTarget, step: FilterStep): void => {
  target.apply({ steps: [...target.query.steps, step] });
};

const filterBy = (by: FilterBy): Action => ({
  id: by.id,
  title: by.title,
  description: by.description,
  runs: runsWhere("steps"),
  available: by.available ?? canFilter,
  run: onTarget((context, target) => {
    void by.names(context.shownCall ?? context.call, target).then((found) => {
      if (!found.ok) {
        context.echo(found.message);
      } else if (found.names.length === 0) {
        context.echo(by.nothing);
      } else {
        context.ask({
          label: by.label,
          items: found.names.map((name) =>
            choice(name, () => {
              addStep(target, by.step(name));
            }),
          ),
        });
      }
    });
  }),
});

/** The facets of the shown list or page: what its elements have, from the core (`element.facets`). */
const facetsOf = (call: Call, target: QueryTarget): Promise<Answer<"element.facets">> =>
  call("element.facets", target.selection === undefined ? {} : { selection: target.selection });

export const LIST_ACTIONS: readonly Action[] = [
  {
    id: "list-all",
    title: "List all elements",
    available: (context: ActionContext): boolean => context.workspace,
    run: (context: ActionContext): void => {
      context.dispatch({
        type: "open",
        buffer: listBuffer("All elements", undefined, currentList(context)?.sort),
      });
    },
  },
  // "Open perspective" (SR-214), next to "List all elements".
  ...PERSPECTIVE_ACTIONS,
  filterBy({
    id: "filter-type",
    title: "Filter list by type",
    description: "Keep only the elements of one type in the shown list.",
    label: "Type",
    nothing: "The metamodel has no types.",
    names: async (call: Call): Promise<Names> => {
      const answer = await call("metamodel.get", {});
      return answer.ok ? { ok: true, names: answer.output.types.map((type) => type.key) } : answer;
    },
    step: typeStep,
  }),
  filterBy({
    id: "filter-status",
    title: "Filter list by status",
    description: "Keep only the elements in one status in the shown list.",
    label: "Status",
    nothing: "The elements of this list have no status.",
    names: async (call: Call, target: QueryTarget): Promise<Names> => {
      const answer = await facetsOf(call, target);
      return answer.ok ? { ok: true, names: answer.output.statuses.map((status) => status.key) } : answer;
    },
    step: statusStep,
  }),
  {
    id: "filter-property",
    title: "Filter list by property",
    description: "Keep only the elements with one value of a property in the shown list.",
    available: canFilter,
    run: onTarget((context, target) => {
      void facetsOf(context.shownCall ?? context.call, target).then((answer) => {
        if (!answer.ok) {
          context.echo(answer.message);
          return;
        }
        const items = propertyChoices(
          answer.output,
          (step) => {
            addStep(target, step);
          },
          context.ask,
        );
        if (items.length === 0) {
          context.echo("No property of the elements in this list has values to choose from.");
        } else {
          context.ask({ label: "Property", items });
        }
      });
    }),
  },
  {
    id: "filter-text",
    title: "Filter list by text search",
    description: "Keep only the elements of the shown list that a text search finds.",
    available: canFilter,
    run: onTarget((context, target) => {
      context.ask({
        label: "Text",
        items: [],
        text: (text) => {
          const query = text.trim();
          if (query !== "") {
            addStep(target, textStep(query));
          }
        },
      });
    }),
  },
  filterBy({
    id: "filter-saved",
    title: "Filter list by saved filter",
    description: "Keep only the elements of the shown list that a saved filter finds.",
    label: "Filter",
    nothing: "The workspace has no saved filters.",
    available: (context) => {
      const target = queryTarget(context);
      return canFilter(context) && target !== undefined && !hasSavedFilter(target.query.steps);
    },
    names: async (call: Call): Promise<Names> => {
      const answer = await call("filter.list", {});
      return answer.ok ? { ok: true, names: answer.output.filters.map((filter) => filter.name) } : answer;
    },
    step: savedStep,
  }),
  {
    id: "clear-filter",
    title: "Clear list filter",
    description: "Take back the last filter of the shown list.",
    runs: runsWhere("steps"),
    available: isFiltered,
    run: onTarget((_context, target) => {
      target.apply({ steps: target.query.steps.slice(0, -1) });
    }),
  },
  {
    id: "clear-filters",
    title: "Clear all list filters",
    description: "Take back every filter of the shown list.",
    runs: runsWhere("steps"),
    // Offered on every filtered list, as the context menu of a list has it (SR-198 AK1).
    available: isFiltered,
    run: onTarget((_context, target) => {
      target.apply({ steps: fixedSteps(target.query.steps) });
    }),
  },
  {
    id: "sort",
    title: "Sort list",
    description: "Sort the shown list by a chosen key.",
    runs: runsWhere("sort"),
    available: sets("sort"),
    run: onTarget((context, target) => {
      context.ask({
        label: "Sort by",
        items: sortChoices((sort) => {
          target.apply({ sort });
        }),
      });
    }),
  },
  {
    id: "group",
    title: "Group list",
    description: "Group the elements of the shown list by type, status, package or a property.",
    runs: runsWhere("group"),
    available: sets("group"),
    run: onTarget((context, target) => {
      const call = context.shownCall ?? context.call;
      void Promise.all([facetsOf(call, target), call("metamodel.get", {})]).then(([facets, metamodel]) => {
        if (!facets.ok) {
          context.echo(facets.message);
          return;
        }
        const packages = metamodel.ok ? (metamodel.output.meanings["packages"] ?? []) : [];
        context.ask({
          label: "Group by",
          items: groupChoices(facets.output, packages, (group) => {
            target.apply({ group });
          }),
        });
      });
    }),
  },
  {
    id: "ungroup",
    title: "Ungroup list",
    description: "Remove the groups of the shown list.",
    runs: runsWhere("group"),
    available: (context: ActionContext): boolean => queryTarget(context)?.query.group !== undefined,
    run: onTarget((_context, target) => {
      target.apply({ group: undefined });
    }),
  },
  {
    id: "matrix",
    title: "Show traceability matrix",
    shortcut: MATRIX_SHORTCUT,
    available: (context: ActionContext): boolean =>
      (currentList(context) !== undefined && !isMatrix(context)) || packagePage(context) !== undefined,
    run: (context: ActionContext): void => {
      const list = currentList(context);
      const page = packagePage(context);
      if (list !== undefined) {
        context.dispatch({ type: "open", buffer: withMatrix(list, true) });
      } else if (page !== undefined) {
        // The members of the package as a list in matrix mode, in the query of the page, as its list shows them.
        const step = { label: `package: ${page.name}`, selection: packageSelection(page.id) };
        const query = memberQuery(page);
        context.dispatch({
          type: "open",
          buffer: listOf({ ...query, steps: [step, ...query.steps] }, "matrix"),
        });
      }
    },
  },
  {
    id: "matrix-list",
    title: "Show as list",
    description: "Show the traceability matrix as a list again.",
    runs: [DISPLAY_COMMANDS.list],
    shortcut: MATRIX_SHORTCUT,
    available: isMatrix,
    run: onList((context, list) => {
      context.dispatch({ type: "open", buffer: withMatrix(list, false) });
    }),
  },
];
