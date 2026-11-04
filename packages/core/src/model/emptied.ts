// `element.text-emptied` (warning, #677, #841): a save that empties what was not empty. The save is
// done; an empty value is mostly a broken shell substitution, so the result says so (product owner
// decisions, 2026-11-02: a warning, not a refusal; 2026-11-04: also for a Markdown property and a
// list property, in `element.update` and `element.bulkUpdate`).
import type { Problem } from "../catalog.js";
import type { MetamodelProperty } from "../generated/types.js";
import type { ElementRecord } from "./elements.js";
import { isEmptyValue } from "./required.js";

const RESTORE = "was not empty and is now empty; restore it from Git if this was not intended";

/** The warning for the element text of `record` that the update emptied. */
export const textEmptied = (repository: string, record: ElementRecord): Problem => ({
  code: "element.text-emptied",
  severity: "warning",
  message: `The text of element ${record.id} ${RESTORE}`,
  repository,
  file: record.file,
  elementId: record.id,
});

/**
 * The warning, with `key`, for each of `properties` that is a Markdown property or has `many` (a
 * list) and that held a value in `before` and holds none in `after` (`isEmptyValue`: absent, `null`,
 * a blank string or `[]`), in the order of `properties`. Other properties, such as a plain text or a
 * single choice, are not covered.
 */
export const propertiesEmptied = (
  repository: string,
  before: ElementRecord,
  after: ElementRecord,
  properties: readonly MetamodelProperty[],
): Problem[] =>
  properties.flatMap(({ key, name, markdown, many }) => {
    const covered = markdown === true || many === true;
    if (!covered || isEmptyValue(before.data[key]) || !isEmptyValue(after.data[key])) {
      return [];
    }
    return [
      {
        code: "element.text-emptied",
        severity: "warning",
        message: `Property ${name} (${key}) of element ${before.id} ${RESTORE}`,
        repository,
        file: after.file,
        elementId: before.id,
        key,
      },
    ];
  });
