// The origin of an imported element (SR-057, D-059, ADR-0013 "Import"): source, source IDENTIFIER,
// import date, delivery and import version, written only by `reqif.import`. Every other command
// refuses to write them (`propertyKeyRefusal`, `element.bulkUpdate`).
//
// The import version (Importfassung) is the version of the element right after the import wrote
// it (D-059, ADR-0013); the planner sets it.
import { CommandError } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { ORIGIN_MEANINGS, meaningUnassigned, propertyWithMeaning } from "../metamodel/index.js";

/** The key of each origin property in the metamodel. */
export type OriginKeys = Readonly<Record<(typeof ORIGIN_MEANINGS)[number], string>>;

/** The value kind each origin meaning needs, always without `many` (`import-version` the metamodel checks, #357). */
const ORIGIN_KINDS: Readonly<Record<(typeof ORIGIN_MEANINGS)[number], string>> = {
  source: "text",
  "source-identifier": "text",
  "import-date": "date",
  delivery: "text",
  "import-version": "text",
};

/**
 * The keys of the origin properties: `metamodel.meaning-unassigned` (SR-013 AK3) for the first
 * origin meaning no property has, `input.invalid` for one whose property cannot hold its value
 * (another kind, or `many`).
 */
export const originKeys = (metamodel: Metamodel): OriginKeys => {
  const keys: Partial<Record<(typeof ORIGIN_MEANINGS)[number], string>> = {};
  for (const meaning of ORIGIN_MEANINGS) {
    const definition = propertyWithMeaning(metamodel, meaning);
    if (definition === undefined) {
      throw meaningUnassigned(meaning, "reqif.import");
    }
    const kind = ORIGIN_KINDS[meaning];
    if (definition.kind !== kind || definition.many === true) {
      throw new CommandError(
        "input.invalid",
        `Not imported: property ${definition.key} has the meaning ${meaning}, which needs kind ${kind} without many`,
        { key: definition.key, meaning, reason: "origin-kind" },
      );
    }
    keys[meaning] = definition.key;
  }
  return keys as OriginKeys;
};

/** The date of `now` on this machine's calendar, as a date property holds it (`YYYY-MM-DD`). */
export const importDate = (now: Date): string =>
  [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
