// The core requirement (glossary „Kern“, D-020): the one predicate for the targets of replacements
// and exclusions (SR-041, SR-042), their hint `variant.target-not-core` and the refusal of
// `variant.exclude`. An element is one when its type has the property with the meaning `validity`
// among its effective properties and it has no validity entry (absent, `null` or `[]`). An element of
// a type without that property (a need, a package: SR-041 AK8, SR-042 AK7) is none, nor is one whose
// validity has another shape (the value-kind check reports that, SR-085).
import type { Metamodel } from "../metamodel/index.js";
import { findType } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { validityOf } from "./views.js";

/** Whether `element` is a core requirement in `context` (see the file comment). */
export const isCoreRequirement = (
  context: { readonly metamodel: Metamodel },
  element: ElementRecord,
): boolean => {
  const validity = validityOf(context.metamodel);
  if (
    validity === undefined ||
    findType(context.metamodel, element.type)?.properties.includes(validity.key) !== true
  ) {
    return false;
  }
  const value = element.data[validity.key];
  return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
};
