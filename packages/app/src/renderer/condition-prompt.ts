// A condition (`where` of "Save filter" and "Save perspective") built step by step from hits (SR-215 AK3,
// AK4, AK6, AK9). The first step offers the finishing hit and the kinds; choosing a kind asks its values, and
// each value chosen is a mark in the input with the label of the same list filter step (`list-filters.ts`)
// where a list has one. All marks hold together: the value is `{ all: [<marks in their order>] }`, without a
// mark `{ all: [] }` (AK10). Text that starts with "{" is one condition in JSON, as the command line takes
// it; core checks it (ADR-0002: the app builds the input and decides nothing about what is allowed).
//
// The values come from read commands: types from `metamodel.get`; statuses and properties with their values
// from `element.facets` over the marks so far (without a mark the workspace), the statuses by their name in
// `metamodel.get`, the properties by SR-124 AK2 and AK3 (`choosableProperties`). The other kinds of AK3
// (verification and validation status, validity, relation) follow in the next part of #1645; until then they
// go in as JSON.
import type { ElementFacetsOutput, ElementSelection } from "@reqseq/core";
import type {
  ActionContext,
  ArgumentExplanation,
  Choice,
  Prompt,
  PromptFill,
  PromptMark,
} from "./actions.js";
import type { FilterStep } from "./buffers.js";
import type { Facet } from "./list-filters.js";
import {
  choosableProperties,
  facetValueStep,
  missingStep,
  statusStep,
  textStep,
  typeStep,
  valueName,
} from "./list-filters.js";

type Condition = NonNullable<ElementSelection["where"]>;

/** One condition of the value, with the label its mark shows. */
export interface ConditionMark {
  readonly label: string;
  readonly condition: unknown;
}

/** What the steps of a condition need from the argument entry (`catalog-commands.ts`). */
export interface ConditionAsk {
  readonly context: ActionContext;
  /** The command's line and the field, "Save filter open · where": the prompts' labels start with it. */
  readonly line: string;
  /** Why core refused the condition, said in the first step when it is asked again (AK6). */
  readonly error?: string;
  /** The explanation line of the argument (SR-210 AK2), to which each step adds its keys. */
  readonly explain: ArgumentExplanation;
  /** One argument back: Backspace on an empty input without a mark, and Escape, in the first step. */
  readonly back: () => void;
  /** Takes the marks as the value; `more` (Ctrl/Cmd+Enter) offers the optional arguments next. */
  readonly take: (marks: readonly ConditionMark[], more: boolean) => void;
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

const stepMark = (step: FilterStep): ConditionMark => ({
  label: step.label,
  condition: step.selection.where,
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

/** A kind of condition (AK3) and the hits of its values. */
interface Kind {
  readonly key: string;
  readonly name: string;
  /** `self` is the kind, to which the step after a hit goes back (a property's values). */
  readonly hits?: (ask: ConditionAsk, marks: readonly ConditionMark[], self: Kind) => Promise<Hits>;
}

/** The facets of the elements the marks select, without a mark of the workspace (AK3). */
const facetsOf = (
  ask: ConditionAsk,
  marks: readonly ConditionMark[],
): Promise<
  | { readonly ok: true; readonly output: ElementFacetsOutput }
  | { readonly ok: false; readonly message: string }
> =>
  ask.context.call(
    "element.facets",
    // A mark in JSON is what was typed; core checks it.
    marks.length === 0 ? {} : { selection: { where: conditionOf(marks) as Condition } },
  );

/** The values of a property among the elements the marks select, as "Filter list by property" offers them. */
const valueHits = (facet: Facet): Hit[] => [
  ...(facet.values ?? []).map((value) => {
    const name = value.name ?? valueName(facet, value);
    const key = String(value.value);
    return {
      name,
      ...(facet.kind === "choice" && key !== name ? { key } : {}),
      mark: stepMark(facetValueStep(facet, value)),
    };
  }),
  ...(facet.missing > 0 ? [{ name: "(no value)", mark: stepMark(missingStep(facet.key)) }] : []),
];

const KINDS: readonly Kind[] = [
  {
    key: "type",
    name: "Type",
    hits: async (ask) => {
      const answer = await ask.context.call("metamodel.get", {});
      return answer.ok
        ? answer.output.types.map((type) => ({
            name: type.name,
            key: type.key,
            mark: stepMark(typeStep(type.key)),
          }))
        : { failed: answer.message };
    },
  },
  {
    key: "status",
    name: "Status",
    hits: async (ask, marks) => {
      const [facets, metamodel] = await Promise.all([
        facetsOf(ask, marks),
        ask.context.call("metamodel.get", {}),
      ]);
      if (!facets.ok) {
        return { failed: facets.message };
      }
      if (!metamodel.ok) {
        return { failed: metamodel.message };
      }
      return facets.output.statuses.map(({ key }) => {
        const name = metamodel.output.statuses.find((status) => status.key === key)?.name ?? key;
        return { name, ...(name === key ? {} : { key }), mark: stepMark(statusStep(key)) };
      });
    },
  },
  {
    key: "property",
    name: "Property",
    hits: async (ask, marks, self) => {
      const facets = await facetsOf(ask, marks);
      return facets.ok
        ? choosableProperties(facets.output).map(({ facet }) => ({
            name: facet.name,
            key: facet.key,
            next: () => {
              askValues(
                ask,
                marks,
                facet.name,
                () => Promise.resolve(valueHits(facet)),
                (kept) => {
                  askKind(ask, kept, self);
                },
              );
            },
          }))
        : { failed: facets.message };
    },
  },
  { key: "text", name: "Text search" },
];

/** The marks as the minibuffer shows them, each with its × (AK9): `again` asks the step again without it. */
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

/** Asks the values of `kind`; a text search takes the typed words (an empty input asks again). */
const askKind = (ask: ConditionAsk, marks: readonly ConditionMark[], kind: Kind): void => {
  const { hits } = kind;
  if (hits !== undefined) {
    askValues(ask, marks, kind.name, (given) => hits(ask, given, kind));
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
        askCondition(ask, [...marks, stepMark(textStep(query))]);
      }
    },
  });
};

/**
 * Asks the condition with `marks` given (AK3, AK4): the finishing hit first, "Take <n> conditions" with
 * marks, else "No condition: all elements", then the kinds; text starting with "{" is taken as one condition
 * in JSON (AK6). Ctrl/Cmd+Enter takes the marks and offers the optional arguments. Backspace on an empty
 * input removes the last mark, without one it goes back an argument, as Escape does (AK9, SR-134 AK4).
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
        name: marks.length === 0 ? NO_CONDITION : `Take ${plural(marks.length, "condition")}`,
        run: take(marks, false),
        more: take(marks, true),
      },
      ...KINDS.map((kind): Choice => ({
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
    back: given.back,
  };
  given.context.ask(prompt);
};
