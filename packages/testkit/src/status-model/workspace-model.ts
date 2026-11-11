// Reference model of the workspace status rules (#1395): views (W…), records per view (R…) and indirect verification
// (I… in README.md). Written from the spec and README.md only; each function names its rule and source.
// Deliberately naive: plain loops over small inputs, a fixed point by repetition, no index.
import {
  type ModelElement,
  type ModelRecord,
  type ModelVerificationStatus,
  verificationOf,
} from "./model.js";

/** A relation item: the target's UUID, and the repository it names (absent: the source's own, W1). */
export interface ModelRef {
  readonly id: string;
  readonly repository?: string;
}

export interface ModelRepository {
  readonly name: string;
  /** Marked variant-independent in the workspace file (SR-173). */
  readonly variantIndependent: boolean;
}

/** A variant element: its status may be marked invalid; its exclusions are relations of its own (ADR-0004). */
export interface ModelVariant {
  readonly id: string;
  readonly repository: string;
  readonly invalid: boolean;
  readonly excludes: readonly ModelRef[];
}

/** An element of a type with the meaning requirement, or of another type without validity (a need). */
export interface ModelWorkspaceElement {
  /** Unique handle of this file; twins share `id`, never `key`. */
  readonly key: string;
  readonly id: string;
  readonly repository: string;
  readonly type: "requirement" | "need";
  /** Its status is one the metamodel marks invalid (D-044). */
  readonly invalid: boolean;
  /** Marked as emergent behaviour (SR-035). */
  readonly emergent: boolean;
  /** Variant ids; empty: a core requirement (SR-040). Always empty for a need. */
  readonly validity: readonly string[];
  /** Items of relation kinds with the meaning derivation: this element is the child (ADR-0004). */
  readonly derivesFrom: readonly ModelRef[];
  /** Items of the relation kind with the meaning replacement (D-020). */
  readonly replaces: readonly ModelRef[];
  /** Criteria, older versions and the element's own records (records carry `variant`). */
  readonly own: ModelElement;
}

export interface ModelWorkspace {
  readonly repositories: readonly ModelRepository[];
  readonly variants: readonly ModelVariant[];
  readonly elements: readonly ModelWorkspaceElement[];
}

/** `core`, or a variant id. */
export type ModelViewId = string;
export const CORE_VIEW = "core";

export type ModelEntryStatus = ModelVerificationStatus | "indirect";

/** The verification entry of one requirement in one view. */
export interface ModelEntry {
  readonly view: ModelViewId;
  readonly status: ModelEntryStatus;
  /** I4: the counted children that are missing, as a sorted set of keys; absent when none is named. */
  readonly missingChildren?: readonly string[];
  /** V16, only for a status from own records of a requirement with criteria. */
  readonly verified?: number;
  readonly total?: number;
}

// W1 (ADR-0004, trace block): a relation item resolves in the repository it names, else the source's own; it names an
// element only when exactly one file there carries the UUID (twins: ambiguous, SR-088).
export function resolveRef(
  workspace: ModelWorkspace,
  ref: ModelRef,
  sourceRepository: string,
): ModelWorkspaceElement | undefined {
  const repository = ref.repository ?? sourceRepository;
  const found = workspace.elements.filter(
    (element) => element.id === ref.id && element.repository === repository,
  );
  return found.length === 1 ? found[0] : undefined;
}

// W2 (SR-043 AK9, SR-040 AK1): a core requirement is a requirement without validity.
export function isCoreRequirement(element: ModelWorkspaceElement): boolean {
  return element.type === "requirement" && element.validity.length === 0;
}

// W5 (SR-042 AK1, AK7): a core requirement is excluded for a variant whose exclusion names it; one naming a
// requirement with validity or a need changes no view.
export function isExcluded(
  workspace: ModelWorkspace,
  element: ModelWorkspaceElement,
  variant: ModelVariant,
): boolean {
  return (
    isCoreRequirement(element) &&
    variant.excludes.some((ref) => resolveRef(workspace, ref, variant.repository) === element)
  );
}

// W6 (SR-041 AK1, AK4, AK6, AK8, AK9): a core requirement is replaced in a variant by a requirement whose validity
// names that variant and that has the relation replaces on it, whatever that requirement's status. A replacing
// requirement without validity, or a target with validity or without validity property, changes no view.
export function isReplaced(
  workspace: ModelWorkspace,
  element: ModelWorkspaceElement,
  variant: string,
): boolean {
  return (
    isCoreRequirement(element) &&
    workspace.elements.some(
      (other) =>
        other.type === "requirement" &&
        other.validity.includes(variant) &&
        other.replaces.some((ref) => resolveRef(workspace, ref, other.repository) === element),
    )
  );
}

// W2, W3, W4, W5, W6, W7 (SR-040 AK1, AK2, SR-041 AK3, SR-042 AK5, SR-043 AK1, AK9, AK10): whether the element is in
// the view. Exclusion and replacement both take a core requirement out of the variant's view, so "exclusion before
// replacement" (SR-042 AK5) changes no view, only `variant.diff`.
export function appliesIn(
  workspace: ModelWorkspace,
  element: ModelWorkspaceElement,
  view: ModelViewId,
): boolean {
  if (element.type !== "requirement") {
    return true;
  }
  if (view === CORE_VIEW) {
    return element.validity.length === 0;
  }
  if (element.validity.length > 0) {
    return element.validity.includes(view);
  }
  const variant = workspace.variants.find((candidate) => candidate.id === view);
  return (
    variant !== undefined && !isExcluded(workspace, element, variant) && !isReplaced(workspace, element, view)
  );
}

