// The variants that replace or exclude a core requirement (SR-046 AK3), as the view rule decides
// it (view-rule.ts): a variant v excludes it when v's own exclusion names it, and replaces it with
// each replacement valid in v that names it, unless v also excludes it (exclusion wins, SR-042
// AK5). The variants a replacement is valid in are the entries of its validity that resolve to one
// element of a type with the meaning `variant`; an entry that names none (a variant in a repository
// that is not here, `ref.unknown`) names no view, so it is left out, as the selection leaves it.
//
// Cost (N-036): the rule items by target are one pass over the items of the index, kept with it
// (a WeakMap by index); one element then costs its own items, and the rule of each variant they
// name is built once per index (`viewRuleIn`), so data.export pays it once for all elements.
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord, ElementStore } from "../model/index.js";
import { resolveTarget } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { isCoreRequirement } from "./core.js";
import type { RuleItem, ViewRuleIndex } from "./view-rule.js";
import { ruleTarget, viewRuleIn, viewRuleIndexOf } from "./view-rule.js";
import { validityEntries, validityOf, validityTarget, variantTypes } from "./views.js";

/** The variants that replace (with the replacement) or exclude one core requirement. */
export interface ReplacedExcluded {
  /** Each variant with each replacement valid in it, in item order; none for a variant in `excludedBy`. */
  readonly replacedBy: readonly { readonly variant: ElementRecord; readonly replacement: ElementRecord }[];
  /** The variants that exclude it, in item order. */
  readonly excludedBy: readonly ElementRecord[];
}

const NONE: ReplacedExcluded = { replacedBy: [], excludedBy: [] };

/** The rule items of an index by the element they name, built once per index. */
const byTarget = new WeakMap<ViewRuleIndex, Map<ElementRecord, RuleItem[]>>();

const itemsByTarget = (index: ViewRuleIndex): Map<ElementRecord, RuleItem[]> => {
  let map = byTarget.get(index);
  if (map === undefined) {
    map = new Map();
    for (const item of index.items) {
      const target = ruleTarget(index, item);
      const items = target === undefined ? undefined : map.get(target);
      if (items !== undefined) {
        items.push(item);
      } else if (target !== undefined) {
        map.set(target, [item]);
      }
    }
    byTarget.set(index, map);
  }
  return map;
};

/** What `variantsNamedBy` reads of the index, computed once per call of `replacedExcludedOf`. */
interface Named {
  readonly store: ElementStore;
  readonly validity: ReturnType<typeof validityOf>;
  readonly types: ReadonlySet<string>;
}

/** The variants the validity of `source` names, each resolved to one element of a variant type. */
const variantsNamedBy = (named: Named, source: ElementRecord): ElementRecord[] =>
  validityEntries(named.validity, source).flatMap((entry) => {
    const target = validityTarget(entry.value, source);
    const match = target === undefined ? undefined : resolveTarget(named.store, source.repository, target);
    return match?.kind === "found" && named.types.has(match.element.type) ? [match.element] : [];
  });

/**
 * The variants that replace or exclude `record` (see the file comment), for its copy in
 * `context.store` (the same repository and file: the rule works on the store's records, and
 * element.get reads its record from the file again); none when it is no core requirement or the
 * store holds no such copy.
 */
export const replacedExcludedOf = (
  context: { readonly workspace: Workspace; readonly store: ElementStore; readonly metamodel: Metamodel },
  record: ElementRecord,
): ReplacedExcluded => {
  const element = context.store.byId
    .get(record.id)
    ?.find((r) => r.repository === record.repository && r.file === record.file);
  if (element === undefined || !isCoreRequirement(context, element)) {
    return NONE;
  }
  const index = viewRuleIndexOf(context.workspace, context.store, context.metamodel);
  const named: Named = {
    store: index.store,
    validity: validityOf(index.metamodel),
    types: variantTypes(index.metamodel),
  };
  const variants = new Set<ElementRecord>();
  for (const item of itemsByTarget(index).get(element) ?? []) {
    for (const variant of item.meaning === "exclusion"
      ? [item.source]
      : variantsNamedBy(named, item.source)) {
      variants.add(variant);
    }
  }
  const replacedBy: { variant: ElementRecord; replacement: ElementRecord }[] = [];
  const excludedBy: ElementRecord[] = [];
  for (const variant of variants) {
    const rule = viewRuleIn(index, { kind: "variant", variant });
    if (rule.excludes(element)) {
      excludedBy.push(variant);
    }
    replacedBy.push(...rule.replacedBy(element).map((replacement) => ({ variant, replacement })));
  }
  return { replacedBy, excludedBy };
};
