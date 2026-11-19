// The fields of a relation kind as metamodel.addRelationKind and metamodel.changeRelationKind take
// them (SR-239 AK1, AK2): the input names them in camel case, the metamodel file in kebab case.
import { isDeepStrictEqual } from "node:util";
import { CommandError } from "../catalog.js";
import type { MetamodelRelationKind } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";

/** Input field and file field of each changeable field, in the order a new definition has them. */
export const RELATION_KIND_FIELDS = [
  ["name", "name"],
  ["description", "description"],
  ["inverseName", "inverse-name"],
  ["sourceTypes", "source-types"],
  ["targetTypes", "target-types"],
  ["limits", "limits"],
  ["meaning", "meaning"],
] as const;

export type RelationKindField = (typeof RELATION_KIND_FIELDS)[number][1];

/** The input fields, each optional; null removes the field (metamodel.changeRelationKind). */
export type RelationKindInput = Readonly<Partial<Record<(typeof RELATION_KIND_FIELDS)[number][0], unknown>>>;

/**
 * The file fields `input` gives, in the order of `RELATION_KIND_FIELDS`, with their values; a null
 * value stays null, which removes the line.
 */
export const givenFields = (input: RelationKindInput): readonly (readonly [RelationKindField, unknown])[] =>
  RELATION_KIND_FIELDS.filter(([field]) => input[field] !== undefined).map(([field, written]) => [
    written,
    input[field],
  ]);

/** Whether `definition` holds `value` under `field` already (absent counts as null). */
export const hasValue = (
  definition: MetamodelRelationKind,
  field: RelationKindField,
  value: unknown,
): boolean => isDeepStrictEqual(definition[field] ?? null, value);

/**
 * Refuses a name another relation kind than `own` has (SR-236 AK2), compared in Unicode normal form
 * NFC, as the key is made from it (SR-236 AK6).
 */
export const refuseTakenName = (metamodel: Metamodel, name: string | undefined, own?: string): void => {
  if (name === undefined) {
    return;
  }
  const other = metamodel.relations.find(
    (r) => r.key !== own && r.name.normalize("NFC") === name.normalize("NFC"),
  );
  if (other !== undefined) {
    throw new CommandError("input.invalid", `Relation kind ${other.key} already has the name ${name}`, {
      reason: "taken",
      field: "name",
      relationKind: other.key,
    });
  }
};

/** Refuses an unknown relation kind `key`. */
export const unknownRelationKind = (key: string): CommandError =>
  new CommandError(
    "input.invalid",
    `Unknown relation kind ${key}: the metamodel has no relation kind with this key`,
    {
      reason: "unknown",
      relationKind: key,
    },
  );
