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
export {
  supersededValidityFindings,
  supersededValidityFindingsOf,
  supersededValidityProblemsState,
} from "./superseded-validity.js";
