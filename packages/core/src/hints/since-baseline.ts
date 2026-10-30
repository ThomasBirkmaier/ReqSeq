// Changed core requirements since a variant's newest baseline (SR-103, D-042, N-022): "Das Tool muss
// an jeder Variante die übernommenen Kern-Requirements zeigen, die sich seit ihrer neuesten Baseline
// geändert haben."
//
// - A baseline of variant A (ADR-0018 "Which baseline", AK4): its stored selection has exactly the
//   key `view` and names A, in any readable form (`{ id, title }` or `{ id, repository }` by
//   `resolveTarget` from the file's repository, a text by `resolveRef`). One that also names a
//   package, a filter or IDs, `view: core`, or no selection is no baseline of A. The newest is the one
//   of the latest date and time, at the same instant the last file (`newestBaselines`). No stored
//   selection is resolved and Git is not asked (plan question 2, option b).
// - Which requirements: the core requirements (`isCoreRequirement`) that the view of A holds now
//   (the view rule: no variant rule removes it, `removersOf`), so excluded and replaced ones are not named here (AK6; a replaced one is SR-045's
//   `variant.core-changed`). One whose UUID the baseline lists with its current version is unchanged
//   (`contains`); for the others, an entry names its copy by the copy rule (`copyOf`).
//   - Listed with another version than the current one: `variant.core-changed-since-baseline` with the
//     version in the baseline (`storedVersion`) and the current one (AK1). A version that cannot be
//     computed now counts as changed, without `currentVersion` (a `file.faulty` finding says why).
//   - Not listed (new, its exclusion undone, its replacement removed): `variant.core-new-since-baseline`
//     with the current version only (AK7).
// - Each hint is at A (its file, the line of `id`), with the core requirement as `targetId`. A
//   variant without baseline gets none (AK3); a new baseline of the current state clears them (AK2).
//   Neither code has a hint ID: `hint.confirm` refuses them (`confirm.ts`, AK5).
// - Computed per call, not kept as a state, since a new baseline file changes them without a change
//   of the store. Cost (N-036): the headers of the baseline files and one full read per variant with a
//   baseline (`newestBaselines`), the core requirements once per store, their current versions once
//   per call, then one pass over the core requirements with one lookup per variant with a baseline;
//   a baseline's entries are indexed by record only when it lists a changed core requirement.
import type { Problem } from "../catalog.js";
import type { Baseline, BaselineCandidate } from "../baselines/index.js";
import { copyOf, newestBaselines, versionKey } from "../baselines/index.js";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, LocatableFinding, ShortIds } from "../model/index.js";
import {
  currentVersionsOf,
  elementLabel,
  locateFindings,
  resolveRef,
  resolveTarget,
} from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { ViewRuleIndex } from "../variants/index.js";
import {
  isCoreRequirement,
  removersOf,
  variantTypes,
  variantsOf,
  viewRuleIndexOf,
} from "../variants/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";

/** The code of a core requirement changed since the baseline (AK1). */
export const CHANGED_SINCE_BASELINE_CODE = "variant.core-changed-since-baseline";

/** The code of a core requirement new in the view since the baseline (AK7). */
export const NEW_SINCE_BASELINE_CODE = "variant.core-new-since-baseline";

/** Both codes, which no hint ID names and `hint.confirm` refuses (AK5). */
export const SINCE_BASELINE_CODES: ReadonlySet<string> = new Set([
  CHANGED_SINCE_BASELINE_CODE,
  NEW_SINCE_BASELINE_CODE,
]);

/** What the hints read. */
export interface SinceBaselineContext {
  readonly workspace: Workspace;
  readonly layout: WorkspaceLayout;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
}

/** The core requirements of a store in store order, with the metamodel they were found with. */
const cores = new WeakMap<ElementStore, { readonly metamodel: Metamodel; readonly cores: ElementRecord[] }>();

const coreRequirementsOf = (context: SinceBaselineContext): ElementRecord[] => {
  const { store, metamodel } = context;
  let known = cores.get(store);
  if (known?.metamodel !== metamodel) {
    known = { metamodel, cores: store.elements.filter((e) => isCoreRequirement(context, e)) };
    cores.set(store, known);
  }
  return known.cores;
};

const keyOf = (element: Pick<ElementRecord, "id" | "repository">): string =>
  `${element.repository}\0${element.id}`;

/** The variant whose view alone the selection of `candidate` stores, or undefined (see the file comment). */
const variantOf = (
  context: SinceBaselineContext,
  candidate: BaselineCandidate,
): ElementRecord | undefined => {
  const { selection } = candidate.header;
  const view = selection?.view;
  if (selection === undefined || view === undefined || Object.keys(selection).length !== 1) {
    return undefined;
  }
  let named: ElementRecord | undefined;
  if (typeof view === "string") {
    try {
      named = resolveRef(context.store, context.shortIds, view);
    } catch {
      // `core`, or a text that names no element or several.
      return undefined;
    }
  } else {
    const match = resolveTarget(context.store, candidate.repository, view);
    named = match.kind === "found" ? match.element : undefined;
  }
  return named !== undefined && variantTypes(context.metamodel).has(named.type) ? named : undefined;
};

/** The version `baseline` lists for each element copy (`copyOf`), by record; built once per baseline and store. */
const listed = new WeakMap<
  Baseline,
  { readonly store: ElementStore; readonly versions: Map<ElementRecord, string> }
>();

