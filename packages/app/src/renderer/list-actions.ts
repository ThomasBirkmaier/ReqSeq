// The actions on a list, on the elements of a package page and on the hits of a search (SR-124, SR-125,
// SR-149, SR-112): filter, sort, group and the matrix. Each acts on a query target, the shown list, the
// elements of the shown package page or the shown search, and changes its query (`list-query.ts`); what
// the target's view does not show is not offered (a search is not sorted). Only the input of
// `element.list` and `element.search` is built (ADR-0002).
import type { ElementSelection, FilterSortKeyWithDefaults } from "@reqseq/core";
import type { Action, ActionContext, Choice, CommandIn, Prompt } from "./actions.js";
import type { ElementBuffer, FilterStep, ListBuffer } from "./buffers.js";
import {
  DEFAULT_SORT,
  fieldsInput,
  inMatrix,
  listBuffer,
  listOf,
  listView,
  listing,
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
import type { ConditionKind, ConditionMark, KindSource, KindValue } from "./condition-kinds.js";
import { CONDITION_KINDS, conditionSchema } from "./condition-kinds.js";
import { hasSavedFilter, savedStep, textStep } from "./list-filters.js";
import { groupChoices } from "./list-groups.js";
import type { ListQuery, QueryChange, QueryPart, QueryView } from "./list-query.js";
import { QUERY_VIEWS, queryIn, supports } from "./list-query.js";
import { PERSPECTIVE_ACTIONS } from "./perspective-actions.js";
import { memberQuery, memberSelection, packageSelection, withMemberQuery } from "./package-page.js";

/** Ctrl/Cmd+T shows the list as a traceability matrix (SR-125), and the matrix as a list again. */
export const MATRIX_SHORTCUT: Shortcut = { mod: true, shift: false, key: "t" };

export const currentList = (context: ActionContext): ListBuffer | undefined => {
  const current = context.buffers[0];
  return listing(current) ? current : undefined;
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
  /**
   * The search of a list of search hits restricted to fields (SR-216): `element.facets` counts only its hits, which
   * a text condition over every field cannot select.
   */
  readonly search?: { readonly query: string; readonly fields?: readonly string[] };
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
      // condition, which selects what element.search finds (SR-068 AK3); in chosen fields the steps' selection
      // with the search itself, since the text condition searches every field (SR-216).
      ...(shown.fields === undefined
        ? { selection: selectionOf([textStep(shown.query), ...shown.steps]) }
        : {
            selection: selectionOf(shown.steps),
            search: { query: shown.query, ...fieldsInput(shown.fields) },
          }),
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
// saved filter too (it does not fall back to the sort of the filter). "ID" is what the rows show. A key with a
// direction asks for it in a second step, so the first list names each key once.
const SORTS: readonly (readonly [
  string,
  readonly FilterSortKeyWithDefaults[] | FilterSortKeyWithDefaults["by"],
])[] = [
  ["Type and ID", DEFAULT_SORT],
  ["Workspace order", []],
  ["ID", "identifier"],
  ["Title", "title"],
  ["Type", "type"],
  ["Status", "status"],
  ["Hierarchy (tree)", [{ by: "hierarchy", order: "asc" }]],
];

/** The directions "Order" offers after a sort key, also in the sort the command prompt builds (SR-215 AK7). */
export const ORDERS = [
  ["ascending", "asc"],
  ["descending", "desc"],
] as const;

/**
 * The choices of the prompt "Sort by"; a key with a direction asks "Order" next with `ask`. `apply` gets the
 * sort that is taken.
 */
const sortChoices = (
  apply: (sort: readonly FilterSortKeyWithDefaults[]) => void,
  ask: (prompt: Prompt) => void,
): Choice[] =>
  SORTS.map(([name, sort]) =>
    choice(name, () => {
      if (typeof sort !== "string") {
        apply(sort);
        return;
      }
      ask({
        label: "Order",
        items: ORDERS.map(([word, order]) =>
          choice(word, () => {
            apply([{ by: sort, order }]);
          }),
        ),
      });
    }),
  );

/** The list or page with one more step; the rest of its query stays. */
const addStep = (target: QueryTarget, step: FilterStep): void => {
  target.apply({ steps: [...target.query.steps, step] });
};

/** The facets of the shown list or page: what its elements have, from the core (`element.facets`). */
const facetsOf = (call: Call, target: QueryTarget): Promise<Answer<"element.facets">> =>
  call("element.facets", {
    ...(target.selection === undefined ? {} : { selection: target.selection }),
    ...(target.search === undefined ? {} : { search: target.search }),
  });

/** A value "Filter list" offers: choosing it adds `step`. */
interface StepValue {
  readonly name: string;
  readonly key?: string;
  readonly step: FilterStep;
}

/** A hit that asks its values next: a property. */
interface StepChoice {
  readonly name: string;
  readonly key: string;
  readonly values: readonly StepValue[];
}

type StepHits = readonly (StepValue | StepChoice)[] | { readonly failed: string };

/** A kind "Filter list" asks first (SR-124 AK5): those of a condition, and "Saved filter". */
interface FilterKind {
  readonly key: string;
  readonly name: string;
  /** Without it, a text search: the typed words are the value. */
  readonly hits?: (source: KindSource) => Promise<StepHits>;
}

/** What the prompt says when a kind has no values in the shown list (SR-124 AK6). */
const NOTHING: Readonly<Record<string, string>> = {
  type: "The metamodel has no types.",
  status: "The elements of this list have no status.",
  property: "No property of the elements in this list has values to choose from.",
  filter: "The workspace has no saved filters.",
};

const nothingFor = (kind: FilterKind): string =>
  NOTHING[kind.key] ?? `There is no ${kind.name.toLowerCase()} to choose from.`;

/** The list filter step of a condition: its label, and the condition as the step's selection. */
const conditionStep = (mark: ConditionMark): FilterStep => ({
  label: mark.label,
  selection: { where: mark.condition as NonNullable<ElementSelection["where"]> },
});

const stepValue = (value: KindValue): StepValue => ({
  name: value.name,
  ...(value.key === undefined ? {} : { key: value.key }),
  step: conditionStep(value.mark),
});

/** A kind of a condition as "Filter list" offers it: each value one step, a property its values next. */
const conditionKind = (kind: ConditionKind): FilterKind => {
  const { hits } = kind;
  return {
    key: kind.key,
    name: kind.name,
    ...(hits === undefined
      ? {}
      : {
          hits: async (source) => {
            const found = await hits(source);
            return "failed" in found
              ? found
              : found.map((hit) =>
                  "values" in hit
                    ? { name: hit.name, key: hit.key, values: hit.values.map(stepValue) }
                    : stepValue(hit),
                );
          },
        }),
  };
};

/** "Saved filter": the saved filters of the workspace, each the step "filter: <name>". */
const SAVED_KIND: FilterKind = {
  key: "filter",
  name: "Saved filter",
  hits: async ({ call }) => {
    const answer = await call("filter.list", {});
    return answer.ok
      ? answer.output.filters.map((filter) => ({ name: filter.name, step: savedStep(filter.name) }))
      : { failed: answer.message };
  },
};

const FILTER_KINDS: readonly FilterKind[] = CONDITION_KINDS.map(conditionKind);

/** The choices of a step of values: a value adds its step, a property asks its values (`ask`). */
const valueChoices = (
  target: QueryTarget,
  hits: readonly (StepValue | StepChoice)[],
  ask: (prompt: Prompt) => void,
): Choice[] =>
  hits.map((hit, at) => ({
    id: `${String(at)}:${hit.name}`,
    name: hit.name,
    ...(hit.key === undefined || hit.key === hit.name ? {} : { hint: hit.key }),
    run: () => {
      if ("values" in hit) {
        ask({ label: hit.name, items: valueChoices(target, hit.values, ask) });
      } else {
        addStep(target, hit.step);
      }
    },
  }));

/**
 * Asks the values of `kind` and adds the step of the one chosen (SR-124 AK6); a text search takes the typed
 * words. A kind without values says so, and the list stays as it is. Escape goes back a step
 * (`steppedContext`).
 */
const askKind = (context: ActionContext, target: QueryTarget, kind: FilterKind, source: KindSource): void => {
  const { hits } = kind;
  if (hits === undefined) {
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
    return;
  }
  void hits(source).then((found) => {
    if ("failed" in found) {
      context.echo(found.failed);
    } else if (found.length === 0) {
      context.echo(nothingFor(kind));
    } else {
      context.ask({ label: kind.name, items: valueChoices(target, found, context.ask) });
    }
  });
};

/**
 * "Filter list" (SR-124 AK5, AK6, D-077): asks the kind first, then its values, and adds one step. "Saved
 * filter" is left out while a step or the perspective's selection has one: a selection takes one (SR-101).
 */
const FILTER_ACTION: Action = {
  id: "filter",
  title: "Filter list",
  description: "Keep only the elements of the shown list that meet one more condition, chosen by its kind.",
  runs: runsWhere("steps"),
  available: canFilter,
  run: onTarget((context, target) => {
    const shownCall = context.shownCall ?? context.call;
    const source: KindSource = {
      call: context.call,
      // The statuses and properties of the shown list, in the view of the window.
      facets: () => facetsOf(shownCall, target),
      schema: conditionSchema(context.catalog?.() ?? []),
    };
    const kinds = hasSavedFilter(target.query.steps) ? FILTER_KINDS : [...FILTER_KINDS, SAVED_KIND];
    context.ask({
      label: "Filter by",
      items: kinds.map((kind) => ({
        id: `kind:${kind.key}`,
        name: kind.name,
        hint: kind.key,
        run: () => {
          askKind(context, target, kind, source);
        },
      })),
    });
  }),
};

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
  FILTER_ACTION,
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
        }, context.ask),
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
