// The optional properties and relations of a new element ("Create element" after Ctrl/Cmd+Enter), built from hits
// as marks (SR-215 AK4, AK8, AK9, AK10) as a condition is (`condition-prompt.ts`): the properties of the type
// without a value, then their values as a required one asks them (SR-064 AK1), or the relation kinds of the type
// (`metamodel.get` `relationKinds`), then a target among their target types. The value is per mark what the CLI
// takes: properties as their boxes save them (`propertiesInput`), relations by kind with the target's UUID, a
// list where a kind has several. Core checks the input (ADR-0002).
import type { ElementInputValue, MetamodelGetOutput } from "@reqseq/core";
import type { ActionContext, ArgumentExplanation, Choice, PromptFill, PromptMark } from "./actions.js";
import { findElements } from "./actions.js";
import type { PropertyAnswer } from "./create-element.js";
import { propertiesInput } from "./create-element.js";
import type { PropertyInfo } from "./element-view.js";
import { propertyInfo } from "./element-view.js";
import { choiceItems } from "./property-edit.js";
import { rowName } from "./rows.js";

type Metamodel =
  | { readonly ok: true; readonly output: MetamodelGetOutput }
  | { readonly ok: false; readonly message: string };

interface Answer {
  readonly value: PropertyAnswer;
  readonly label: string;
}

/** A property of the new element with its values: one mark (AK8). */
export interface PropertyMark {
  readonly label: string;
  readonly property: string;
  readonly info: PropertyInfo;
  readonly values: readonly Answer[];
}

/** A relation of the new element, its kind and the UUID of its target: one mark (AK8). */
export interface RelationMark {
  readonly label: string;
  readonly kind: string;
  readonly target: string;
}

/** What the steps need from the argument entry (`catalog-commands.ts`). */
export interface BuildAsk<M> {
  readonly context: ActionContext;
  readonly line: string;
  /** Why core refused the value, said in the first step when it is asked again. */
  readonly error?: string;
  /** The explanation line of the argument (SR-210 AK2), to which each step adds its keys. */
  readonly explain: ArgumentExplanation;
  readonly type: unknown;
  /** The properties given a value before (the required ones): not offered. */
  readonly filled: readonly string[];
  /** One argument back, with the marks, which stand again when the argument is asked again (AK9). */
  readonly back: (marks: readonly M[]) => void;
  /** Takes the marks as the value; `more` (Ctrl/Cmd+Enter) offers the optional arguments next. */
  readonly take: (marks: readonly M[], more: boolean) => void;
  /** The finishing hit without a mark: no value (AK4, AK10). */
  readonly skip: (more: boolean) => void;
  /** The metamodel, read once for the argument, so the hits of its later steps come at once. */
  readonly metamodel?: Promise<Metamodel>;
}

/** The value of `properties` the marks give (AK10): each property as its box with those values saves it. */
export const propertiesOf = (marks: readonly PropertyMark[]): Record<string, ElementInputValue> =>
  propertiesInput(
    marks.map(({ property, info }) => ({ key: property, info })),
    marks.flatMap(({ property, values }) => values.map(({ value }) => ({ key: property, value }))),
  );

/** The value of `relations` the marks give (AK10): each kind with its target, a list where it has several. */
export const relationsOf = (marks: readonly RelationMark[]): Record<string, string | string[]> =>
  Object.fromEntries(
    marks.map(({ kind }) => {
      const targets = marks.filter((mark) => mark.kind === kind).map((mark) => mark.target);
      return [kind, targets.length === 1 ? (targets[0] ?? "") : targets];
    }),
  );

export const marksLabel = (marks: readonly { readonly label: string }[]): string =>
  marks.map((mark) => mark.label).join(" · ");

/** The marks, each with its × (AK9): `again` asks the first step without it. */
const promptMarks = <M extends { readonly label: string }>(
  marks: readonly M[],
  again: (marks: readonly M[]) => void,
): readonly PromptMark[] =>
  marks.map((mark, at) => ({
    label: mark.label,
    remove: () => {
      again(marks.filter((_, place) => place !== at));
    },
  }));

/** The keys of a later step: what Enter does; Escape and Backspace on an empty input go to the first step. */
const later = <M extends { readonly label: string }>(
  ask: BuildAsk<M>,
  label: string,
  marks: readonly M[],
  first: (marks: readonly M[]) => void,
  enter: string,
) => ({
  label: `${ask.line} · ${label}:`,
  items: [],
  marks: promptMarks(marks, first),
  explain: { ...ask.explain, more: false, building: { enter, unmark: false, json: false } },
  back: () => {
    first(marks);
  },
});

interface Offered {
  readonly key: string;
  readonly name: string;
  readonly next: () => void;
}

/**
 * The first step: the finishing hit, "Take <n> …" with marks, else `none`, which skips the argument (AK4), then the
 * choices `offered` reads. Backspace on an empty input removes the last mark, else goes back (AK9, SR-134 AK4).
 */
