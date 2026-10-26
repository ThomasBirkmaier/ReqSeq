// Conditions on any property (SR-069 AK1 "eine beliebige Property", `filter.schema.json#/$defs/
// propertyCondition`): `{property, op, value}` on the values under a frontmatter key, known to the
// metamodel or not (SR-016: unknown properties are kept, so they can be filtered on too).
//
// - The values: none when the key is absent, `null` or an empty list (the same, as for the version,
//   ADR-0005), the items of a list, else the one value (`valuesOf`). `exists` holds with some value,
//   `missing` with none; both take no `value`.
// - `eq`: some value equals `value` (a text, number or boolean; `===`, so `1` is not `"1"`); `ne`
//   holds where `eq` does not, also without a value. `in`: some value equals an item of the list.
//   `contains`: some text value contains the text, ignoring case (and Unicode normal form).
//   `lt`, `le`, `gt`, `ge`: some value compares so with `value`, a number with numbers and a text
//   with texts by code units (an ISO date is text in YAML 1.2, so dates compare as dates). `matches`:
//   some text value matches the JavaScript regular expression `value` (flag `u`).
// - A property of kind `choice`: a value may be the display name of a choice in any case, as on
//   write (#309, `findNamed`); a text that names no choice is taken as written (a file may hold it,
//   SR-085), one that names several is `input.invalid`.
// - A key that holds relations (a property of kind `relation`, such as validity and packages, or a
//   relation kind): the values are element references (`resolveRef`, any case; product owner's note
//   on #81), compared with the targets the items name (UUID and repository, D-058); only `eq`, `ne`,
//   `in`, `exists` and `missing` apply.
import type { FilterPropertyCondition } from "../generated/types.js";
import type { Named } from "../metamodel/index.js";
import { findNamed, keyDefinition } from "../metamodel/index.js";
import { relationKey, resolveRef } from "../model/index.js";
import { validityTarget } from "../variants/index.js";
import type { CompileContext, Predicate } from "./context.js";
import { fold, invalidAt, valuesOf } from "./context.js";

type Scalar = string | number | boolean;

const isScalar = (value: unknown): value is Scalar =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/** The operands of `eq`, `ne` (one value) and `in` (a list); `input.invalid` for any other shape. */
const operandsOf = (
  context: CompileContext,
  op: "eq" | "ne" | "in",
  value: unknown,
  at: string,
): readonly Scalar[] => {
  if (op === "in") {
    if (!Array.isArray(value) || !value.every(isScalar)) {
      throw invalidAt(context, `${at}.value`, "op in takes a list of texts, numbers or booleans");
    }
    return value;
  }
  if (!isScalar(value)) {
    throw invalidAt(context, `${at}.value`, `op ${op} takes a text, number or boolean`);
  }
  return [value];
};

/** The choice keys `operands` name (see the file comment). */
const choiceKeys = (
  context: CompileContext,
  choices: readonly Named[],
  operands: readonly Scalar[],
  at: string,
): readonly Scalar[] =>
  operands.map((operand) => {
    if (typeof operand !== "string") {
      return operand;
    }
    const match = findNamed(choices, operand);
    if (match.kind === "ambiguous") {
      throw invalidAt(
        context,
        `${at}.value`,
        `${operand} names more than one choice (${match.keys.join(", ")}); give the key`,
      );
    }
    return match.kind === "found" ? match.key : operand;
  });

/** Whether some text value meets `test`. */
const someText =
  (key: string, test: (text: string) => boolean): Predicate =>
  (element) =>
    valuesOf(element.data[key]).some((v) => typeof v === "string" && test(v));

/** `lt`, `le`, `gt`, `ge` on the outcome of comparing a value with the operand. */
const ORDERS: Readonly<Record<"lt" | "le" | "gt" | "ge", (order: number) => boolean>> = {
  lt: (order) => order < 0,
  le: (order) => order <= 0,
  gt: (order) => order > 0,
  ge: (order) => order >= 0,
};

