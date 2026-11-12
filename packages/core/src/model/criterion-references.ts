// The acceptance criteria of a requirement as element.get and element.resolve give them (SR-205 AK1):
// each with its number (its position, from 1, so the numbers have no gaps, AK3), its criterion key,
// its text and the reference a test name uses, `[SR-036/AK-k7f3]`.
//
// The name in the reference is the element's identifier only when the reference leads back to this
// element: read as enrich-junit reads a test name (`bracketReference`, split at the first `/`) and
// resolved as element.resolve resolves it (`resolveRef`). Otherwise, for an identifier with `/`, `[`
// or `]`, a blank one, or one two elements share, it is the short ID. A criterion without key, and
// both criteria that carry one key (SR-204 AK10: a record with that key counts for neither), have no
// reference; a key in another form than SR-204 AK5 allows is shown as none (assumption of spec question #1525).
import type { Metamodel } from "../metamodel/index.js";
import { typesWithMeaning } from "../metamodel/index.js";
import type { DataExportCriterionEntry } from "../generated/types.js";
import { acceptanceCriteriaKeyOf, criteriaItemsOf } from "./acceptance-criteria.js";
import {
  criterionKey,
  criterionReference,
  criterionReferenceOf,
  criterionText,
  isCriterionKey,
} from "./criterion-items.js";
import type { ElementRecord } from "./elements.js";
import { resolveRef } from "./resolve.js";
import type { ShortIds } from "./short-id.js";
import type { ElementStore } from "./store.js";

/** What the references are worked out from. */
export interface CriterionReferenceContext {
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
}

/** The criteria of a requirement with their references, and the property that holds them. */
export interface CriterionReferences {
  /** The key of the property with the meaning `acceptance-criteria`. */
  readonly property: string;
  readonly criteria: readonly DataExportCriterionEntry[];
}

/** A key that stands in for any key when a name is tried out (`readsBack`). */
const PROBE_KEY = "abcd";

/** Whether `name` in a reference resolves to `record` again, read as a test name is (see the file comment). */
const readsBack = (context: CriterionReferenceContext, record: ElementRecord, name: string): boolean => {
  const read = criterionReferenceOf(criterionReference(name, PROBE_KEY));
  if (read?.ref !== name || read.criterion !== PROBE_KEY) {
    return false;
  }
  try {
    const found = resolveRef(context.store, context.shortIds, read.ref);
    return found.id === record.id && found.repository === record.repository && found.file === record.file;
  } catch {
    return false;
  }
};

/**
 * The name the references of `record` use: its identifier where it reads back to `record`, else its
 * short ID (see the file comment).
 */
export const referenceNameOf = (context: CriterionReferenceContext, record: ElementRecord): string => {
  const identifier = context.shortIds.identifierOf(record);
  return identifier !== undefined && identifier !== "" && readsBack(context, record, identifier)
    ? identifier
    : context.shortIds.of(record);
};

/**
 * The criteria `properties` hold for an element of `type` (`record` as the store holds it, for its
 * name), each with number, key, text and reference; undefined for an element whose type does not
 * have the meaning `requirement`, without criteria, or with an item that is no text.
 */
export const criterionReferencesOf = (
  context: CriterionReferenceContext,
  record: ElementRecord,
  type: string,
  properties: Readonly<Record<string, unknown>>,
): CriterionReferences | undefined => {
  const property = acceptanceCriteriaKeyOf(context.metamodel);
  const items = criteriaItemsOf(properties, property);
  if (
    property === undefined ||
    items.length === 0 ||
    !typesWithMeaning(context.metamodel, "requirement").some((t) => t.key === type) ||
    !items.every((item) => typeof criterionText(item) === "string")
  ) {
    return undefined;
  }
  // A key in another form (`element.criterion-key-invalid`) is shown as none: no test name can use it.
  const keys = items.map((item) => {
    const key = criterionKey(item);
    return isCriterionKey(key) ? key : undefined;
  });
  const name = referenceNameOf(context, record);
  return {
    property,
    criteria: items.map((item, i) => {
      const key = keys[i];
      // A key two criteria carry names neither of them (SR-204 AK10).
      const usable = key !== undefined && keys.indexOf(key) === keys.lastIndexOf(key);
      return {
        criterion: i + 1,
        ...(key === undefined ? {} : { key }),
        text: criterionText(item) as string,
        ...(usable ? { reference: criterionReference(name, key) } : {}),
      };
    }),
  };
};
