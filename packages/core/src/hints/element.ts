// The hints on one element in its view (`element.get`, `element.resolve`, and the element
// `element.create` and `element.update` return) that come from blocks importing the model, which
// the model therefore cannot ask itself (`ElementHints`). SR-026 AK3: "Gegeben ein Element mit
// offenem Hinweis, wenn es angezeigt wird, dann ist der Hinweis am Element sichtbar." The model
// gives the element's own hints (SR-015, SR-016, SR-072 AK2, SR-085, SR-086); these follow:
//
// - the validity entries that name a superseded variant (SR-040 AK3);
// - the cycle of derivations the element lies in (SR-090, `elementCycleFindings`);
// - its outdated evidence (SR-025 AK4, `elementEvidenceFindings`);
// - its outdated relations and inline references (SR-025, `outdatedOfShown`).
//
// So every hint `hint.list` lists for an element is shown at it. Each is computed for this element
// alone unless the whole-workspace state is built already (ADR-0008). The messages of outdated
// relations name the dates of both versions (D-013) only when the caller asks for the version date
// (`versionDate`): without it no git runs, so opening an element stays fast (SR-082 AK3).
// `hint.list` always gives the dates.
import type { ElementHints, LocatableFinding } from "../model/index.js";
import { elementCycleFindings } from "../trace/index.js";
import { supersededValidityFindingsOf } from "../variants/index.js";
import { elementEvidenceFindings } from "./evidence.js";
import { datedProblems, outdatedOfShown } from "./outdated.js";

/** The hints of `record` from the variants, trace and hints blocks, before their lines are known (`ElementHints`). */
export const elementHints: ElementHints = async (context, record, withDate) => {
  const [cycles, evidence, outdated] = await Promise.all([
    elementCycleFindings(context, record),
    elementEvidenceFindings(context, record),
    outdatedOfShown(context, record),
  ]);
  const dated = withDate
    ? await datedProblems(
        context.workspace,
        outdated.map((c) => c.finding),
      )
    : undefined;
  const hints = outdated.map(({ finding, path }, i): LocatableFinding => {
    const problem = dated?.[i] ?? finding.problem;
    // A link has its line in the file just read already; an item's line is looked up by its path.
    return path === undefined
      ? { element: record, path: [], at: "line", problem }
      : { element: record, path, problem };
  });
  return [...supersededValidityFindingsOf(context, record), ...cycles, ...evidence, ...hints];
};
