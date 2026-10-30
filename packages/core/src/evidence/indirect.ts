// The indirect verification (SR-034, ADR-0012 "Status rules"): „Das Tool muss für Parents ohne eigenen
// Datensatz den indirekten Nachweis aus ihren gültigen Children berechnen.“ It refines the verification
// status of SR-031 (`status.ts`) per requirement and view; like it, it is a derived view that never
// reads the element's `status` beyond the invalid flag and never changes it (D-030).
//
// 1. Own record decides: a requirement with at least one verification record that holds in the view
//    (any version, any result; `holdsIn`, SR-047) has its SR-031 status there and names no children
//    (spec question #526 Q1, Q4 assumptions). Validation records do not count (D-007).
// 2. Counted children: the derivation children (`ChildRules.childrenOf`: the trace block's
//    `childrenOf`, so a child named only by an ambiguous relation is none), each once, whose type has
//    the meaning `requirement` (#526 Q2), whose status the metamodel does not mark invalid (AK3,
//    D-044) and that the view holds (`ViewScope`: the view rule, `viewRuleOf`; SR-040, SR-041 AK5,
//    SR-043 AK7): a core requirement a variant excludes or replaces is no child there, and its own
//    children count where their validity puts them, never under the replacement.
// 3. No counted child: `open`, no `missingChildren` (#526 Q3).
// 4. Every counted child `verified` or `indirect` (each measured in the same view against its own
//    current version, recursively): `indirect` (AK1).
// 5. Otherwise `open` with `missingChildren`: the counted children that are `open`, `failed` or
//    `outdated`, direct children only, in child order, each UUID once (AK2; #526 Q4).
// 6. An element on a derivation cycle of elements without own record is not indirect: an element
//    that is being computed counts as `open` for its descendants (#526 Q5). That is the least fixed
//    point, so the result does not depend on which element is computed first. The walk is iterative
//    (explicit stack, memo per view), so a chain of any depth cannot overflow the call stack (N-036).
// 7. Without child rules (no relation kind with the meaning `derivation`, or the metamodel is not
//    valid) no element has children: nothing is indirect, and nothing fails.
// 8. An element marked emergent (SR-035 AK1, `StatusSource.emergent`) has no counted children: without
//    an own record in the view it is `open` there with no `missingChildren`, never `indirect`, and its
//    children are not walked (#591 Q2, Q3). As a child it is then open, so its parent names it (rule 5).
//
// Cost (#698): the views share their work. Besides the core and the variants the evaluator keeps one
// internal neutral view: the view of the core (no validity) and no record that holds. In a variant
// `v` the result of an element whose subtree (the element and its candidate children, recursively:
// requirements that count, whatever their validity; none below an emergent element) holds no seed
// of `v` is the neutral result: a seed of `v` is a requirement whose validity names `v` (repository
// and UUID, as `appliesIn`), an element with a verification record for `v` (its UUID, as `holdsIn`)
// or a core requirement the rule of `v` may remove (`removersOf`). Below such an element the view
// and `holdsIn` give in `v` what they give in the neutral view, and no rule reads anything else per view, so every variant reuses
// the one neutral walk and walks itself only through the elements above its seeds. The seeds below
// each element (`seedsBelow`) are found by one walk over its subtree, exact also on cycles (a
// fixpoint over the elements of the walk). At N-036 with 100 variants this replaces 101 walks below
// the top of the tree by about two and the few hundred elements above each variant's seeds.
import type { VerificationStatus } from "../generated/types.js";
import { invalidStatuses } from "../model/index.js";
import type { ElementRecord } from "../model/index.js";
import type { TraceContext } from "../trace/index.js";
import { childrenOf, derivationGraph } from "../trace/index.js";
import type { View } from "../variants/index.js";
import type { Validity, ViewRuleIndex } from "../variants/index.js";
import { appliesIn, removersOf, validityEntries, validityTarget, viewRuleIn } from "../variants/index.js";
import type { StatusSource } from "./status.js";
import { verificationStatusOf } from "./status.js";

/** Which elements are children of which, and which of them count (see the file comment, rule 2). */
export interface ChildRules {
  /** The derivation children of `element` in child order; may name one twice (two relations). */
  readonly childrenOf: (element: ElementRecord) => readonly ElementRecord[];
  /** Whether a child counts by its status: not marked invalid by the metamodel (AK3). */
  readonly counts: (element: ElementRecord) => boolean;
}