// W8 (SR-047 AK3, AK6): the views a requirement has an entry in: the core when it applies there, then each variant
// it applies in whose status is not invalid. Elements of other types have none (ADR-0012 "Which elements").
export function entryViews(workspace: ModelWorkspace, element: ModelWorkspaceElement): ModelViewId[] {
  if (element.type !== "requirement") {
    return [];
  }
  const views = [
    CORE_VIEW,
    ...workspace.variants.filter((variant) => !variant.invalid).map((variant) => variant.id),
  ];
  return views.filter((view) => appliesIn(workspace, element, view));
}

// R1, R2, R3 (SR-047 AK1, AK2, SR-173 AK1, AK2): the verification records that count for the element in the view. The
// core: records without variant. A variant: records for it, pooled with those without variant when the element's
// repository is variant-independent.
export function recordsInView(
  workspace: ModelWorkspace,
  element: ModelWorkspaceElement,
  view: ModelViewId,
): ModelRecord[] {
  const independent =
    workspace.repositories.find((repository) => repository.name === element.repository)
      ?.variantIndependent === true;
  return element.own.records.filter((record) => {
    if (record.kind !== "verification") {
      return false;
    }
    if (view === CORE_VIEW) {
      return record.variant === undefined;
    }
    return record.variant === view || (record.variant === undefined && independent);
  });
}

// I2 (SR-034 AK1, AK3, SR-041 AK5, SR-043 AK7, D-044): the counted children of a parent in the view, each once: the
// elements whose derivation item resolves to it (W1), whose type is requirement, whose status is not invalid and that
// are in the view.
export function countedChildren(
  workspace: ModelWorkspace,
  parent: ModelWorkspaceElement,
  view: ModelViewId,
): ModelWorkspaceElement[] {
  return workspace.elements.filter(
    (child) =>
      child.type === "requirement" &&
      !child.invalid &&
      appliesIn(workspace, child, view) &&
      child.derivesFrom.some((ref) => resolveRef(workspace, ref, child.repository) === parent),
  );
}

// I1, I3, I4, I5, I6 (SR-031, SR-034 AK1, AK2, SR-035 AK1, ADR-0012): the entries of every requirement in one view.
export function entriesInView(workspace: ModelWorkspace, view: ModelViewId): Map<string, ModelEntry> {
  const inView = workspace.elements.filter(
    (element) => element.type === "requirement" && appliesIn(workspace, element, view),
  );
  // I1: a requirement with an own verification record in the view takes its status from its records (any version).
  const own = new Map(
    inView.flatMap((element) => {
      const records = recordsInView(workspace, element, view);
      return records.length === 0
        ? []
        : [[element.key, verificationOf({ ...element.own, records })] as const];
    }),
  );
  // I3, I6: the least fixed point: indirect once every counted child is verified or indirect, so an element on a
  // derivation cycle of elements without own record never becomes indirect through itself.
  const indirect = new Set<string>();
  const verifiedOrIndirect = (child: ModelWorkspaceElement): boolean =>
    own.get(child.key)?.status === "verified" || indirect.has(child.key);
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of inView) {
      if (own.has(element.key) || element.emergent || indirect.has(element.key)) {
        continue;
      }
      const children = countedChildren(workspace, element, view);
      if (children.length > 0 && children.every(verifiedOrIndirect)) {
        indirect.add(element.key);
        changed = true;
      }
    }
  }
  const entries = new Map<string, ModelEntry>();
  for (const element of inView) {
    entries.set(element.key, entryOf(workspace, element, view, own, indirect, verifiedOrIndirect));
  }
  return entries;
}

function entryOf(
  workspace: ModelWorkspace,
  element: ModelWorkspaceElement,
  view: ModelViewId,
  own: ReadonlyMap<string, ReturnType<typeof verificationOf>>,
  indirect: ReadonlySet<string>,
  verifiedOrIndirect: (child: ModelWorkspaceElement) => boolean,
): ModelEntry {
  const fromRecords = own.get(element.key);
  if (fromRecords !== undefined) {
    const total = element.own.criteria.length;
    return total === 0
      ? { view, status: fromRecords.status }
      : { view, status: fromRecords.status, verified: fromRecords.verified, total };
  }
  // I5 (SR-035 AK1; ADR-0012 "Emergent" (3)): emergent without own record is open, its children are not walked.
  if (element.emergent) {
    return { view, status: "open" };
  }
  if (indirect.has(element.key)) {
    return { view, status: "indirect" };
  }
  // I4 (SR-034 AK2; ADR-0012, #526 Q3, Q4): otherwise open, naming the counted children that are not verified or
  // indirect; none named without a counted child.
  const missing = countedChildren(workspace, element, view)
    .filter((child) => !verifiedOrIndirect(child))
    .map((child) => child.key);
  const missingChildren = [...new Set(missing)].sort();
  return missingChildren.length === 0 ? { view, status: "open" } : { view, status: "open", missingChildren };
}

// W8 with all rules: every requirement's entries, by element key, in the order of `entryViews`. A variant with an
// invalid status gives no entry, so its view is not computed.
export function workspaceStatusOf(workspace: ModelWorkspace): Map<string, ModelEntry[]> {
  const views = [
    CORE_VIEW,
    ...workspace.variants.filter((variant) => !variant.invalid).map((variant) => variant.id),
  ];
  const perView = views.map((view) => entriesInView(workspace, view));
  return new Map(
    workspace.elements
      .filter((element) => element.type === "requirement")
      .map((element) => [
        element.key,
        perView.flatMap((entries) => {
          const entry = entries.get(element.key);
          return entry === undefined ? [] : [entry];
        }),
      ]),
  );
}