const askFirst = <M extends { readonly label: string }>(
  ask: Reading<M>,
  error: string | undefined,
  marks: readonly M[],
  [none, one, many]: readonly [string, string, string],
  offered: (output: MetamodelGetOutput) => readonly Offered[],
  again: (marks: readonly M[]) => void,
): void => {
  const take = (more: boolean) => (): void => {
    if (marks.length === 0) {
      ask.skip(more);
    } else {
      ask.take(marks, more);
    }
  };
  const label = `${error === undefined ? "" : `${error} · `}${ask.line}:`;
  const finish: Choice = {
    id: "take",
    name: marks.length === 0 ? none : `Take ${String(marks.length)} ${marks.length === 1 ? one : many}`,
    run: take(false),
    more: take(true),
  };
  ask.context.ask({
    label,
    items: [finish],
    fill: ask.metamodel.then((answer): PromptFill =>
      answer.ok
        ? {
            items: [
              finish,
              ...offered(answer.output).map((offer): Choice => ({
                id: `key:${offer.key}`,
                name: offer.name,
                hint: offer.key,
                run: offer.next,
                more: take(true),
              })),
            ],
          }
        : { label: `${answer.message} · ${label}` },
    ),
    marks: promptMarks(marks, again),
    unmark: true,
    explain: {
      ...ask.explain,
      building: { enter: "takes the marked hit", unmark: marks.length > 0, json: false },
    },
    back: () => {
      ask.back(marks);
    },
  });
};

type Reading<M> = BuildAsk<M> & { readonly metamodel: Promise<Metamodel> };

/** `given` with the metamodel read, and without core's message, which is said once, in the first step. */
const reading = <M>({ error: _error, ...given }: BuildAsk<M>): Reading<M> => ({
  ...given,
  metamodel: given.metamodel ?? given.context.call("metamodel.get", {}),
});

/**
 * Asks the values of a property (AK8, SR-064 AK1); a value joins its mark, a list takes more until Enter on an
 * empty input.
 */
const askValues = (
  ask: BuildAsk<PropertyMark>,
  marks: readonly PropertyMark[],
  property: string,
  info: PropertyInfo,
): void => {
  const own = marks.find((mark) => mark.property === property);
  const values = own?.values ?? [];
  const first = (next: readonly PropertyMark[]): void => {
    askProperties(ask, next);
  };
  const add = (answer: Answer): void => {
    const added = [...values, answer];
    const label = `${property}: ${added.map((value) => value.label).join(", ")}`;
    const mark = { label, property, info, values: added };
    const next = own === undefined ? [...marks, mark] : marks.map((given) => (given === own ? mark : given));
    if (info.many) {
      askValues(ask, next, property, info);
    } else {
      first(next);
    }
  };
  const types = info.targetTypes;
  const taken = values.flatMap(({ value }) => (typeof value === "string" ? [value] : []));
  const enter =
    info.many && values.length > 0 ? "adds a value, on an empty input ends the values" : "adds the value";
  ask.context.ask({
    ...later(ask, property, marks, first, enter),
    ...(values.length > 0
      ? {
          empty: () => {
            first(marks);
          },
        }
      : {}),
    ...(info.kind === "choice"
      ? {
          items: choiceItems(info, taken)
            .filter((choice) => !choice.set)
            .map((choice) => ({
              id: JSON.stringify(choice.key),
              name: choice.name,
              hint: choice.hint,
              run: () => {
                add({ value: choice.key, label: choice.name });
              },
            })),
        }
      : info.kind !== "relation"
        ? {
            text: (text: string) => {
              if (text.trim() === "") {
                first(marks);
              } else {
                add({ value: text, label: text });
              }
            },
          }
        : types?.length === 0
          ? {} // A relation property that may point at no type finds nothing.
          : {
              find: findElements(
                ask.context,
                (row) => {
                  const value = { id: row.open.id, repository: row.open.repository, label: rowName(row) };
                  add({ value, label: row.label });
                },
                types === undefined ? {} : { selection: { where: { type: [...types] } } },
              ),
            }),
  });
};

/**
 * Asks the optional properties of a new element (AK4, AK8): the finishing hit, then the properties of the type
 * in its order without a value, never the title; a property asks its values.
 */
export const askProperties = (given: BuildAsk<PropertyMark>, marks: readonly PropertyMark[]): void => {
  const ask = reading(given);
  const offered = (output: MetamodelGetOutput): Offered[] =>
    (output.types.find((type) => type.key === given.type)?.properties ?? [])
      .flatMap((key) => output.properties.filter((property) => property.key === key))
      .filter(
        ({ key, meaning }) =>
          meaning !== "title" && !given.filled.includes(key) && !marks.some((mark) => mark.property === key),
      )
      .map((property) => ({
        key: property.key,
        name: property.name,
        next: () => {
          askValues(ask, marks, property.key, propertyInfo(property));
        },
      }));
  askFirst(ask, given.error, marks, ["No properties", "property", "properties"], offered, (next) => {
    askProperties(ask, next);
  });
};

/**
 * Asks the relations of a new element (AK4, AK8): the finishing hit, then the relation kinds the type may have as
 * source; a kind asks its target among the elements of its target types, which adds a mark.
 */
export const askRelations = (given: BuildAsk<RelationMark>, marks: readonly RelationMark[]): void => {
  const ask = reading(given);
  const first = (next: readonly RelationMark[]): void => {
    askRelations(ask, next);
  };
  const offered = (output: MetamodelGetOutput): Offered[] =>
    (typeof given.type === "string" ? (output.relationKinds[given.type] ?? []) : []).map(
      ({ kind, targetTypes }) => ({
        key: kind,
        name: output.relations.find((relation) => relation.key === kind)?.name ?? kind,
        next: () => {
          ask.context.ask({
            ...later(ask, kind, marks, first, "adds the relation"),
            find: findElements(
              ask.context,
              (row) => {
                first([...marks, { label: `${kind}: ${row.label}`, kind, target: row.open.id }]);
              },
              { selection: { where: { type: [...targetTypes] } } },
            ),
          });
        },
      }),
    );
  askFirst(ask, given.error, marks, ["No relations", "relation", "relations"], offered, first);
};