/**
 * The child rules of a trace context with a valid metamodel (the caller gives none otherwise, rule 7):
 * derivation children of the trace block, counted unless their status is marked invalid; undefined
 * when no relation kind has the meaning `derivation` (unlike `trace.*`, no
 * `metamodel.meaning-unassigned`).
 */
export const childRulesOf = (context: TraceContext): ChildRules | undefined => {
  const { metamodel } = context;
  if (metamodel.meanings.derivation.length === 0) {
    return undefined;
  }
  // The meaning is assigned, so `derivationGraph` does not throw (`requireMeaning`).
  const graph = derivationGraph(context, "evidence.status");
  const invalid = invalidStatuses(metamodel);
  return {
    childrenOf: (element) => childrenOf(graph, element).steps.map((step) => step.to),
    counts: (element) => !invalid.has(String(element.data["status"])),
  };
};

/** Which elements a view holds, and the variants that may remove an element (the seeds of the file comment). */
export interface ViewScope {
  /** Whether `view` holds an element; asked once per view. */
  readonly includesIn: (view: View) => (element: ElementRecord) => boolean;
  /** The variants whose view may leave the element out beyond its validity, as `repository\0UUID`. */
  readonly removersOf: (element: ElementRecord) => readonly string[];
}

/** The views by validity alone (`appliesIn`): no variant removes anything. */
export const validityScope = (validity: Validity | undefined): ViewScope => ({
  includesIn: (view) => (element) => appliesIn(validity, element, view),
  removersOf: () => NONE,
});

/** The views of the view rule of one store (`viewRuleIn`, `removersOf`). */
export const ruleScope = (index: ViewRuleIndex): ViewScope => ({
  includesIn: (view) => viewRuleIn(index, view).includes,
  removersOf: (element) => removersOf(index, element),
});

/** The verification of a requirement in one view (`data-export.schema.json#/$defs/element` `verification[]`). */
export interface VerificationResult {
  readonly status: VerificationStatus;
  /** The children that are missing (rule 5); left out when there is none. */
  readonly missingChildren?: readonly string[];
}

/** The version an element is shown with (element.get), in place of its current version. */
export interface Shown {
  readonly current: string | undefined;
}

/**
 * The verification of `element` in `view`; undefined when it has none there (no requirement, or it
 * does not apply in the view). `shown` measures the element's own records against the version shown
 * instead of its current version; it is never kept for other calls.
 */
export type VerificationEvaluator = (
  element: ElementRecord,
  view: View,
  shown?: Shown,
) => VerificationResult | undefined;

/** The views in which an element has an own verification record (rule 1): the core, and variants by UUID. */
interface OwnViews {
  readonly core: boolean;
  readonly variants: ReadonlySet<string>;
}

const NO_VARIANTS: ReadonlySet<string> = new Set();
const NO_OWN: OwnViews = { core: false, variants: NO_VARIANTS };

/**
 * The own views of each UUID of a source, built once per UUID and kept with the source: the records
 * of a source must not change while it is used (build a new source per records state).
 */
const ownViewsBySource = new WeakMap<StatusSource, Map<string, OwnViews>>();

const ownViewsOf = (source: StatusSource, id: string): OwnViews => {
  let known = ownViewsBySource.get(source);
  if (known === undefined) {
    known = new Map();
    ownViewsBySource.set(source, known);
  }
  let own = known.get(id);
  if (own === undefined) {
    let core = false;
    let variants: Set<string> | undefined;
    for (const record of source.recordsOf(id)) {
      if (record.kind !== "verification") {
        continue;
      }
      if (record.variant === undefined) {
        core = true;
      } else {
        (variants ??= new Set()).add(record.variant);
      }
    }
    own = core || variants !== undefined ? { core, variants: variants ?? NO_VARIANTS } : NO_OWN;
    known.set(id, own);
  }
  return own;
};

/** Whether `element` has a verification record that holds in `view` (rule 1; `holdsIn`, SR-047). */
export const hasOwnRecordIn = (source: StatusSource, element: ElementRecord, view: View): boolean => {
  const own = ownViewsOf(source, element.id);
  return view.kind === "core" ? own.core : own.variants.has(view.variant.id);
};

const OPEN: VerificationResult = Object.freeze({ status: "open" });
const INDIRECT: VerificationResult = Object.freeze({ status: "indirect" });
const NONE: readonly never[] = Object.freeze([]);
const NO_SEEDS: ReadonlySet<string> = new Set();
const CORE: View = Object.freeze({ kind: "core" });

/** One element of the walk: its counted children and how many of them were looked at. */
interface Frame {
  readonly key: string;
  readonly children: readonly ElementRecord[];
  next: number;
}

