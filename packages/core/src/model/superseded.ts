// Hints on relations to superseded elements (SR-072 AK2, D-044, D-045). An element is superseded
// when its status is one the metamodel marks `invalid` (D-044); which command or person set that
// status does not matter (`element.supersede`, `element.setStatus` or an edit by hand). Every
// relation of a relation kind of the metamodel whose target is such an element gets one hint
// `relation.target-superseded` (a `warning`: it blocks nothing and changes no status), also the
// successor's own relation with the meaning `replacement` (assumption, spec question #192). The
// hint names the successors: the sources of `replacement` relations to the same element.
// Relation-valued properties (validity, packages) and inline references are not counted here; a
// superseded variant in a validity is `variant.superseded-in-validity` (SR-045).
import type { Problem } from "../catalog.js";
import type { MetamodelRelationKind, MetamodelStatus } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, metamodelState } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import { locateFindings } from "./locate.js";
import { isRelationTarget, resolveTarget } from "./relations.js";
import type { ShortIds } from "./short-id.js";
import { shortIdState } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";

/** What the hints need: targets are looked up in the store, messages show short IDs (SR-084). */
export interface SupersededContext {
  readonly store: ElementStore;
  readonly metamodel: Metamodel;
  readonly shortIds: ShortIds;
}

/** The statuses the metamodel marks invalid (D-044), by key, in metamodel order. */
export const invalidStatuses = (metamodel: Metamodel): ReadonlyMap<string, MetamodelStatus> =>
  new Map(metamodel.statuses.filter((s) => s.invalid === true).map((s) => [s.key, s]));

/** One relation to a superseded element: item `index` of the list under `kind.key` in `source`. */
interface Hit {
  readonly source: ElementRecord;
  readonly kind: MetamodelRelationKind;
  readonly index: number;
  readonly target: ElementRecord;
  readonly status: MetamodelStatus;
}

/** An element's place in the store; the same element is the same file of the same repository. */
const placeOf = (record: ElementRecord): string => `${record.repository}\0${record.file}`;

/**
 * Every relation of a relation kind whose target resolves to one element (`resolveTarget`) with an
 * invalid status, in store order of the sources, then in the order of the keys in the file, then of
 * the items. With `targets`, only relations to these elements. A target that is missing,
 * lies in a missing repository or is ambiguous is another check (SR-089, SR-006, SR-088), as is an
 * item that is no relation target (SR-085).
 */
const hitsOf = (context: SupersededContext, targets: ReadonlySet<string> | undefined): Hit[] => {
  const { store, metamodel } = context;
  const invalid = invalidStatuses(metamodel);
  const hits: Hit[] = [];
  if (invalid.size === 0) {
    return hits;
  }
  const kinds = new Map(metamodel.relations.map((k) => [k.key, k]));
  for (const source of store.elements) {
    for (const [key, value] of Object.entries(source.data)) {
      const kind = kinds.get(key);
      if (kind === undefined || !Array.isArray(value)) {
        continue;
      }
      value.forEach((item: unknown, index) => {
        if (!isRelationTarget(item)) {
          return;
        }
        const match = resolveTarget(store, source.repository, item);
        if (match.kind !== "found" || (targets !== undefined && !targets.has(placeOf(match.element)))) {
          return;
        }
        const status = invalid.get(String(match.element.data["status"]));
        if (status !== undefined) {
          hits.push({ source, kind, index, target: match.element, status });
        }
      });
    }
  }
  return hits;
};

/** How a message names an element: type name and short ID. */
const nameOf = (context: SupersededContext, record: ElementRecord): string =>
  `${findType(context.metamodel, record.type)?.name ?? record.type} ${context.shortIds.of(record)}`;

/**
 * The hints `relation.target-superseded` (SR-072 AK2), one per relation to a superseded element,
 * before their lines are known (`locateFindings` adds them): source repository, file and element,
 * the target's ID, and a message with the relation kind, both elements, the target's status and
 * its successors. With `targets`, only relations to these elements (for a command that has just
 * set their status).
 */
export const supersededTargetFindings = (
  context: SupersededContext,
  targets?: readonly ElementRecord[],
): readonly LocatableFinding[] => {
  const hits = hitsOf(context, targets === undefined ? undefined : new Set(targets.map(placeOf)));
  const successors = new Map<string, ElementRecord[]>();
  for (const hit of hits) {
    if (hit.kind.meaning === "replacement") {
      const place = placeOf(hit.target);
      const known = successors.get(place) ?? [];
      if (!known.includes(hit.source)) {
        known.push(hit.source);
      }
      successors.set(place, known);
    }
  }
  return hits.map(({ source, kind, index, target, status }): LocatableFinding => {
    const others = (successors.get(placeOf(target)) ?? []).filter((s) => s !== source);
    const successorText =
      others.length === 0 ? "" : `; successor: ${others.map((s) => nameOf(context, s)).join(", ")}`;
    const problem: Problem = {
      code: "relation.target-superseded",
      severity: "warning",
      message: `Relation ${kind.name} (${kind.key}) from ${nameOf(context, source)} points to ${nameOf(context, target)}, which is superseded (status ${status.name})${successorText}`,
      repository: source.repository,
      file: source.file,
      elementId: source.id,
      targetId: target.id,
    };
    return { element: source, path: [kind.key, index], problem };
  });
};

/**
 * The hints with their lines for the relations to `targets` as the element store holds them now:
 * what `element.supersede` and `element.setStatus` return after a write. Empty when none of them
 * has an invalid status.
 */
export const supersededTargetProblems = async (
  workspace: Workspace,
  targets: readonly ElementRecord[],
): Promise<readonly Problem[]> => {
  const layout = await workspace.get(workspaceLayoutState);
  const store = await workspace.get(elementStoreState);
  const metamodel = await workspace.get(metamodelState);
  const shortIds = await workspace.get(shortIdState);
  return locateFindings(layout, supersededTargetFindings({ store, metamodel, shortIds }, targets));
};

/**
 * Every relation of the workspace to a superseded element, as a hint with repository, file, line,
 * element and target ID (SR-072 AK2), for `workspace.check` (SR-019). One pass over the store, then
 * the files with hints are read again for the lines (`locateFindings`). Kept until the element
 * store or the metamodel is reset.
 */
export const supersededTargetProblemsState = defineWorkspaceState(
  "superseded-targets",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const shortIds = await workspace.get(shortIdState);
    return locateFindings(layout, supersededTargetFindings({ store, metamodel, shortIds }));
  },
  { dependsOn: [elementStoreState, metamodelState, shortIdState] },
);
