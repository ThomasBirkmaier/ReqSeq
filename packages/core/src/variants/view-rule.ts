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
//   change no view and are `variant.target-not-core` (target-not-core.ts, SR-041 AK8). A target in
//   a repository that is not here acts in no view and gives no hint; the selection says
//   `incomplete` (SR-006 AK2).
// - Exclusion wins: a replacement of a target v excludes is no replacement in v (SR-042 AK5), and
//   its source counts as added. Several replacements of one target are all listed (SR-041 AK7).
// - The status is not read: a superseded replacement still replaces until its relation or its
//   validity is removed or a successor replaces the target (SR-041 AK9). Nothing cascades: the
//   children of a removed core requirement stay where their own validity puts them (SR-041 AK5).
//
// Cost (N-036): the index is one pass over the store, without file reads and without any other
// state, memoised per store and metamodel (`viewRuleIndexState`, a WeakMap like the succession
// index), and carried over a change of the store in O(items + changed) (`carryViewRuleIndex`, #215).
// Which variants remove which core requirement is one map per index, built on first use from the
// items, O(replacements + exclusions) (`removalOf`); `includes` of every view reads it, so a new
// store costs one pass over the items, not one per variant (N-036, SR-082 AK3). Where a record of the
// store is in the views of the variants (`membershipOf`) is found on its first lookup and kept per
// index, so a variant's `includes` is one lookup by record after it: a walk asks it once per step,
// about 110,000 times for the chain of the first need at N-036 (#463), and a new store pays only
// for the records asked about. The lists of a variant's rule
// (`replacedBy`, `addedOf`, ...) are built only when asked. An element is looked up by repository and
// UUID, not by record, so a record read again from its file (element.get) gets the same answer.
import type { Metamodel } from "../metamodel/index.js";
import { relationKindsWithMeaning } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, StoreUpdate } from "../model/index.js";
import { byPath, carryStoreUpdate, elementStoreState, relationItems, resolveTarget } from "../model/index.js";
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

/** The rule items of `source` (see the file comment), in relation kind order, then item order. */
export const ruleItemsOf = (metamodel: Metamodel, source: ElementRecord): readonly RuleItem[] =>
  itemsOf(scopeOf(metamodel), source);

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

/**
 * The index of `update.to`, carried over from `index`, the index of `update.from` (#215): the items
 * of the records in the changed files (`StoreUpdate.files`) are dropped, those of the records in them
 * now are put at their place in store order, and the other items are kept as the same objects. Costs
 * the items (a few hundred at N-036), not the store. The removal map is built again from the items on
 * first use (a changed record may be the target of an item that did not change), and the
 * membership of each record on its first lookup (`membershipOf`).
 */
export const carryViewRuleIndex = (index: ViewRuleIndex, update: StoreUpdate): ViewRuleIndex => {
  const scope = scopeOf(index.metamodel);
  const inChangedFile = (source: ElementRecord): boolean =>
    update.files.get(source.repository)?.has(source.file) === true;
  const recordsIn = (store: ElementStore): ElementRecord[] =>
    [...update.ids].flatMap((id) => (store.byId.get(id) ?? []).filter(inChangedFile));
  const gone = recordsIn(update.from);
  const came = recordsIn(update.to);
  const dropped = new Set(gone);
  const order = new Map(update.repositories.map((contents, at) => [contents.repository, at]));
  const compare = (a: ElementRecord, b: ElementRecord): number =>
    Number(order.get(a.repository)) - Number(order.get(b.repository)) || byPath(a.file, b.file);
  const added = came.sort(compare).flatMap((source) => itemsOf(scope, source));
  const kept = index.items.some((item) => dropped.has(item.source))
    ? index.items.filter((item) => !dropped.has(item.source))
    : index.items;
  // Both lists are in store order of the sources; one source's items stay together.
  let items = kept;
  if (added.length > 0) {
    const merged: RuleItem[] = [];
    let next = 0;
    for (const item of kept) {
      for (
        let at = added[next];
        at !== undefined && compare(at.source, item.source) < 0;
        at = added[++next]
      ) {
        merged.push(at);
      }
      merged.push(item);
    }
    merged.push(...added.slice(next));
    items = merged;
  }
  return { ...index, store: update.to, items, rules: new Map() };
};

