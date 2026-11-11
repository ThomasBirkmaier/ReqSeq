// Outdated evidence (SR-025 AK4, D-013): an element whose evidence records (Datensätze) of one kind
// and variant all belong to older versions than its current one. The records come from `evidenceRecordsState` of the
// evidence block (ADR-0012): the Markdown records since SR-028 (ThomasBirkmaier/ReqSeq-archive#40), the JUnit records with SR-093
// (ThomasBirkmaier/ReqSeq-archive#105). The check of AK4 is tested at core level with records given through it (decision on ThomasBirkmaier/ReqSeq-archive#127,
// option 1) and end to end on record files (`packages/cli/test/e2e/evidence-records.test.ts`).
//
// - Per element, kind (verification, validation) and variant (none: the core, SR-047) of its records,
//   the evidence is outdated when the status of that kind in that view is `outdated` (SR-025 AK4:
//   „dessen Nachweisstatus im Kern oder in einer Variante veraltet ist (SR-031)“; #201, product
//   owner decision, 2026-10-29: the hint follows the status). The status is that of
//   evidence/status.ts over the element's records: `verificationStatusOf` with its acceptance
//   criteria, so one criterion with records of older versions only and the others verified is
//   outdated too (SR-031 AK8), and `recordStatusOf` for validation. A newer record of an older
//   version next to one of the current version gives no hint when the status follows the current one.
// - The hint names the newest record of the group (by `date`) of an older version. When the group
//   has none of the current version, the message says its newest record is for an older version;
//   otherwise it names the criteria whose status is outdated (SR-031 AK8).
// - For an element whose repository the workspace file marks `variant-independent` (SR-173) the
//   records without variant hold in every variant too (`holdsIn`), as the status pools them, so a
//   variant's group is outdated only when the pooled status is (spec question #817 Q10, assumption).
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
import {
  criterionStatusesOf,
  evidenceIndexState,
  evidenceRecordsState,
  instantOf,
  ofVersion,
  recordStatusOf,
  verificationStatusOf,
} from "../evidence/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState } from "../metamodel/index.js";
import type {
  ElementRecord,
  ElementStore,
  LocatableFinding,
  ShortIds,
  VersionForms,
} from "../model/index.js";
import {
  acceptanceCriteriaKeyOf,
  criteriaCount,
  currentFormsOf,
  currentVersionsOf,
  currentVersionsState,
  elementLabel,
  shortIdState,
  NORMAL_FORM,
} from "../model/index.js";
import { settledValue } from "../runtime/settled.js";
import type { View } from "../variants/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { variantIndependentOf, workspaceLayoutState } from "../workspace/index.js";

/** The records of one element, kind and variant, in the order the records give them. */
interface RecordGroup {
  readonly kind: EvidenceRecord["kind"];
  readonly variant: string | undefined;
  readonly records: EvidenceRecord[];
}

/** The records of each element by UUID, and their groups by kind and variant in the order the records give them. */
const recordGroups = (
  records: readonly EvidenceRecord[],
): Map<string, { readonly records: EvidenceRecord[]; readonly groups: RecordGroup[] }> => {
  const groups = new Map<string, RecordGroup>();
  const byElement = new Map<string, { records: EvidenceRecord[]; groups: RecordGroup[] }>();
  for (const record of records) {
    const ofElement = byElement.get(record.element) ?? { records: [], groups: [] };
    byElement.set(record.element, ofElement);
    ofElement.records.push(record);
    const key = `${record.element}\n${record.kind}\n${record.variant ?? ""}`;
    const group = groups.get(key);
    if (group === undefined) {
      const created: RecordGroup = { kind: record.kind, variant: record.variant, records: [record] };
      groups.set(key, created);
      ofElement.groups.push(created);
      continue;
    }
    group.records.push(record);
  }
  return byElement;
};

/** The newest of `records` (`date` compared as an instant; the first on a tie), undefined for none. */
const newestOf = (records: readonly EvidenceRecord[]): EvidenceRecord | undefined =>
  records.reduce<EvidenceRecord | undefined>(
    (newest, record) =>
      newest === undefined || instantOf(record.date) > instantOf(newest.date) ? record : newest,
    undefined,
  );

const CORE: View = { kind: "core" };

/**
 * The message of an outdated status named by `record`, the newest record of its group of an older
 * version: with `criteria` (the group has a record of the current version) the criteria whose status
 * is outdated (SR-031 AK8), else that the group's newest record is for an older version.
 */
