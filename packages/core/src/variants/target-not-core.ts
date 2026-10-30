// Hints on rule items that name no core requirement (SR-041 AK8, SR-042 AK7): a replacement or an
// exclusion (view-rule.ts) whose target resolves to one element that is not a core requirement
// (`isCoreRequirement`: one with a validity, or of a type without the validity property, such as a
// need or a package) changes no view and gets one hint `variant.target-not-core` (a `warning`) at
// the line of its entry. A target that is missing, ambiguous or in a repository that is not on this
// machine gets none: those are other checks (SR-089, SR-088) or `incomplete` (SR-006). Several
// replacements of one core requirement are no finding (SR-041 AK7).
import type { Problem } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import type { ElementRecord, LocatableFinding, SupersededContext } from "../model/index.js";
import { elementLabel, elementStoreState, locateFindings, shortIdState } from "../model/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { isCoreRequirement } from "./core.js";
import type { RuleItem } from "./view-rule.js";
import { ruleItemsOf, ruleTarget, viewRuleIndexOf } from "./view-rule.js";

/** The hint of `item`, when its target is one element that is no core requirement. */
const findingOf = (context: SupersededContext, item: RuleItem): LocatableFinding[] => {
  const target = ruleTarget(context, item);
  if (target === undefined || isCoreRequirement(context, target)) {
    return [];
  }
  const what = item.meaning === "replacement" ? "replaces" : "excludes";
  const problem: Problem = {
    code: "variant.target-not-core",
    severity: "warning",
    message: `${elementLabel(context, item.source)} ${what} ${elementLabel(context, target)}, which is no core requirement (it has a validity or its type has no validity property); this changes no view`,
    repository: item.source.repository,
    file: item.source.file,
    elementId: item.source.id,
    targetId: target.id,
  };
  return [{ element: item.source, path: item.path, problem }];
};

/** The hints of `source` (an element shown by `element.get`; it need not be the store's copy), before their lines are known. */
export const targetNotCoreFindingsOf = (
  context: SupersededContext,
  source: ElementRecord,
): readonly LocatableFinding[] =>
  ruleItemsOf(context.metamodel, source).flatMap((item) => findingOf(context, item));

/**
 * The hints of `items` (rule items of `workspace`'s current store) with repository, file, line,
 * element and target ID, in item order; none against a metamodel that is not valid, whose errors are
 * the findings (#208, #220). `variant.diff` passes the items that act in one variant.
 */
export const targetNotCoreProblemsOf = async (
  workspace: Workspace,
  items: readonly RuleItem[],
): Promise<readonly Problem[]> => {
  const layout = await workspace.get(workspaceLayoutState);
  const store = await workspace.get(elementStoreState);
  const metamodel = await workspace.get(metamodelState);
  if (!metamodel.valid) {
    return [];
  }
  const context = { store, metamodel, shortIds: await workspace.get(shortIdState) };
  return locateFindings(
    layout,
    items.flatMap((item) => findingOf(context, item)),
  );
};

/**
 * Every such hint of the workspace (`targetNotCoreProblemsOf` of every rule item), for
 * `workspace.check` and `hint.list`, in store order of the sources, then entry order. Kept until
 * the element store or the metamodel is reset.
 */
export const targetNotCoreProblemsState = defineWorkspaceState(
  "target-not-core",
  async (workspace): Promise<readonly Problem[]> => {
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    return targetNotCoreProblemsOf(workspace, viewRuleIndexOf(workspace, store, metamodel).items);
  },
  { dependsOn: [elementStoreState, metamodelState, shortIdState] },
);
