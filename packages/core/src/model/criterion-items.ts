// The items of an acceptance criteria list (D-072, SR-204, ADR-0004): a text without criterion key,
// or a block mapping `{ key, text }` with its criterion key. Pure, without imports, so the app's
// renderer can read the items too (`@reqseq/core/criterion-items`). Also the bracket token of a test
// name, `[<ref>/AK-<key>]` (SR-029 AK10, SR-205 AK1, AK5): `criterionReference` writes it, and
// `bracketReference` reads it for enrich-junit (`criterionRefsOf`), element.resolve and the app's
// "Go to", so all of them split it the same way, at the first `/`.

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

/** A reference as a bracket token names it (`bracketReference`). */
export interface BracketReference {
  /** The element reference before the first `/`, trimmed. */
  readonly ref: string;
  /**
   * The criterion it names: a number (1 or more) or a criterion key; absent for a token that names
   * the whole requirement (`[SR-036]`, `[SR-036/slow]`).
   */
  readonly criterion?: number | string;
  /** The token as written when it tries to name a criterion but names none (`[SR-036/AK0]`, `[SR-036/AK]`). */
  readonly malformed?: string;
}

/** `[<ref>]` or `[<ref>/<suffix>]`: the ref has no `[`, `]` or `/`, the suffix no `[` or `]`. */
export const BRACKET_TOKEN = /\[[^[\]/]*(?:\/[^[\]]*)?\]/g;
/**
 * A suffix that tries to name an acceptance criterion: `AK` alone, before a digit or before `-`,
 * ASCII case-insensitive.
 */
const AK_LIKE = /^AK(?:[0-9-]|$)/i;
/** The suffix that names one by number: `AK<n>`, n from 1 without leading zero, at most 9 digits. */
const AK_SUFFIX = /^AK[1-9][0-9]{0,8}$/i;
/** The suffix that names one by key: `AK-<key>` (SR-029 AK10), the key in its form (SR-204 AK5). */
const AK_KEY_SUFFIX = /^AK-[a-z][a-z0-9]{3,15}$/i;

/** The criterion of a suffix that tries to name one (`AK<n>` or `AK-<key>`), else `token` as malformed. */
const suffixCriterion = (
  suffix: string,
  token: string,
): Pick<BracketReference, "criterion" | "malformed"> => {
  if (AK_SUFFIX.test(suffix)) {
    return { criterion: Number(suffix.slice(2)) };
  }
  const key = suffix.slice(3);
  return AK_KEY_SUFFIX.test(suffix) && isCriterionKey(key) ? { criterion: key } : { malformed: token };
};

/**
 * What one bracket token of `BRACKET_TOKEN` (with its brackets) names: the reference before the first
 * `/`, and the criterion of a suffix that tries to name one (`AK<n>`, `AK-<key>`; another form such
 * as `AK0`, `AK02`, `AK`, `AK2a` or `AK-x` is `malformed`). Any other suffix names the whole requirement.
 */
export const bracketReference = (token: string): BracketReference => {
  const inner = token.slice(1, -1);
  const slash = inner.indexOf("/");
  const ref = slash < 0 ? inner : inner.slice(0, slash);
  const suffix = slash < 0 ? "" : inner.slice(slash + 1).trim();
  return { ref: ref.trim(), ...(AK_LIKE.test(suffix) ? suffixCriterion(suffix, token) : {}) };
};

/**
 * `text` as one reference to a criterion (SR-205 AK5): the whole text, trimmed, is one bracket token
 * (`[SR-036/AK-k7f3]`, `[SR-036]`), or a reference and a suffix that tries to name a criterion
 * without brackets (`SR-036/AK-k7f3`). Undefined for any other text, such as a plain reference or an
 * identifier with a `/` whose suffix names no criterion (`SYS/REQ/001`).
 */
export const criterionReferenceOf = (text: string): BracketReference | undefined => {
  const trimmed = text.trim();
  const tokens = trimmed.match(BRACKET_TOKEN);
  if (tokens?.length === 1 && tokens[0] === trimmed) {
    return bracketReference(trimmed);
  }
  const slash = trimmed.indexOf("/");
  if (slash < 0 || /[[\]]/.test(trimmed) || !AK_LIKE.test(trimmed.slice(slash + 1).trim())) {
    return undefined;
  }
  return bracketReference(`[${trimmed}]`);
};

/** The reference of a test name to the criterion `key` of the element named `name` (SR-205 AK1): `[SR-036/AK-k7f3]`. */
export const criterionReference = (name: string, key: string): string => `[${name}/AK-${key}]`;
