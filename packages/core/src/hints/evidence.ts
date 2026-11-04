// Outdated evidence (SR-025 AK4, D-013): an element whose evidence records (Datensätze) of one kind
// and variant all belong to older versions than its current one. The records come from `evidenceRecordsState` of the
// evidence block (ADR-0012): the Markdown records since SR-028 (#40), the JUnit records with SR-093
// (#105). The check of AK4 is tested at core level with records given through it (decision on #127,
// option 1) and end to end on record files (`packages/cli/test/e2e/evidence-records.test.ts`).
//
// - Per element, kind (verification, validation) and variant (none: the core, SR-047) the evidence
//   is outdated when no record belongs to the current version of the element (SR-025 AK4: „dessen
//   Datensätze nur zu älteren Fassungen gehören“); the hint names the newest record by `date`.
//   A newer record of an older version next to one of the current version gives no hint, as the
//   status (SR-031, evidence/status.ts) then follows the current one (#201, product owner decision,
//   2026-10-29: the hint follows the status).
// - For an element whose repository the workspace file marks `variant-independent` (SR-173) the
//   records without variant hold in every variant too, so a variant's group is outdated only when
//   neither its own records nor those without variant (of the same kind) have the current version
//   (spec question #817 Q10, assumption; the hint follows the status, #201).
// - Problem `evidence.outdated`, severity `warning` (as `relation.outdated`: SR-019 AK2 ends the
//   check with exit code 1 for it), with the record's repository, file and line when it has them,
//   `elementId` with the element's own repository and file (`elementRepository`, `elementFile`:
//   `repository` and `file` are the record's, and a UUID may have several copies, SR-088), the
//   record's version as `storedVersion` and the current one as `currentVersion`.
//   No hint ID: such a hint is not confirmed, a new record settles it (ADR-0012).
// - Records of elements that are not in the store, or whose current version is unknown, are left
//   out (an unknown element is `evidence.unknown-element` of `evidence/match.ts`, SR-028 AK3).
// - Order: by element in store order, then kind, then variant as the records give them.
import type { Problem } from "../catalog.js";
import type { EvidenceRecord } from "../evidence/index.js";
import { evidenceIndexState, evidenceRecordsState, instantOf } from "../evidence/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, LocatableFinding, ShortIds } from "../model/index.js";
import {
  currentVersionOf,
  currentVersionsOf,
  currentVersionsState,
  elementLabel,
  shortIdState,
} from "../model/index.js";
import { settledValue } from "../runtime/settled.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { variantIndependentOf, workspaceLayoutState } from "../workspace/index.js";

/** One evidence record as far as the check needs it (ADR-0012), and where it lies when it says so. */
export type EvidenceVersion = Pick<
  EvidenceRecord,
  "kind" | "element" | "version" | "date" | "variant" | "repository" | "file" | "line"
>;

/** The records of one element, kind and variant: the newest (`date` compared as an instant) and every version. */
interface RecordGroup {
  readonly newest: EvidenceVersion;
  readonly versions: Set<string>;
}

