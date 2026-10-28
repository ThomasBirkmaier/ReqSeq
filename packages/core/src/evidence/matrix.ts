// The evidence columns of the traceability matrix (SR-126, D-026, ADR-0012): „Das Tool muss in der
// Traceability-Matrix einer Auswahl zu jedem Requirement seine Testfälle mit dem Ergebnis der letzten
// Durchführung und seinen Nachweisstatus zeigen.“ `trace.matrix` builds them for the rows of the page
// only, through the seam `matrixRows(…, rowFields)` of the trace block, which imports no evidence.
//
// - When (assumption, spec question #593 Q1, `showsEvidence`): the workspace file names an evidence
//   location, the metamodel is valid (otherwise records are not compared, as in `verificationState`)
//   and the selection holds a requirement. Otherwise nothing is read and the output is SR-125's.
// - One view (#593, #592 Q1): the caller's, the first of `Selected.views`, else the core, as
//   `evidence.degree`. Status, test cases and the degree are given for it; element.get and
//   evidence.status give every view.
// - Test cases (AK1): `verificationTestCasesIn`, so the matrix shows the test cases the chain shows
//   in the same view. Records without a test case count only for the status (#528 Q3). Each item is
//   compact: name, class name, `executed`, the last execution (`last`, the newest in the view, of any
//   version) and the mark (AK2, `testCaseMark`).
// - The status (AK1, AK3): one entry of `$defs/verificationEntry` from the shared evaluator
//   (`verificationState`), measured against the version the matrix read for the row, as element.get
//   measures against the version it shows; `indirect` for a requirement verified through its children.
// Pure: the index, the status and the view come from the caller.
import type { TraceMatrixOutput } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { typesWithMeaning } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
import type { View } from "../variants/index.js";
import type { EvidenceIndex } from "./by-element.js";
import { viewIdOf } from "./degree.js";
import type { TestCase } from "./record.js";
import type { WorkspaceStatus } from "./verification.js";
import { verificationTestCasesIn } from "./views.js";

type MatrixRow = TraceMatrixOutput["rows"][number];

/** The evidence fields of a matrix row (`trace.matrix` `rows[].testCases`, `rows[].verification`). */
export type MatrixRowEvidence = Pick<MatrixRow, "testCases" | "verification">;

/** A test case in the test case cell of a matrix row. */
export type MatrixTestCase = NonNullable<MatrixRow["testCases"]>[number];

/** How a test case in the matrix is marked (SR-126 AK2). */
export type MatrixTestCaseMark = NonNullable<MatrixTestCase["mark"]>;

/**
 * The mark of `test` for an element whose current version is `current` (assumptions, spec questions
 * #528 Q1, Q2 and #593 Q2), the first that holds: `not-executed` without an execution; `outdated`
 * when the last execution is of another version, or the current version is not known (#276), the
 * version test of `recordStatusOf`; `failed` when it failed. Undefined when the last execution passed
 * for the current version. Records of one instant may tie: `last` is the first in index order, while
 * the status counts a failed one among them (#525 Q2).
 */
export const testCaseMark = (test: TestCase, current: string | undefined): MatrixTestCaseMark | undefined => {
  const { last } = test;
  if (last === undefined) {
    return "not-executed";
  }
  if (current === undefined || last.version !== current) {
    return "outdated";
  }
  return last.result === "failed" ? "failed" : undefined;
};

/**
 * The test case cell of the element `id` in `view` (see the file comment): its test cases with their
 * verification executions in the view, by class name then name, each with its last execution and
 * mark; an empty array when it has none (a gap, AK2).
 */
export const matrixTestCases = (
  index: EvidenceIndex,
  id: string,
  view: View,
  current: string | undefined,
): MatrixTestCase[] =>
  verificationTestCasesIn(index, id, view).map((test): MatrixTestCase => {
    const mark = testCaseMark(test, current);
    return {
      name: test.name,
      ...(test.className === undefined ? {} : { className: test.className }),
      executed: test.executed,
      ...(test.last === undefined ? {} : { last: test.last }),
      ...(mark === undefined ? {} : { mark }),
    };
  });

/**
 * Whether the matrix of `elements` shows the evidence columns (assumption, spec question #593 Q1):
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
  readonly status: Pick<WorkspaceStatus, "evaluate">;
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
  (element: ElementRecord, current: string | undefined): MatrixRowEvidence => {
    const result = status.evaluate(element, view, { current });
    if (result === undefined) {
      return NONE;
    }
    const { missingChildren } = result;
    return {
      testCases: matrixTestCases(index, element.id, view, current),
      verification: [
        {
          view: viewIdOf(view),
          status: result.status,
          ...(missingChildren === undefined ? {} : { missingChildren: [...missingChildren] }),
        },
      ],
    };
  };
