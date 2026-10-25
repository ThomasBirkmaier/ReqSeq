// Hints on relations to superseded elements (SR-072 AK2, D-044, D-045). An element is superseded
// when its status is one the metamodel marks `invalid` (D-044); which command or person set that
// status does not matter (`element.supersede`, `element.setStatus` or an edit by hand). Every
// relation of a relation kind of the metamodel whose target is such an element gets one hint
// `relation.target-superseded` (a `warning`: it blocks nothing and changes no status), also the
// successor's own relation with the meaning `replacement` (assumption, spec question #192). The
// hint names the successors: the sources of `replacement` relations to the same element.
// Relation-valued properties (validity, packages) and inline references are not counted here; a
// superseded variant in a validity is `variant.superseded-in-validity` (SR-040 AK3,
// variants/superseded-validity.ts).
// The successors of a superseded element in its view (SR-072 AK3) are `successors.ts`.
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

/** Only relations to these elements: their UUIDs (a cheap first test) and their places. */
interface TargetFilter {
  readonly ids: ReadonlySet<string>;
  readonly places: ReadonlySet<string>;
}

const filterOf = (targets: readonly ElementRecord[]): TargetFilter => ({
  ids: new Set(targets.map((t) => t.id)),
  places: new Set(targets.map(placeOf)),
});

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Every relation of a relation kind from one of `sources` whose target resolves to one element
 * (`resolveTarget`) with an invalid status, in the order of the sources, then of the keys in the
 * file, then of the items. With `filter`, only relations to these elements. A target that is
 * missing, lies in a missing repository or is ambiguous is another check (SR-089, SR-006, SR-088),
 * as is an item that is no relation target (SR-085).
 */
const hitsOf = (
  context: SupersededContext,
  sources: readonly ElementRecord[],
  filter: TargetFilter | undefined,
): Hit[] => {
  const { store, metamodel } = context;
  const invalid = invalidStatuses(metamodel);
  const hits: Hit[] = [];
  if (invalid.size === 0) {
    return hits;
  }
  const kinds = new Map(metamodel.relations.map((k) => [k.key, k]));
  for (const source of sources) {
    for (const [key, value] of Object.entries(source.data)) {
      const kind = kinds.get(key);
      if (kind === undefined || !Array.isArray(value)) {
        continue;
      }
      value.forEach((item: unknown, index) => {
        // The UUID first: the schema check and the lookup cost too much for each of 200,000
        // relations when a command asks about a few elements (ADR-0008: 200 ms). Switch to the
        // incoming relation index of ADR-0008 once it exists.
        if (filter !== undefined && !(isRecord(item) && filter.ids.has(String(item["id"])))) {
          return;
        }
        if (!isRelationTarget(item)) {
          return;
        }
        const match = resolveTarget(store, source.repository, item);
        if (match.kind !== "found" || (filter !== undefined && !filter.places.has(placeOf(match.element)))) {
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

/**
 * How a message names an element: the name of its type (its key when the metamodel does not know
 * it) and its short ID (SR-084).
 */
export const elementLabel = (
  context: Pick<SupersededContext, "metamodel" | "shortIds">,
  record: ElementRecord,
): string =>
  `${findType(context.metamodel, record.type)?.name ?? record.type} ${context.shortIds.of(record)}`;

/**
 * The successors of each superseded target, by its place: the sources of the `replacement` hits
 * among `hits`, each element (place) once, in the order of the hits.
 */
const successorsOf = (hits: readonly Hit[]): ReadonlyMap<string, readonly ElementRecord[]> => {
  const successors = new Map<string, ElementRecord[]>();
  for (const hit of hits) {
    if (hit.kind.meaning === "replacement") {
      const place = placeOf(hit.target);
      const known = successors.get(place) ?? [];
      if (!known.some((s) => placeOf(s) === placeOf(hit.source))) {
        known.push(hit.source);
      }
      successors.set(place, known);
    }
  }
  return successors;
};

/** The hint of each hit; it names the target's successors other than the hit's source. */
const findingsOf = (
  context: SupersededContext,
  hits: readonly Hit[],
  successors: ReadonlyMap<string, readonly ElementRecord[]>,
): LocatableFinding[] =>
  hits.map(({ source, kind, index, target, status }): LocatableFinding => {
    const others = (successors.get(placeOf(target)) ?? []).filter((s) => placeOf(s) !== placeOf(source));
    const successorText =
      others.length === 0
        ? ""
        : `; ${others.length === 1 ? "successor" : "successors"}: ${others.map((s) => elementLabel(context, s)).join(", ")}`;
    const problem: Problem = {
      code: "relation.target-superseded",
      severity: "warning",
      message: `Relation ${kind.name} (${kind.key}) from ${elementLabel(context, source)} points to ${elementLabel(context, target)}, which is superseded (status ${status.name})${successorText}`,
      repository: source.repository,
      file: source.file,
      elementId: source.id,
      targetId: target.id,
    };
    return { element: source, path: [kind.key, index], problem };
  });

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
  const hits = hitsOf(context, context.store.elements, targets === undefined ? undefined : filterOf(targets));
  return findingsOf(context, hits, successorsOf(hits));
};

/**
 * The hints on the relations of one element (SR-072 AK2), in the order of its keys and items, for
 * a command about one element (`elementView`: `element.create`, `element.update`, later
 * `element.get`), like `unknownFindings`. `source` need not be in the store as it is (a new or
 * just written element): the successors are the sources of `replacement` relations in the store
 * to the same targets, with `source` in place of the store's copy of it.
 */
export const supersededFindingsOf = (
  context: SupersededContext,
  source: ElementRecord,
): readonly LocatableFinding[] => {
  const own = hitsOf(context, [source], undefined);
  if (own.length === 0) {
    return [];
  }
  const stored = hitsOf(context, context.store.elements, filterOf(own.map((h) => h.target))).filter(
    (h) => placeOf(h.source) !== placeOf(source),
  );
  return findingsOf(context, own, successorsOf([...stored, ...own]));
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
    // Nothing against a metamodel that is not valid: its errors are the findings (#208, #220).
    if (!metamodel.valid) {
      return [];
    }
    const shortIds = await workspace.get(shortIdState);
    return locateFindings(layout, supersededTargetFindings({ store, metamodel, shortIds }));
  },
  { dependsOn: [elementStoreState, metamodelState, shortIdState] },
);
