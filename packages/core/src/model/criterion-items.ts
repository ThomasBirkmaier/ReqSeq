// The items of an acceptance criteria list (D-072, SR-204, ADR-0004): a text without criterion key,
// or a block mapping `{ key, text }` with its criterion key. Pure, without imports, so the app's
// renderer can read the items too (`@reqseq/core/criterion-items`).

/** A criterion as the element file stores it with its criterion key (ADR-0004). */
export interface KeyedCriterion {
  readonly key: string;
  readonly text: string;
}

/** The form of a criterion key (SR-204 AK5): a lower-case letter, then 3 to 15 lower-case letters or digits. */
export const CRITERION_KEY = /^[a-z][a-z0-9]{3,15}$/;

/** Whether `value` is a criterion key in its form (SR-204 AK5). */
export const isCriterionKey = (value: unknown): value is string =>
  typeof value === "string" && CRITERION_KEY.test(value);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Whether `value` is a mapping with a string `text` and no key other than `key` and `text`: a
 * criterion as a caller gives it (`key` optional, of any type) or as a file holds it.
 */
export const isCriterionMapping = (
  value: unknown,
): value is { readonly text: string; readonly key?: unknown } =>
  isRecord(value) &&
  typeof value["text"] === "string" &&
  Object.keys(value).every((k) => k === "key" || k === "text");

/** Whether `value` is a criterion with its key as a file stores it: exactly `key` and `text`, both strings. */
export const isKeyedCriterion = (value: unknown): value is KeyedCriterion =>
  isCriterionMapping(value) && typeof value.key === "string" && Object.keys(value).length === 2;

/** The text of an item: the `text` of a criterion mapping, else the item itself. */
export const criterionText = (item: unknown): unknown => (isCriterionMapping(item) ? item.text : item);

/** The criterion key a file stores for an item (`isKeyedCriterion`), else undefined. */
export const criterionKey = (item: unknown): string | undefined =>
  isKeyedCriterion(item) ? item.key : undefined;

/**
 * A criterion as a message names it (SR-205 AK2): `AK2 (k7f3)` with number and key, `AK2` without
 * key, `AK-k7f3` without number (the key form of a test name, SR-029 AK10).
 */
export const criterionLabel = ({
  criterion,
  key,
}: {
  readonly criterion?: number;
  readonly key?: string;
}): string => {
  if (criterion === undefined) {
    return `AK-${key ?? ""}`;
  }
  return key === undefined ? `AK${String(criterion)}` : `AK${String(criterion)} (${key})`;
};