/** The key of an element's children: its repository and UUID (twins of one repository share them, SR-088). */
const nodeKeys = new WeakMap<Pick<ElementRecord, "id" | "repository">, string>();
export const nodeKey = (element: Pick<ElementRecord, "id" | "repository">): string => {
  let key = nodeKeys.get(element);
  if (key === undefined) {
    key = `${element.repository}\u0000${element.id}`;
    nodeKeys.set(element, key);
  }
  return key;
};

/** How one view decides (see the file comment): the core, a variant, or the internal neutral view. */
interface ViewRules {
  /** The view (the core for the neutral view, which no record holds in). */
  readonly view: View;
  /** The memo of the view. */
  readonly memo: Map<string, VerificationResult>;
  readonly applies: (element: ElementRecord) => boolean;
  readonly holds: (element: ElementRecord) => boolean;
  /** For a variant: whether the element's subtree holds no seed of it, so the neutral result is its result. */
  readonly clean: (element: ElementRecord) => boolean;
}

/** The seed of a variant named by a validity: repository and UUID. */
const validitySeed = (target: Pick<ElementRecord, "id" | "repository">): string => `v${nodeKey(target)}`;
/** The seed of a variant named by a record: its UUID (`holdsIn` compares the UUID only). */
const recordSeed = (variantId: string): string => `r${variantId}`;
/** The seed of a variant whose rule may remove the element: repository and UUID (`removersOf`). */
const ruleSeed = (key: string): string => `x${key}`;

/**
 * What an evaluator has found so far, by element (candidate children, seeds below) and by view and
 * repository and UUID (results): what `carriedEvaluator` takes over.
 */
interface EvaluatorCaches {
  readonly candidatesOf: Map<ElementRecord, readonly ElementRecord[]>;
  readonly seeds: Map<ElementRecord, ReadonlySet<string>>;
  readonly core: Map<string, VerificationResult>;
  readonly neutral: Map<string, VerificationResult>;
  /** The memo of each variant view, by the variant's repository and UUID. */
  readonly variants: Map<string, Map<string, VerificationResult>>;
}

const cachesOf = new WeakMap<VerificationEvaluator, EvaluatorCaches>();

/**
 * The evaluator of `source` with `children` (undefined: no element has children) and the current
 * version of each element (`currentOf`; only asked for requirements with records). Results computed
 * from children are kept per view and element for the life of the evaluator, so neither `currentOf`
 * nor the records of `source` may change while it lives: the own views of each UUID are kept with
 * `source` (`ownViewsOf`) and every result built on them in the memos. The evidence block builds a
 * new source and evaluator per records state (review of #714, S1), and one per store, or carries
 * this one over a store change with `carriedEvaluator`. `scope` gives the views (`ruleScope` of the
 * store's view rule; `validityScope` only where no rule applies).
 */
export const verificationEvaluator = (
  source: StatusSource,
  children: ChildRules | undefined,
  currentOf: (element: ElementRecord) => string | undefined,
  scope: ViewScope,
): VerificationEvaluator => evaluatorWith(source, children, currentOf, scope, undefined);

/** A copy of `map` without the entries whose key `drop` names. */
const without = <K, V>(map: ReadonlyMap<K, V>, drop: (key: K) => boolean): Map<K, V> => {
  const copy = new Map<K, V>();
  for (const [key, value] of map) {
    if (!drop(key)) {
      copy.set(key, value);
    }
  }
  return copy;
};

/**
 * The evaluator of a store after a change, carried over from `old`, the evaluator of the store
 * before it with the same `source` (ADR-0008, #698): it keeps what `old` found for every element
 * whose repository and UUID (`nodeKey`) `affected` does not name. `affected` must name every element
 * whose candidate children, seeds below or results may differ in the new store: the changed ones and
 * their ancestors before and after the change, and the core requirements a changed rule item names
 * (`carriedStatus` in `verification.ts`). `old` is not changed; a command that still holds it keeps a
 * consistent view. `scope` gives the views of the new store.
 */
