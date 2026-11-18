// A condition (`where` of "New saved filter" and "New perspective", SR-219) built step by step from hits (SR-215
// AK3, AK4, AK6, AK9). The first step offers the finishing hit and the kinds; choosing a kind asks its values,
// and each value chosen is a mark in the input with the label of the same list filter step (`list-filters.ts`)
// where a list has one. All marks hold together: the value is `{ all: [<marks in their order>] }`, without a
// mark `{ all: [] }` (AK10). Text that starts with "{" is one condition in JSON, as the command line takes
// it; core checks it (ADR-0002: the app builds the input and decides nothing about what is allowed).
//
// The types are one type mark (AK5, `type-mark.ts`), which "Type" chosen again continues.
// The kinds and their values are those of `condition-kinds.ts`; statuses and properties with their values
// come from `element.facets` over the marks so far (without a mark the workspace).
// `shownMarks` gives the conditions of a list's steps as marks: the parts "Save list as perspective" writes
// under `all` (`perspectiveWhere`), which keeps only an unchanged perspective selection as stored (SR-213 AK3).
import type { ElementSelection } from "@reqseq/core";
import type { ArgumentExplanation, Choice, Prompt, PromptFill, PromptMark } from "./action-types.js";
import type { FilterStep } from "./buffers.js";
import type { BuiltAsk } from "./catalog-entry.js";
import type { ConditionKind, ConditionMark, KindHits, KindSource } from "./condition-kinds.js";
import { CONDITION_KINDS, stepMark, textMark } from "./condition-kinds.js";
import { missingStep, propertyStep, statusStep, textStep, typesStep } from "./list-filters.js";
import { askTypes, typeKeysOf, typeMark, typeMarkAt } from "./type-mark.js";

export type { ConditionMark } from "./condition-kinds.js";

type Condition = NonNullable<ElementSelection["where"]>;

/** What the steps of a condition need from the argument entry (`catalog-commands.ts`). */
export interface ConditionAsk extends BuiltAsk<ConditionMark> {
  /** The condition's schema in the catalog: the verification and validation statuses are its enums. */
  readonly schema: unknown;
  /**
   * One argument back, with the marks given, which stand again when the condition is asked again (AK9):
   * Backspace on an empty input without a mark, and Escape, in the first step.
   */
  readonly back: (marks: readonly ConditionMark[]) => void;
  /**
   * The name of the hit that takes the marks in a builder ("Next: grouping", SR-219 AK2, AK3), for "Take <n>
   * conditions"; there it goes on to the next step.
   */
  readonly next?: string;
}

/** The value the marks give (AK10): all of them, in their order. */
export const conditionOf = (marks: readonly ConditionMark[]): { readonly all: readonly unknown[] } => ({
  all: marks.map((mark) => mark.condition),
});

/** How the prompt's line and the result buffer name the value given. */
export const conditionLabel = (marks: readonly ConditionMark[]): string =>
  marks.length === 0 ? "all elements" : marks.map((mark) => mark.label).join(" · ");

/** The finishing hit without a mark (AK4). */
export const NO_CONDITION = "No condition: all elements";

