// A sort (`sort` of "Save filter", "Save perspective" and the other commands with one) built step by step
// from hits (SR-215 AK4, AK5, AK7, AK9, AK10), as the condition is (`condition-prompt.ts`). The first step
// offers the finishing hit and the sort keys: the keys of the `by` enum and the properties of the metamodel
// that hold no relations (`metamodel.get`). A key asks "Order" as "Sort list" does (`ORDERS`), and is then a
// mark "<key> <order>"; a key chosen again replaces its mark in its place. The hierarchy is offered only
// before the first key and sorts ascending; "Workspace order" takes the empty sort. The value is the keys of
// the marks in their order; without a mark the finishing hit skips the argument. Core checks the sort
// (ADR-0002: the app builds the input and decides nothing about what is allowed).
import type { FilterSortKeyWithDefaults } from "@reqseq/core";
import type { ActionContext, Choice, PromptFill, PromptMark } from "./actions.js";
import { ORDERS } from "./list-actions.js";
import { listSort, listing, selectionOf } from "./buffers.js";
import type { BuiltAsk, Entry } from "./catalog-entry.js";

type SortKey = FilterSortKeyWithDefaults;

/** One key of the sort, with the label its mark shows. */
export interface SortMark {
  readonly label: string;
  readonly key: SortKey;
}

/**
 * The first hit without a mark (SR-215 AK5): the sort the shown list is shown in, or why there is none, which
 * the explanation line says.
 */
export type ShownSort = { readonly sort: readonly SortKey[] } | { readonly note: string };

/** What the steps of a sort need from the argument entry (`catalog-commands.ts`). */
export interface SortAsk extends BuiltAsk<SortMark> {
  /** Skips the argument: the finishing hit without a mark (AK4, AK10). */
  readonly skip: (more: boolean) => void;
  /** The sort of the shown list, the first hit without a mark (AK5); worked out only when no mark is set. */
  readonly shown?: () => ShownSort | undefined;
  /** The sort keys, read once for the argument: its later steps take them from here (`keysOf`). */
  readonly keys?: Promise<Keys>;
}

/** The value the marks give (AK10): their keys in their order; none is the workspace order. */
export const sortOf = (marks: readonly SortMark[]): readonly SortKey[] => marks.map((mark) => mark.key);

/** How the prompt's line names the sort given. */
export const sortMarksLabel = (marks: readonly SortMark[]): string =>
  `sort: ${marks.length === 0 ? "workspace order" : marks.map((mark) => mark.label).join(" · ")}`;

/** The first hit without a mark on a shown list (AK5): Enter takes its sort keys as marks. */
export const SHOWN_SORT = "Sort of the shown list";

/** The finishing hit without a mark (AK4): it skips the argument. */
export const NO_SORT = "No sort";

export const WORKSPACE_ORDER = "Workspace order";

const HIERARCHY = "Hierarchy (tree)";

/** The keys of the `by` enum but the hierarchy, by the names "Sort list" gives them; "ID" is what rows show. */
const FIXED: readonly (readonly [string, string])[] = [
  ["identifier", "ID"],
  ["id", "Short ID"],
  ["title", "Title"],
  ["type", "Type"],
  ["status", "Status"],
];

/** A sort key that asks its order. */
interface Key {
  readonly by: string;
  readonly name: string;
}

/** The sort keys there are, and why the properties among them could not be read. */
interface Keys {
  readonly keys: readonly Key[];
  readonly failed?: string;
}

const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/** The word of each order, as "Order" offers it: "descending". */
const WORDS = Object.fromEntries(ORDERS.map(([word, order]) => [order, word])) as Readonly<
  Record<SortKey["order"], string>
>;

/** The mark of `key` sorted in `order`: "Title descending"; the hierarchy by its name alone. */
const markOf = (key: Key, order: SortKey["order"]): SortMark =>
  key.by === "hierarchy"
    ? { label: HIERARCHY, key: { by: "hierarchy", order: "asc" } }
    : {
        label: `${key.name} ${WORDS[order]}`,
        key: { by: key.by, order },
      };

/** The marks with `mark`: in the place of the mark of the same key, else after the others (AK7). */
const withMark = (marks: readonly SortMark[], mark: SortMark): readonly SortMark[] =>
  marks.some((given) => given.key.by === mark.key.by)
    ? marks.map((given) => (given.key.by === mark.key.by ? mark : given))
    : [...marks, mark];

/**
 * The sort keys that ask an order: the fixed ones, then the properties of the metamodel that hold no relations
 * and are not named by a fixed key (AK7, SR-075 AK1). Without the metamodel, the fixed ones and why.
 */
const keysOf = async (context: ActionContext): Promise<Keys> => {
  const fixed = FIXED.map(([by, name]) => ({ by, name }));
  const answer = await context.call("metamodel.get", {});
  if (!answer.ok) {
    return { keys: fixed, failed: answer.message };
  }
  const taken = new Set(["hierarchy", ...FIXED.map(([by]) => by)]);
  return {
    keys: [
      ...fixed,
      ...answer.output.properties
        .filter((property) => property.kind !== "relation" && !taken.has(property.key))
        .map((property) => ({ by: property.key, name: property.name })),
    ],
  };
};

/** The marks of a sort as stored: each key by its name among `keys`, else by itself. */
const marksOf = (sort: readonly SortKey[], keys: readonly Key[]): readonly SortMark[] =>
  sort.map((key) =>
    markOf(keys.find((known) => known.by === key.by) ?? { by: key.by, name: key.by }, key.order),
  );

