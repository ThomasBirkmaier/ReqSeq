// Relation targets (ADR-0004, D-058): what a relation in a source file points at. A target names
// its element by UUID and, across repositories, the workspace name of the repository it lies in.
// Every check that follows a relation (SR-086, SR-089, SR-006) looks the target up here, and
// `targetState` tells a target in a repository that is not on this machine from a missing one.
import type { RelationTarget } from "../generated/types.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { ElementMatch, ElementRecord } from "./elements.js";
import type { ElementStore } from "./store.js";

/** Whether a value has the format of a relation target (`common.schema.json#/$defs/relationTarget`). */
export const isRelationTarget = (value: unknown): value is RelationTarget =>
  fileSchemaValidator("common.schema.json#/$defs/relationTarget")(value);

/**
 * The element a relation target names: the records of its UUID that lie in the repository it
 * names, or in the source's own repository when it names none (D-058). `unknown` when there is no
 * such record there (the target is missing, SR-089, or its repository is missing, SR-006);
 * `ambiguous` when several files there share the UUID (SR-088), in store order. Unlike `resolveId`,
 * which asks whether a UUID names one element in the whole workspace, a record of the UUID in
 * another repository does not count.
 */
export const resolveTarget = (
  store: ElementStore,
  sourceRepository: string,
  target: Pick<RelationTarget, "id"> & Partial<RelationTarget>,
): ElementMatch => {
  const repository = target.repository ?? sourceRepository;
  const elements = (store.byId.get(target.id) ?? []).filter((r) => r.repository === repository);
  const [first] = elements;
  if (first === undefined) {
    return { kind: "unknown" };
  }
  return elements.length === 1 ? { kind: "found", element: first } : { kind: "ambiguous", elements };
};

/** Whether `repository` is listed in the workspace file but not on this machine (N-041, SR-006). */
export const isUnavailableRepository = (
  layout: Pick<WorkspaceLayout, "repositories">,
  repository: unknown,
): boolean => layout.repositories.some((r) => r.name === repository && !r.available);

/**
 * Where a relation target is (D-058, `data-export.schema.json#/$defs/relation` `targetState`).
 * Every state but `available` names the repository looked in; for `unknown-repository` it is the
 * value as written, which need not be text.
 */
export type TargetState =
  | { readonly kind: "available"; readonly element: ElementRecord }
  | { readonly kind: "inaccessible" | "missing"; readonly repository: string }
  | { readonly kind: "unknown-repository"; readonly repository: unknown }
  | { readonly kind: "ambiguous"; readonly repository: string; readonly elements: readonly ElementRecord[] };

/**
 * Where a relation target is, looked up in the repository it names or in the source's own when it
 * names none (D-058): `available` with its one element; `inaccessible` when that repository is in
 * the workspace file but not on this machine (N-041, SR-006); `missing` when the repository is
 * here and has no element with the UUID (N-065, SR-089); `ambiguous` when several files there
 * share the UUID (SR-088), in store order; `unknown-repository` when the workspace file lists no
 * repository of that name, or `repository` is not text. The element view and the missing-target
 * check (SR-089, `missing-targets.ts`) use it; the relation-type check (SR-086), which uses
 * `resolveTarget` today, is to share it too, so all accesses agree (SR-080).
 */
export const targetState = (
  layout: Pick<WorkspaceLayout, "repositories">,
  store: ElementStore,
  sourceRepository: string,
  target: { readonly id: string; readonly repository?: unknown },
): TargetState => {
  // Only a target without `repository` lies in the source's own; `repository: null` names none.
  const repository = target.repository === undefined ? sourceRepository : target.repository;
  if (typeof repository !== "string" || !layout.repositories.some((r) => r.name === repository)) {
    return { kind: "unknown-repository", repository };
  }
  if (isUnavailableRepository(layout, repository)) {
    return { kind: "inaccessible", repository };
  }
  const match = resolveTarget(store, sourceRepository, { id: target.id, repository });
  switch (match.kind) {
    case "found":
      return { kind: "available", element: match.element };
    case "unknown":
      return { kind: "missing", repository };
    case "ambiguous":
      return { kind: "ambiguous", repository, elements: match.elements };
  }
};

/**
 * The workspace name of the repository a target state looked in (#416, `data-export.schema.json#/$defs/relation`
 * `repository`): the found element's for `available`, else the one the state names; undefined only for an
 * `unknown-repository` whose stored `repository` is not text.
 */
export const targetRepository = (state: TargetState): string | undefined =>
  state.kind === "available"
    ? state.element.repository
    : typeof state.repository === "string"
      ? state.repository
      : undefined;

/** The targets a computation reached, and whether some it had to follow could not be read. */
export interface FollowedTargets {
  /** The elements of the `available` targets, in the order of the targets. */
  readonly elements: readonly ElementRecord[];
  /**
   * Some target could not be read (SR-006 AK2): it lies in a repository that is not on this
   * machine, or in one the workspace file does not list (spec question #193). What is computed from
   * `elements` (chain, coverage, degree of evidence) misses that part and is incomplete. A missing
   * or ambiguous target is a finding of its own (SR-089, SR-088) and does not count here.
   */
  readonly incomplete: boolean;
}

/**
 * Follows the relation targets of a source in `sourceRepository` (`targetState`): the step a
 * chain, coverage and degree of evidence take for each element they visit (SR-006 AK2).
 */
export const followTargets = (
  layout: Pick<WorkspaceLayout, "repositories">,
  store: ElementStore,
  sourceRepository: string,
  targets: readonly { readonly id: string; readonly repository?: unknown }[],
): FollowedTargets => {
  const states = targets.map((t) => targetState(layout, store, sourceRepository, t));
  return {
    elements: states.flatMap((s) => (s.kind === "available" ? [s.element] : [])),
    incomplete: states.some((s) => s.kind === "inaccessible" || s.kind === "unknown-repository"),
  };
};
