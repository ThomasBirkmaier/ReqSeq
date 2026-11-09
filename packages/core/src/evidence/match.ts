// The findings of the evidence records for `workspace.check` (SR-028 AK3): what reading the evidence
// folders found, and the records matched against the element store.
//
// - The problems of `evidenceReadState`: the walk (`evidence.folder-missing`, `file.skipped`, ...) and
//   the readers (`evidence.invalid-record`, ...). A file problem the element store reports for the
//   same file and line (`file.invalid-yaml` of a Markdown file in an element repository, which the
//   store reads too) is left out, so it shows once.
// - `evidence.unknown-element` (warning) for a record whose element is not in the store: "Gegeben ein
//   Datensatz verweist auf eine ID, die es nicht gibt, wenn er gelesen wird, dann zeigt das Tool
//   einen Hinweis." It names the record's file and line and the UUID as `targetId`, not as
//   `elementId`: there is no such element. It is no confirmable hint (`hint.list`); a corrected
//   record settles it (spec question ThomasBirkmaier/ReqSeq-archive#533 Q2, assumption).
// - `evidence.ambiguous-element` (warning) for a record whose UUID has several copies (SR-088): the
//   record cannot be assigned to one of them. The UUID is its `targetId` too: the problem is about
//   the record, which is no hint (`isHint` of `hint.list` needs an `elementId`).
// - `evidence.kind-mismatch` (warning, #628) for a verification record whose element has one copy of a
//   type without the meaning `requirement` (D-012: a verification names a requirement). Such a record
//   counts for no status, so a JUnit test case naming a need (always a verification, ADR-0012) no
//   longer passes silently. Validation records are not checked: one of any element type counts for
//   its validation status (ThomasBirkmaier/ReqSeq-archive#534 assumption, `hasValidationStatus`). Left out while the metamodel is
//   not valid, since the types then have no meanings.
// - `evidence.unknown-criterion` (warning, SR-028 AK5: „Gegeben ein Datensatz nennt eine Nummer, die
//   es in der genannten Fassung des Requirements nicht als Akzeptanzkriterium gibt, wenn er gelesen
//   wird, dann meldet die Prüfung des Arbeitsbereichs einen Befund.“) for a record whose `criteria`
//   name a number larger than the count of acceptance criteria (the property with the meaning
//   `acceptance-criteria`, `model/acceptance-criteria.ts`) of the version it names. One per record,
//   naming every such number, at the line of the first of them (the `criteria` key, the
//   `reqseq:criterion` property), with the UUID as `targetId`. Only for an element with one copy
//   (SR-088) and a known current version, while the metamodel is valid. A warning, as
//   `evidence.unknown-element`: the record stays readable, only that number counts for nothing
//   (plan of #960, assumption). A type without that property has no criteria, so every number is
//   unknown; such a record counts for the whole requirement (SR-031 AK7, plan of #963 Q2). For the current version the count is that of the element file (`evidenceProblemsState`);
//   for an older one it is that of the commit that started that version, through the walk of the
//   version dates (`model/version-date.ts`), asked per call by `workspace.check`
//   (`olderCriterionProblems`, since Git changes without a file change); without Git, or when Git
//   does not have the version, the record is not checked.
// - The records are those of `evidenceRecordsState` (records injected there are matched too), in
//   their order. Only the kind and criterion checks need the metamodel; the other findings show while
//   it is not valid.
// - A JUnit test case for several views gives one record per view (SR-093 AK5) with the same place
//   and element, so the findings of the records are given once per code, place and target
//   (`distinctFindings`).
import type { Problem } from "../catalog.js";
import { zip } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState, typesWithMeaning } from "../metamodel/index.js";
import type { CurrentVersions, ElementRecord, VersionForms } from "../model/index.js";
import {
  acceptanceCriteriaKeyOf,
  criteriaCount,
  currentFormsOf,
  currentVersionsState,
  elementStoreState,
} from "../model/index.js";
import { versionValues } from "../model/version-date.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { RepositoryLocation } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { EvidenceRecord } from "./record.js";
import { criterionLineOf } from "./record.js";
import { evidenceReadState, evidenceRecordsState } from "./state.js";

/** The store as far as the matching needs it: the copies of each UUID. */
export interface ElementCopies {
  readonly byId: ReadonlyMap<string, readonly unknown[]>;
}

/** What the matching reads of the workspace layout: which repositories are on this machine. */
export interface RepositoriesAvailable {
  readonly repositories: readonly Pick<RepositoryLocation, "name" | "available">[];
}

/** Where a problem lies, to find the same problem twice. */
const placeOf = (problem: Problem): string =>
  JSON.stringify([problem.code, problem.repository, problem.file, problem.line]);

