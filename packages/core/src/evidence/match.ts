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
//   record settles it (spec question #533 Q2, assumption).
// - `evidence.ambiguous-element` (warning) for a record whose UUID has several copies (SR-088): the
//   record cannot be assigned to one of them. The UUID is its `targetId` too: the problem is about
//   the record, which is no hint (`isHint` of `hint.list` needs an `elementId`).
// - `evidence.kind-mismatch` (warning, #628) for a record whose element has one copy of a type its
//   kind cannot name (D-012): a verification names a requirement, a validation a need or a
//   requirement, as `evidence.record` refuses it. Such a record counts for no status, so a JUnit test
//   case naming a need (always a verification, ADR-0012) no longer passes silently. Left out while
//   the metamodel is not valid, since the types then have no meanings.
// - The records are those of `evidenceRecordsState` (records injected there are matched too), in
//   their order. Only the kind check needs the metamodel; the other findings show while it is not
//   valid.
import type { Problem } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { metamodelState, typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import { elementStoreState } from "../model/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { RepositoryLocation } from "../workspace/index.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { EvidenceRecord } from "./record.js";
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
  const keys = (meaning: "requirement" | "need"): Set<string> =>
    new Set(typesWithMeaning(metamodel, meaning).map((t) => t.key));
  const requirements = keys("requirement");
  const needs = keys("need");
  const problems: Problem[] = [];
  for (const record of records) {
    const [element, ...others] = store.byId.get(record.element) ?? [];
    if (element === undefined || others.length > 0 || requirements.has(element.type)) {
      continue;
    }
    if (record.kind === "validation" && needs.has(element.type)) {
      continue;
    }
    problems.push({
      code: "evidence.kind-mismatch",
      severity: "warning",
      message: `The ${record.kind} record names element ${record.element} of type ${element.type}, so it counts for no status: a verification record names a requirement, a validation record a need or a requirement (D-012)`,
      ...recordPlace(record),
      targetId: record.element,
    });
  }
  return problems;
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
    return [
      ...read.problems.filter((p) => !known.has(placeOf(p))),
      ...recordElementProblems(records, store, layout),
      ...recordKindProblems(records, store, metamodel),
    ];
  },
  {
    dependsOn: [
      workspaceLayoutState,
      elementStoreState,
      metamodelState,
      evidenceReadState,
      evidenceRecordsState,
    ],
  },
);
