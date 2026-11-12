// The evidence columns of the traceability matrix (SR-126, D-026, ADR-0012): „Das Tool muss in der
// Traceability-Matrix einer Auswahl zu jedem Requirement seine Testfälle mit dem Ergebnis der letzten
// Durchführung und seinen Nachweisstatus zeigen.“ `trace.matrix` builds them for the rows of the page
// only, through the seam `matrixRows(…, rowFields)` of the trace block, which imports no evidence.
//
// - When (assumption, spec question ThomasBirkmaier/ReqSeq-archive#593 Q1, `showsEvidence`): the workspace file names an evidence
//   location, the metamodel is valid (otherwise records are not compared, as in `verificationState`)
//   and the selection holds a requirement. Otherwise nothing is read and the output is SR-125's.
// - One view (ThomasBirkmaier/ReqSeq-archive#593, ThomasBirkmaier/ReqSeq-archive#592 Q1): the caller's, the first of `Selected.views`, else the core, as
//   `evidence.degree`. Status, test cases and the degree are given for it; element.get and
//   evidence.status give every view.
// - Test cases (AK1): `verificationTestCasesIn`, so the matrix shows the test cases the chain shows
//   in the same view. Records without a test case count only for the status (ThomasBirkmaier/ReqSeq-archive#528 Q3). Each item is
//   compact: name, class name, `executed`, the last execution (`last`, the newest in the view, of any
//   version; of several equally new ones the worst, a failed one, AK1: „bei mehreren gleich neuen
//   die schlechteste“, `worstOfNewest`) and the mark (AK2, `testCaseMark`).
// - The status (AK1, AK3): one entry of `$defs/verificationEntry` from the shared evaluator
//   (`verificationState`), measured against the version the matrix read for the row, as element.get
//   measures against the version it shows; `indirect` for a requirement verified through its children.
// Pure: the index, the status and the view come from the caller.
import type { TraceMatrixOutput } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord, VersionForms } from "../model/index.js";
import { sameVersion } from "../model/index.js";
import type { View } from "../variants/index.js";
import type { EvidenceIndex } from "./by-element.js";
import { instantOf } from "./by-element.js";
import { viewIdOf } from "./degree.js";
import { withEvidenceSource } from "./evidence-source.js";
import type { EvidenceRecord, TestCase } from "./record.js";
import type { StatusSource } from "./status.js";
import type { WorkspaceStatus } from "./verification.js";
import { entryOf } from "./verification.js";
import { verificationTestCasesIn } from "./views.js";

type MatrixRow = TraceMatrixOutput["rows"][number];

/** The evidence fields of a matrix row (`trace.matrix` `rows[].testCases`, `rows[].verification`). */
export type MatrixRowEvidence = Pick<MatrixRow, "testCases" | "verification">;

/** A test case in the test case cell of a matrix row. */
export type MatrixTestCase = NonNullable<MatrixRow["testCases"]>[number];

/** How a test case in the matrix is marked (SR-126 AK2). */
export type MatrixTestCaseMark = NonNullable<MatrixTestCase["mark"]>;

/**
 * Of the `executions` that `counts` takes (newest first, as a test case holds them), the newest; of
 * several at the same instant the first failed one, else the first (SR-126 AK1). Undefined for none.
 * Stops at the first older instant, without a copy (N-036).
 */
const worstOfNewest = (
  executions: readonly EvidenceRecord[],
  counts: (execution: EvidenceRecord) => boolean = () => true,
): EvidenceRecord | undefined => {
  let first: EvidenceRecord | undefined;
  let newest = 0;
  for (const execution of executions) {
    if (!counts(execution)) {
      continue;
    }
    if (first === undefined) {
      first = execution;
      newest = instantOf(execution.date);
    } else if (instantOf(execution.date) !== newest) {
      break;
    }
    if (execution.result === "failed") {
      return execution;
    }
  }
  return first;
};