/**
 * `problems` without a repetition of an earlier one of the same code, repository, file, line and
 * target (the records of one test case for several views, SR-093 AK5), in their order.
 */
export const distinctFindings = (problems: readonly Problem[]): Problem[] => {
  const seen = new Set<string>();
  return problems.filter((problem) => {
    const key = JSON.stringify([placeOf(problem), problem.targetId]);
    const first = !seen.has(key);
    seen.add(key);
    return first;
  });
};

/** Where a record lies, for its problems (records injected without a place have none). */
const recordPlace = (record: EvidenceRecord): Pick<Problem, "repository" | "file" | "line"> => ({
  ...(record.repository === undefined ? {} : { repository: record.repository }),
  ...(record.file === undefined ? {} : { file: record.file }),
  ...(record.line === undefined ? {} : { line: record.line }),
});

/** `; it may lie in repository x, which is not on this machine` when repositories are missing. */
const unavailableNote = (layout: RepositoriesAvailable): string => {
  const names = layout.repositories.filter((r) => !r.available).map((r) => r.name);
  if (names.length === 0) {
    return "";
  }
  return names.length === 1
    ? `; it may lie in repository ${names.join("")}, which is not on this machine`
    : `; it may lie in one of the repositories ${names.join(", ")}, which are not on this machine`;
};

/**
 * `evidence.unknown-element` and `evidence.ambiguous-element` of `records` against the copies of
 * each UUID in `store`, in the order of the records (see the file comment).
 */
export const recordElementProblems = (
  records: readonly EvidenceRecord[],
  store: ElementCopies,
  layout: RepositoriesAvailable,
): Problem[] => {
  const problems: Problem[] = [];
  for (const record of records) {
    const copies = store.byId.get(record.element)?.length ?? 0;
    if (copies === 0) {
      problems.push({
        code: "evidence.unknown-element",
        severity: "warning",
        message: `The ${record.kind} record names element ${record.element}, which the workspace does not have${unavailableNote(layout)}`,
        ...recordPlace(record),
        targetId: record.element,
      });
    } else if (copies > 1) {
      problems.push({
        code: "evidence.ambiguous-element",
        severity: "warning",
        message: `The ${record.kind} record names element ${record.element}, which ${String(copies)} files share; it is not assigned to one of them`,
        ...recordPlace(record),
        targetId: record.element,
      });
    }
  }
  return problems;
};

/**
 * `evidence.kind-mismatch` of `records` whose element (one copy in `store`) is of a type their kind
 * cannot name (D-012, see the file comment), in the order of the records.
 */
export const recordKindProblems = (
  records: readonly EvidenceRecord[],
  store: { readonly byId: ReadonlyMap<string, readonly ElementRecord[]> },
  metamodel: Metamodel,
): Problem[] => {
  if (!metamodel.valid) {
    return [];
  }
  const requirements = new Set(typesWithMeaning(metamodel, "requirement").map((t) => t.key));
  const problems: Problem[] = [];
  for (const record of records) {
    if (record.kind !== "verification") {
      continue;
    }
    const [element, ...others] = store.byId.get(record.element) ?? [];
    if (element === undefined || others.length > 0 || requirements.has(element.type)) {
      continue;
    }
    problems.push({
      code: "evidence.kind-mismatch",
      severity: "warning",
      message: `The verification record names element ${record.element} of type ${element.type}, so it counts for no status: a verification record names a requirement (D-012)`,
      ...recordPlace(record),
      targetId: record.element,
      targetRepository: element.repository,
    });
  }
  return problems;
};

/** A record with criteria and the one copy of its element. */
export interface CriteriaTarget {
  readonly record: EvidenceRecord;
  /** The `criteria` of the record. */
  readonly criteria: readonly number[];
  readonly element: ElementRecord;
}

/**
 * The records with `criteria` whose element has one copy in `store` and a known current version,
 * split by whether they name that version (in either normal form, ADR-0005) or an older one; in the
 * order of the records. None while the metamodel is not valid.
 */
export const criteriaTargets = (
  records: readonly EvidenceRecord[],
  store: { readonly byId: ReadonlyMap<string, readonly ElementRecord[]> },
  currentOf: (element: ElementRecord) => VersionForms | undefined,
): { readonly current: CriteriaTarget[]; readonly older: CriteriaTarget[] } => {
  const current: CriteriaTarget[] = [];
  const older: CriteriaTarget[] = [];
  for (const record of records) {
    const { criteria } = record;
    const [element, ...others] = criteria === undefined ? [] : (store.byId.get(record.element) ?? []);
    const forms = element === undefined || others.length > 0 ? undefined : currentOf(element);
    if (criteria === undefined || element === undefined || forms === undefined) {
      continue;
    }
    const isCurrent = record.version === forms.n1 || record.version === forms.n2;
    (isCurrent ? current : older).push({ record, criteria, element });
  }
  return { current, older };
};

