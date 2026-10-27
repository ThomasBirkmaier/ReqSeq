// The `data` block (architecture README §5): the data of a state as JSON for external evaluation
// (SR-061; the file of SR-062 later). Core blocks and commands import it relatively; it never
// imports `commands`. Block doc: docs/evidence-views.md "Data export and store".
export {
  exportData,
  exportHeader,
  exportTime,
  exportedElement,
  exportedProperties,
  withRelationVersions,
} from "./export.js";
export type { ExportOptions, ExportedProperties } from "./export.js";
