// A sort (`sort` of "New saved filter", "New perspective" and the other commands with one, SR-219) built step by
// step from hits (SR-215 AK4, AK7, AK9, AK10), as the condition is (`condition-prompt.ts`). The first step offers
// the finishing hit and the sort keys: the keys of the `by` enum and the properties of the metamodel that hold no
// relations (`metamodel.get`). A key asks "Order" as "Sort list" does (`ORDERS`), and is then a mark "<key>
// <order>"; a key chosen again replaces its mark in its place. The hierarchy is offered only before the first key
// and sorts ascending; "Workspace order" takes the empty sort. The value is the keys of the marks in their order;
// without a mark the finishing hit skips the argument. In the last step of a builder (`save`, SR-219 AK2, AK3) the
// finishing hit is "Save", and "Workspace order" is a mark that stays in the step. Core checks the sort (ADR-0002:
// the app builds the input and decides nothing about what is allowed).
import type { FilterSortKeyWithDefaults } from "@reqseq/core";
import type { ActionContext, Choice, PromptFill, PromptMark } from "./action-types.js";
import { ORDERS } from "./list-actions.js";
import type { BuiltAsk } from "./catalog-entry.js";

type SortKey = FilterSortKeyWithDefaults;

/** One key of the sort, with the label its mark shows; `null` the workspace order of a builder (SR-219 AK2). */
export interface SortMark {
  readonly label: string;
  readonly key: SortKey | null;
}

/** What the steps of a sort need from the argument entry (`catalog-commands.ts`). */
export interface SortAsk extends BuiltAsk<SortMark> {
  /** Skips the argument: the finishing hit without a mark (AK4, AK10). */
  readonly skip: (more: boolean) => void;
  /** The last step of a builder (SR-219 AK2, AK3): "Save" takes the marks and runs the command. */
  readonly save?: true;
  /** The sort keys, read once for the argument: its later steps take them from here (`keysOf`). */
  readonly keys?: Promise<Keys>;
}

/** The value the marks give (AK10): their keys in their order; none, or the workspace order, is the empty sort. */
export const sortOf = (marks: readonly SortMark[]): readonly SortKey[] =>
  marks.flatMap((mark) => (mark.key === null ? [] : [mark.key]));

/** How the prompt's line names the sort given. */
export const sortMarksLabel = (marks: readonly SortMark[]): string =>
  `sort: ${sortOf(marks).length === 0 ? "workspace order" : marks.map((mark) => mark.label).join(" · ")}`;

/** The finishing hit without a mark (AK4): it skips the argument. */
export const NO_SORT = "No sort";

/** The finishing hit of the last step of a builder (SR-219 AK2, AK3): it runs the command. */
export const SAVE = "Save";

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

const FIXED_NAMES: Readonly<Record<string, string>> = Object.fromEntries(FIXED);

/** The label of the mark of `key`: "Type ascending"; a key that is no fixed one by its key. */
export const keyLabel = (key: SortKey): string => `${FIXED_NAMES[key.by] ?? key.by} ${WORDS[key.order]}`;

/** The mark of `key` sorted in `order`: "Title descending"; the hierarchy by its name alone. */
const markOf = (key: Key, order: SortKey["order"]): SortMark =>
  key.by === "hierarchy"
    ? { label: HIERARCHY, key: { by: "hierarchy", order: "asc" } }
    : {
        label: `${key.name} ${WORDS[order]}`,
        key: { by: key.by, order },
      };

/** The mark of the workspace order in a builder: the empty sort, in place of every key (SR-219 AK2). */
const WORKSPACE_MARK: SortMark = { label: WORKSPACE_ORDER, key: null };

/**
 * The marks with `mark`: in the place of the mark of the same key, else after the others (AK7); a key takes
 * the place of the workspace order.
 */
const withMark = (marks: readonly SortMark[], mark: SortMark): readonly SortMark[] => {
  const keys = marks.filter((given) => given.key !== null);
  return keys.some((given) => given.key?.by === mark.key?.by)
    ? keys.map((given) => (given.key?.by === mark.key?.by ? mark : given))
    : [...keys, mark];
};

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

/** The marks as the command prompt shows them, each with its × (AK9): `again` asks the step again without it. */
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
 * Asks the sort with `marks` given (AK4, AK7): the finishing hit, "Take <n> sort keys" with marks, else "No
 * sort", the hierarchy without a key, the keys and "Workspace order". In the last step of a builder (`save`) the
 * finishing hit is "Save", with or without marks, and "Workspace order" a mark (SR-219 AK2). Ctrl/Cmd+Enter takes
 * the marks and offers the optional arguments. Backspace on an empty input removes the last mark, without one it
 * goes back an argument, as Escape does (AK9, SR-134 AK4).
 */
export const askSort = (given: SortAsk, marks: readonly SortMark[]): void => {
  const keys = given.keys ?? keysOf(given.context);
  const ask = { ...plain(given), keys };
  const take = (taken: readonly SortMark[], more: boolean) => (): void => {
    given.take(taken, more);
  };
  // Without a mark there is no sort to take, except in a builder: the finishing hit skips it.
  const finish = (more: boolean) =>
    marks.length === 0 && given.save !== true
      ? () => {
          given.skip(more);
        }
      : take(marks, more);
  const label = `${given.error === undefined ? "" : `${given.error} · `}${given.line}:`;
  const hits = (known: readonly Key[]): Choice[] => {
    const hierarchy = markOf({ by: "hierarchy", name: HIERARCHY }, "asc");
    return [
      {
        id: "take",
        name:
          given.save === true
            ? SAVE
            : marks.length === 0
              ? NO_SORT
              : `Take ${plural(marks.length, "sort key")}`,
        run: finish(false),
        more: finish(true),
      },
      ...(sortOf(marks).length === 0
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
        more: finish(true),
      })),
      given.save === true
        ? {
            id: "workspace",
            name: WORKSPACE_ORDER,
            run: () => {
              askSort(ask, [WORKSPACE_MARK]);
            },
            more: take([WORKSPACE_MARK], true),
          }
        : { id: "workspace", name: WORKSPACE_ORDER, run: take([], false), more: take([], true) },
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
        enter:
          given.save === true
            ? "takes the marked hit; Save saves with the keys in their order"
            : "takes the marked hit; the keys sort in their order",
        unmark: marks.length > 0,
        json: false,
      },
    },
    back: () => {
      given.back(marks);
    },
  });
};
