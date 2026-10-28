// The verification degree (Nachweisgrad, SR-037, ADR-0012 "Status rules", bullet "Verification degree"):
// „Das Tool muss für eine Auswahl von Requirements den Nachweisgrad als Anteil und als Anzahl je
// Nachweisstatus berechnen.“ A derived view of the verification status; it never reads the element's
// `status` beyond the invalid flag and never changes it (D-030).
//
// 1. One degree per call, in one view: the selection's own view, else its saved filter's, else the core
//    (as the filter condition `verification` and `evidence.coverage` take it; assumption, spec question
//    #592 Q1). The output names it (`viewIdOf`).
// 2. Counted are the elements of the selection whose type has the meaning `requirement` (own or
//    inherited), whose status the metamodel does not mark invalid (AK3, D-044) and that have a
//    verification status in the view (they apply in it). Needs, packages and other types count nowhere;
//    without a view, a requirement valid only in a variant is not counted (#592 Q1, Q2).
// 3. The status of each is the one of the shared evaluator (`verificationState`, SR-031, SR-034), the
//    same that evidence.status, element.get, element.resolve and the filter give; no rule of its own.
// 4. One count per verification status, all five always given, in the order of
//    `common.verificationStatus`; they add up to `total`. `indirect` is apart from `verified` (AK2).
// 5. `share = (verified + indirect) / total` (AK1, AK2): failed, outdated and open are in the
//    denominator. Left out when nothing is counted (#592 Q3); never rounded here. How it is shown (one
//    decimal, rounded down) is `degree-text.ts`.
// 6. While the metamodel is not valid the records are not compared: every counted requirement is open.
// SR-126 (the degree above the matrix) calls `degreeOf` after its own `prepare(elements, { own: true })`.
// Cost: one pass over the selection, one evaluation per counted requirement (memoised per view), at most
// one batch of current versions per state (none after the filter or an earlier degree); output O(1).
import type { DataExportVerificationDegree, VerificationStatus } from "../generated/types.js";
import type { ElementRecord } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { View } from "../variants/index.js";
import type { StatusSource } from "./status.js";
import type { WorkspaceStatus } from "./verification.js";
import { verificationState } from "./verification.js";

/** The verification degree of a selection in one view (`data-export.schema.json#/$defs/verificationDegree`). */
export type VerificationDegree = DataExportVerificationDegree;

/** Whether `element` may count (rule 2 without the view): a requirement whose status is not marked invalid. */
const mayCount = (source: Pick<StatusSource, "requirements" | "invalid">, element: ElementRecord): boolean =>
  source.requirements.has(element.type) && !source.invalid.has(String(element.data["status"]));

/**
 * The elements of `elements` that may count (rule 2 without the view), in their order: the ones to
 * `prepare` before `degreeOf`.
 */
export const countedIn = (
  source: Pick<StatusSource, "requirements" | "invalid">,
  elements: readonly ElementRecord[],
): ElementRecord[] => elements.filter((element) => mayCount(source, element));

/**
 * The verification degree of `elements` in `view` (see the file comment). Pure and synchronous: the
 * caller has run `status.prepare(elements, { own: true })` before, else an own record is measured
 * against no version and reads `outdated`.
 */
export const degreeOf = (
  status: Pick<WorkspaceStatus, "source" | "evaluate">,
  elements: readonly ElementRecord[],
  view: View,
): VerificationDegree => {
  const counts: Record<VerificationStatus, number> = {
    open: 0,
    verified: 0,
    indirect: 0,
    failed: 0,
    outdated: 0,
  };
  let total = 0;
  for (const element of elements) {
    const result = mayCount(status.source, element) ? status.evaluate(element, view) : undefined;
    if (result !== undefined) {
      counts[result.status] += 1;
      total += 1;
    }
  }
  return { ...(total === 0 ? {} : { share: (counts.verified + counts.indirect) / total }), total, counts };
};

/** A view as outputs name it (`common.schema.json#/$defs/viewId`): `core` or the variant's UUID. */
export const viewIdOf = (view: View): string => (view.kind === "core" ? "core" : view.variant.id);

/**
 * The verification degree of `elements` in `view` on the shared `verificationState`: it reads the
 * versions the counted requirements need and were not read before (one batch at most), then counts.
 */
export const selectionDegree = async (
  workspace: Workspace,
  elements: readonly ElementRecord[],
  view: View,
): Promise<VerificationDegree> => {
  const status = await workspace.get(verificationState);
  const counted = countedIn(status.source, elements);
  await status.prepare(counted, { own: true });
  return degreeOf(status, counted, view);
};
