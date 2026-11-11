// Reference model of the verification degree and of the status filters (#1396): rules D… and F… in README.md.
// Written from the spec and the command contracts only (SR-037, `evidence.degree`, filter conditions), without reading
// the core's degree or filter code. Deliberately naive: it counts the model's entries of one view.
import { type ModelViewId, type ModelWorkspace, type ModelWorkspaceElement, entriesInView } from "./workspace-model.js";
import { type ModelValidationStatus, validationOf } from "./model.js";

export type ModelDegreeStatus = "open" | "verified" | "indirect" | "failed" | "outdated";

export interface ModelDegree {
  readonly total: number;
  readonly counts: Readonly<Record<ModelDegreeStatus, number>>;
  /** (verified + indirect) / total; absent at total 0 (D4). */
  readonly share?: number;
}

// D1, D2, D3, D4 (SR-037 AK1 to AK4): the degree of the requirements of `selection` (element keys) in `view`. Counted
// are requirements whose status is not invalid (AK3) and that have a status in the view (the view rule, W2 to W7);
// each counts once with its status there, indirect apart from verified (AK2). The core view is the view of a selection
// without variant (AK4). The view of a variant with an invalid status is counted like any other: the requirements
// have a status there, only `evidence.status` gives no entry for it (W8, SR-047 AK6) - this model's reading.
export function degreeOf(
  workspace: ModelWorkspace,
  view: ModelViewId,
  selection: ReadonlySet<string>,
): ModelDegree {
  const entries = entriesInView(workspace, view);
  const counts: Record<ModelDegreeStatus, number> = { open: 0, verified: 0, indirect: 0, failed: 0, outdated: 0 };
  let total = 0;
  for (const element of workspace.elements) {
    const entry = entries.get(element.key);
    if (!selection.has(element.key) || element.invalid || entry === undefined) {
      continue;
    }
    counts[entry.status] += 1;
    total += 1;
  }
  return total === 0 ? { total, counts } : { total, counts, share: (counts.verified + counts.indirect) / total };
}

// F1 (filter condition `verification`, SR-069): the elements whose verification status in `view` is one of
// `statuses`. Only requirements in the view have a status there (W2 to W7); a need or a requirement outside the view
// matches no status. The view of an invalid variant is computed as for D1.
export function verificationMatches(
  workspace: ModelWorkspace,
  view: ModelViewId,
  statuses: readonly ModelDegreeStatus[],
): Set<string> {
  const entries = entriesInView(workspace, view);
  return new Set(
    workspace.elements
      .filter((element) => {
        const status = entries.get(element.key)?.status;
        return status !== undefined && statuses.includes(status);
      })
      .map((element) => element.key),
  );
}

// A7 (SR-038 AK1, AK5, the element contract `validation`): the validation status an element shows. Every need has one
// (open without record), a requirement only with a validation record; a requirement without one shows none.
export function shownValidationOf(
  element: ModelWorkspaceElement,
): { readonly status: ModelValidationStatus; readonly reason?: string } | undefined {
  if (element.type === "requirement" && !element.own.records.some((record) => record.kind === "validation")) {
    return undefined;
  }
  return validationOf(element.own);
}

// F2 (filter condition `validation`): the elements whose shown validation status (A7) is one of `statuses`.
export function validationMatches(
  workspace: ModelWorkspace,
  statuses: readonly ModelValidationStatus[],
): Set<string> {
  return new Set(
    workspace.elements
      .filter((element) => {
        const shown = shownValidationOf(element);
        return shown !== undefined && statuses.includes(shown.status);
      })
      .map((element) => element.key),
  );
}