/**
 * The mark of `test` for an element whose current version is `current` (assumptions, spec questions
 * ThomasBirkmaier/ReqSeq-archive#528 Q1, Q2 and ThomasBirkmaier/ReqSeq-archive#593 Q2), the first that holds: `not-executed` without an execution; `outdated`
 * when no execution is of the current version, or the current version is not known (ThomasBirkmaier/ReqSeq-archive#276), the
 * version test of `recordStatusOf`; `failed` when the newest execution of the current version failed.
 * Undefined when it passed. A newer execution of an older version does not mark the test case
 * outdated, as the status then follows the current one (#201:
 * the mark follows the status). Executions of the current version at one instant may tie: a failed
 * one among them marks it `failed`, as the status counts it (ThomasBirkmaier/ReqSeq-archive#525 Q2,
 * SR-126 AK1).
 */
export const testCaseMark = (
  test: TestCase,
  current: VersionForms | undefined,
): MatrixTestCaseMark | undefined => {
  if (test.last === undefined) {
    return "not-executed";
  }
  const ofCurrent =
    current === undefined
      ? undefined
      : worstOfNewest(test.executions, (e) => sameVersion(e.version, current));
  if (ofCurrent === undefined) {
    return "outdated";
  }
  return ofCurrent.result === "failed" ? "failed" : undefined;
};

/**
 * The test case cell of the element `id` in `view` (see the file comment): its test cases with their
 * verification executions in the view, by class name then name, each with its last execution and
 * mark; an empty array when it has none (a gap, AK2). `independent`: the element's repository is
 * marked `variant-independent` (SR-173).
 */
export const matrixTestCases = (
  index: EvidenceIndex,
  id: string,
  view: View,
  independent: boolean,
  current: VersionForms | undefined,
): MatrixTestCase[] =>
  verificationTestCasesIn(index, id, view, independent).map((test): MatrixTestCase => {
    const mark = testCaseMark(test, current);
    const last = worstOfNewest(test.executions);
    return {
      name: test.name,
      ...(test.className === undefined ? {} : { className: test.className }),
      executed: test.executed,
      ...(last === undefined ? {} : { last: withEvidenceSource(last) }),
      ...(mark === undefined ? {} : { mark }),
    };
  });

/**
 * Whether the matrix of `elements` shows the evidence columns (assumption, spec question ThomasBirkmaier/ReqSeq-archive#593 Q1):
 * the workspace file names an evidence location, the metamodel is valid and an element of the
 * selection is of a type with the meaning `requirement` (own or inherited).
 */
export const showsEvidence = (
  layout: { readonly file: { readonly evidence?: readonly unknown[] } },
  metamodel: Metamodel,
  elements: readonly ElementRecord[],
): boolean => {
  if ((layout.file.evidence ?? []).length === 0 || !metamodel.valid) {
    return false;
  }
  const requirements = new Set(typesWithMeaning(metamodel, "requirement").map((t) => t.key));
  return elements.some((element) => requirements.has(element.type));
};

/** What the evidence columns read: the shared status (prepared for the rows), the evidence index and the view. */
export interface MatrixEvidenceInput {
  readonly status: Pick<WorkspaceStatus, "evaluate"> & { readonly source: Pick<StatusSource, "independent"> };
  readonly index: EvidenceIndex;
  readonly view: View;
}

const NONE: MatrixRowEvidence = Object.freeze({});

/**
 * The evidence fields of a matrix row (the `rowFields` of `matrixRows`), for `element` whose current
 * version the matrix read as `current`: for a requirement that applies in the view its test cases
 * and its one status entry; nothing for any other row (not applicable, no gap). The caller has
 * prepared `status` for the rows (`prepare`).
 */
export const matrixEvidence =
  ({ status, index, view }: MatrixEvidenceInput) =>
  (element: ElementRecord, current: VersionForms | undefined): MatrixRowEvidence => {
    const result = status.evaluate(element, view, { current });
    if (result === undefined) {
      return NONE;
    }
    return {
      testCases: matrixTestCases(index, element.id, view, status.source.independent(element), current),
      verification: [entryOf(viewIdOf(view), result)],
    };
  };