export const carriedEvaluator = (
  old: VerificationEvaluator,
  source: StatusSource,
  children: ChildRules | undefined,
  currentOf: (element: ElementRecord) => string | undefined,
  affected: ReadonlySet<string>,
  scope: ViewScope,
): VerificationEvaluator => {
  const caches = cachesOf.get(old);
  if (caches === undefined) {
    return verificationEvaluator(source, children, currentOf, scope);
  }
  const dropKey = (key: string): boolean => affected.has(key);
  const dropElement = (element: ElementRecord): boolean => affected.has(nodeKey(element));
  return evaluatorWith(source, children, currentOf, scope, {
    candidatesOf: without(caches.candidatesOf, dropElement),
    seeds: without(caches.seeds, dropElement),
    core: without(caches.core, dropKey),
    neutral: without(caches.neutral, dropKey),
    variants: new Map([...caches.variants].map(([key, memo]) => [key, without(memo, dropKey)])),
  });
};

const evaluatorWith = (
  source: StatusSource,
  children: ChildRules | undefined,
  currentOf: (element: ElementRecord) => string | undefined,
  scope: ViewScope,
  carried: EvaluatorCaches | undefined,
): VerificationEvaluator => {
  const caches: EvaluatorCaches = carried ?? {
    candidatesOf: new Map(),
    seeds: new Map(),
    core: new Map(),
    neutral: new Map(),
    variants: new Map(),
  };
  /**
   * The children of an element that may count in some view: requirements whose status counts, each
   * once, in child order; none below an emergent element (rule 8). Built once per element.
   */
  const { candidatesOf } = caches;
  const candidates = (element: ElementRecord): readonly ElementRecord[] => {
    let known = candidatesOf.get(element);
    if (known === undefined) {
      if (children === undefined || source.emergent(element)) {
        known = NONE;
      } else {
        const seen = new Set<ElementRecord>();
        const list: ElementRecord[] = [];
        for (const child of children.childrenOf(element)) {
          if (!seen.has(child) && source.requirements.has(child.type) && children.counts(child)) {
            list.push(child);
          }
          seen.add(child);
        }
        known = list.length === 0 ? NONE : list;
      }
      candidatesOf.set(element, known);
    }
    return known;
  };

  /**
   * The seeds of the element itself: the variants its validity names, the variants of its records,
   * the variants whose rule may remove it.
   */
  const ownSeeds = (element: ElementRecord): ReadonlySet<string> => {
    let seeds: Set<string> | undefined;
    for (const entry of validityEntries(source.validity, element)) {
      const target = validityTarget(entry.value, element);
      if (target !== undefined) {
        (seeds ??= new Set()).add(validitySeed(target));
      }
    }
    for (const variant of ownViewsOf(source, element.id).variants) {
      (seeds ??= new Set()).add(recordSeed(variant));
    }
    for (const variant of scope.removersOf(element)) {
      (seeds ??= new Set()).add(ruleSeed(variant));
    }
    return seeds ?? NO_SEEDS;
  };

  /** The seeds of the element and of everything below it (see the file comment), once per element. */
  const { seeds } = caches;
  const unionOf = (element: ElementRecord, own: ReadonlySet<string>): ReadonlySet<string> => {
    let union = own;
    let copied = false;
    for (const child of candidates(element)) {
      const below = seeds.get(child) ?? NO_SEEDS;
      if (below.size === 0 || below === union) {
        continue;
      }
      if (union.size === 0) {
        union = below;
        continue;
      }
      if (!copied) {
        union = new Set(union);
        copied = true;
      }
      for (const seed of below) {
        (union as Set<string>).add(seed);
      }
    }
    return union;
  };
  const seedsBelow = (root: ElementRecord): ReadonlySet<string> => {
    const known = seeds.get(root);
    if (known !== undefined) {
      return known;
    }
    // The elements below `root` without seeds yet, children before their parents (`root` comes last).
    const order: ElementRecord[] = [];
    const done = new Set<ElementRecord>();
    const visiting = new Set<ElementRecord>([root]);
    const stack: { element: ElementRecord; next: number }[] = [{ element: root, next: 0 }];
    let cycle = false;
    for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
      const child = candidates(top.element)[top.next];
      if (child === undefined) {
        if (top.element !== root) {
          order.push(top.element);
        }
        done.add(top.element);
        stack.pop();
        continue;
      }
      top.next += 1;
      if (seeds.has(child)) {
        continue;
      }
      if (visiting.has(child)) {
        // On the stack: a cycle (a child already done has its seeds once this pass reaches it).
        cycle ||= !done.has(child);
        continue;
      }
      visiting.add(child);
      stack.push({ element: child, next: 0 });
    }
    // Children first, so each element finds the seeds of the children done before it.
    const entryOf = (element: ElementRecord) => {
      const own = ownSeeds(element);
      const union = unionOf(element, own);
      seeds.set(element, union);
      return { element, own, union };
    };
    const below = order.map(entryOf);
    const rootEntry = entryOf(root);
    const found = [...below, rootEntry];
    // On a cycle an element may have been done before a child on the cycle: repeat until nothing grows.
    for (let grown = cycle; grown;) {
      grown = false;
      for (const entry of found) {
        const union = unionOf(entry.element, entry.own);
        if (union.size !== entry.union.size) {
          entry.union = union;
          seeds.set(entry.element, union);
          grown = true;
        }
      }
    }
    return rootEntry.union;
  };

  const coreRules: ViewRules = {
    view: CORE,
    memo: caches.core,
    applies: scope.includesIn(CORE),
    holds: (element) => ownViewsOf(source, element.id).core,
    clean: () => false,
  };
  const neutral: ViewRules = {
    view: CORE,
    memo: caches.neutral,
    applies: coreRules.applies,
    holds: () => false,
    clean: () => false,
  };
  const variantRules = new Map<string, ViewRules>();
  const rulesOf = (view: View): ViewRules => {
    if (view.kind === "core") {
      return coreRules;
    }
    const { variant } = view;
    const key = nodeKey(variant);
    let rules = variantRules.get(key);
    if (rules === undefined) {
      const byValidity = validitySeed(variant);
      const byRecord = recordSeed(variant.id);
      const byRule = ruleSeed(key);
      let memo = caches.variants.get(key);
      if (memo === undefined) {
        memo = new Map();
        caches.variants.set(key, memo);
      }
      rules = {
        view,
        memo,
        applies: scope.includesIn(view),
        holds: (element) => ownViewsOf(source, element.id).variants.has(variant.id),
        clean: (element) => {
          const below = seedsBelow(element);
          return !below.has(byValidity) && !below.has(byRecord) && !below.has(byRule);
        },
      };
      variantRules.set(key, rules);
    }
    return rules;
  };

  /** The counted children of `element` in a view (rule 2). */
  const counted = (element: ElementRecord, rules: ViewRules): readonly ElementRecord[] => {
    const list = candidates(element);
    return list.every(rules.applies) ? list : list.filter(rules.applies);
  };

  /** The status of a counted child, once its walk is done; one being computed counts as open (rule 6). */
  const childStatus = (child: ElementRecord, rules: ViewRules) => {
    if (rules.holds(child)) {
      return verificationStatusOf(source.recordsOf(child.id), currentOf(child), rules.view);
    }
    if (rules.clean(child)) {
      return derived(child, neutral).status;
    }
    return rules.memo.get(nodeKey(child))?.status ?? "open";
  };

  const fromChildren = (frame: Frame, rules: ViewRules): VerificationResult => {
    if (frame.children.length === 0) {
      return OPEN;
    }
    const missing = new Set<string>();
    for (const child of frame.children) {
      const status = childStatus(child, rules);
      if (status !== "verified" && status !== "indirect") {
        missing.add(child.id);
      }
    }
    return missing.size === 0 ? INDIRECT : { status: "open", missingChildren: [...missing] };
  };

  /** The status of `root`, which has no own record in the view, from its children (rules 2 to 6). */
  const derived = (root: ElementRecord, rules: ViewRules): VerificationResult => {
    const { memo } = rules;
    const known = memo.get(nodeKey(root));
    if (known !== undefined) {
      return known;
    }
    const onStack = new Set<string>();
    const stack: Frame[] = [];
    const enter = (element: ElementRecord): void => {
      const key = nodeKey(element);
      onStack.add(key);
      stack.push({ key, children: counted(element, rules), next: 0 });
    };
    enter(root);
    let result = OPEN;
    for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
      const child = frame.children[frame.next];
      if (child !== undefined) {
        frame.next += 1;
        const key = nodeKey(child);
        if (!rules.holds(child) && !memo.has(key) && !onStack.has(key) && !rules.clean(child)) {
          enter(child);
        }
        continue;
      }
      result = fromChildren(frame, rules);
      memo.set(frame.key, result);
      onStack.delete(frame.key);
      stack.pop();
    }
    return result;
  };

  const evaluate: VerificationEvaluator = (element, view, shown) => {
    const rules = rulesOf(view);
    if (!source.requirements.has(element.type) || !rules.applies(element)) {
      return undefined;
    }
    if (rules.holds(element)) {
      const current = shown === undefined ? currentOf(element) : shown.current;
      return { status: verificationStatusOf(source.recordsOf(element.id), current, view) };
    }
    return derived(element, rules.clean(element) ? neutral : rules);
  };
  cachesOf.set(evaluate, caches);
  return evaluate;
};
