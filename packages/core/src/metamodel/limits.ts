// Limits on the number of relations (SR-152): a relation kind may set, per target type and
// optionally per source type, how many relations of it one source element may (`max`) or must
// (`min`) have. The checks of the limits when the metamodel is loaded, and `limitsOf`, the limits
// that apply to the elements of each type, which the check of the elements reads
// (`model/relation-limits.ts`).
import type { Problem } from "../catalog.js";
import type { MetamodelKey, MetamodelRelationKind } from "../generated/types.js";
import type { EffectiveType, Located } from "./inheritance.js";
import type { Metamodel } from "./load.js";
import { allowsType } from "./lookup.js";

/** One limit as it applies to the elements of a type. */
export interface RelationLimit {
  /** The relation kind's key. */
  readonly key: MetamodelKey;
  /** How messages name the kind: display name and key (D-043). */
  readonly label: string;
  readonly targetType: MetamodelKey;
  /** The display name of the target type. */
  readonly targetName: string;
  readonly min?: number;
  readonly max?: number;
}

const problem = (
  located: Located<MetamodelRelationKind>,
  severity: Problem["severity"],
  segments: readonly string[],
  message: string,
): Problem => {
  const line = located.lineOf(segments);
  return {
    code: "metamodel.invalid",
    severity,
    message,
    file: located.file,
    ...(line === undefined ? {} : { line }),
  };
};

type Side = "source-type" | "target-type";

/**
 * The problems of the limits of every relation kind, in metamodel order: `min` above `max`, a
 * second limit for the same pair of source and target type (errors), a type that is not defined
 * (an error, only when every file was read, `complete`, as #157), and a type that does not overlap
 * the kind's `source-types`/`target-types` (a warning: a type overlaps a list when it or one of
 * its subtypes is allowed, so an abstract parent of an allowed type counts).
 */
export const limitProblems = (
  relations: readonly Located<MetamodelRelationKind>[],
  types: readonly EffectiveType[],
  complete: boolean,
): Problem[] => {
  const ancestors = new Map(types.map((t) => [t.key, t.ancestors]));
  const within = (type: MetamodelKey, parent: MetamodelKey): boolean =>
    type === parent || ancestors.get(type)?.includes(parent) === true;
  return relations.flatMap((located) => {
    const { key, limits = [] } = located.definition;
    const pairs = new Set<string>();
    return limits.flatMap((limit, index): Problem[] => {
      const at = ["limits", String(index)];
      const found: Problem[] = [];
      if (limit.min !== undefined && limit.max !== undefined && limit.min > limit.max) {
        const message = `Relation kind ${key} has a limit with min ${String(limit.min)} above max ${String(limit.max)}`;
        found.push(problem(located, "error", [...at, "min"], message));
      }
      const pair = `${limit["source-type"] ?? ""} ${limit["target-type"]}`;
      if (pairs.has(pair)) {
        const message = `Relation kind ${key} has a second limit for the same source and target type; one limit per pair`;
        found.push(problem(located, "error", at, message));
      }
      pairs.add(pair);
      for (const side of ["source-type", "target-type"] as const satisfies readonly Side[]) {
        const type = limit[side];
        const list = located.definition[`${side}s`];
        if (type === undefined) {
          continue;
        }
        if (!ancestors.has(type)) {
          if (complete) {
            found.push(
              problem(
                located,
                "error",
                [...at, side],
                `Relation kind ${key} names unknown type ${type} in limits`,
              ),
            );
          }
        } else if (
          list !== undefined &&
          !list.some((allowed) => within(type, allowed) || within(allowed, type))
        ) {
          const message = `Relation kind ${key} has a limit for ${side} ${type}, which its ${side}s (${list.join(", ")}) do not allow`;
          found.push(problem(located, "warning", [...at, side], message));
        }
      }
      return found;
    });
  });
};

/** One index per metamodel object; a reset of the metamodel state makes a new object. */
const indexes = new WeakMap<Metamodel, ReadonlyMap<MetamodelKey, readonly RelationLimit[]>>();

/**
 * The limits that apply to the elements of each type, by type key, in metamodel order: a limit
 * with a `source-type` applies to that type and its subtypes as far as the kind's `source-types`
 * allow them as sources, one without to the kind's
 * `source-types` (and their subtypes), or to every type when the kind has none. Every limit that
 * applies is checked on its own. Built once per metamodel object; empty for a metamodel that is not
 * valid, whose limits are not trusted.
 */
export const limitsOf = (metamodel: Metamodel): ReadonlyMap<MetamodelKey, readonly RelationLimit[]> => {
  const known = indexes.get(metamodel);
  if (known !== undefined) {
    return known;
  }
  const index = new Map<MetamodelKey, RelationLimit[]>();
  for (const kind of metamodel.valid ? metamodel.relations : []) {
    for (const limit of kind.limits ?? []) {
      const sources = limit["source-type"] === undefined ? kind["source-types"] : [limit["source-type"]];
      // A valid metamodel defines the target type: its one entry gives the name.
      for (const target of metamodel.effectiveTypes.filter((t) => t.key === limit["target-type"])) {
        // A type the kind does not allow as a source is never a source element of it.
        const applies = (key: MetamodelKey): boolean =>
          allowsType(sources, key, metamodel) && allowsType(kind["source-types"], key, metamodel);
        for (const type of metamodel.effectiveTypes.filter((t) => applies(t.key))) {
          const list = index.get(type.key) ?? [];
          index.set(type.key, list);
          list.push({
            key: kind.key,
            label: `${kind.name} (${kind.key})`,
            targetType: target.key,
            targetName: target.name,
            ...(limit.min === undefined ? {} : { min: limit.min }),
            ...(limit.max === undefined ? {} : { max: limit.max }),
          });
        }
      }
    }
  }
  indexes.set(metamodel, index);
  return index;
};
