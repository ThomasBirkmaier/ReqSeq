// The type mark (SR-215 AK5): several types in one mark, which keeps the elements of one of them. The condition
// of "New saved filter" and "New perspective" (`condition-prompt.ts`) asks it; "Filter list" (`list-actions.ts`,
// SR-124 AK7) is to ask it the same way. Choosing a type adds it to the mark and stays in the step; the types in
// the mark are no longer offered; "Take <n> types" comes first once the mark has a type and takes it; Escape and
// Backspace on an empty input go back with the mark; an × is the asking prompt's (`TypeAsk.marks`). A condition
// has at most one type mark: choosing "Type" again continues it (`typeMarkAt`). The types come from
// `metamodel.get`; the app builds the condition `{ type: [<keys>] }` and core selects (ADR-0002).
import type { ArgumentExplanation, Choice, PromptFill, PromptMark, Prompt } from "./actions.js";
import type { Call } from "./call.js";
import type { ConditionMark } from "./condition-kinds.js";
import { stepMark } from "./condition-kinds.js";
import { typesStep } from "./list-filters.js";

/** The mark of the types `keys`: "type: need, decision", with the condition `{ type: ["need", "decision"] }`. */
export const typeMark = (keys: readonly string[]): ConditionMark => stepMark(typesStep(keys));

/**
 * The keys of the condition of a type mark (or of a type filter step): one with `type` alone and at least one key;
 * else undefined.
 */
export const typeKeysOf = (condition: unknown): readonly string[] | undefined => {
  if (typeof condition !== "object" || condition === null || Array.isArray(condition)) {
    return undefined;
  }
  const fields = condition as Readonly<Record<string, unknown>>;
  const { type } = fields;
  return Object.keys(fields).length === 1 &&
    Array.isArray(type) &&
    type.length > 0 &&
    type.every((key) => typeof key === "string")
    ? type
    : undefined;
};

/** Where the type mark stands among `marks`, the first one if a condition typed in JSON is one too; -1 without one. */
export const typeMarkAt = (marks: readonly ConditionMark[]): number =>
  marks.findIndex((mark) => typeKeysOf(mark.condition) !== undefined);

/** The name of the hit that takes the type mark: "Take 1 type", "Take 2 types". */
export const takeTypesName = (count: number): string => `Take ${String(count)} type${count === 1 ? "" : "s"}`;

/** What the type step needs from the prompt that asks it. */
export interface TypeAsk {
  readonly ask: (prompt: Prompt) => void;
  /** Reads the types (`metamodel.get`). */
  readonly call: Call;
  /** The label of the step ("New saved filter open · where · Type:"). */
  readonly label: string;
  /** The keys of the types in the mark so far, in the order chosen; empty before the first. */
  readonly keys: readonly string[];
  /**
   * The marks the input shows with the type mark of `keys` (none while `keys` is empty) at its place, each with
   * its ×, which asks the step again (`askTypes` with the keys left).
   */
  readonly marks: (keys: readonly string[]) => readonly PromptMark[];
  /** "Take <n> types": takes the mark of `keys`, which has at least one. */
  readonly take: (keys: readonly string[]) => void;
  /** Escape, and Backspace on an empty input: back to the kinds, the mark of `keys` kept (none while empty). */
  readonly back: (keys: readonly string[]) => void;
  /** The explanation line of the argument (SR-210 AK2), to which the step adds its keys; none without it. */
  readonly explain?: ArgumentExplanation;
}

/** Asks the types of the type mark (SR-215 AK5) with the types of `step.keys` in it. */
export const askTypes = (step: TypeAsk): void => {
  const { keys } = step;
  const take: readonly Choice[] =
    keys.length === 0
      ? []
      : [
          {
            id: "take",
            name: takeTypesName(keys.length),
            run: () => {
              step.take(keys);
            },
          },
        ];
  step.ask({
    label: step.label,
    // "Take <n> types" comes with the types, not before them: a hit marked while the types load would take
    // Enter only once they are there, and a key typed meanwhile cancels that Enter (SR-119), as in every step
    // whose hits come later.
    items: [],
    marks: step.marks(keys),
    ...(step.explain === undefined
      ? {}
      : {
          explain: {
            ...step.explain,
            more: false,
            building: { enter: "adds the type to the mark, or takes the mark", unmark: false, json: false },
          },
        }),
    back: () => {
      step.back(keys);
    },
    fill: step.call("metamodel.get", {}).then((answer): PromptFill =>
      answer.ok
        ? {
            items: [
              ...take,
              ...answer.output.types
                .filter((type) => !keys.includes(type.key))
                .map((type): Choice => ({
                  id: `type:${type.key}`,
                  name: type.name,
                  ...(type.key === type.name ? {} : { hint: type.key }),
                  run: () => {
                    askTypes({ ...step, keys: [...keys, type.key] });
                  },
                })),
            ],
          }
        : { label: `${answer.message} · ${step.label}`, items: take },
    ),
  });
};