const messageOf = (
  record: EvidenceRecord,
  label: string,
  criteria: readonly string[] | undefined,
): string => {
  const variant = record.variant === undefined ? "" : ` for variant ${record.variant}`;
  return criteria === undefined
    ? `The newest ${record.kind} record of ${label}${variant}, from ${record.date}, is for an older version`
    : `The ${record.kind} of ${label}${variant} is outdated: ${criteria.join(", ")} only ${criteria.length === 1 ? "has" : "have"} records of older versions, the newest from ${record.date}`;
};

/**
 * The outdated evidence of `elements` (SR-025 AK4): for each element in the given order, per kind
 * and variant of its records whose status in that view is `outdated` against the version `currentOf`
 * gives for that element (each copy of a UUID against its own, SR-088), the newest record of the
 * group of an older version. `independent` names the elements whose repository is marked
 * `variant-independent` (SR-173), `criteriaOf` gives an element's number of acceptance criteria
 * (SR-031 AK5 to AK8; 0 without).
 */
export const outdatedEvidenceFindings = (
  elements: readonly ElementRecord[],
  records: readonly EvidenceRecord[],
  currentOf: (element: ElementRecord) => VersionForms | undefined,
  label: (element: ElementRecord) => string,
  independent: (element: ElementRecord) => boolean,
  criteriaOf: (element: ElementRecord) => number = () => 0,
): Problem[] => {
  const byElement = recordGroups(records);
  const problems: Problem[] = [];
  for (const element of elements) {
    const version = currentOf(element);
    const own = byElement.get(element.id);
    if (version === undefined || own === undefined) {
      continue;
    }
    const pooled = independent(element);
    const count = criteriaOf(element);
    for (const group of own.groups) {
      const view: View =
        group.variant === undefined
          ? CORE
          : { kind: "variant", variant: { id: group.variant, repository: element.repository } };
      const status =
        group.kind === "verification"
          ? verificationStatusOf(own.records, version, view, pooled, count)
          : recordStatusOf(own.records, group.kind, version, view, pooled);
      // An outdated status has a counted record of an older version: of the group's, or, pooled,
      // of the core's, which then has its own hint.
      const record = newestOf(group.records.filter((r) => !ofVersion(r, group.kind, version)));
      if (status !== "outdated" || record === undefined) {
        continue;
      }
      problems.push({
        code: "evidence.outdated",
        severity: "warning",
        message: messageOf(
          record,
          label(element),
          group.records.some((r) => ofVersion(r, group.kind, version))
            ? criterionStatusesOf(own.records, version, view, pooled, count).flatMap((s, i) =>
                s === "outdated" ? [`AK${String(i + 1)}`] : [],
              )
            : undefined,
        ),
        ...(record.repository === undefined ? {} : { repository: record.repository }),
        ...(record.file === undefined ? {} : { file: record.file }),
        ...(record.line === undefined ? {} : { line: record.line }),
        elementId: element.id,
        elementRepository: element.repository,
        elementFile: element.file,
        storedVersion: record.version,
        currentVersion: version[NORMAL_FORM],
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
      (element) => currentFormsOf(versions, element),
      (element) => elementLabel({ metamodel, shortIds }, element),
      (element) => marked.has(element.repository),
      (element) => criteriaCount(element.data, acceptanceCriteriaKeyOf(metamodel)),
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
 * picks the same record as the state, and no other element's records are looked at (ThomasBirkmaier/ReqSeq-archive#698: grouping
 * every record of the workspace cost about 170 ms per open at N-036). Called only against a valid
 * metamodel (`getElement`, the write path). `element.get` builds the index anyway for the
 * verification status; `element.update` and `element.create` (`model/write.ts`) build it for this
 * hint alone when it is not built (about 0.28 s at N-036 after `evidence.record` reset it, where the
 * grouping cost about 0.17 s), until the index is carried over a new record (ThomasBirkmaier/ReqSeq-archive#698 PR D, ThomasBirkmaier/ReqSeq-archive#713).
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
    (r) => currentFormsOf(versions, r),
    (r) => elementLabel({ metamodel, shortIds }, r),
    (r) => variantIndependentOf(layout).has(r.repository),
    (r) => criteriaCount(r.data, acceptanceCriteriaKeyOf(metamodel)),
  ).map(toFinding);
};