const plural = (count: number, word: string): string => `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/** The parts of `condition` under one `all`: those of an `all`, else the condition itself. */
const allParts = (condition: Condition): readonly Condition[] =>
  "all" in condition && Object.keys(condition).length === 1 ? condition.all : [condition];

/** The list filter step a stored condition is, where there is one: "type: need", not its JSON. */
const stepOf = (part: Condition): FilterStep | undefined => {
  const fields = part as Readonly<Record<string, unknown>>;
  const keys = Object.keys(fields).sort().join(",");
  const one = (values: unknown): string | undefined =>
    Array.isArray(values) && values.length === 1 && typeof values[0] === "string" ? values[0] : undefined;
  const { status, text, property, op, value } = fields;
  const typeKeys = typeKeysOf(part);
  const statusKey = one(status);
  if (typeKeys !== undefined) {
    return typesStep(typeKeys);
  }
  if (keys === "status" && statusKey !== undefined) {
    return statusStep(statusKey);
  }
  if (keys === "text" && typeof text === "string") {
    return textStep(text);
  }
  if (typeof property !== "string") {
    return undefined;
  }
  if (keys === "op,property" && op === "missing") {
    return missingStep(property);
  }
  return keys === "op,property,value" &&
    op === "eq" &&
    (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    ? propertyStep(property, String(value), value)
    : undefined;
};

/** The label of a stored condition: that of its list filter step, else its JSON (or, not, AK6). */
const partLabel = (part: Condition): string => stepOf(part)?.label ?? JSON.stringify(part);

/**
 * The marks of the conditions of a list's steps: each filter step with its label, the selection of a
 * perspective (its first step) as one mark per condition of it, with the label of its list filter step, else
 * in JSON; a saved filter gives none (it is the argument `filter`).
 */
export const shownMarks = (steps: readonly FilterStep[]): readonly ConditionMark[] =>
  steps.flatMap((step) => {
    const { where } = step.selection;
    if (where === undefined) {
      return [];
    }
    return step.perspective === true
      ? allParts(where).map((part) => ({ label: partLabel(part), condition: part }))
      : [stepMark(step)];
  });

/** A mark of the typed JSON: the parsed condition, else the text, which core then refuses (AK6). */
const jsonMark = (text: string): ConditionMark => {
  try {
    const condition = JSON.parse(text) as unknown;
    return { label: JSON.stringify(condition), condition };
  } catch {
    return { label: text.trim(), condition: text.trim() };
  }
};

/** One hit of a step: a value that adds a mark, or a choice that asks the next step (a property). */
interface Hit {
  readonly name: string;
  readonly key?: string;
  readonly mark?: ConditionMark;
  readonly next?: () => void;
}

type Hits = readonly Hit[] | { readonly failed: string };

/** What the kinds read their values from: the facets of the elements the marks select, without a mark of the workspace (AK3). */
const sourceOf = (ask: ConditionAsk, marks: readonly ConditionMark[]): KindSource => ({
  call: ask.context.call,
  facets: () =>
    ask.context.call(
      "element.facets",
      // A mark in JSON is what was typed; core checks it.
      marks.length === 0 ? {} : { selection: { where: conditionOf(marks) as Condition } },
    ),
  schema: ask.schema,
});

/**
 * The hits of `kind` with `marks` given: a value adds its mark, a property asks its values next, from which
 * Escape goes back to the properties.
 */
const hitsOf = async (
  ask: ConditionAsk,
  marks: readonly ConditionMark[],
  kind: ConditionKind,
  hits: NonNullable<ConditionKind["hits"]>,
): Promise<Hits> => {
  const found: KindHits = await hits(sourceOf(ask, marks));
  return "failed" in found
    ? found
    : found.map((hit) =>
        "values" in hit
          ? {
              name: hit.name,
              key: hit.key,
              next: () => {
                askValues(
                  ask,
                  marks,
                  hit.name,
                  () => Promise.resolve(hit.values),
                  (kept) => {
                    askKind(ask, kept, kind);
                  },
                );
              },
            }
          : hit,
      );
};

/** The marks as the command prompt shows them, each with its × (AK9): `again` asks the step again without it. */
const promptMarks = (
  marks: readonly ConditionMark[],
  again: (marks: readonly ConditionMark[]) => void,
): readonly PromptMark[] =>
  marks.map((mark, at) => ({
    label: mark.label,
    remove: () => {
      again(marks.filter((_, place) => place !== at));
    },
  }));

/** The keys of a step of the values (SR-210 AK2): Enter adds the condition; no mark goes with Backspace. */
const valueExplain = (ask: ConditionAsk, enter: string): ArgumentExplanation => ({
  ...ask.explain,
  more: false,
  building: { enter, unmark: false, json: false },
});

/** `ask` without core's message: it is said once, in the step that is asked again. */
const plain = ({ error: _error, ...ask }: ConditionAsk): ConditionAsk => ask;

/**
 * Asks the values of a kind (or of a property, `hits` from its facet), each of which adds its mark and goes
 * back to the first step. Escape and Backspace on an empty input go back to the kinds, or from a property's
 * values to the properties (`from`, with the marks then given); an × removes a mark and asks the step again
 * (a property's values: the properties), its values read anew.
 */
const askValues = (
  ask: ConditionAsk,
  marks: readonly ConditionMark[],
  name: string,
  hits: (marks: readonly ConditionMark[]) => Promise<Hits>,
  from?: (marks: readonly ConditionMark[]) => void,
): void => {
  const again = (next: readonly ConditionMark[]): void => {
    askCondition(ask, next);
  };
  const label = `${ask.line} · ${name}:`;
  ask.context.ask({
    label,
    items: [],
    // Values read for other marks: the step asks them again, a property's values from the properties.
    marks: promptMarks(marks, (next) => {
      if (from === undefined) {
        askValues(ask, next, name, hits);
      } else {
        from(next);
      }
    }),
    explain: valueExplain(ask, "adds the condition"),
    back: () => {
      if (from === undefined) {
        again(marks);
      } else {
        from(marks);
      }
    },
    fill: hits(marks).then((found): PromptFill =>
      "failed" in found
        ? { label: `${found.failed} · ${label}` }
        : {
            items: found.map((hit, at) => ({
              id: `${String(at)}:${hit.name}`,
              name: hit.name,
              ...(hit.key === undefined || hit.key === hit.name ? {} : { hint: hit.key }),
              run: () => {
                if (hit.next !== undefined) {
                  hit.next();
                } else if (hit.mark !== undefined) {
                  again([...marks, hit.mark]);
                }
              },
            })),
          },
    ),
  });
};

/**
 * Asks the types of the type mark (AK5): that of `marks` where there is one, which keeps its place, else a new
 * one after them. "Take <n> types", Escape and Backspace on an empty input go back to the kinds with the mark;
 * an × removes a mark and asks the types again.
 */
const askTypeMark = (ask: ConditionAsk, marks: readonly ConditionMark[]): void => {
  const at = typeMarkAt(marks);
  const before = at === -1 ? marks : marks.slice(0, at);
  const after = at === -1 ? [] : marks.slice(at + 1);
  const all = (keys: readonly string[]): readonly ConditionMark[] => [
    ...before,
    ...(keys.length === 0 ? [] : [typeMark(keys)]),
    ...after,
  ];
  const kinds = (keys: readonly string[]): void => {
    askCondition(ask, all(keys));
  };
  askTypes({
    ask: ask.context.ask,
    call: ask.context.call,
    label: `${ask.line} · Type:`,
    keys: at === -1 ? [] : (typeKeysOf(marks[at]?.condition) ?? []),
    marks: (keys) =>
      promptMarks(all(keys), (next) => {
        askTypeMark(ask, next);
      }),
    take: kinds,
    back: kinds,
    explain: ask.explain,
  });
};

/** Asks the values of `kind`; a text search takes the typed words (an empty input asks again). */
const askKind = (ask: ConditionAsk, marks: readonly ConditionMark[], kind: ConditionKind): void => {
  const { hits } = kind;
  if (kind.key === "type") {
    askTypeMark(ask, marks);
    return;
  }
  if (hits !== undefined) {
    askValues(ask, marks, kind.name, (given) => hitsOf(ask, given, kind, hits));
    return;
  }
  ask.context.ask({
    label: `${ask.line} · ${kind.name}:`,
    items: [],
    marks: promptMarks(marks, (next) => {
      askKind(ask, next, kind);
    }),
    explain: valueExplain(ask, "adds the text search"),
    back: () => {
      askCondition(ask, marks);
    },
    text: (text) => {
      const query = text.trim();
      if (query === "") {
        askKind(ask, marks, kind);
      } else {
        askCondition(ask, [...marks, textMark(query)]);
      }
    },
  });
};

/**
 * Asks the condition with `marks` given (AK3, AK4): the finishing hit, "Take <n> conditions" with marks (in a
 * builder `next`, SR-219 AK2, AK3), else "No condition: all elements", then the kinds; text starting with "{" is
 * taken as one condition in JSON (AK6). Ctrl/Cmd+Enter takes the marks and offers the optional arguments.
 * Backspace on an empty input removes the last mark, without one it goes back an argument, as Escape does (AK9,
 * SR-134 AK4).
 */
export const askCondition = (given: ConditionAsk, marks: readonly ConditionMark[]): void => {
  const ask = plain(given);
  const take = (taken: readonly ConditionMark[], more: boolean) => (): void => {
    given.take(taken, more);
  };
  const prompt: Prompt = {
    label: `${given.error === undefined ? "" : `${given.error} · `}${given.line}:`,
    items: [
      {
        id: "take",
        name: marks.length === 0 ? NO_CONDITION : (given.next ?? `Take ${plural(marks.length, "condition")}`),
        run: take(marks, false),
        more: take(marks, true),
      },
      ...CONDITION_KINDS.map((kind): Choice => ({
        id: `kind:${kind.key}`,
        name: kind.name,
        hint: kind.key,
        run: () => {
          askKind(ask, marks, kind);
        },
        more: take(marks, true),
      })),
    ],
    literal: (text) => {
      if (!text.trimStart().startsWith("{")) {
        return undefined;
      }
      const mark = jsonMark(text);
      return {
        id: "json",
        name: "Add the condition in JSON",
        run: () => {
          askCondition(ask, [...marks, mark]);
        },
        more: take([...marks, mark], true),
      };
    },
    marks: promptMarks(marks, (next) => {
      askCondition(ask, next);
    }),
    unmark: true,
    explain: {
      ...given.explain,
      building: {
        enter: "takes the marked hit; all conditions must hold",
        unmark: marks.length > 0,
        json: true,
      },
    },
    back: () => {
      given.back(marks);
    },
  };
  given.context.ask(prompt);
};