/** How `value` compares with `operand`, undefined when they are not of one kind (a number and a text). */
const orderOf = (value: unknown, operand: number | string): number | undefined => {
  if (typeof operand === "number") {
    return typeof value === "number" ? value - operand : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  return value === operand ? 0 : value < operand ? -1 : 1;
};

/** A condition on a key that holds relations (see the file comment). */
const compileTargets = (
  context: CompileContext,
  condition: FilterPropertyCondition,
  label: string,
  at: string,
): Predicate => {
  const { property: key, op, value } = condition;
  if (op !== "eq" && op !== "ne" && op !== "in") {
    throw invalidAt(
      context,
      `${at}.op`,
      `op ${op} does not apply to ${label}, which holds relations; use eq, ne, in, exists or missing`,
    );
  }
  const operands = operandsOf(context, op, value, at);
  const targets = new Set(
    operands.map((ref) => {
      if (typeof ref !== "string") {
        throw invalidAt(context, `${at}.value`, `${label} holds relations: give element references`);
      }
      const target = resolveRef(context.store, context.shortIds, ref);
      return `${target.repository}\n${target.id}`;
    }),
  );
  const names: Predicate = (element) =>
    valuesOf(element.data[key]).some((item) => {
      const target = validityTarget(item, element);
      return target !== undefined && targets.has(`${target.repository}\n${target.id}`);
    });
  return op === "ne" ? (element) => !names(element) : names;
};

/** `eq`, `ne` and `in` on plain values. */
const compileEquality = (key: string, op: "eq" | "ne" | "in", operands: readonly Scalar[]): Predicate => {
  const wanted: ReadonlySet<unknown> = new Set(operands);
  const some: Predicate = (element) => valuesOf(element.data[key]).some((v) => wanted.has(v));
  return op === "ne" ? (element) => !some(element) : some;
};

/** The test of `matches`: a JavaScript regular expression with flag `u`; `input.invalid` when it is none. */
const regexOf = (context: CompileContext, pattern: string, at: string): ((text: string) => boolean) => {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "u");
  } catch (error) {
    throw invalidAt(context, `${at}.value`, `${pattern} is no regular expression: ${String(error)}`);
  }
  return (text) => regex.test(text);
};

/** `contains`, `matches`, `lt`, `le`, `gt` and `ge` on plain values. */
const compileCompare = (
  context: CompileContext,
  key: string,
  op: "contains" | "matches" | "lt" | "le" | "gt" | "ge",
  value: unknown,
  at: string,
): Predicate => {
  if (op === "contains" || op === "matches") {
    if (typeof value !== "string") {
      throw invalidAt(context, `${at}.value`, `op ${op} takes a text`);
    }
    const part = fold(value);
    return someText(
      key,
      op === "contains" ? (text) => fold(text).includes(part) : regexOf(context, value, at),
    );
  }
  if (typeof value !== "number" && typeof value !== "string") {
    throw invalidAt(context, `${at}.value`, `op ${op} takes a number or a text`);
  }
  const holds = ORDERS[op];
  return (element) =>
    valuesOf(element.data[key]).some((v) => {
      const order = orderOf(v, value);
      return order !== undefined && holds(order);
    });
};

/** Compiles a property condition (see the file comment). */
export const compileProperty = (
  context: CompileContext,
  condition: FilterPropertyCondition,
  at: string,
): Predicate => {
  const { property: key, op, value } = condition;
  if (op === "exists" || op === "missing") {
    if (value !== undefined) {
      throw invalidAt(context, `${at}.value`, `op ${op} takes no value`);
    }
    const wanted = op === "exists";
    return (element) => valuesOf(element.data[key]).length > 0 === wanted;
  }
  const relation = relationKey(context.metamodel, key);
  if (relation !== undefined) {
    return compileTargets(context, condition, relation.label, at);
  }
  if (op !== "eq" && op !== "ne" && op !== "in") {
    return compileCompare(context, key, op, value, at);
  }
  const found = keyDefinition(context.metamodel, key);
  const choices = found?.kind === "property" ? found.definition.choices : undefined;
  const operands = operandsOf(context, op, value, at);
  return compileEquality(
    key,
    op,
    choices === undefined ? operands : choiceKeys(context, choices, operands, at),
  );
};
