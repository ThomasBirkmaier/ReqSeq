// Changed core requirements since a variant's newest baseline (SR-103, D-042, N-022): "Das Tool muss
// an jeder Variante die übernommenen Kern-Requirements zeigen, die sich seit ihrer neuesten Baseline
// geändert haben."
//
// - A baseline of variant A (ADR-0018 "Which baseline", AK4): its stored selection has exactly the
//   key `view` and names A, in any readable form (`{ id, title }` or `{ id, repository }` by
//   `resolveTarget` from the file's repository, a text by `resolveRef`). One that also names a
//   package, a filter or IDs, `view: core`, or no selection is no baseline of A. The newest is the one
//   of the latest date and time, at the same instant the last file (`newestBaselines`). No stored
//   selection is resolved and Git is not asked (AK4: a package or a filter beside the view makes
//   it no baseline of A).
// - Which requirements: the core requirements (`isCoreRequirement`) that the view of A holds now
//   (no variant rule removes them, `removersOf`), so excluded and replaced ones are not named here
//   (AK6; a replaced one is SR-045's `variant.core-changed`). A UUID with one copy whose version the
//   baseline lists is unchanged (`containsKey`); for any other, the entry that names its copy by the
//   copy rule (`copyOf`) decides (SR-088).
//   - Listed with another version than the current one: `variant.core-changed-since-baseline` with the
//     version in the baseline (`storedVersion`) and the current one (AK1). A version that cannot be
//     computed now counts as changed, without `currentVersion` (a `file.faulty` finding says why).
//   - Not listed (new, its exclusion undone, its replacement removed): `variant.core-new-since-baseline`
//     with the current version only (AK7).
// - Each hint is at A (its file, the line of `id`), with the core requirement as `targetId`. A
//   variant without baseline gets none (AK3); a new baseline of the current state clears them (AK2).
//   Neither code has a hint ID: `hint.confirm` refuses them (`confirm.ts`, AK5).
// - Not a state, since a new baseline file changes them without a change of the store. Kept: per
//   variant the hits (`Memo`) with the chosen `Baseline` object, the store, the metamodel and the
//   value of `currentVersionsState` they came from; a new or changed baseline file gives a new
//   object, so a memo never outlives its baseline. Over a store change the hits are carried
//   (`carried`) when each changed UUID keeps one copy in the same file, its rule items and whether it
//   is a core requirement: only a changed core requirement is looked at again, with its own file.
//   Anything else (a rule, a new or removed element, the versions built again) is the full pass. A
//   changed embedded image of an unchanged core requirement shows once the versions are checked
//   again (`hint.list`, `workspace.check` call `currentVersions`).
// - Cost (N-036): the headers of the baseline files and one full read per variant with a baseline
//   (`newestBaselines`), then for a memo the changed UUIDs (`storeUpdate`), else the full pass: the
//   core requirements once per store, their current versions (`currentVersionsOf`: the whole store,
//   so the first call in a process waits for the versions build, 4–5 s at N-036, #259; a variant
//   without baseline returns before), one pass over them per variant with one lookup each.
import type { Problem } from "../catalog.js";
import type { Baseline, BaselineCandidate } from "../baselines/index.js";
import { copyOf, newestBaselines, versionKey } from "../baselines/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { isDeepStrictEqual } from "node:util";
import type {
  CurrentVersion,
  ElementRecord,
  ElementStore,
  LocatableFinding,
  ShortIds,
} from "../model/index.js";
import {
  currentVersionsOf,
  currentVersionsState,
  storeUpdate,
  elementLabel,
  locateFindings,
  resolveRef,
  resolveTarget,
} from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { ViewRuleIndex } from "../variants/index.js";
import {
  isCoreRequirement,
  removersOf,
  ruleItemsOf,
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

/** The entries of `baseline` by UUID, built once per baseline when a core requirement is not unchanged. */
const entriesById = new WeakMap<
  Baseline,
  ReadonlyMap<string, readonly Baseline["data"]["elements"][number][]>
>();

/** The version `baseline` lists for the copy `core` (the copy rule, `copyOf`), or undefined. */
const storedOf = (store: ElementStore, baseline: Baseline, core: ElementRecord): string | undefined => {
  let byId = entriesById.get(baseline);
  if (byId === undefined) {
    const map = new Map<string, Baseline["data"]["elements"][number][]>();
    for (const entry of baseline.data.elements) {
      const list = map.get(entry.id) ?? [];
      list.push(entry);
      map.set(entry.id, list);
    }
    byId = map;
    entriesById.set(baseline, byId);
  }
  return byId.get(core.id)?.find((entry) => copyOf(store.byId, baseline, entry) === core)?.version;
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

/** One core requirement that is not unchanged since the baseline: its place among the core requirements and both versions. */
interface Hit {
  readonly core: ElementRecord;
  readonly at: number;
  readonly stored: string | undefined;
  readonly current: string | undefined;
}

/** What one variant's hints were computed from, and the hits (see the file comment, "Kept"). */
interface Memo {
  readonly store: ElementStore;
  readonly metamodel: Metamodel;
  readonly baseline: Baseline;
  /** The value of `currentVersionsState` then. */
  readonly versions: unknown;
  readonly index: ViewRuleIndex;
  /** The place of each core requirement of the full pass, by `keyOf`. */
  readonly places: ReadonlyMap<string, number>;
  readonly hits: readonly Hit[];
}

/** The memo of each variant, by `keyOf`. */
const memoState = defineWorkspaceState("since-baseline", (): Map<string, Memo> => new Map());

/** The places of the core requirements of a store by `keyOf`, once per list. */
const placesOf = new WeakMap<readonly ElementRecord[], ReadonlyMap<string, number>>();

const placesIn = (cores: readonly ElementRecord[]): ReadonlyMap<string, number> => {
  let places = placesOf.get(cores);
  if (places === undefined) {
    places = new Map(cores.map((core, i) => [keyOf(core), i]));
    placesOf.set(cores, places);
  }
  return places;
};

/** The current version of `entry`, or undefined. */
const versionOf = (entry: CurrentVersion | undefined): string | undefined =>
  entry?.kind === "version" ? entry.version : undefined;

/** The key of `containsKey` for `core` at `current`, or undefined without a current version. */
const keyFor = (core: ElementRecord, current: string | undefined): string | undefined =>
  current === undefined ? undefined : versionKey(core.id, current);

/** Whether `core`, now at `current`, is unchanged in `baseline` (see the file comment). */
const unchanged = (
  store: ElementStore,
  baseline: Baseline,
  core: ElementRecord,
  current: string | undefined,
  key: string | undefined,
): boolean =>
  // The usual case, one lookup; only for a UUID with one copy, as the entry may name another (SR-088).
  key !== undefined && store.byId.get(core.id)?.length === 1
    ? baseline.containsKey(key)
    : current !== undefined && storedOf(store, baseline, core) === current;

/** The rule items of `record` as data: what a change of it may change in the views. */
const rulesOf = (metamodel: Metamodel, record: ElementRecord): unknown =>
  ruleItemsOf(metamodel, record).map(({ meaning, path, target }) => ({ meaning, path, target }));

const NONE: readonly ElementRecord[] = [];

/** The records of the UUID `id` in `store`. */
const copiesIn = (store: ElementStore, id: string): readonly ElementRecord[] => store.byId.get(id) ?? NONE;

/**
 * The hits of `memo` carried to the store of `context`, or undefined when they must be computed
 * again: each changed UUID keeps one copy in the same file, its rule items and whether it is a core
 * requirement; a changed core requirement gets its hit again from its file.
 */
const carried = async (
  context: SinceBaselineContext,
  memo: Memo,
  variantKey: string,
): Promise<Hit[] | undefined> => {
  const update = storeUpdate(memo.store, context.store);
  /* v8 ignore next 3 -- undefined only when the repositories differ, which a new workspace layout
     makes, and with it a new metamodel, which `findingsOf` checks before it asks for this. */
  if (update === undefined) {
    return undefined;
  }
  const changed: ElementRecord[] = [];
  for (const id of update.ids) {
    const [before, ...more] = copiesIn(memo.store, id);
    const [after, ...others] = copiesIn(context.store, id);
    const core = after !== undefined && isCoreRequirement(context, after);
    if (
      before === undefined ||
      after === undefined ||
      more.length + others.length > 0 ||
      before.repository !== after.repository ||
      before.file !== after.file ||
      core !== isCoreRequirement(context, before) ||
      !isDeepStrictEqual(rulesOf(memo.metamodel, before), rulesOf(context.metamodel, after))
    ) {
      return undefined;
    }
    if (core) {
      changed.push(after);
    }
  }
  const ids = new Set(changed.map((core) => core.id));
  const hits = memo.hits.filter((hit) => !ids.has(hit.core.id));
  const versions = await currentVersionsOf(context.workspace, changed);
  for (const core of changed) {
    const current = versionOf(versions.get(core));
    // Each changed core requirement was one in the full pass: carrying keeps whether it is one.
    const at = Number(memo.places.get(keyOf(core)));
    if (
      !removersOf(memo.index, core).includes(variantKey) &&
      !unchanged(context.store, memo.baseline, core, current, keyFor(core, current))
    ) {
      hits.push({ core, at, stored: storedOf(context.store, memo.baseline, core), current });
    }
  }
  return hits.sort((a, b) => a.at - b.at);
};

/** A variant with its newest baseline. */
interface Against {
  readonly variant: ElementRecord;
  readonly key: string;
  readonly baseline: Baseline;
}

/** A variant with a baseline and its hits: kept or carried, else (`full`) from the full pass. */
interface Pending {
  readonly at: Against;
  hits: readonly Hit[];
  readonly full: boolean;
}

/** The hint at `variant` of `hit` against `baseline` (see the file comment). */
const findingOf = (
  context: SinceBaselineContext,
  variant: ElementRecord,
  shown: string,
  baseline: Baseline,
  { core, stored, current }: Hit,
): LocatableFinding => {
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

/** The hits of each of `against` in one pass over the core requirements (see the file comment). */
const fullPass = async (
  context: SinceBaselineContext,
  pending: readonly Pending[],
  memos: Map<string, Memo>,
): Promise<void> => {
  const cores = coreRequirementsOf(context);
  const versions = await currentVersionsOf(context.workspace, cores);
  const index = viewRuleIndexOf(context.workspace, context.store, context.metamodel);
  // Per core requirement once: its current version, as a key of `containsKey` (one string for every
  // baseline), and the variants whose rule removes it (`removersOf`: it has no validity, so it is in
  // every other variant's view).
  const currents = cores.map((core) => versionOf(versions.get(core)));
  const keys = cores.map((core, i) => keyFor(core, currents[i]));
  const removers = removersOfCores(index, cores);
  const state = context.workspace.peek(currentVersionsState);
  // One pass per variant, which reads one baseline at a time (measured: several times faster).
  for (const item of pending) {
    const { key, baseline } = item.at;
    const hits: Hit[] = [];
    cores.forEach((core, i) => {
      const removedHere = removers.get(i)?.includes(key) === true;
      if (!removedHere && !unchanged(context.store, baseline, core, currents[i], keys[i])) {
        hits.push({ core, at: i, stored: storedOf(context.store, baseline, core), current: currents[i] });
      }
    });
    memos.set(key, {
      store: context.store,
      metamodel: context.metamodel,
      baseline,
      versions: state,
      index,
      places: placesIn(cores),
      hits,
    });
    item.hits = hits;
  }
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
    return baseline === undefined ? [] : [{ variant, key: keyOf(variant), baseline }];
  });
  const memos = context.workspace.get(memoState);
  const state = context.workspace.peek(currentVersionsState);
  const pending: Pending[] = [];
  for (const at of against) {
    const memo = memos.get(at.key);
    const kept =
      memo?.baseline !== at.baseline || memo.metamodel !== context.metamodel
        ? undefined
        : memo.store === context.store
          ? memo.versions === state
            ? memo.hits
            : undefined
          : await carried(context, memo, at.key);
    if (kept !== undefined && memo !== undefined && memo.store !== context.store) {
      memos.set(at.key, {
        ...memo,
        store: context.store,
        versions: context.workspace.peek(currentVersionsState),
        hits: kept,
      });
    }
    pending.push({ at, hits: kept ?? [], full: kept === undefined });
  }
  const full = pending.filter((p) => p.full);
  if (full.length > 0) {
    await fullPass(context, full, memos);
  }
  return pending.flatMap(({ at: { variant, baseline }, hits }) => {
    const shown = elementLabel(context, variant);
    return hits.map((hit) => findingOf(context, variant, shown, baseline, hit));
  });
};

/** The since-baseline hints of `record` when it is a variant, for a command that shows it (`element.get`). */
export const sinceBaselineFindingsOf = async (
  context: SinceBaselineContext,
  record: ElementRecord,
): Promise<readonly LocatableFinding[]> =>
  variantTypes(context.metamodel).has(record.type) ? findingsOf(context, [record]) : [];

/**
 * The since-baseline hints of `variants` (every variant of the store when left out) that are
 * variants, with their lines, for `workspace.check`, `hint.list` and `hint.confirm`.
 */
export const sinceBaselineProblems = async (
  context: SinceBaselineContext,
  variants?: readonly ElementRecord[],
): Promise<readonly Problem[]> => {
  const types = variantTypes(context.metamodel);
  const asked = variants?.filter((v) => types.has(v.type)) ?? variantsOf(context.store, context.metamodel);
  return locateFindings(context.layout, await findingsOf(context, asked));
};
