// What changed in an element between two of its texts, field by field (SR-232 AK7: the HTML export's difference of
// an element since a baseline, whose old text Git holds, `filesAtCommit`). Pure:
//
// - Text: the old and the new text when they differ in the normal form of the version (`normalizeText`, D-027).
// - Acceptance criteria (the property with the meaning `acceptance-criteria`): matched by criterion key; a criterion
//   without key in one of the texts by its number, unless the other one's key is in the old text (a key given later
//   to the same criterion, D-072); a criterion whose text differs (normal form) has its old and new
//   wording, one only in the old text is removed, one only in the new text added. The key itself never counts
//   (SR-091 AK6).
// - Properties: each property of the element's type that counts to the version (`content`, D-057), other than the
//   acceptance criteria and relation properties, whose value differs (strings in normal form; absent, `null` and an
//   empty list alike, as ADR-0005 writes them).
// - Relations: the targets of every relation kind and relation property, by kind, UUID and stored repository; the
//   stored version and title of a target never count, so a target that only got a newer version is no difference.
import type { Metamodel } from "../metamodel/index.js";
import { findType, keyDefinition } from "../metamodel/index.js";
import { normalizeText } from "../version/version.js";
import { acceptanceCriteriaKeyOf, criteriaItemsOf } from "./acceptance-criteria.js";
import { criterionKey, criterionText } from "./criterion-items.js";
import { relationKeysOf } from "./incoming.js";
import { hasId, relationItems } from "./relation-keys.js";
import { versionDefinitions } from "./loaded-version.js";

/** An element's values and text, as one of its files holds them. */
export interface ElementContent {
  readonly type: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly text: string;
}

/** A value before and after; undefined where it is absent. */
export interface Changed<T> {
  readonly before: T | undefined;
  readonly after: T | undefined;
}

/** One acceptance criterion that changed: its number then and now, and its key, where it has them. */
export interface ChangedCriterion extends Changed<string> {
  readonly key?: string;
  readonly numberBefore?: number;
  readonly numberAfter?: number;
}

/** One relation target that was added or removed. */
export interface ChangedRelation {
  /** The relation kind or relation property key. */
  readonly kind: string;
  readonly id: string;
  readonly repository?: string;
  /** The title the entry stores, where it stores one. */
  readonly title?: string;
}

/** The field difference of an element (see the file comment); empty lists where nothing changed. */
export interface FieldDifference {
  readonly text?: Changed<string>;
  readonly criteria: readonly ChangedCriterion[];
  readonly properties: readonly (Changed<string> & { readonly key: string })[];
  readonly addedRelations: readonly ChangedRelation[];
  readonly removedRelations: readonly ChangedRelation[];
}

const isAbsent = (value: unknown): boolean =>
  value === undefined || value === null || (Array.isArray(value) && value.length === 0);

/** A value in the form it is compared in: strings normalised, object keys sorted. */
const comparable = (value: unknown): unknown => {
  if (typeof value === "string") {
    return normalizeText(value);
  }
  if (Array.isArray(value)) {
    return value.map(comparable);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, comparable(v)]),
    );
  }
  return value;
};

const same = (a: unknown, b: unknown): boolean =>
  (isAbsent(a) && isAbsent(b)) || JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));

/** A single value as the page shows it: a string as written, anything else as JSON. */
const one = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/** A value as the page shows it: a list one item per line after `- `; undefined when absent. */
const shown = (value: unknown): string | undefined =>
  isAbsent(value)
    ? undefined
    : Array.isArray(value)
      ? value.map((item) => `- ${one(item)}`).join("\n")
      : one(value);

/** The criteria of `data` with their numbers (from 1), keys and texts. */
const criteriaOf = (data: ElementContent["data"], key: string | undefined) =>
  criteriaItemsOf(data, key).map((item, index) => ({
    number: index + 1,
    key: criterionKey(item),
    text: criterionText(item),
  }));

type Criterion = ReturnType<typeof criteriaOf>[number];