/**
 * The view rule indexes of a workspace, by the store each was built from (dropped with the store),
 * each with the metamodel it was built with. Carried over a change of the store like the incoming
 * relation index (`incomingState`): when a save or a watcher batch replaces a store that has an
 * index, the index of the new store is derived from it (`carryViewRuleIndex`) and added to the same
 * memo; any other change of the store drops the memo.
 */
export const viewRuleIndexState = defineWorkspaceState(
  "view-rule",
  (): WeakMap<ElementStore, ViewRuleIndex> => new WeakMap(),
  {
    dependsOn: [elementStoreState],
    carry: carryStoreUpdate((memo, update) => {
      const index = memo.get(update.from);
      if (index !== undefined) {
        memo.set(update.to, carryViewRuleIndex(index, update));
      }
      return memo;
    }),
  },
);

/**
 * The index of `store` with `metamodel` from a memo of `viewRuleIndexState`, built when it has none
 * for both. Synchronous and without loading any state, so a carry hook can call it.
 */
export const viewRuleIndexIn = (
  memo: WeakMap<ElementStore, ViewRuleIndex>,
  store: ElementStore,
  metamodel: Metamodel,
): ViewRuleIndex => {
  let index = memo.get(store);
  if (index?.metamodel !== metamodel) {
    index = buildViewRuleIndex(store, metamodel);
    memo.set(store, index);
  }
  return index;
};

/** The index of `store` with `metamodel` in `workspace` (`viewRuleIndexIn`). Synchronous. */
export const viewRuleIndexOf = (
  workspace: Workspace,
  store: ElementStore,
  metamodel: Metamodel,
): ViewRuleIndex => viewRuleIndexIn(workspace.get(viewRuleIndexState), store, metamodel);

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

/** The variants that may remove each element, by UUID, then repository (`removersOf`). */
type Removal = ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;

/** The removal map of each index, built once per index. */
const removersByIndex = new WeakMap<ViewRuleIndex, Removal>();

const NO_REMOVERS: readonly string[] = Object.freeze([]);

/** The removers of `element` in `removal`: by UUID and repository, without building a key (N-036). */
const removersIn = (removal: Removal, element: ElementRecord): readonly string[] =>
  removal.get(element.id)?.get(element.repository) ?? NO_REMOVERS;

const removalOf = (index: ViewRuleIndex): Removal => {
  let byElement = removersByIndex.get(index);
  if (byElement === undefined) {
    const validity = validityOf(index.metamodel);
    const found = new Map<string, Map<string, string[]>>();
    for (const item of index.items) {
      const target = actingTarget(index, item);
      if (target === undefined) {
        continue;
      }
      const variants =
        item.meaning === "exclusion"
          ? [item.source]
          : validityEntries(validity, item.source).flatMap((e) => validityTarget(e.value, item.source) ?? []);
      const repositories = found.get(target.id) ?? new Map<string, string[]>();
      const list = repositories.get(target.repository) ?? [];
      list.push(...variants.map((v) => `${v.repository}\0${v.id}`));
      repositories.set(target.repository, list);
      found.set(target.id, repositories);
    }
    byElement = found;
    removersByIndex.set(index, byElement);
  }
  return byElement;
};

/**
 * The variants whose rule removes `element`, each as `repository\0UUID`: the variant of an acting
 * exclusion item and every variant the validity of an acting replacement's source names. Exactly the
 * views that leave it out beyond its validity ("exclusion wins" changes only `replacedBy`).
 */
export const removersOf = (index: ViewRuleIndex, element: ElementRecord): readonly string[] =>
  removersIn(removalOf(index), element);

