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
//    D-044) and that apply in the view (`appliesIn`, SR-040).
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
// Not yet: an element flagged emergent (SR-035) can still be indirect; SR-035 adds that condition here.
import type { VerificationStatus } from "../generated/types.js";
import { invalidStatuses } from "../model/index.js";
import type { ElementRecord } from "../model/index.js";
import type { TraceContext } from "../trace/index.js";
import { childrenOf, derivationGraph } from "../trace/index.js";
import type { View } from "../variants/index.js";
import { appliesIn } from "../variants/index.js";
import type { StatusSource } from "./status.js";
import { holdsIn, verificationStatusOf } from "./status.js";

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

/** Whether `element` has a verification record that holds in `view` (rule 1). */
export const hasOwnRecordIn = (source: StatusSource, element: ElementRecord, view: View): boolean =>
  source.recordsOf(element.id).some((r) => r.kind === "verification" && holdsIn(r, view));

const OPEN: VerificationResult = Object.freeze({ status: "open" });
const INDIRECT: VerificationResult = Object.freeze({ status: "indirect" });
const NONE: readonly never[] = Object.freeze([]);

/** One element of the walk: its counted children and how many of them were looked at. */
interface Frame {
  readonly key: string;
  readonly children: readonly ElementRecord[];
  next: number;
}

/** The key of an element's children: its repository and UUID (twins of one repository share them, SR-088). */
const nodeKey = (element: ElementRecord): string => `${element.repository}\u0000${element.id}`;

/**
 * The evaluator of `source` with `children` (undefined: no element has children) and the current
 * version of each element (`currentOf`; only asked for requirements with records). Results computed
 * from children are kept per view and element for the life of the evaluator, so `currentOf` must not
 * change while it lives (the evidence block builds one per state of store, metamodel and records).
 */
export const verificationEvaluator = (
  source: StatusSource,
  children: ChildRules | undefined,
  currentOf: (element: ElementRecord) => string | undefined,
): VerificationEvaluator => {
  const memos = new Map<string, Map<string, VerificationResult>>();
  const memoOf = (view: View): Map<string, VerificationResult> => {
    const key = view.kind === "core" ? "" : `${view.variant.repository}\u0000${view.variant.id}`;
    let memo = memos.get(key);
    if (memo === undefined) {
      memo = new Map();
      memos.set(key, memo);
    }
    return memo;
  };

  const counted = (element: ElementRecord, view: View): readonly ElementRecord[] => {
    if (children === undefined) {
      return NONE;
    }
    const seen = new Set<ElementRecord>();
    return children.childrenOf(element).filter((child) => {
      const counts =
        !seen.has(child) &&
        source.requirements.has(child.type) &&
        children.counts(child) &&
        appliesIn(source.validity, child, view);
      seen.add(child);
      return counts;
    });
  };

  /** The status of a counted child, once its walk is done; one being computed counts as open (rule 6). */
  const childStatus = (child: ElementRecord, view: View, memo: ReadonlyMap<string, VerificationResult>) =>
    hasOwnRecordIn(source, child, view)
      ? verificationStatusOf(source.recordsOf(child.id), currentOf(child), view)
      : (memo.get(nodeKey(child))?.status ?? "open");

  const fromChildren = (
    frame: Frame,
    view: View,
    memo: ReadonlyMap<string, VerificationResult>,
  ): VerificationResult => {
    if (frame.children.length === 0) {
      return OPEN;
    }
    const missing = new Set<string>();
    for (const child of frame.children) {
      const status = childStatus(child, view, memo);
      if (status !== "verified" && status !== "indirect") {
        missing.add(child.id);
      }
    }
    return missing.size === 0 ? INDIRECT : { status: "open", missingChildren: [...missing] };
  };

  /** The status of `root`, which has no own record in `view`, from its children (rules 2 to 6). */
  const derived = (root: ElementRecord, view: View): VerificationResult => {
    const memo = memoOf(view);
    const known = memo.get(nodeKey(root));
    if (known !== undefined) {
      return known;
    }
    const onStack = new Set<string>();
    const stack: Frame[] = [];
    const enter = (element: ElementRecord): void => {
      const key = nodeKey(element);
      onStack.add(key);
      stack.push({ key, children: counted(element, view), next: 0 });
    };
    enter(root);
    let result = OPEN;
    for (let frame = stack.at(-1); frame !== undefined; frame = stack.at(-1)) {
      const child = frame.children[frame.next];
      if (child !== undefined) {
        frame.next += 1;
        const key = nodeKey(child);
        if (!hasOwnRecordIn(source, child, view) && !memo.has(key) && !onStack.has(key)) {
          enter(child);
        }
        continue;
      }
      result = fromChildren(frame, view, memo);
      memo.set(frame.key, result);
      onStack.delete(frame.key);
      stack.pop();
    }
    return result;
  };

  return (element, view, shown) => {
    if (!source.requirements.has(element.type) || !appliesIn(source.validity, element, view)) {
      return undefined;
    }
    if (hasOwnRecordIn(source, element, view)) {
      const current = shown === undefined ? currentOf(element) : shown.current;
      return { status: verificationStatusOf(source.recordsOf(element.id), current, view) };
    }
    return derived(element, view);
  };
};