/** The record groups of each element by UUID, in the order the records give them. */
const recordGroups = (records: readonly EvidenceVersion[]): Map<string, RecordGroup[]> => {
  const groups = new Map<string, { newest: EvidenceVersion; versions: Set<string> }>();
  for (const record of records) {
    const key = `${record.element}\n${record.kind}\n${record.variant ?? ""}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { newest: record, versions: new Set([record.version]) });
      continue;
    }
    group.versions.add(record.version);
    if (instantOf(record.date) > instantOf(group.newest.date)) {
      group.newest = record;
    }
  }
  const byElement = new Map<string, RecordGroup[]>();
  for (const group of groups.values()) {
    const id = group.newest.element;
    byElement.set(id, [...(byElement.get(id) ?? []), group]);
  }
  return byElement;
};

/**
 * The outdated evidence of `elements` (SR-025 AK4): for each element in the given order, per kind
 * and variant with no record of the version `currentOf` gives for that element (each copy of a UUID
 * against its own, SR-088), the newest record. For an element `independent` names (its repository is
 * marked `variant-independent`, SR-173) a variant's group counts the versions of the group without
 * variant of the same kind too.
 */
export const outdatedEvidenceFindings = (
  elements: readonly ElementRecord[],
  records: readonly EvidenceVersion[],
  currentOf: (element: ElementRecord) => string | undefined,
  label: (element: ElementRecord) => string,
  independent: (element: ElementRecord) => boolean,
): Problem[] => {
  const groups = recordGroups(records);
  const problems: Problem[] = [];
  for (const element of elements) {
    const version = currentOf(element);
    const own = groups.get(element.id) ?? [];
    const pooled = independent(element);
    for (const { newest: record, versions } of own) {
      if (version === undefined || versions.has(version)) {
        continue;
      }
      if (
        pooled &&
        record.variant !== undefined &&
        own.some(
          (g) => g.newest.variant === undefined && g.newest.kind === record.kind && g.versions.has(version),
        )
      ) {
        continue;
      }
      const variant = record.variant === undefined ? "" : ` for variant ${record.variant}`;
      problems.push({
        code: "evidence.outdated",
        severity: "warning",
        message: `The newest ${record.kind} record of ${label(element)}${variant}, from ${record.date}, is for an older version`,
        ...(record.repository === undefined ? {} : { repository: record.repository }),
        ...(record.file === undefined ? {} : { file: record.file }),
        ...(record.line === undefined ? {} : { line: record.line }),
        elementId: element.id,
        elementRepository: element.repository,
        elementFile: element.file,
        storedVersion: record.version,
        currentVersion: version,
      });
    }
  }
  return problems;
};

/** Every outdated evidence of the workspace (SR-025 AK4) for `workspace.check`; nothing against an invalid metamodel. */
export const outdatedEvidenceProblemsState = defineWorkspaceState(
  "outdated-evidence",
  async (workspace): Promise<readonly Problem[]> => {
    const metamodel = await workspace.get(metamodelState);
    const records = await workspace.get(evidenceRecordsState);
    // Nothing to compare (stage 2 has no records): the versions are not built for it.
    if (!metamodel.valid || records.length === 0) {
      return [];
    }
    const versions = await workspace.get(currentVersionsState);
    const shortIds: ShortIds = await workspace.get(shortIdState);
    const marked = variantIndependentOf(await workspace.get(workspaceLayoutState));
    return outdatedEvidenceFindings(
      versions.store.elements,
      records,
      (element) => currentVersionOf(versions, element),
      (element) => elementLabel({ metamodel, shortIds }, element),
      (element) => marked.has(element.repository),
    );
  },
  {
    dependsOn: [
      evidenceRecordsState,
      metamodelState,
      shortIdState,
      currentVersionsState,
      workspaceLayoutState,
    ],
  },
);

/** What the outdated evidence of one element reads: the states `element.get` works on. */
export interface ElementEvidenceContext {
  readonly workspace: Workspace;
  readonly layout: WorkspaceLayout;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
}

/**
 * The hints `evidence.outdated` of one element shown (SR-026 AK3), as
 * `outdatedEvidenceProblemsState` has them: from that state when its build has ended
 * (`settledValue`), else from the records and the current version of this element alone
 * (`currentVersionsOf`; ADR-0008). Its records are those of its UUID in the evidence index
 * (`byElement`), put back into the order of `evidenceRecordsState` (`positionOf`), so a tie of dates
 * picks the same record as the state, and no other element's records are looked at (#698: grouping
 * every record of the workspace cost about 170 ms per open at N-036). Called only against a valid
 * metamodel (`getElement`, the write path). `element.get` builds the index anyway for the
 * verification status; `element.update` and `element.create` (`model/write.ts`) build it for this
 * hint alone when it is not built (about 0.28 s at N-036 after `evidence.record` reset it, where the
 * grouping cost about 0.17 s), until the index is carried over a new record (#698 PR D, #713).
 * `element` may be the element as its file holds it now; it is looked up in the store by
 * repository and file. Each problem keeps the line in its record file. For two copies of one UUID
 * (SR-088) each copy is compared with its own version, here as in the state (#201).
 */
export const elementEvidenceFindings = async (
  context: ElementEvidenceContext,
  element: ElementRecord,
): Promise<LocatableFinding[]> => {
  const { workspace, layout, metamodel, store, shortIds } = context;
  const own = (p: Problem): boolean =>
    p.elementId === element.id &&
    p.elementRepository === element.repository &&
    p.elementFile === element.file;
  const toFinding = (problem: Problem): LocatableFinding => ({ element, path: [], at: "line", problem });
  const kept = await settledValue(workspace.peek(outdatedEvidenceProblemsState));
  if (kept !== undefined) {
    return kept.filter(own).map(toFinding);
  }
  // None for an element the store does not hold yet (one just created).
  const record = (store.byId.get(element.id) ?? []).find(
    (r) => r.repository === element.repository && r.file === element.file,
  );
  if (record === undefined) {
    return [];
  }
  const index = await workspace.get(evidenceIndexState);
  const ofElement = index.byElement.get(element.id);
  if (ofElement === undefined) {
    return [];
  }
  const records = [...ofElement].sort((a, b) => index.positionOf(a) - index.positionOf(b));
  const versions = { store, layout, metamodel, byRecord: await currentVersionsOf(workspace, [record]) };
  return outdatedEvidenceFindings(
    [record],
    records,
    (r) => currentVersionOf(versions, r),
    (r) => elementLabel({ metamodel, shortIds }, r),
    (r) => variantIndependentOf(layout).has(r.repository),
  ).map(toFinding);
};
