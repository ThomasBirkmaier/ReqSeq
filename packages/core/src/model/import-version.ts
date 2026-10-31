// The import version (Importfassung, D-059) of an imported element (SR-057, ADR-0013 "Import"): an
// `n1` hash (ADR-0005) over what the import writes: the title, the text and the mapped properties,
// whether they count to the version or not; a property without a value adds nothing. The origin is
// left out, and the import version never counts to the version (D-057, D-059). This departs from
// D-059's „Fassung des Elements“ (assumption carried in #511, ADR-0013), so that a repeated import
// (SR-056) tells a local change from a changed delivery.
import type { PropertyValue } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import { originMeaning } from "../metamodel/index.js";
import type { VersionValue } from "../version/version.js";
import { computeVersion } from "../version/version.js";

/**
 * The import version of an element with `title`, `text` and `properties` (see the file comment);
 * keys the metamodel does not define add nothing.
 */
export const importVersion = (
  metamodel: Metamodel,
  titleKey: string,
  title: string,
  text: string,
  properties: ReadonlyMap<string, PropertyValue>,
): string => {
  const values: Record<string, VersionValue> = {};
  for (const [key, value] of properties) {
    values[key] = value;
  }
  values[titleKey] = title;
  return computeVersion({
    text,
    properties: values,
    definitions: metamodel.properties
      .filter((p) => Object.hasOwn(values, p.key) && originMeaning(p) === undefined)
      .map((p) => ({ key: p.key, kind: p.kind, content: true })),
    files: [],
  });
};
