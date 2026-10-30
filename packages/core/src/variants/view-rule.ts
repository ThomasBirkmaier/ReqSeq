// The view rule (SR-041, SR-042, SR-043, D-020, D-059): which elements a view holds.
//
// - The core view holds the elements without a validity entry (`appliesIn`, SR-043 AK9).
//   Replacements and exclusions never touch it (SR-041 AK3).
// - The view of a variant v holds the elements that apply in v by their validity (`appliesIn`),
//   less the core requirements (`isCoreRequirement`) that v excludes or that a replacement valid in
//   v replaces (SR-041 AK1, AK4, SR-043 AK1).
// - Elements of a type without the validity property among its effective properties are in every
//   view and added in none, even with a stray validity entry (SR-043 AK10; SR-016 reports the key).
// - Rule items are the items of every relation kind with the meaning `replacement` or `exclusion`,
//   read by meaning, never by key: exclusions only from elements of a type with the meaning
//   `variant` (they act in that variant), replacements only from elements with a validity entry
//   (they act in the variants it names; one without validity replaces in no view, SR-041 AK6). An
//   item names the UUID in the repository it names, else in its source's (D-058, `validityTarget`).
// - Only items whose target resolves to one core requirement act (`resolveTarget`); the others
//   change no view (SR-041 AK8). A target in a repository that is not here acts in no view; the
//   selection says `incomplete` (SR-006 AK2).
// - Exclusion wins: a replacement of a target v excludes is no replacement in v (SR-042 AK5), and
//   its source counts as added. Several replacements of one target are all listed (SR-041 AK7).
// - The status is not read: a superseded replacement still replaces until its relation or its
//   validity is removed or a successor replaces the target (SR-041 AK9). Nothing cascades: the
//   children of a removed core requirement stay where their own validity puts them (SR-041 AK5).
//
// Cost (N-036): the index is one pass over the store, without file reads and without any other
// state, memoised per store and metamodel (`viewRuleIndexState`, a WeakMap like the succession
// index). The rule of a variant is built on demand from the items, O(replacements + exclusions),
// and kept in the index; then `includes` is O(1) beyond `appliesIn` (the types with the validity
// property are one set, built with the index).
import type { Metamodel } from "../metamodel/index.js";
import { relationKindsWithMeaning } from "../metamodel/index.js";
import type { ElementRecord, ElementStore } from "../model/index.js";
import { relationItems, resolveTarget } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { isCoreRequirement } from "./core.js";
import type { ValidityTarget, View } from "./views.js";
import { appliesIn, validityEntries, validityOf, validityTarget, variantTypes } from "./views.js";

/** One item of a relation kind with the meaning `replacement` or `exclusion`. */
export interface RuleItem {
  readonly meaning: "replacement" | "exclusion";
  readonly source: ElementRecord;
  /** Where the item is in the source's file: `[key, i]`. */
  readonly path: readonly (string | number)[];
  readonly target: ValidityTarget;
}

/** The rule of one view (see the file comment). */
export interface ViewRule {
  readonly view: View;
  /** Whether the view holds `element`. */
  readonly includes: (element: ElementRecord) => boolean;
  /** The elements that replace the core requirement `element` in the view, in item order. */
  readonly replacedBy: (element: ElementRecord) => readonly ElementRecord[];
  /** Whether the view excludes the core requirement `element`. */
  readonly excludes: (element: ElementRecord) => boolean;
  /** The elements whose validity names the variant and that replace no core requirement in it, in store order. */
  readonly addedOf: () => readonly ElementRecord[];
  /** Each replaced core requirement with each of its replacements, in store order of the core requirements. */
  readonly replacedOf: () => readonly { readonly core: ElementRecord; readonly replacement: ElementRecord }[];
  /** The excluded core requirements, in store order. */
  readonly excludedOf: () => readonly ElementRecord[];
}

/** The rule items of one store, and the rules built from them. */
export interface ViewRuleIndex {
  readonly store: ElementStore;
  readonly metamodel: Metamodel;
  /** The effective type keys whose properties hold the validity property (SR-043 AK10). */
  readonly validityTypes: ReadonlySet<string>;
  /** Every rule item, in store order of the sources, then relation kind (metamodel order), then item. */
  readonly items: readonly RuleItem[];
  /** The rules of the variants built so far, by repository and UUID of the variant. */
  readonly rules: Map<string, ViewRule>;
}

/** What the index and the finder read of a metamodel. */
interface Scope {
  readonly metamodel: Metamodel;
  readonly validity: ReturnType<typeof validityOf>;
  readonly variants: ReadonlySet<string>;
  readonly replacement: readonly string[];
  readonly exclusion: readonly string[];
}

const scopeOf = (metamodel: Metamodel): Scope => ({
  metamodel,
  validity: validityOf(metamodel),
  variants: variantTypes(metamodel),
  replacement: relationKindsWithMeaning(metamodel, "replacement").map((k) => k.key),
  exclusion: relationKindsWithMeaning(metamodel, "exclusion").map((k) => k.key),
});

/** The rule items of `source` (see the file comment), in relation kind order, then item order. */
const itemsOf = (scope: Scope, source: ElementRecord): readonly RuleItem[] => {
  const kinds: [RuleItem["meaning"], readonly string[]][] = [];
  if (validityEntries(scope.validity, source).length > 0) {
    kinds.push(["replacement", scope.replacement]);
  }
  if (scope.variants.has(source.type)) {
    kinds.push(["exclusion", scope.exclusion]);
  }
  return kinds.flatMap(([meaning, keys]) =>
    keys.flatMap((key) =>
      relationItems(key, { many: true }, source.data[key]).flatMap(([path, item]) => {
        const target = validityTarget(item, source);
        return target === undefined ? [] : [{ meaning, source, path, target }];
      }),
    ),
  );
};

