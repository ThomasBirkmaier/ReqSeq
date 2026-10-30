// The `data` block (architecture README §5): the data of a state as JSON for external evaluation
// (SR-061) and as a file per state (SR-062). Core blocks and commands import it relatively; it never
// imports `commands`. Block doc: docs/evidence-views.md "Data export and store".
export {
  exportData,
  exportDataWithProblems,
  exportHeader,
  exportTime,
  exportedElement,
  exportedProperties,
  withRelationVersions,
} from "./export.js";
export type { ExportOptions, ExportWithProblems, ExportedProperties } from "./export.js";
export { DATA_LINES, dataFileName, storeData } from "./store.js";
export type { StoreOptions } from "./store.js";
