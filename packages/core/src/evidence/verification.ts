// The verification status (SR-031, SR-034) and the validation status (SR-038) of a workspace's
// elements (ADR-0012 "Status rules"), as evidence.status, element.get, element.resolve and the filter
// (`query/evidence.ts`) show them: one memoised workspace state (`verificationState`) with the
// status source (`status.ts`), the variants, the child rules of the trace block and the evaluator
// (`indirect.ts`), so all of them give the same status by construction (SR-080 AK2). The validation
// status needs no walk: one pass over the element's own records (`validate`), never inherited.
//
// Current versions are read lazily and kept for the life of the state: `prepare` walks down from the
// elements shown through their counted children, down to the children with an own record in every
// view they apply in, and reads the versions of those with records that are not known yet, in one
// batch (`currentVersionsOf`: their files, or the whole store when they are a large share of it). A
// page or a leaf reads only what it needs; a repeated element.get of the same parent reads nothing
// (plan review B1, SR-082 AK3). Below an element marked emergent nothing is walked (SR-035). The walk
// is iterative, so a deep chain cannot overflow the stack.
// With `own`, `prepare` also reads the versions of the elements themselves that have validation
// records; the walk below them stays on verification. The element shown is measured against the
// version it is shown with (`Shown`), which is never kept. Children are measured against the versions
// of the store as read: a change made outside LogReq shows once the watcher's batch carries the state
// over (the changed elements, those that embed images or had no version, and their ancestors are
// read and computed again; `carriedStatus`) or resets it.
// The state never reads or changes the element's `status` beyond the invalid flag (D-030).
import type { DataExportElement, ValidationStatus } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import type {
  CurrentVersion,
  ElementRecord,
  ElementStore,
  IncomingIndex,
  StoreUpdate,
} from "../model/index.js";
import {
  CARRY_LIMIT,
  carryStoreUpdate,
  currentVersionsOf,
  elementStoreState,
  hasId,
  incomingFor,
  incomingIn,
  incomingState,
} from "../model/index.js";
import type { StateChange, Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { derivationKinds } from "../trace/index.js";
import type { View } from "../variants/index.js";
import { appliesIn, variantsOf } from "../variants/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { EvidenceIndex } from "./by-element.js";
import { evidenceIndexState } from "./by-element.js";
import type { ChildRules, Shown, VerificationEvaluator } from "./indirect.js";
import {
  carriedEvaluator,
  childRulesOf,
  hasOwnRecordIn,
  nodeKey,
  verificationEvaluator,
} from "./indirect.js";
import type { EvidenceRecord } from "./record.js";
import { insertionOf } from "./state.js";
import type { StatusSource, VerificationEntries } from "./status.js";
import { hasValidationRecord, statusSource, validationStatusOf } from "./status.js";

/**
 * The verification entries of `element` (`$defs/element` `verification`): the core and each variant
 * it applies in, in that order, with its status there and the children that are missing (SR-034);
 * undefined for an element that is no requirement. `shown`: see `VerificationEvaluator`.
 */
export const verificationOf = (
  status: Pick<WorkspaceStatus, "source" | "variants" | "evaluate">,
  element: ElementRecord,
  shown?: Shown,
): VerificationEntries | undefined => {
  if (!status.source.requirements.has(element.type)) {
    return undefined;
  }
  const views: View[] = [
    { kind: "core" },
    ...status.variants.map((variant): View => ({ kind: "variant", variant })),
  ];
  return views.flatMap((view) => {
    const result = status.evaluate(element, view, shown);
    if (result === undefined) {
      return [];
    }
    const { missingChildren } = result;
    return [
      {
        view: view.kind === "core" ? "core" : view.variant.id,
        status: result.status,
        ...(missingChildren === undefined ? {} : { missingChildren: [...missingChildren] }),
      },
    ];
  });
};

/**
 * The verification status of a workspace's elements (`verificationState`): the status source, the
 * variants, the evaluator of SR-031 and SR-034, and the current versions it needs, read lazily.
 */
export interface WorkspaceStatus {
  readonly source: StatusSource;
  /** The variants of the workspace in store order (`variantsOf`). */
  readonly variants: readonly ElementRecord[];
  /**
   * Reads the current versions that the status of `elements` needs and that were not read before:
   * those of the counted children below them, down to the children with an own record in every view
   * they apply in, and with `own` those of `elements` too. One batch per call; call it before
   * `evaluate` asks about these elements.
   */
  readonly prepare: (
    elements: readonly ElementRecord[],
    options?: { readonly own?: boolean },
  ) => Promise<void>;
  readonly evaluate: VerificationEvaluator;
  /**
   * The validation status of `element` (SR-038): for a need, and for any other element with a
   * counted validation record (#534 assumption); undefined otherwise. Measured against `shown.current`
   * when given (also when that is undefined, #276), else against the version read by `prepare`
   * (`own`); `shown` is never kept.
   */
  readonly validate: (element: ElementRecord, shown?: Shown) => ValidationStatus | undefined;
  /** How many batches of current versions were read so far (tests and measurements, B1 of the plan review). */
  readonly versionBatches: () => number;
}

/** Reads the current versions of some elements (`currentVersionsOf`). */
export type VersionReader = (
  records: readonly ElementRecord[],
) => Promise<ReadonlyMap<ElementRecord, CurrentVersion>>;

/**
 * The verification status of `source` with the variants, the child rules (undefined: no element has
 * children) and a reader of current versions. The versions read are kept for its life, so build one
 * per state of store, metamodel and records (`verificationState`).
 */
export const workspaceStatusOf = (
  source: StatusSource,
  variants: readonly ElementRecord[],
  children: ChildRules | undefined,
  read: VersionReader,
): WorkspaceStatus =>
  statusWith(source, variants, children, read, freshCaches(), freshEvaluator(source, children));

/** The caches of a status that has read and walked nothing yet. */
const freshCaches = (): StatusCaches => ({
  versions: new Map(),
  walked: new Set(),
  volatile: new Set(),
  batches: 0,
});

/** Builds the evaluator of a status over its versions (`currentOf`). */
type EvaluatorOf = (currentOf: (element: ElementRecord) => string | undefined) => VerificationEvaluator;

/** A new evaluator of `source` with `children`. */
const freshEvaluator =
  (source: StatusSource, children: ChildRules | undefined): EvaluatorOf =>
  (currentOf) =>
    verificationEvaluator(source, children, currentOf);

/** What a status has read and walked (`workspaceStatusOf`), to start a status carried over a store change. */
interface StatusCaches {
  /** The current versions read, by record (none for a record whose read gave none). */
  readonly versions: Map<ElementRecord, string | undefined>;
  /** Elements whose children were walked by an earlier `prepare`, by repository and UUID (`nodeKey`). */
  readonly walked: Set<string>;
  /**
   * The records read whose version may change while their file does not: one that embeds images
   * (the watcher does not report images, ADR-0008) or one whose read gave no version.
   */
  readonly volatile: Set<ElementRecord>;
  /** The batches read before (`versionBatches` goes on counting). */
  readonly batches: number;
}

/**
 * A status with its caches, so that `verificationState` can carry it (`carriedStatus`). It holds no
 * reference to the status it was carried from, so a chain of saves keeps only the newest.
 */
export interface KeptStatus extends WorkspaceStatus {
  readonly children: ChildRules | undefined;
  readonly caches: StatusCaches;
}

const statusWith = (
  source: StatusSource,
  variants: readonly ElementRecord[],
  children: ChildRules | undefined,
  read: VersionReader,
  caches: StatusCaches,
  evaluatorOf: EvaluatorOf,
): KeptStatus => {
  const { versions, walked, volatile } = caches;
  const views: View[] = [
    { kind: "core" },
    ...variants.map((variant): View => ({ kind: "variant", variant })),
  ];
  const hasRecords = (element: ElementRecord): boolean =>
    source.recordsOf(element.id).some((r) => r.kind === "verification");
  // Below an element with an own record in every view it applies in, or one marked emergent (SR-035),
  // its children decide nothing.
  const decidedByChildren = (element: ElementRecord): boolean =>
    !source.emergent(element) &&
    views.some((view) => appliesIn(source.validity, element, view) && !hasOwnRecordIn(source, element, view));
  let { batches } = caches;

  /**
   * The elements below `elements` whose version is needed and not known, and the elements walked
   * for that (see `prepare`); with `own` `elements` themselves too.
   */
  const needed = (elements: readonly ElementRecord[], own: boolean) => {
    const wanted = new Set<ElementRecord>();
    const want = (element: ElementRecord): void => {
      if (!versions.has(element) && hasRecords(element)) {
        wanted.add(element);
      }
    };
    if (own) {
      // Their own versions: requirements with verification records, any element with a counted
      // validation record (SR-038). The walk below stays on verification (S4 of the SR-038 plan review).
      for (const element of elements) {
        if (
          !versions.has(element) &&
          ((source.requirements.has(element.type) && hasRecords(element)) ||
            hasValidationRecord(source.recordsOf(element.id)))
        ) {
          wanted.add(element);
        }
      }
    }
    const stack = elements.filter((e) => source.requirements.has(e.type));
    const done = new Set<string>();
    for (let element = stack.pop(); element !== undefined; element = stack.pop()) {
      const key = nodeKey(element);
      if (children === undefined || walked.has(key) || done.has(key) || !decidedByChildren(element)) {
        continue;
      }
      done.add(key);
      for (const child of children.childrenOf(element)) {
        if (source.requirements.has(child.type) && children.counts(child)) {
          want(child);
          stack.push(child);
        }
      }
    }
    return { wanted, done };
  };

  const fill = async (elements: readonly ElementRecord[], own: boolean): Promise<void> => {
    const { wanted, done } = needed(elements, own);
    if (wanted.size > 0) {
      batches += 1;
      const found = await read([...wanted]);
      for (const element of wanted) {
        const entry = found.get(element);
        versions.set(element, entry?.kind === "version" ? entry.version : undefined);
        if (entry?.kind !== "version" || entry.images.length > 0) {
          volatile.add(element);
        }
      }
    }
    // Only once the versions are in: a failed read walks again next time.
    for (const key of done) {
      walked.add(key);
    }
  };

  // One `prepare` at a time, so a second never evaluates before the versions of the first are in.
  let queue: Promise<void> = Promise.resolve();
  return {
    source,
    variants,
    children,
    caches: {
      versions,
      walked,
      volatile,
      get batches() {
        return batches;
      },
    },
    prepare: (elements, options = {}) => {
      const run = queue.then(() => fill(elements, options.own === true));
      queue = run.catch(() => undefined);
      return run;
    },
    evaluate: evaluatorOf((element) => versions.get(element)),
    validate: (element, shown) => {
      const records = source.recordsOf(element.id);
      if (!source.needs.has(element.type) && !hasValidationRecord(records)) {
        return undefined;
      }
      return validationStatusOf(records, shown === undefined ? versions.get(element) : shown.current);
    },
    versionBatches: () => batches,
  };
};

/** What the verification status of one store is built from (`verificationState`). */
export interface StatusInputs {
  readonly metamodel: Metamodel;
  readonly layout: WorkspaceLayout;
  readonly store: ElementStore;
  /** The records; none while the metamodel is not valid. */
  readonly index: EvidenceIndex | undefined;
  /** The incoming relation index of `store`, for the children; none while the metamodel is not valid. */
  readonly incoming: IncomingIndex | undefined;
}

/** The status of `verificationState`: one built from `inputs`, which a store change can carry. */
export interface StateStatus extends KeptStatus {
  readonly inputs: StatusInputs;
}

const statusOfInputs = (inputs: StatusInputs, read: VersionReader): StateStatus => {
  const { metamodel, layout, store, index, incoming } = inputs;
  const children = incoming === undefined ? undefined : childRulesOf({ layout, metamodel, store, incoming });
  const source = statusSource(metamodel, index);
  const status = statusWith(
    source,
    variantsOf(store, metamodel),
    children,
    read,
    freshCaches(),
    freshEvaluator(source, children),
  );
  return { ...status, inputs };
};

/**
 * The records of `store` under the UUIDs `ids` and the records whose derivation relations name them,
 * recursively: everything whose status may depend on them, as far as `store` tells. A relation item
 * counts for every record of its UUID, in every repository, so this holds the derivation parents
 * the trace block resolves (`parentsOf`, `childrenOf`), and possibly more.
 */
const upwardsFrom = (
  store: ElementStore,
  starts: Iterable<ElementRecord>,
  keys: readonly string[],
  into: Set<string>,
): void => {
  const seen = new Set<ElementRecord>();
  const stack = [...starts];
  for (let record = stack.pop(); record !== undefined; record = stack.pop()) {
    if (seen.has(record)) {
      continue;
    }
    seen.add(record);
    into.add(nodeKey(record));
    for (const key of keys) {
      const value: unknown = record.data[key];
      if (!Array.isArray(value)) {
        continue;
      }
      for (const item of value as readonly unknown[]) {
        if (hasId(item)) {
          stack.push(...(store.byId.get(item.id) ?? []));
        }
      }
    }
  }
};

/**
 * The verification status of the store after `update`, carried over from `old`, the status of the
 * store before it (ADR-0008, #184, #698): the versions read, the walks of `prepare` and the results
 * of the evaluator are kept for every element that the change cannot reach. Affected are the
 * records of the changed UUIDs (`update.ids`, before and after: a twin that comes or goes changes
 * the children of its UUID, SR-088) and the records whose version may have changed without their
 * file (`volatile`: images, no version), with their ancestors before the change (in the old store)
 * and after it (in the new one); a child stores its derivation (ADR-0004), so the old and the new
 * parents of a changed element are among them. The new store's status is built afresh (no versions
 * kept) when the metamodel is not valid or has no derivation, or the variants changed (the views
 * change). `memo` is the incoming index memo as the hook took it, so no `get` runs later (review B5
 * of the #698 plan): a second change before this one resolved pairs its own store and index.
 */
const carriedStatus = (
  old: StateStatus,
  update: StoreUpdate,
  memo: WeakMap<ElementStore, IncomingIndex>,
  read: VersionReader,
): StateStatus => {
  const { metamodel } = old.inputs;
  const variants = variantsOf(update.to, metamodel);
  const sameViews =
    variants.length === old.variants.length && variants.every((v, i) => v === old.variants[i]);
  // Without children (an invalid metamodel, no derivation) nothing was walked; other variants
  // change the views; a status of another store than the one changed (the store is replaced by
  // compare and set, so only a value put in place by hand) cannot be carried by the change. Built
  // afresh from the values of the change, still without any `get`.
  if (old.children === undefined || !sameViews || old.inputs.store !== update.from) {
    const incoming = old.inputs.incoming === undefined ? undefined : incomingIn(memo, update.to, metamodel);
    return statusOfInputs({ ...old.inputs, store: update.to, incoming }, read);
  }
  const incoming = incomingIn(memo, update.to, metamodel);
  const inputs: StatusInputs = { ...old.inputs, store: update.to, incoming };
  const children = childRulesOf({ ...inputs, incoming });
  return keptOver(old, update, { inputs, source: old.source, children, versionsOfChanged: false }, read);
};

/** The change a status is carried over (`keptOver`): the stores before and after, the UUIDs it names. */
interface Reach {
  readonly from: ElementStore;
  readonly to: ElementStore;
  readonly ids: ReadonlySet<string>;
}

/** What the carried status is built of. */
interface Next {
  readonly inputs: StatusInputs;
  readonly source: StatusSource;
  readonly children: ChildRules | undefined;
  /** Keep the versions of the records of `ids` (their files did not change). */
  readonly versionsOfChanged: boolean;
}

/**
 * The status `next` from `old`, which has children, keeping what the change `reach` cannot reach
 * (see `carriedStatus`): the records of `reach.ids` in both stores and the volatile records, with
 * their ancestors in both stores, lose their walks and results, and the old records among them
 * their versions (the volatile ones always, those of `ids` unless `versionsOfChanged`).
 */
const keptOver = (old: StateStatus, reach: Reach, next: Next, read: VersionReader): StateStatus => {
  const keys = derivationKinds(next.inputs.metamodel, "evidence.status").map((kind) => kind.key);
  const { versions, walked, volatile } = old.caches;
  const ofIds = (store: ElementStore): ElementRecord[] =>
    [...reach.ids].flatMap((id) => store.byId.get(id) ?? []);
  const before = [...ofIds(reach.from), ...volatile];
  const affected = new Set<string>();
  upwardsFrom(reach.from, before, keys, affected);
  upwardsFrom(reach.to, [...ofIds(reach.to), ...volatile], keys, affected);
  const dropped = new Set(next.versionsOfChanged ? volatile : before);
  const keptVersions = new Map<ElementRecord, string | undefined>();
  for (const [record, version] of versions) {
    if (!dropped.has(record)) {
      keptVersions.set(record, version);
    }
  }
  const keptWalked = new Set<string>();
  for (const key of walked) {
    if (!affected.has(key)) {
      keptWalked.add(key);
    }
  }
  const evaluate = old.evaluate;
  const { source, children } = next;
  const status = statusWith(
    source,
    old.variants,
    children,
    read,
    { versions: keptVersions, walked: keptWalked, volatile: new Set(), batches: old.caches.batches },
    (currentOf) => carriedEvaluator(evaluate, source, children, currentOf, affected),
  );
  return { ...status, inputs: next.inputs };
};

/**
 * The status after `evidence.record` wrote `record`, carried over from `old`, the status of the
 * records before it (#278, plan §3.4): `index` is the carried index with the record (taken inside
 * the hook, review B5). The source is new (its records changed: the evaluator must not keep the own
 * views of the old one, review S1 of #714); the records of the element's UUID and their ancestors
 * lose their walks and results, so a first record for a variant reaches the seeds of its ancestors.
 * The versions are kept but those of the volatile records (as over a store change). Unchanged while
 * the metamodel is not valid (the records are not compared then); built afresh without children.
 */
const recordedStatus = (
  old: StateStatus,
  record: EvidenceRecord,
  index: EvidenceIndex,
  read: VersionReader,
): StateStatus => {
  if (old.inputs.index === undefined) {
    return old;
  }
  const inputs: StatusInputs = { ...old.inputs, index };
  if (old.children === undefined) {
    return statusOfInputs(inputs, read);
  }
  const { store } = inputs;
  return keptOver(
    old,
    { from: store, to: store, ids: new Set([record.element]) },
    {
      inputs,
      source: statusSource(inputs.metamodel, index),
      children: old.children,
      versionsOfChanged: true,
    },
    read,
  );
};

/** Reads current versions from the workspace's files (`currentVersionsOf`). */
const readerOf =
  (workspace: Workspace): VersionReader =>
  (records) =>
    currentVersionsOf(workspace, records);

/** The carry of `verificationState` over a change of the element store (`carriedStatus`). */
const carryStore = carryStoreUpdate((value: Promise<StateStatus>, update, workspace) => {
  // Not over a large change (the bound of the incoming index); the memo was carried first (a
  // dependency): it holds the index of the new store only when it held one of the old store.
  if (update.ids.size > CARRY_LIMIT) {
    return undefined;
  }
  const memo = workspace.get(incomingState);
  if (memo.get(update.to) === undefined) {
    return undefined;
  }
  const read = readerOf(workspace);
  return value.then((old) => carriedStatus(old, update, memo, read));
});

/**
 * The carry of `verificationState` over the read after `evidence.record` (`recordedStatus`): the
 * record and the carried index are taken here, inside `Workspace.replace` (review B5); the index
 * state was carried first (a dependency), else this hook does not run.
 */
const carryRecord = (
  value: Promise<StateStatus>,
  change: StateChange,
  workspace: Workspace,
): Promise<StateStatus> | undefined => {
  const record = insertionOf(change);
  if (record === undefined) {
    return undefined;
  }
  const index = workspace.get(evidenceIndexState);
  const read = readerOf(workspace);
  return value.then(async (old) => recordedStatus(old, record, await index, read));
};

/**
 * The verification status of a workspace (see the file comment): the records of `evidenceIndexState`
 * while the metamodel is valid, none otherwise; children through the trace block. Shared by
 * `evidence.status`, `element.get`, `element.resolve` and the filter (`query/evidence.ts`), so all of
 * them give the same status (SR-080 AK2) and a repeated call reads no version again (SR-082). Reset
 * with the metamodel and the evidence records; carried over a change of the element store
 * (`carriedStatus`) while the incoming relation index was carried with it (`incomingState`, at most
 * `CARRY_LIMIT` UUIDs), reset otherwise.
 */
export const verificationState = defineWorkspaceState(
  "verification",
  async (workspace): Promise<StateStatus> => {
    const [metamodel, store, layout] = await Promise.all([
      workspace.get(metamodelState),
      workspace.get(elementStoreState),
      workspace.get(workspaceLayoutState),
    ]);
    // While the metamodel is not valid the records are not compared and no element has children.
    const valid = metamodel.valid;
    const index = valid ? await workspace.get(evidenceIndexState) : undefined;
    const incoming = valid ? incomingFor(workspace, store, metamodel) : undefined;
    return statusOfInputs({ metamodel, layout, store, index, incoming }, readerOf(workspace));
  },
  {
    dependsOn: [metamodelState, elementStoreState, evidenceIndexState, incomingState, workspaceLayoutState],
    carry: (value, change, workspace) =>
      change.key === elementStoreState
        ? carryStore(value, change, workspace)
        : carryRecord(value, change, workspace),
  },
);

/**
 * The verification status of `workspace` (`verificationState`), prepared for the elements `shown`
 * (a page, or the one element of element.get), whose own versions come from what is shown.
 */
export const workspaceStatus = async (
  workspace: Workspace,
  shown: readonly ElementRecord[],
): Promise<WorkspaceStatus> => {
  const status = await workspace.get(verificationState);
  await status.prepare(shown);
  return status;
};

/**
 * `element` with its verification entries (`verificationOf`, SR-031, SR-034) and its validation status
 * (`validate`, SR-038), each when it has one, both measured against the `version` it shows.
 */
export const withEvidenceStatus = (
  status: WorkspaceStatus,
  record: ElementRecord,
  element: DataExportElement,
): DataExportElement => {
  const shown: Shown = { current: element.version };
  const verification = verificationOf(status, record, shown);
  const validation = status.validate(record, shown);
  return {
    ...element,
    ...(verification === undefined ? {} : { verification }),
    ...(validation === undefined ? {} : { validation }),
  };
};
