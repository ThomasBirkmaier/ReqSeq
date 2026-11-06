// Limits on the number of relations (SR-152): a relation kind may set, per target type and
// optionally per source type, how many relations of it one source element may (`max`) or must
// (`min`) have. The checks of the limits when the metamodel is loaded, and `limitsOf`, the limits
// that apply to the elements of each type, which the check of the elements reads
// (`model/relation-limits.ts`), and `minimaOf`, the limits with a `min` of 1 or more, which mark
// the gaps of the traceability matrix (SR-153, `trace/matrix.ts`). Likewise the most entries of a list property (`max-items`,
// SR-171): `maxItemsProblems` and `maxItemsOf` (`model/item-limits.ts`).
import type { Problem } from "../catalog.js";
import type { MetamodelKey, MetamodelProperty, MetamodelRelationKind } from "../generated/types.js";
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
  located: Located<MetamodelRelationKind | MetamodelProperty>,
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
 * second limit written for the same pair of source and target type (errors), a limit without
 * `source-type` that names the same pair as one with it because the kind has one source type (a
 * warning, so the workspace stays writable), a type that is not defined
 * (an error, only when every file was read, `complete`, as ThomasBirkmaier/ReqSeq-archive#157), and a type that does not overlap
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
    const { key, limits = [], "source-types": sources } = located.definition;
    // A limit without `source-type` applies to the kind's source types, so with only one it names
    // the same pair as a limit with that `source-type`.
    const only = sources?.length === 1 ? sources[0] : undefined;
    const written = new Set<string>();
    const pairs = new Set<string>();
    return limits.flatMap((limit, index): Problem[] => {
      const at = ["limits", String(index)];
      const found: Problem[] = [];
      if (limit.min !== undefined && limit.max !== undefined && limit.min > limit.max) {
        const message = `Relation kind ${key} has a limit with min ${String(limit.min)} above max ${String(limit.max)}`;
        found.push(problem(located, "error", [...at, "min"], message));
      }
      const exact = `${limit["source-type"] ?? "*"} ${limit["target-type"]}`;
      const pair = `${limit["source-type"] ?? only ?? "*"} ${limit["target-type"]}`;
      if (written.has(exact)) {
        const message = `Relation kind ${key} has a second limit for the same source and target type; one limit per pair`;
        found.push(problem(located, "error", at, message));
      } else if (pairs.has(pair)) {
        const message = `Relation kind ${key} has two limits that apply to the same source and target type; both are checked`;
        found.push(problem(located, "warning", at, message));
      }
      written.add(exact);
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

/** A limit with a minimum (SR-153): `min` is 1 or more. */
export type RelationMinimum = RelationLimit & { readonly min: number };

/** The minima of each type, by type key and then by relation kind key. */
export type Minima = ReadonlyMap<MetamodelKey, ReadonlyMap<MetamodelKey, readonly RelationMinimum[]>>;

const minimaIndexes = new WeakMap<Metamodel, Minima>();

/**
 * The minima of each type (SR-153): by type key, then by relation kind key, the limits of
 * `limitsOf` with a `min` of 1 or more, in metamodel order (`min: 0` is no minimum). A type without
 * one has no entry. Built once per metamodel object; empty for a metamodel that is not valid.
 */
export const minimaOf = (metamodel: Metamodel): Minima => {
  const known = minimaIndexes.get(metamodel);
  if (known !== undefined) {
    return known;
  }
  const index = new Map<MetamodelKey, Map<MetamodelKey, RelationMinimum[]>>();
  for (const [type, limits] of limitsOf(metamodel)) {
    for (const limit of limits) {
      const { min } = limit;
      if (min === undefined || min < 1) {
        continue;
      }
      const byKey = index.get(type) ?? new Map<MetamodelKey, RelationMinimum[]>();
      index.set(type, byKey);
      const list = byKey.get(limit.key) ?? [];
      byKey.set(limit.key, list);
      list.push({ ...limit, min });
    }
  }
  minimaIndexes.set(metamodel, index);
  return index;
};

/**
 * `max-items` on a property that holds no list (`many` not true) or holds relations (kind
 * `relation`, spec question #808 question 2): an error on the line of `max-items`, as a misplaced
 * `markdown`.
 */
export const maxItemsProblems = (properties: readonly Located<MetamodelProperty>[]): Problem[] =>
  properties.flatMap((located): Problem[] => {
    const { key, kind, many } = located.definition;
    if (located.definition["max-items"] === undefined || (many === true && kind !== "relation")) {
      return [];
    }
    const reason = kind === "relation" ? "kind relation" : "a single value";
    const message = `Property ${key} has max-items, which needs a list (many: true) that holds no relations, not ${reason}`;
    return [problem(located, "error", ["max-items"], message)];
  });

/** The most entries of a list property (SR-171). */
export interface ItemLimit {
  readonly max: number;
  /** How messages name the property: display name and key (D-043). */
  readonly label: string;
}

const itemIndexes = new WeakMap<Metamodel, ReadonlyMap<MetamodelKey, ItemLimit>>();

/**
 * The `max-items` of each property that has one, by key (SR-171). Built once per metamodel
 * object; empty for a metamodel that is not valid, whose limits are not trusted.
 */
export const maxItemsOf = (metamodel: Metamodel): ReadonlyMap<MetamodelKey, ItemLimit> => {
  let index = itemIndexes.get(metamodel);
  if (index === undefined) {
    index = new Map(
      (metamodel.valid ? metamodel.properties : []).flatMap((p) => {
        const max = p["max-items"];
        return max === undefined ? [] : [[p.key, { max, label: `${p.name} (${p.key})` }] as const];
      }),
    );
    itemIndexes.set(metamodel, index);
  }
  return index;
};
