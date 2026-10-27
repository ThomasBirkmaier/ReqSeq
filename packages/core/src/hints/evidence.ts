// Outdated evidence (SR-025 AK4, D-013): an element whose newest evidence record (Datensatz) belongs
// to an older version than its current one. The records come from `evidenceRecordsState` of the
// evidence block (ADR-0012); until its readers are in (SR-028 #40, SR-093 #105) it is empty, and the
// check of AK4 is tested at core level with records given through it (decision on #127, option 1).
// SR-028 adds the CLI test.
//
// - Per element, kind (verification, validation) and variant (none: the core, SR-047) the newest
//   record by `date` decides (SR-025 AK4: "dessen neuester Datensatz zu einer älteren Fassung
//   gehört"). When its version is not the current version of the element, the evidence is
//   outdated. Of records with the same newest date, one for the current version counts.
// - Problem `evidence.outdated`, severity `warning` (as `relation.outdated`: SR-019 AK2 ends the
//   check with exit code 1 for it), with the record's repository, file and line when it has them,
//   `elementId` with the element's own repository and file (`elementRepository`, `elementFile`:
//   `repository` and `file` are the record's, and a UUID may have several copies, SR-088), the
//   record's version as `storedVersion` and the current one as `currentVersion`.
//   No hint ID: such a hint is not confirmed, a new record settles it (ADR-0012).
// - Records of elements that are not in the store, or whose current version is unknown, are left
//   out (an unknown element is SR-029's `evidence.unknown-element`, stage 4).
// - Order: by element in store order, then kind, then variant as the records give them.
import type { Problem } from "../catalog.js";
import type { EvidenceRecord } from "../evidence/index.js";
import { evidenceRecordsState } from "../evidence/index.js";
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

/** One evidence record as far as the check needs it (ADR-0012), and where it lies when it says so. */
export type EvidenceVersion = Pick<
  EvidenceRecord,
  "kind" | "element" | "version" | "date" | "variant" | "repository" | "file" | "line"
>;

/** `date` as an instant; a date that cannot be read counts as the oldest (NaN would compare false either way). */
const instantOf = (date: string): number => {
  const time = Date.parse(date);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};

/** The newest record of each element, kind and variant (`date` compared as an instant), the current one on a tie. */
const newestRecords = (
  records: readonly EvidenceVersion[],
  currentOf: (id: string) => string | undefined,
): Map<string, EvidenceVersion[]> => {
  const newest = new Map<string, EvidenceVersion>();
  for (const record of records) {
    const group = `${record.element}\n${record.kind}\n${record.variant ?? ""}`;
    const before = newest.get(group);
    const time = instantOf(record.date);
    const beforeTime = before === undefined ? Number.NEGATIVE_INFINITY : instantOf(before.date);
    if (
      before === undefined ||
      time > beforeTime ||
      (time === beforeTime && record.version === currentOf(record.element))
    ) {
      newest.set(group, record);
    }
  }
  const byElement = new Map<string, EvidenceVersion[]>();
  for (const record of newest.values()) {
    byElement.set(record.element, [...(byElement.get(record.element) ?? []), record]);
  }
  return byElement;
};

/**
 * The outdated evidence of `elements` (SR-025 AK4): for each element in the given order, each of
 * its newest records (per kind and variant) that belongs to an older version than `currentOf` gives.
 */
export const outdatedEvidenceFindings = (
  elements: readonly ElementRecord[],
  records: readonly EvidenceVersion[],
  currentOf: (element: ElementRecord) => string | undefined,
  label: (element: ElementRecord) => string,
): Problem[] => {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const current = (id: string): string | undefined => {
    const element = byId.get(id);
    return element === undefined ? undefined : currentOf(element);
  };
  const newest = newestRecords(records, current);
  const problems: Problem[] = [];
  for (const element of elements) {
    const version = currentOf(element);
    for (const record of newest.get(element.id) ?? []) {
      if (version === undefined || record.version === version) {
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
    return outdatedEvidenceFindings(
      versions.store.elements,
      records,
      (element) => currentVersionOf(versions, element),
      (element) => elementLabel({ metamodel, shortIds }, element),
    );
  },
  { dependsOn: [evidenceRecordsState, metamodelState, shortIdState, currentVersionsState] },
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
 * (`currentVersionsOf`; ADR-0008). `element` may be the element as its file holds it now; it is
 * looked up in the store by repository and file. Each problem keeps the line in its record file.
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
  const records = await workspace.get(evidenceRecordsState);
  if (records.length === 0) {
    return [];
  }
  const versions = { store, layout, metamodel, byRecord: await currentVersionsOf(workspace, [record]) };
  return outdatedEvidenceFindings(
    [record],
    records,
    (r) => currentVersionOf(versions, r),
    (r) => elementLabel({ metamodel, shortIds }, r),
  ).map(toFinding);
};
