// The `variants` block (architecture README, D-020): validity and views of the core and the
// variants. Core blocks and commands import it relatively; it is not part of the package's public API.
export {
  appliesIn,
  resolveView,
  validityEntries,
  validityOf,
  validityTarget,
  variantTypes,
  variantsOf,
} from "./views.js";
export type { Validity, ValidityEntry, ValidityTarget, View } from "./views.js";
export { nestedVariantCheck, nestedVariantFindingsOf, nestedVariantsState } from "./nested.js";
export {
  supersededValidityFindings,
  supersededValidityFindingsOf,
  supersededValidityProblemsState,
} from "./superseded-validity.js";
export { isCoreRequirement } from "./core.js";
export {
  targetNotCoreFindingsOf,
  targetNotCoreProblemsOf,
  targetNotCoreProblemsState,
} from "./target-not-core.js";
export {
  removersOf,
  ruleTargetsOf,
  viewIncomplete,
  viewRuleIn,
  viewRuleIndexIn,
  viewRuleIndexOf,
  viewRuleIndexState,
  viewRuleOf,
  viewsInclude,
} from "./view-rule.js";
export type { ViewRule, ViewRuleIndex } from "./view-rule.js";
export { replacedExcludedOf } from "./replaced-excluded.js";
export type { ReplacedExcluded } from "./replaced-excluded.js";
