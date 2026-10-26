// The relations the metamodel allows from a type (SR-067, SR-012, SR-086, D-012): which relation
// kinds an element of a type may get, and which types their targets may have. One rule for
// `relation.options`, which offers them (AK1, AK2), and `relation.add`, which sets them, so the
// tool offers exactly what it accepts.
//
// - A kind is offered when its `source-types` allow the type and its `target-types` allow some type
//   of the metamodel (`allowsType`: an absent list allows every type, an empty one none, a listed
//   type also its subtypes). A kind whose targets allow no type can never be set.
// - Its target types are every type of the metamodel the kind allows, subtypes included, in
//   metamodel order, so a search restricted to them (`{ type: targetTypes }`) finds the same
//   elements with or without `subtypes` (AK2).
// - A type the metamodel does not know gets no kind: LogReq only reads such an element (SR-016 AK3).
import { CommandError } from "../catalog.js";
import type { MetamodelKey, MetamodelRelationKind } from "../generated/types.js";
import type { Metamodel } from "./load.js";
import { allowsType, findType, keyDefinition } from "./lookup.js";

/** A relation kind the metamodel allows from a type, with the types its target may have. */
export interface RelationOption {
  readonly kind: MetamodelRelationKind;
  /** Every type a target may have, subtypes included, in metamodel order; never empty. */
  readonly targetTypes: readonly MetamodelKey[];
}

/** The relation kinds an element of type `typeKey` may get, in metamodel order (see the file comment). */
export const relationOptions = (metamodel: Metamodel, typeKey: MetamodelKey): readonly RelationOption[] => {
  if (findType(metamodel, typeKey) === undefined) {
    return [];
  }
  const options: RelationOption[] = [];
  for (const kind of metamodel.relations) {
    if (!allowsType(kind["source-types"], typeKey, metamodel)) {
      continue;
    }
    const targetTypes = metamodel.effectiveTypes
      .filter((type) => allowsType(kind["target-types"], type.key, metamodel))
      .map((type) => type.key);
    if (targetTypes.length > 0) {
      options.push({ kind, targetTypes });
    }
  }
  return options;
};

/**
 * The relation kind `key` names, for a source of type `typeKey` (`keyDefinition`: a property of the
 * same key wins, as in every check). A property is `input.invalid` with `reason: "property"`; any
 * other key that is no relation kind is `reason: "unknown-relation"` with the kinds
 * `relationOptions` offers the type as `allowed`. Whether the type allows the kind is not checked.
 */
export const relationKindFor = (
  metamodel: Metamodel,
  key: string,
  typeKey: MetamodelKey,
): MetamodelRelationKind => {
  const found = keyDefinition(metamodel, key);
  if (found?.kind === "relation") {
    return found.definition;
  }
  if (found?.kind === "property") {
    throw new CommandError(
      "input.invalid",
      `${key} is a property, not a relation kind; set it with element.update`,
      { kind: key, reason: "property" },
    );
  }
  const allowed = relationOptions(metamodel, typeKey).map((option) => option.kind.key);
  const typeName = findType(metamodel, typeKey)?.name ?? typeKey;
  throw new CommandError(
    "input.invalid",
    `The metamodel has no relation kind ${key}; relation kinds from ${typeName}: ${allowed.length === 0 ? "none" : allowed.join(", ")}`,
    { kind: key, reason: "unknown-relation", allowed },
  );
};
