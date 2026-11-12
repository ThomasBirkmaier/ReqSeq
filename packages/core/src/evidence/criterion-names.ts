// The criteria a record names, as every output that lists records names them (SR-205 AK2): number,
// key and text in `criterionNames` (`namedCriterion`), the number that of the version whose criteria
// are counted. evidence.list, trace.chain, trace.matrix and trace.affected count the current version
// (`recordNamer`); baseline.get counts the baseline's version and names its later records with the
// items of that version (`withCriterionNames`, `evidence/baseline.ts`); evidence.record names the
// record it wrote from the current items. A record that names no criterion stays as it is.
//
// The text of a criterion an older record names by number, without key in that version, comes from
// the Git walk of the version dates (`versionValues`): one walk per command call for all elements and
// versions it lists, not one per record, and only for records the status lookup has no items for.
// `withCriterionNames` (`criteria.ts`) names one record against the items it is given.
import type { ElementRecord } from "../model/index.js";
import { acceptanceCriteriaKeyOf, criteriaItemsOf, currentVersionsOf, formsOfEntry } from "../model/index.js";
import { versionValues } from "../model/version-date.js";
import { metamodelState } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { withCriterionNames } from "./criteria.js";
import type { EvidenceRecord } from "./record.js";
import { verificationState } from "./verification.js";

/**
 * The acceptance criteria items of each of `requests`, an element at an older version, from the Git
 * walk of the version dates (`versionValues`), by repository, file and version; none where Git does not
 * have that version. One walk for all of them; none for no request.
 */
const fetchedItems = async (
  workspace: Workspace,
  requests: readonly { readonly element: ElementRecord; readonly version: string }[],
): Promise<ReadonlyMap<string, readonly unknown[]>> => {
  if (requests.length === 0) {
    return new Map();
  }
  const [metamodel, layout] = await Promise.all([
    workspace.get(metamodelState),
    workspace.get(workspaceLayoutState),
  ]);
  const values = await versionValues(
    { workspace, layout, metamodel },
    requests.map(({ element, version }) => ({
      repository: element.repository,
      file: element.file,
      id: element.id,
      version,
    })),
  );
  const key = acceptanceCriteriaKeyOf(metamodel);
  return new Map(
    requests.flatMap(({ element, version }, i) => {
      const at = values[i];
      return at === null || at === undefined
        ? []
        : [[`${element.repository}\u0000${element.file}\u0000${version}`, criteriaItemsOf(at, key)] as const];
    }),
  );
};

/**
 * Names the criteria of a record of an element, as `recordNamer` prepared them; a record of an
 * element it was not given stays as it is. The element is the store's record, so two copies of one
 * UUID (SR-088) are told apart.
 */
export type RecordNamer = (element: ElementRecord, record: EvidenceRecord) => EvidenceRecord;

/** The records of one element that an output lists. */
export interface ListedRecords {
  readonly element: ElementRecord;
  readonly records: readonly EvidenceRecord[];
}

const sameRecord: RecordNamer = (_element, record) => record;

/**
 * A `RecordNamer` for the records `listed` gives, counted against each element's current version
 * (see the file comment). Reads nothing when none of them names a criterion.
 */
export const recordNamer = async (
  workspace: Workspace,
  listed: readonly ListedRecords[],
): Promise<RecordNamer> => {
  const naming = listed.filter(({ records }) => records.some((r) => r.criteria !== undefined));
  if (naming.length === 0) {
    return sameRecord;
  }
  const status = await workspace.get(verificationState);
  // The records of each element, also of one listed twice (evidence.list lists its records and test cases).
  const byElement = new Map<ElementRecord, EvidenceRecord[]>();
  for (const { element, records } of naming) {
    byElement.set(element, [...(byElement.get(element) ?? []), ...records]);
  }
  const versions = await currentVersionsOf(workspace, [...byElement.keys()]);
  const entries = [...byElement].map(([element, records]) => ({
    element,
    records,
    criteria: status.source.criteriaOf(element),
    current: formsOfEntry(versions.get(element)),
  }));
  // The older versions that records name by number and the status lookup has no items for.
  const placeOf = (element: ElementRecord, version: string): string =>
    `${element.repository}\u0000${element.file}\u0000${version}`;
  const wanted = new Map<string, { readonly element: ElementRecord; readonly version: string }>();
  for (const { element, records, criteria, current } of entries) {
    for (const r of records) {
      if (
        r.criteria?.some((ref) => typeof ref === "number") === true &&
        criteria.namedItems(r, current) === undefined
      ) {
        wanted.set(placeOf(element, r.version), { element, version: r.version });
      }
    }
  }
  const fetched = await fetchedItems(workspace, [...wanted.values()]);
  const infos = new Map(entries.map((entry) => [entry.element, entry]));
  return (element, record) => {
    const info = infos.get(element);
    return info === undefined || record.criteria === undefined
      ? record
      : withCriterionNames(record, info.criteria, info.current, {
          get: (version) => fetched.get(placeOf(info.element, version)),
        });
  };
};

/** `test` with the criteria of its records named (`RecordNamer`), its executions and its last one. */
export const withNamedExecutions = <
  T extends { readonly executions: readonly EvidenceRecord[]; readonly last?: EvidenceRecord },
>(
  name: RecordNamer,
  element: ElementRecord,
  test: T,
): T => ({
  ...test,
  executions: test.executions.map((record) => name(element, record)),
  ...(test.last === undefined ? {} : { last: name(element, test.last) }),
});
