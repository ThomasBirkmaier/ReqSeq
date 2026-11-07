// The actions on a list and on the elements of a package page (SR-124, SR-125, SR-149, SR-112): filter,
// sort, group and the matrix. Each acts on a query target, the shown list or the elements of the shown
// package page, and changes its query (`list-query.ts`); what the target's view does not show is not
// offered. Only the input of `element.list` is built (ADR-0002).
import type { ElementSelection, FilterSortKeyWithDefaults } from "@reqseq/core";
import type { Action, ActionContext, Choice, PromptFill } from "./actions.js";
import type { ElementBuffer, FilterStep, ListBuffer } from "./buffers.js";
import {
  DEFAULT_SORT,
  inMatrix,
  listBuffer,
  listOf,
  listView,
  queryOf,
  withMatrix,
  withQuery,
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
import { supports } from "./list-query.js";
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
 * What the list actions act on: the shown list, or the elements of the shown package page (SR-112 AK2).
 * `query` is what it asks, `view` where it shows it, `selection` what the steps select (on a page with the
 * package), the input of `element.facets`; `apply` shows the same list or page with the query changed.
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
      query: queryOf(list),
      view: listView(list),
      selection: list.selection,
      apply: (change) => {
        context.dispatch({ type: "open", buffer: withQuery(list, change) });
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

/** The shown target sets `part` of its query: the action for it is offered. */
const sets =
  (part: QueryPart) =>
  (context: ActionContext): boolean => {
    const target = queryTarget(context);
    return target !== undefined && supports(target.view, part);
  };

const canFilter = sets("steps");
const isFiltered = (context: ActionContext): boolean => (queryTarget(context)?.query.steps.length ?? 0) > 0;
const isChained = (context: ActionContext): boolean => (queryTarget(context)?.query.steps.length ?? 0) > 1;

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
  available: by.available ?? canFilter,
  // The prompt opens at once and fills its choices when core answers, so keys typed meanwhile go to it
  // (#467); a read that fails or finds nothing says so in the label.
  run: onTarget((context, target) => {
    context.ask({
      label: by.label,
      items: [],
      fill: by.names(context.shownCall ?? context.call, target).then((found): PromptFill => {
        if (!found.ok) {
          return { label: `${found.message} · ${by.label}` };
        }
        if (found.names.length === 0) {
          return { label: `${by.nothing} · ${by.label}` };
        }
        return {
          items: found.names.map((name) =>
            choice(name, () => {
              addStep(target, by.step(name));
            }),
          ),
        };
      }),
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
  filterBy({
    id: "filter-type",
    title: "Filter list by type",
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
    available: canFilter,
    run: onTarget((context, target) => {
      context.ask({
        label: "Property",
        items: [],
        fill: facetsOf(context.shownCall ?? context.call, target).then((answer): PromptFill => {
          if (!answer.ok) {
            return { label: `${answer.message} · Property` };
          }
          const items = propertyChoices(
            answer.output,
            (step) => {
              addStep(target, step);
            },
            context.ask,
          );
          return items.length === 0
            ? { label: "No property of the elements in this list has values to choose from. · Property" }
            : { items };
        }),
      });
    }),
  },
  {
    id: "filter-text",
    title: "Filter list by text search",
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
    available: isFiltered,
    run: onTarget((_context, target) => {
      target.apply({ steps: target.query.steps.slice(0, -1) });
    }),
  },
  {
    id: "clear-filters",
    title: "Clear all list filters",
    available: isChained,
    run: onTarget((_context, target) => {
      target.apply({ steps: [] });
    }),
  },
  {
    id: "sort",
    title: "Sort list",
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
    available: sets("group"),
    run: onTarget((context, target) => {
      const call = context.shownCall ?? context.call;
      context.ask({
        label: "Group by",
        items: [],
        fill: Promise.all([facetsOf(call, target), call("metamodel.get", {})]).then(
          ([facets, metamodel]): PromptFill => {
            if (!facets.ok) {
              return { label: `${facets.message} · Group by` };
            }
            const packages = metamodel.ok ? (metamodel.output.meanings["packages"] ?? []) : [];
            return {
              items: groupChoices(facets.output, packages, (group) => {
                target.apply({ group });
              }),
            };
          },
        ),
      });
    }),
  },
  {
    id: "ungroup",
    title: "Ungroup list",
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
    shortcut: MATRIX_SHORTCUT,
    available: isMatrix,
    run: onList((context, list) => {
      context.dispatch({ type: "open", buffer: withMatrix(list, false) });
    }),
  },
];