const listedOf = (store: ElementStore, baseline: Baseline): ReadonlyMap<ElementRecord, string> => {
  let known = listed.get(baseline);
  if (known?.store !== store) {
    known = { store, versions: new Map() };
    for (const entry of baseline.data.elements) {
      const copy = copyOf(store.byId, baseline, entry);
      if (typeof copy === "object") {
        known.versions.set(copy, entry.version);
      }
    }
    listed.set(baseline, known);
  }
  return known.versions;
};

/** The variants that remove each core requirement, by its place in `cores`, only those removed somewhere; once per index. */
const removed = new WeakMap<ViewRuleIndex, ReadonlyMap<number, readonly string[]>>();

const removersOfCores = (
  index: ViewRuleIndex,
  cores: readonly ElementRecord[],
): ReadonlyMap<number, readonly string[]> => {
  let known = removed.get(index);
  if (known === undefined) {
    const map = new Map<number, readonly string[]>();
    cores.forEach((core, i) => {
      const removers = removersOf(index, core);
      if (removers.length > 0) {
        map.set(i, removers);
      }
    });
    known = map;
    removed.set(index, known);
  }
  return known;
};

/** A variant with its newest baseline, and its hints so far. */
interface Against {
  readonly variant: ElementRecord;
  readonly key: string;
  readonly baseline: Baseline;
  /** How messages name the variant. */
  readonly shown: string;
  readonly findings: LocatableFinding[];
}

/** The hint at `at.variant` on `core`, whose current version is `current` (see the file comment). */
const findingOf = (
  context: SinceBaselineContext,
  at: Against,
  core: ElementRecord,
  current: string | undefined,
): LocatableFinding => {
  const { variant, baseline, shown } = at;
  const stored = listedOf(context.store, baseline).get(core);
  const label = elementLabel(context, core);
  const now = current === undefined ? "a version that cannot be computed now" : `version ${current} now`;
  const problem: Problem =
    stored === undefined
      ? {
          code: NEW_SINCE_BASELINE_CODE,
          severity: "warning",
          message: `Core requirement ${label} has come into the view of ${shown} since its newest baseline ${baseline.name}, which does not list it: ${now}; a new baseline of ${shown} settles it (D-042)`,
        }
      : {
          code: CHANGED_SINCE_BASELINE_CODE,
          severity: "warning",
          message: `Core requirement ${label}, which ${shown} adopts, has changed since its newest baseline ${baseline.name}: version ${stored} there, ${now}; a new baseline of ${shown} settles it (D-042)`,
          storedVersion: stored,
        };
  return {
    element: variant,
    path: ["id"],
    at: "key",
    problem: {
      ...problem,
      repository: variant.repository,
      file: variant.file,
      elementId: variant.id,
      targetId: core.id,
      ...(current === undefined ? {} : { currentVersion: current }),
    },
  };
};

/** The hints of each of `variants` that has a baseline, in their order, before their lines are known. */
const findingsOf = async (
  context: SinceBaselineContext,
  variants: readonly ElementRecord[],
): Promise<LocatableFinding[]> => {
  if (variants.length === 0) {
    return [];
  }
  const asked = new Set(variants.map(keyOf));
  const newest = await newestBaselines(context.workspace, (candidate) => {
    const variant = variantOf(context, candidate);
    return variant !== undefined && asked.has(keyOf(variant)) ? keyOf(variant) : undefined;
  });
  const against: Against[] = variants.flatMap((variant) => {
    const baseline = newest.get(keyOf(variant));
    return baseline === undefined
      ? []
      : [{ variant, key: keyOf(variant), baseline, shown: elementLabel(context, variant), findings: [] }];
  });
  if (against.length === 0) {
    return [];
  }
  const cores = coreRequirementsOf(context);
  const versions = await currentVersionsOf(context.workspace, cores);
  const index = viewRuleIndexOf(context.workspace, context.store, context.metamodel);
  // Per core requirement once: its current version, and as a key of `containsKey` (one string for
  // every baseline), and the variants whose rule removes it (`removersOf`: it has no validity, so it is
  // in every other variant's view).
  const currents = cores.map((core) => {
    const entry = versions.get(core);
    return entry?.kind === "version" ? entry.version : undefined;
  });
  const keys = cores.map((core, i) => {
    const current = currents[i];
    return current === undefined ? undefined : versionKey(core.id, current);
  });
  const removers = removersOfCores(index, cores);
  // Then one pass per variant, which reads one baseline at a time (measured: several times faster).
  for (const at of against) {
    cores.forEach((core, i) => {
      const key = keys[i];
      const removed = removers.get(i)?.includes(at.key) === true;
      // Unchanged: the baseline lists its UUID with the current version (the usual case, one lookup).
      if (!removed && !(key !== undefined && at.baseline.containsKey(key))) {
        at.findings.push(findingOf(context, at, core, currents[i]));
      }
    });
  }
  return against.flatMap((at) => at.findings);
};

/** The since-baseline hints of `record` when it is a variant, for a command that shows it (`element.get`). */
export const sinceBaselineFindingsOf = async (
  context: SinceBaselineContext,
  record: ElementRecord,
): Promise<readonly LocatableFinding[]> =>
  variantTypes(context.metamodel).has(record.type) ? findingsOf(context, [record]) : [];

/**
 * The since-baseline hints of every variant of the store, or of `only`, with their lines, for
 * `workspace.check` and `hint.list` (`hint.list --variant A` computes A alone).
 */
export const sinceBaselineProblems = async (
  context: SinceBaselineContext,
  only?: ElementRecord,
): Promise<readonly Problem[]> => {
  const variants = only === undefined ? variantsOf(context.store, context.metamodel) : [only];
  return locateFindings(context.layout, await findingsOf(context, variants));
};