/** The rule items of `store` read with `metamodel`: one pass, no file read, no other state. */
export const buildViewRuleIndex = (store: ElementStore, metamodel: Metamodel): ViewRuleIndex => {
  const scope = scopeOf(metamodel);
  const key = scope.validity?.key;
  const validityTypes = new Set(
    metamodel.effectiveTypes.filter((t) => key !== undefined && t.properties.includes(key)).map((t) => t.key),
  );
  return {
    store,
    metamodel,
    validityTypes,
    items: store.elements.flatMap((e) => itemsOf(scope, e)),
    rules: new Map(),
  };
};

/** The view rule indexes of a workspace, by the store each was built from (dropped with the store). */
export const viewRuleIndexState = defineWorkspaceState(
  "view-rule",
  (): WeakMap<ElementStore, ViewRuleIndex> => new WeakMap(),
);

/** The index of `store` with `metamodel`, built when the workspace has none for both. Synchronous. */
export const viewRuleIndexOf = (
  workspace: Workspace,
  store: ElementStore,
  metamodel: Metamodel,
): ViewRuleIndex => {
  const memo = workspace.get(viewRuleIndexState);
  let index = memo.get(store);
  if (index?.metamodel !== metamodel) {
    index = buildViewRuleIndex(store, metamodel);
    memo.set(store, index);
  }
  return index;
};

/** The element `item` names in `context.store`, when it resolves to exactly one (`resolveTarget`). */
export const ruleTarget = (
  context: { readonly store: ElementStore },
  item: RuleItem,
): ElementRecord | undefined => {
  const match = resolveTarget(context.store, item.source.repository, item.target);
  return match.kind === "found" ? match.element : undefined;
};

/** The core requirement `item` names, if it resolves to one (see the file comment). */
const actingTarget = (index: ViewRuleIndex, item: RuleItem): ElementRecord | undefined => {
  const target = ruleTarget(index, item);
  return target !== undefined && isCoreRequirement(index, target) ? target : undefined;
};

/** Whether `element` applies in `view`: always for a type without the validity property (SR-043 AK10). */
const appliesInView = (
  index: ViewRuleIndex,
  validity: ReturnType<typeof validityOf>,
  element: ElementRecord,
  view: View,
): boolean => !index.validityTypes.has(element.type) || appliesIn(validity, element, view);

const inStoreOrder = (index: ViewRuleIndex, wanted: (e: ElementRecord) => boolean): ElementRecord[] =>
  index.store.elements.filter(wanted);

/** The rule of the variant `variant` (see the file comment). */
const variantRule = (index: ViewRuleIndex, view: View & { readonly kind: "variant" }): ViewRule => {
  const validity = validityOf(index.metamodel);
  const { variant } = view;
  const own = (item: RuleItem): boolean =>
    item.source.id === variant.id && item.source.repository === variant.repository;
  const excluded = new Set<ElementRecord>();
  for (const item of index.items) {
    const target = item.meaning === "exclusion" && own(item) ? actingTarget(index, item) : undefined;
    if (target !== undefined) {
      excluded.add(target);
    }
  }
  const replaced = new Map<ElementRecord, ElementRecord[]>();
  const replacing = new Set<ElementRecord>();
  for (const item of index.items) {
    const valid = item.meaning === "replacement" && appliesIn(validity, item.source, view);
    const target = valid ? actingTarget(index, item) : undefined;
    if (target !== undefined && !excluded.has(target)) {
      const list = replaced.get(target) ?? [];
      if (!list.includes(item.source)) {
        list.push(item.source);
      }
      replaced.set(target, list);
      replacing.add(item.source);
    }
  }
  const replacedBy = (e: ElementRecord): readonly ElementRecord[] => replaced.get(e) ?? [];
  return {
    view,
    includes: (e) => appliesInView(index, validity, e, view) && !excluded.has(e) && !replaced.has(e),
    replacedBy,
    excludes: (e) => excluded.has(e),
    addedOf: () =>
      inStoreOrder(
        index,
        (e) =>
          index.validityTypes.has(e.type) &&
          validityEntries(validity, e).length > 0 &&
          appliesIn(validity, e, view) &&
          !replacing.has(e),
      ),
    replacedOf: () =>
      inStoreOrder(index, (e) => replaced.has(e)).flatMap((core) =>
        replacedBy(core).map((replacement) => ({ core, replacement })),
      ),
    excludedOf: () => inStoreOrder(index, (e) => excluded.has(e)),
  };
};

/** The rule of the core view: the validity alone. */
const coreRule = (index: ViewRuleIndex): ViewRule => {
  const validity = validityOf(index.metamodel);
  const view: View = { kind: "core" };
  return {
    view,
    includes: (e) => appliesInView(index, validity, e, view),
    replacedBy: () => [],
    excludes: () => false,
    addedOf: () => [],
    replacedOf: () => [],
    excludedOf: () => [],
  };
};

/** The rule of `view` in `index`, built once per variant and index. */
export const viewRuleIn = (index: ViewRuleIndex, view: View): ViewRule => {
  if (view.kind === "core") {
    return coreRule(index);
  }
  const key = `${view.variant.repository}\0${view.variant.id}`;
  let rule = index.rules.get(key);
  if (rule === undefined) {
    rule = variantRule(index, view);
    index.rules.set(key, rule);
  }
  return rule;
};

/** The rule of `view` for `store` read with `metamodel` in `workspace` (see the file comment). */
export const viewRuleOf = (
  context: { readonly workspace: Workspace; readonly store: ElementStore; readonly metamodel: Metamodel },
  view: View,
): ViewRule => viewRuleIn(viewRuleIndexOf(context.workspace, context.store, context.metamodel), view);
