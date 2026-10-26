// A condition as `filter.save` writes it into a saved filter file (SR-070; product owner's note on #82): the
// same condition, with every element reference as the UUID of the element it names (`resolveRef`, any
// form and case, #309, #305) and every choice given by its display name as its key, as LogReq writes
// values into element files (#316). A UUID stays right when a short ID grows or an identifier moves,
// and in a working copy with other repositories (D-017). Everything else is kept as given.
//
// Call it only with a condition that `compileWhere` compiled against the same states: it resolves
// the references again and relies on the compiler's checks (a reference names one element, a view
// is a variant, a value of a key that holds relations is a text).
import type { FilterCondition, FilterPropertyCondition, View as ViewInput } from "../generated/types.js";
import { findNamed, keyDefinition } from "../metamodel/index.js";
import { relationKey, resolveRef } from "../model/index.js";
import { resolveView } from "../variants/index.js";
import type { QueryContext } from "./context.js";

/** `core`, or the UUID of the variant the view names. */
export const canonicalView = (context: QueryContext, view: ViewInput, at: string): ViewInput => {
  const resolved = resolveView(context, view, context.command, at, true);
  return resolved.kind === "core" ? "core" : resolved.variant.id;
};

const canonicalValue = (value: unknown, each: (text: string) => string): FilterPropertyCondition["value"] => {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => (typeof item === "string" ? each(item) : item));
  }
  return typeof value === "string" ? each(value) : value;
};

/** A property condition: references as UUIDs, choice names as keys (only `eq`, `ne` and `in` take them). */
const canonicalProperty = (
  context: QueryContext,
  condition: FilterPropertyCondition,
): FilterPropertyCondition => {
  const { property: key, op, value } = condition;
  if (op !== "eq" && op !== "ne" && op !== "in") {
    return condition;
  }
  if (relationKey(context.metamodel, key) !== undefined) {
    return {
      ...condition,
      value: canonicalValue(value, (ref) => resolveRef(context.store, context.shortIds, ref).id),
    };
  }
  const found = keyDefinition(context.metamodel, key);
  const choices = found?.kind === "property" ? found.definition.choices : undefined;
  if (choices === undefined) {
    return condition;
  }
  return {
    ...condition,
    value: canonicalValue(value, (text) => {
      const match = findNamed(choices, text);
      return match.kind === "found" ? match.key : text;
    }),
  };
};

/** `condition` as a saved filter file holds it (see the file comment); `at` names its field. */
export const canonicalCondition = (
  context: QueryContext,
  condition: FilterCondition,
  at: string,
): FilterCondition => {
  if ("all" in condition) {
    return { all: condition.all.map((c, i) => canonicalCondition(context, c, `${at}.all[${String(i)}]`)) };
  }
  if ("any" in condition) {
    return { any: condition.any.map((c, i) => canonicalCondition(context, c, `${at}.any[${String(i)}]`)) };
  }
  if ("not" in condition) {
    return { not: canonicalCondition(context, condition.not, `${at}.not`) };
  }
  if ("property" in condition) {
    return canonicalProperty(context, condition);
  }
  if ("relation" in condition) {
    const { to } = condition.relation;
    return to === undefined
      ? condition
      : {
          ...condition,
          relation: { ...condition.relation, to: canonicalCondition(context, to, `${at}.relation.to`) },
        };
  }
  if ("package" in condition) {
    return { package: resolveRef(context.store, context.shortIds, condition.package).id };
  }
  if ("validFor" in condition) {
    return { validFor: canonicalView(context, condition.validFor, `${at}.validFor`) };
  }
  if ("verification" in condition && condition.variant !== undefined) {
    return { ...condition, variant: canonicalView(context, condition.variant, `${at}.variant`) };
  }
  return condition;
};