/**
 * Where a record of the store is in the views of the variants: `ALWAYS` in every one (no validity
 * entry, or a type without the validity property, and no variant removes it), else the variants its
 * validity names (`validFor`, undefined: every one) and those whose rule removes it, each as
 * `repository\0UUID`.
 */
type Membership =
  | typeof ALWAYS
  | { readonly validFor: ReadonlySet<string> | undefined; readonly removers: readonly string[] };

const ALWAYS = "always";

const CORE: View = { kind: "core" };

/** The membership lookup of each index (`membershipOf`). */
const membershipByIndex = new WeakMap<ViewRuleIndex, (e: ElementRecord) => Membership | undefined>();

/** The membership of `e` (see `Membership`) with the removal map `removal`. */
const membershipIn = (
  index: ViewRuleIndex,
  validity: ReturnType<typeof validityOf>,
  removal: Removal,
  e: ElementRecord,
): Membership => {
  const removers = removersIn(removal, e);
  // `appliesInView` in the core view: in every view by validity (no entry, or no validity property).
  const validFor = appliesInView(index, validity, e, CORE)
    ? undefined
    : new Set(
        validityEntries(validity, e)
          .flatMap((entry) => validityTarget(entry.value, e) ?? [])
          .map((t) => `${t.repository}\0${t.id}`),
      );
  return validFor === undefined && removers.length === 0 ? ALWAYS : { validFor, removers };
};

/**
 * Where each record of `index.store` is in the views of the variants (see `Membership`), found on
 * its first lookup and kept per index (undefined for a record that is not the store's), shared by the rules of all variants, so `includes` is one
 * lookup by record after the first (#463) and a new store (a carried index, #215) costs only the
 * records asked about, not a pass over the store.
 */
const membershipOf = (index: ViewRuleIndex): ((e: ElementRecord) => Membership | undefined) => {
  let lookup = membershipByIndex.get(index);
  if (lookup === undefined) {
    const validity = validityOf(index.metamodel);
    const removal = removalOf(index);
    const found = new Map<ElementRecord, Membership>();
    lookup = (e) => {
      let member = found.get(e);
      // Only records of the store are kept: one read again from its file is not (undefined).
      if (member === undefined && index.store.byId.get(e.id)?.includes(e) === true) {
        member = membershipIn(index, validity, removal, e);
        found.set(e, member);
      }
      return member;
    };
    membershipByIndex.set(index, lookup);
  }
  return lookup;
};

/** An element by repository and UUID (the key of the lists of a variant's rule). */
const keyOf = (element: ElementRecord): string => `${element.repository}\0${element.id}`;

/** What a variant's rule lists beyond `includes`: built only when asked (see the file comment). */
const variantDetails = (index: ViewRuleIndex, view: View & { readonly kind: "variant" }) => {
  const validity = validityOf(index.metamodel);
  const { variant } = view;
  const own = (item: RuleItem): boolean =>
    item.source.id === variant.id && item.source.repository === variant.repository;
  const excluded = new Set<string>();
  for (const item of index.items) {
    const target = item.meaning === "exclusion" && own(item) ? actingTarget(index, item) : undefined;
    if (target !== undefined) {
      excluded.add(keyOf(target));
    }
  }
  const replaced = new Map<string, ElementRecord[]>();
  const replacing = new Set<ElementRecord>();
  for (const item of index.items) {
    const valid = item.meaning === "replacement" && appliesIn(validity, item.source, view);
    const target = valid ? actingTarget(index, item) : undefined;
    if (target !== undefined && !excluded.has(keyOf(target))) {
      const list = replaced.get(keyOf(target)) ?? [];
      if (!list.includes(item.source)) {
        list.push(item.source);
      }
      replaced.set(keyOf(target), list);
      replacing.add(item.source);
    }
  }
  return { validity, excluded, replaced, replacing };
};

