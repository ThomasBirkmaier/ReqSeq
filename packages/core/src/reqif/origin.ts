// The origin of an imported element (SR-057, D-059, ADR-0013 "Import"): source, source IDENTIFIER,
// import date, delivery and import version, written only by `reqif.import`. Every other command
// refuses to write them (`propertyKeyRefusal`, `element.bulkUpdate`).
//
// The import version is `importVersion` of the model (model/import-version.ts).
import type { Metamodel } from "../metamodel/index.js";
import { ORIGIN_MEANINGS, meaningUnassigned } from "../metamodel/index.js";

/** The key of each origin property in the metamodel. */
export type OriginKeys = Readonly<Record<(typeof ORIGIN_MEANINGS)[number], string>>;

/**
 * The keys of the origin properties; `metamodel.meaning-unassigned` (SR-013 AK3) for the first
 * origin meaning no property has.
 */
export const originKeys = (metamodel: Metamodel): OriginKeys => {
  const keys: Partial<Record<(typeof ORIGIN_MEANINGS)[number], string>> = {};
  for (const meaning of ORIGIN_MEANINGS) {
    const [key] = metamodel.meanings[meaning];
    if (key === undefined) {
      throw meaningUnassigned(meaning, "reqif.import");
    }
    keys[meaning] = key;
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
