// Whether a verification record of an element for a view would count there: the view must hold it by
// the view rule (`viewRuleOf`, as the views decide it), so an element of a type without the validity
// property counts in every view (SR-043 AK10). Out of the view, it does not apply there (SR-040), or
// the variant excludes or replaces it (SR-047 AK4). `evidence.record` refuses such a record for a
// variant, `evidence.enrichJunit` such a test case for a variant or the core (SR-029 AK9); both name
// the element and the view by short ID.
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
  const rule = viewRuleOf(context, view);
  if (rule.includes(element)) {
    return undefined;
  }
  const variant = view.kind === "core" ? "core" : shortIds.of(view.variant);
  // Out of the core view, or out of a variant's by its validity (the type has the validity property).
  if (view.kind === "core" || !appliesIn(validityOf(context.metamodel), element, view)) {
    return {
      reason: "not-valid-in-variant",
      why: `does not apply in ${variant}, so a record for it there would count nowhere (SR-040)`,
    };
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