/**
 * The rule of the variant `variant` (see the file comment). `includes` reads only the removal map
 * of the index (`removalOf`, one pass over the items per index); the lists are built on first use.
 */
const variantRule = (index: ViewRuleIndex, view: View & { readonly kind: "variant" }): ViewRule => {
  const validity = validityOf(index.metamodel);
  const key = `${view.variant.repository}\0${view.variant.id}`;
  let removal: Removal | undefined;
  let details: ReturnType<typeof variantDetails> | undefined;
  const detailsOf = () => (details ??= variantDetails(index, view));
  const replacedBy = (e: ElementRecord): readonly ElementRecord[] => detailsOf().replaced.get(keyOf(e)) ?? [];
  let members: ((e: ElementRecord) => Membership | undefined) | undefined;
  return {
    view,
    includes: (e) => {
      const member = (members ??= membershipOf(index))(e);
      if (member === ALWAYS) {
        return true;
      }
      if (member !== undefined) {
        return (member.validFor === undefined || member.validFor.has(key)) && !member.removers.includes(key);
      }
      // A record that is not the store's (read again from its file): the same rule, by repository and UUID.
      return (
        appliesInView(index, validity, e, view) &&
        !removersIn((removal ??= removalOf(index)), e).includes(key)
      );
    },
    replacedBy,
    excludes: (e) => detailsOf().excluded.has(keyOf(e)),
    addedOf: () => {
      const { replacing } = detailsOf();
      return inStoreOrder(
        index,
        (e) =>
          index.validityTypes.has(e.type) &&
          validityEntries(validity, e).length > 0 &&
          appliesIn(validity, e, view) &&
          !replacing.has(e),
      );
    },
    replacedOf: () => {
      const { replaced } = detailsOf();
      return inStoreOrder(index, (e) => replaced.has(keyOf(e))).flatMap((core) =>
        replacedBy(core).map((replacement) => ({ core, replacement })),
      );
    },
    excludedOf: () => {
      const { excluded } = detailsOf();
      return inStoreOrder(index, (e) => excluded.has(keyOf(e)));
    },
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

/** What `viewsInclude` reads the rules from. */
interface ViewRuleContext {
  readonly workspace: Workspace;
  readonly store: ElementStore;
  readonly metamodel: Metamodel;
}

/** Whether every view of `views` holds `element`; undefined for no view (every element). */
export function viewsInclude(
  context: ViewRuleContext,
  views: readonly [View, ...View[]],
): (element: ElementRecord) => boolean;
export function viewsInclude(
  context: ViewRuleContext,
  views: readonly View[],
): ((element: ElementRecord) => boolean) | undefined;
export function viewsInclude(
  context: ViewRuleContext,
  views: readonly View[],
): ((element: ElementRecord) => boolean) | undefined {
  if (views.length === 0) {
    return undefined;
  }
  const rules = views.map((view) => viewRuleOf(context, view).includes);
  return (element) => rules.every((includes) => includes(element));
}

/**
 * Whether a result in `view` may miss a part (SR-006 AK2): `view` is a variant and the workspace file
 * lists a repository that is not on this machine, which may hold a replacement or an exclusion.
 */
export const viewIncomplete = (
  layout: { readonly repositories: readonly { readonly available: boolean }[] },
  view: View | undefined,
): boolean => view?.kind === "variant" && layout.repositories.some((r) => !r.available);

/**
 * The elements the rule items of `sources` name in `context.store` (`ruleTarget`): whose views a
 * change of these sources may change (the carry of `evidence/verification.ts`).
 */
export const ruleTargetsOf = (
  context: { readonly store: ElementStore; readonly metamodel: Metamodel },
  sources: readonly ElementRecord[],
): ElementRecord[] => {
  const scope = scopeOf(context.metamodel);
  return sources.flatMap((source) =>
    itemsOf(scope, source).flatMap((item) => ruleTarget(context, item) ?? []),
  );
};
