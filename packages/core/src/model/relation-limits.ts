// The number of relations per source element (SR-152, D-012): a limit of a relation kind in the
// metamodel (`limitsOf`) sets how many relations of the kind to elements of a target type one
// element may (`max`) or must (`min`) have. A count outside is a hint (`warning`: it blocks nothing
// and changes no status) with element, kind, target type, count and limit; the file is kept
// unchanged. Assumptions of spec question #808: a relation counts when its target resolves to one
// element of a known type that is or extends the target type, and a duplicate item counts twice;
// a missing, ambiguous or unknown-type target does not count. While a target lies in a repository
// that is not on this machine (SR-006 AK2) or the workspace file does not list, no `too-few` is
// given. An element of an unknown type (SR-016) or with a status the metamodel marks invalid gets
// none, as #667. The target's status does not matter.
import type { Problem } from "../catalog.js";
import type { EffectiveType, Metamodel, RelationLimit } from "../metamodel/index.js";
import { allowsType, findType, limitsOf, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { carryProblems } from "./carry.js";
import type { ElementRecord } from "./elements.js";
import { incomingState } from "./incoming.js";
import type { LocatableFinding } from "./locate.js";
import { locateFindings } from "./locate.js";
import { hasId } from "./relation-keys.js";
import { relationSourcesAgain, samePlaces } from "./relation-types.js";
import { targetState } from "./relations.js";
import type { ShortIds } from "./short-id.js";
import { shortIdState } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { carryStoreUpdate, elementStoreState } from "./store.js";

/** What the check needs: where targets are (layout and store), messages show short IDs (SR-084). */
export interface RelationLimitContext {
  readonly layout: Pick<WorkspaceLayout, "repositories">;
  readonly store: ElementStore;
  readonly metamodel: Metamodel;
  readonly shortIds: ShortIds;
}

/** What the count of one limit reads: where targets are and the types of the metamodel. */
export type LimitCountContext = Pick<RelationLimitContext, "layout" | "store" | "metamodel">;

/** Per metamodel object and target type: the keys of the known types that are or extend it. */
const withinIndexes = new WeakMap<Metamodel, Map<string, ReadonlySet<string>>>();

/** The keys of the known types of `metamodel` that are `targetType` or extend it, built once per pair. */
const typesWithin = (metamodel: Metamodel, targetType: string): ReadonlySet<string> => {
  let byTarget = withinIndexes.get(metamodel);
  if (byTarget === undefined) {
    byTarget = new Map();
    withinIndexes.set(metamodel, byTarget);
  }
  let within = byTarget.get(targetType);
  if (within === undefined) {
    within = new Set(
      metamodel.effectiveTypes
        .filter((t) => findType(metamodel, t.key) !== undefined && allowsType([targetType], t.key, metamodel))
        .map((t) => t.key),
    );
    byTarget.set(targetType, within);
  }
  return within;
};

/**
 * The relations of `element` under `limit.key` that count for `limit` (see the file comment), and
 * whether some target could not be reached. The one count of SR-152, which the gaps of the
 * traceability matrix read too (SR-153). `includes`, in a view (SR-040): an available target that
 * does not apply in it does not count.
 */
export const limitCount = (
  element: ElementRecord,
  limit: RelationLimit,
  context: LimitCountContext,
  includes?: (target: ElementRecord) => boolean,
): { readonly count: number; readonly unreachable: boolean } => {
  const value = element.data[limit.key];
  let count = 0;
  let unreachable = false;
  if (!Array.isArray(value)) {
    return { count, unreachable };
  }
  const within = typesWithin(context.metamodel, limit.targetType);
  for (const item of value as readonly unknown[]) {
    if (!hasId(item)) {
      continue;
    }
    const state = targetState(context.layout, context.store, element.repository, item);
    if (state.kind === "inaccessible" || state.kind === "unknown-repository") {
      unreachable = true;
    } else if (
      state.kind === "available" &&
      within.has(state.element.type) &&
      (includes === undefined || includes(state.element))
    ) {
      count += 1;
    }
  }
  return { count, unreachable };
};

/**
 * The type whose limits `element` is held to: undefined for an unknown type (SR-016) and for a status
 * the metamodel marks invalid, which get no count hint (#667) and no gap (SR-153).
 */
export const limitedType = (element: ElementRecord, metamodel: Metamodel): EffectiveType | undefined => {
  const type = findType(metamodel, element.type);
  return type === undefined ||
    metamodel.statuses.some((s) => s.key === element.data["status"] && s.invalid === true)
    ? undefined
    : type;
};

const plural = (count: number): string => `${String(count)} relation${count === 1 ? "" : "s"}`;

/** The hint of one limit, or undefined when the count is within it. */
const limitFinding = (
  element: ElementRecord,
  typeName: string,
  limit: RelationLimit,
  context: RelationLimitContext,
): LocatableFinding | undefined => {
  const { count, unreachable } = limitCount(element, limit, context);
  const over = limit.max !== undefined && count > limit.max ? limit.max : undefined;
  const under = limit.min !== undefined && count < limit.min && !unreachable ? limit.min : undefined;
  const bound = over ?? under;
  if (bound === undefined) {
    return undefined;
  }
  const message = `${typeName} ${context.shortIds.of(element)} has ${plural(count)} ${limit.label} to ${limit.targetName} (${limit.targetType}); ${over === undefined ? "at least" : "at most"} ${String(bound)}`;
  return {
    element,
    path: [limit.key],
    at: Object.hasOwn(element.data, limit.key) ? "key" : "line",
    problem: {
      code: over === undefined ? "relation.too-few" : "relation.too-many",
      severity: "warning",
      message,
      repository: element.repository,
      file: element.file,
      elementId: element.id,
      key: limit.key,
      targetType: limit.targetType,
      count,
      limit: bound,
    },
  };
};

/**
 * The count hints of one element, in the order of its limits (metamodel order). A
 * `relation.too-many` and a `relation.too-few` under a key the file has are on the line of the key;
 * a `relation.too-few` without the key has no line, so no file is read for it (`at: "line"`).
 */
export const relationLimitFindings = (
  element: ElementRecord,
  context: RelationLimitContext,
): readonly LocatableFinding[] => {
  const type = limitedType(element, context.metamodel);
  const limits = type === undefined ? undefined : limitsOf(context.metamodel).get(type.key);
  if (type === undefined || limits === undefined) {
    return [];
  }
  return limits.flatMap((limit) => limitFinding(element, type.name, limit, context) ?? []);
};

/** The findings of every element of the store, in store order: one pass, no file read (N-036). */
export const allRelationLimitFindings = (context: RelationLimitContext): readonly LocatableFinding[] =>
  context.store.elements.flatMap((element) => relationLimitFindings(element, context));

/** The keys of the relation kinds with limits. */
const limitedKeys = (metamodel: Metamodel): ReadonlySet<string> =>
  new Set(metamodel.relations.filter((r) => (r.limits ?? []).length > 0).map((r) => r.key));

/**
 * Every count hint of the workspace with repository, file and line (SR-152 AK1, AK2), for
 * `workspace.check` (SR-019) and `hint.list`. Reads the files with hints under a key again for the
 * lines (`locateFindings`). Kept until the element store or the metamodel is reset; carried over a
 * change of the store (ThomasBirkmaier/ReqSeq-archive#184): the changed files are looked at again, and, when a changed UUID came,
 * went or changed its repository or type, so is every element whose UUID lies in its short-ID group
 * or that has a relation under a limited key to it (`relationSourcesAgain`, as SR-086).
 */
export const relationLimitProblemsState = defineWorkspaceState(
  "relation-limits",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    // `limitsOf` is empty for a metamodel that is not valid: its errors are the findings (ThomasBirkmaier/ReqSeq-archive#208).
    const shortIds = await workspace.get(shortIdState);
    return locateFindings(layout, allRelationLimitFindings({ layout, store, metamodel, shortIds }));
  },
  {
    dependsOn: [elementStoreState, metamodelState, shortIdState],
    carry: carryStoreUpdate((value, update, workspace) => {
      // Synchronously, so these are the short IDs carried over the same update.
      const context = Promise.all([
        workspace.get(workspaceLayoutState),
        workspace.get(metamodelState),
        workspace.get(shortIdState),
      ]);
      return carryProblems(workspace, value, update, {
        findingsOf: context.then(
          ([layout, metamodel, shortIds]) =>
            (element) =>
              relationLimitFindings(element, { layout, store: update.to, metamodel, shortIds }),
        ),
        again: [...update.ids].every((id) => samePlaces(update.from, update.to, id))
          ? Promise.resolve([])
          : context.then(([, metamodel]) => {
              const keys = limitedKeys(metamodel);
              return relationSourcesAgain(
                update,
                metamodel,
                workspace.peek(incomingState)?.get(update.from),
                (key) => keys.has(key),
              );
            }),
        // Nothing without limits, as a full build: no walk after a save (N-036).
        skip: context.then(([, metamodel]) => limitsOf(metamodel).size === 0),
      });
    }),
  },
);
