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
// of the store as read: a change made outside LogReq shows once the watcher's batch resets the state.
// The state never reads or changes the element's `status` beyond the invalid flag (D-030).
import type { DataExportElement, ValidationStatus } from "../generated/types.js";
import { metamodelState } from "../metamodel/index.js";
import type { CurrentVersion, ElementRecord } from "../model/index.js";
import { currentVersionsOf, elementStoreState } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { traceContext } from "../trace/index.js";
import type { View } from "../variants/index.js";
import { appliesIn, variantsOf } from "../variants/index.js";
import { evidenceIndexState } from "./by-element.js";
import type { ChildRules, Shown, VerificationEvaluator } from "./indirect.js";
import { childRulesOf, hasOwnRecordIn, verificationEvaluator } from "./indirect.js";
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
): WorkspaceStatus => {
  const versions = new Map<ElementRecord, string | undefined>();
  // Elements whose children were walked by an earlier `prepare`, by repository and UUID.
  const walked = new Set<string>();
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
  let batches = 0;

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
      const key = `${element.repository}\u0000${element.id}`;
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
    prepare: (elements, options = {}) => {
      const run = queue.then(() => fill(elements, options.own === true));
      queue = run.catch(() => undefined);
      return run;
    },
    evaluate: verificationEvaluator(source, children, (element) => versions.get(element)),
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

/**
 * The verification status of a workspace (see the file comment): the records of `evidenceIndexState`
 * while the metamodel is valid, none otherwise; children through the trace block. Shared by
 * `evidence.status`, `element.get`, `element.resolve` and the filter (`query/evidence.ts`), so all of
 * them give the same status (SR-080 AK2) and a repeated call reads no version again (SR-082). Reset
 * with the metamodel, the element store and the evidence records.
 */
export const verificationState = defineWorkspaceState(
  "verification",
  async (workspace): Promise<WorkspaceStatus> => {
    const [metamodel, store] = await Promise.all([
      workspace.get(metamodelState),
      workspace.get(elementStoreState),
    ]);
    // While the metamodel is not valid the records are not compared and no element has children.
    const valid = metamodel.valid;
    const index = valid ? await workspace.get(evidenceIndexState) : undefined;
    const children = valid ? childRulesOf(await traceContext(workspace)) : undefined;
    return workspaceStatusOf(
      statusSource(metamodel, index),
      variantsOf(store, metamodel),
      children,
      (records) => currentVersionsOf(workspace, records),
    );
  },
  { dependsOn: [metamodelState, elementStoreState, evidenceIndexState] },
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