/** The changed criteria (see the file comment). */
const criteriaDifference = (
  before: readonly Criterion[],
  after: readonly Criterion[],
): ChangedCriterion[] => {
  const keys = new Set(before.flatMap((c) => (c.key === undefined ? [] : [c.key])));
  const matched = new Set<Criterion>();
  // By key; else the criterion of the same number, when one of the two has no key and the other's key is not in
  // the old text (a key given later, D-072).
  const match = (old: Criterion): Criterion | undefined =>
    after.find((now) => old.key !== undefined && now.key === old.key) ??
    after.find(
      (now) =>
        now.number === old.number &&
        !matched.has(now) &&
        (old.key === undefined ? now.key === undefined || !keys.has(now.key) : now.key === undefined),
    );
  const changed: ChangedCriterion[] = [];
  for (const old of before) {
    const now = match(old);
    if (now !== undefined) {
      matched.add(now);
    }
    if (now === undefined || !same(old.text, now.text)) {
      const key = old.key ?? now?.key;
      changed.push({
        ...(key === undefined ? {} : { key }),
        numberBefore: old.number,
        ...(now === undefined ? {} : { numberAfter: now.number }),
        before: shown(old.text),
        after: now === undefined ? undefined : shown(now.text),
      });
    }
  }
  for (const now of after.filter((c) => !matched.has(c))) {
    changed.push({
      ...(now.key === undefined ? {} : { key: now.key }),
      numberAfter: now.number,
      before: undefined,
      after: shown(now.text),
    });
  }
  return changed;
};

/** The relation targets of `data`, each by kind, UUID and stored repository. */
const relationsOf = (metamodel: Metamodel, data: ElementContent["data"]): Map<string, ChangedRelation> => {
  const targets = new Map<string, ChangedRelation>();
  for (const [key, relation] of relationKeysOf(metamodel)) {
    for (const [, item] of relationItems(key, relation, data[key])) {
      if (hasId(item)) {
        const repository = typeof item["repository"] === "string" ? item["repository"] : undefined;
        const title = typeof item["title"] === "string" ? item["title"] : undefined;
        targets.set(`${key}\0${item.id}\0${String(repository)}`, {
          kind: key,
          id: item.id,
          ...(repository === undefined ? {} : { repository }),
          ...(title === undefined ? {} : { title }),
        });
      }
    }
  }
  return targets;
};

/** The field difference from `before` to `after`, both of the element's current type (see the file comment). */
export const fieldDifference = (
  metamodel: Metamodel,
  before: ElementContent,
  after: ElementContent,
): FieldDifference => {
  const criteriaKey = acceptanceCriteriaKeyOf(metamodel);
  const properties = versionDefinitions({ type: after.type }, metamodel)
    .filter((d) => d.content === true && d.kind !== "relation" && d.key !== criteriaKey)
    .filter((d) => !same(before.data[d.key], after.data[d.key]))
    .map((d) => ({ key: d.key, before: shown(before.data[d.key]), after: shown(after.data[d.key]) }));
  const old = relationsOf(metamodel, before.data);
  const now = relationsOf(metamodel, after.data);
  return {
    ...(normalizeText(before.text) === normalizeText(after.text)
      ? {}
      : { text: { before: before.text, after: after.text } }),
    criteria:
      criteriaKey !== undefined && findType(metamodel, after.type)?.properties.includes(criteriaKey) === true
        ? criteriaDifference(criteriaOf(before.data, criteriaKey), criteriaOf(after.data, criteriaKey))
        : [],
    properties,
    addedRelations: [...now].filter(([key]) => !old.has(key)).map(([, r]) => r),
    removedRelations: [...old].filter(([key]) => !now.has(key)).map(([, r]) => r),
  };
};

/** The name of the property or relation kind `key` as the metamodel gives it, else the key. */
export const fieldName = (metamodel: Metamodel, key: string): string => {
  const found = keyDefinition(metamodel, key);
  return found?.definition.name ?? key;
};
