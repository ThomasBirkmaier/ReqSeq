// Whether a verification record of an element for a view would count there (SR-040, SR-047 AK4): the
// element must apply in the view, and in a variant the variant's view rule must hold it (not excluded,
// not replaced). `evidence.record` refuses such a record, `evidence.enrichJunit` such a test case
// (SR-029 AK9); both name the element and the variant by short ID.
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { ResolvedView } from "../variants/index.js";
import { appliesIn, validityOf, viewRuleOf } from "../variants/index.js";

/** Why a record of an element would count nowhere in a view. */
export interface OutOfView {
  readonly reason: "not-valid-in-variant" | "excluded-in-variant" | "replaced-in-variant";
  /** The text after the element's short ID, naming the view by short ID (or `core`). */
  readonly why: string;
  /** The UUIDs of the replacing requirements (`replaced-in-variant` only). */
  readonly replacedBy?: readonly string[];
}

/** What `outOfView` reads. */
export interface ViewContext {
  readonly workspace: Workspace;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
}

/** Why a record of `element` for `view` would count nowhere, or undefined when it counts there. */
export const outOfView = (
  context: ViewContext,
  element: ElementRecord,
  view: ResolvedView,
): OutOfView | undefined => {
  const { shortIds } = context;
  const variant = view.kind === "core" ? "core" : shortIds.of(view.variant);
  if (!appliesIn(validityOf(context.metamodel), element, view)) {
    return {
      reason: "not-valid-in-variant",
      why: `does not apply in ${variant}, so a record for it there would count nowhere (SR-040)`,
    };
  }
  if (view.kind === "core") {
    return undefined;
  }
  const rule = viewRuleOf(context, view);
  if (rule.includes(element)) {
    return undefined;
  }
  // Out of the view though it applies: the variant excludes it, or a requirement replaces it there.
  if (rule.excludes(element)) {
    return {
      reason: "excluded-in-variant",
      why: `is excluded in ${variant}, so a record for it there would count nowhere (SR-047)`,
    };
  }
  const replacements = rule.replacedBy(element);
  const names = replacements.map((r) => shortIds.of(r)).join(", ");
  return {
    reason: "replaced-in-variant",
    why: `is replaced in ${variant} by ${names}, so a record for it there would count nowhere; record ${names} instead (SR-047)`,
    replacedBy: replacements.map((r) => r.id),
  };
};