/**
 * `evidence.unknown-criterion` of `target` when its record names a number larger than `count`, the
 * acceptance criteria of the version it names (see the file comment); undefined otherwise.
 */
export const unknownCriterionProblem = (
  { record, criteria, element }: CriteriaTarget,
  count: number,
): Problem | undefined => {
  const unknown = criteria.filter((n) => n > count);
  const [first] = unknown;
  if (first === undefined) {
    return undefined;
  }
  const line = criterionLineOf(record, first);
  const numbers = unknown.length === 1 ? `criterion ${String(first)}` : `criteria ${unknown.join(", ")}`;
  return {
    code: "evidence.unknown-criterion",
    severity: "warning",
    // Without criteria the record counts for the whole requirement (SR-031 AK7), else the number counts for none.
    message: `The ${record.kind} record names acceptance ${numbers} of element ${record.element}, whose version ${record.version} has ${String(count)}; ${count === 0 ? "the record counts for the whole requirement" : `${unknown.length === 1 ? "it counts" : "they count"} for no criterion`}`,
    ...recordPlace(record),
    ...(line === undefined ? {} : { line }),
    targetId: record.element,
    targetRepository: element.repository,
  };
};

/** `evidence.unknown-criterion` of each target with the count of criteria of its record's version. */
const criterionProblems = (counted: readonly (readonly [CriteriaTarget, number])[]): Problem[] =>
  counted.flatMap(([target, count]) => {
    const problem = unknownCriterionProblem(target, count);
    return problem === undefined ? [] : [problem];
  });

/** The records with criteria of the workspace and the key of the criteria; undefined when there is nothing to check. */
const criteriaOfWorkspace = async (
  workspace: Workspace,
  metamodel: Metamodel,
  records: readonly EvidenceRecord[],
): Promise<
  { readonly targets: ReturnType<typeof criteriaTargets>; readonly key: string | undefined } | undefined
> => {
  // Nothing to compare: the versions are not built for it.
  if (!metamodel.valid || !records.some((r) => r.criteria !== undefined)) {
    return undefined;
  }
  const store = await workspace.get(elementStoreState);
  const versions: CurrentVersions = await workspace.get(currentVersionsState);
  return {
    targets: criteriaTargets(records, store, (element) => currentFormsOf(versions, element)),
    key: acceptanceCriteriaKeyOf(metamodel),
  };
};

/**
 * `evidence.unknown-criterion` of the records of an older version than their element's current one
 * (see the file comment), counted at the commit that started that version; for `workspace.check`,
 * per call. Nothing where Git cannot tell.
 */
export const olderCriterionProblems = async (workspace: Workspace): Promise<Problem[]> => {
  const metamodel = await workspace.get(metamodelState);
  const found = await criteriaOfWorkspace(workspace, metamodel, await workspace.get(evidenceRecordsState));
  const older = found?.targets.older ?? [];
  if (found === undefined || older.length === 0) {
    return [];
  }
  const layout = await workspace.get(workspaceLayoutState);
  const values = await versionValues(
    { workspace, layout, metamodel },
    older.map(({ record, element }) => ({
      repository: element.repository,
      file: element.file,
      id: element.id,
      version: record.version,
    })),
  );
  return distinctFindings(
    criterionProblems(
      zip(older, values).flatMap(([target, at]): [CriteriaTarget, number][] =>
        at === null ? [] : [[target, criteriaCount(at, found.key)]],
      ),
    ),
  );
};

/** The findings of the evidence records for `workspace.check` (see the file comment). */
export const evidenceProblemsState = defineWorkspaceState(
  "evidence-problems",
  async (workspace): Promise<readonly Problem[]> => {
    const layout = await workspace.get(workspaceLayoutState);
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    const read = await workspace.get(evidenceReadState);
    const records = await workspace.get(evidenceRecordsState);
    const known = new Set(store.problems.map(placeOf));
    const criteria = await criteriaOfWorkspace(workspace, metamodel, records);
    return [
      ...read.problems.filter((p) => !known.has(placeOf(p))),
      ...distinctFindings([
        ...recordElementProblems(records, store, layout),
        ...recordKindProblems(records, store, metamodel),
        ...(criteria === undefined
          ? []
          : criterionProblems(
              criteria.targets.current.map((t) => [t, criteriaCount(t.element.data, criteria.key)] as const),
            )),
      ]),
    ];
  },
  {
    dependsOn: [
      workspaceLayoutState,
      elementStoreState,
      metamodelState,
      evidenceReadState,
      evidenceRecordsState,
      currentVersionsState,
    ],
  },
);