/** The marks as the minibuffer shows them, each with its × (AK9): `again` asks the step again without it. */
const promptMarks = (
  marks: readonly SortMark[],
  again: (marks: readonly SortMark[]) => void,
): readonly PromptMark[] =>
  marks.map((mark, at) => ({
    label: mark.label,
    remove: () => {
      again(marks.filter((_, place) => place !== at));
    },
  }));

/** `ask` without core's message: it is said once, in the step that is asked again. */
const plain = ({ error: _error, ...ask }: SortAsk): SortAsk => ask;

/**
 * Asks the order of `key` (AK7), which adds its mark and goes back to the first step. Escape and Backspace on
 * an empty input go back to the first step with the marks given; an × removes a mark and asks the order again.
 */
const askOrder = (ask: SortAsk, marks: readonly SortMark[], key: Key): void => {
  ask.context.ask({
    label: `${ask.line} · ${key.name} · Order:`,
    items: ORDERS.map(([word, order]) => ({
      id: order,
      name: word,
      hint: order,
      run: () => {
        askSort(ask, withMark(marks, markOf(key, order)));
      },
    })),
    marks: promptMarks(marks, (next) => {
      askOrder(ask, next, key);
    }),
    explain: {
      ...ask.explain,
      more: false,
      building: { enter: "adds the sort key", unmark: false, json: false },
    },
    back: () => {
      askSort(ask, marks);
    },
  });
};

/**
 * Asks the sort with `marks` given (AK4, AK7): without a mark the shown list's sort first (AK5, `shown`), then
 * the finishing hit, "Take <n> sort keys" with marks, else "No sort", the hierarchy without a mark, the keys
 * and "Workspace order". Ctrl/Cmd+Enter takes the marks and offers the optional arguments. Backspace on an
 * empty input removes the last mark, without one it goes back an argument, as Escape does (AK9, SR-134 AK4).
 */
export const askSort = (given: SortAsk, marks: readonly SortMark[]): void => {
  const keys = given.keys ?? keysOf(given.context);
  const ask = { ...plain(given), keys };
  const take = (taken: readonly SortMark[], more: boolean) => (): void => {
    given.take(taken, more);
  };
  const shown = marks.length === 0 ? given.shown?.() : undefined;
  const label = `${given.error === undefined ? "" : `${given.error} · `}${given.line}:`;
  const hits = (known: readonly Key[]): Choice[] => {
    const own = shown !== undefined && "sort" in shown ? marksOf(shown.sort, known) : undefined;
    const hierarchy = markOf({ by: "hierarchy", name: HIERARCHY }, "asc");
    return [
      ...(own === undefined
        ? []
        : [
            {
              id: "shown",
              name: SHOWN_SORT,
              hint: own.length === 0 ? "workspace order" : own.map((mark) => mark.label).join(" · "),
              // Taken once: with marks the hit is gone; the workspace order has none, so it is taken at once.
              run:
                own.length === 0
                  ? take([], false)
                  : () => {
                      askSort(ask, own);
                    },
              more: take(own, true),
            },
          ]),
      {
        id: "take",
        name: marks.length === 0 ? NO_SORT : `Take ${plural(marks.length, "sort key")}`,
        run:
          marks.length === 0
            ? () => {
                given.skip(false);
              }
            : take(marks, false),
        more:
          marks.length === 0
            ? () => {
                given.skip(true);
              }
            : take(marks, true),
      },
      ...(marks.length === 0
        ? [
            {
              id: "hierarchy",
              name: HIERARCHY,
              hint: "hierarchy",
              run: () => {
                askSort(ask, [hierarchy]);
              },
              more: take([hierarchy], true),
            },
          ]
        : []),
      ...known.map((key): Choice => ({
        id: `key:${key.by}`,
        name: key.name,
        hint: key.by,
        run: () => {
          askOrder(ask, marks, key);
        },
        // Without a mark there is no sort to take: Ctrl/Cmd+Enter skips it, as the finishing hit does.
        more:
          marks.length === 0
            ? () => {
                given.skip(true);
              }
            : take(marks, true),
      })),
      { id: "workspace", name: WORKSPACE_ORDER, run: take([], false), more: take([], true) },
    ];
  };
  given.context.ask({
    label,
    items: [],
    fill: keys.then(({ keys: found, failed }): PromptFill => ({
      ...(failed === undefined ? {} : { label: `${failed} · ${label}` }),
      items: hits(found),
    })),
    marks: promptMarks(marks, (next) => {
      askSort(ask, next);
    }),
    unmark: true,
    explain: {
      ...given.explain,
      building: {
        enter: "takes the marked hit; the keys sort in their order",
        unmark: marks.length > 0,
        json: false,
        ...(shown !== undefined && "note" in shown ? { note: shown.note } : {}),
      },
    },
    back: () => {
      given.back(marks);
    },
  });
};

/** Why "Save filter" offers no sort of a shown list with a saved filter (SR-215 AK5). */
export const NO_SHOWN_SORT = "No sort of the shown list: a filter cannot hold its saved filter";

/**
 * The sort of the shown list for the sort of "Save filter" and "Save perspective" (SR-215 AK5): of a list, not
 * the matrix, the search hits or a package page, the sort it is shown in (`listSort`), as "Save list as
 * perspective" saves it; none when the sort of its saved filter holds. "Save filter" has none for a list with
 * a saved filter, and says why.
 */
export const shownSort = (context: ActionContext, entry: Entry): ShownSort | undefined => {
  const list = context.buffers[0];
  const perspective = entry.command.name === "perspective.save";
  if ((!perspective && entry.command.name !== "filter.save") || !listing(list) || list.matrix === true) {
    return undefined;
  }
  if (!perspective && selectionOf(list.steps)?.filter !== undefined) {
    return { note: NO_SHOWN_SORT };
  }
  const sort = listSort(list);
  return sort === undefined ? undefined : { sort };
};
