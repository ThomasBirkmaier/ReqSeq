// Inheritance of types (SR-012): a type that `extends` another one has all its properties and
// required properties (Pflicht-Properties), over any number of levels. A parent that does not
// exist, an inheritance cycle and a type naming an unknown property are metamodel errors with file
// and line, so the workspace opens read-only (SR-011 AK3). Resolution never loops and resolves as
// far as it can, so a read-only workspace still knows its types.
import type { Problem } from "../catalog.js";
import type { MetamodelKey, MetamodelType } from "../generated/types.js";

/** A type with inheritance resolved; everything else as written in its file. */
export interface EffectiveType extends Omit<
  MetamodelType,
  "abstract" | "meaning" | "properties" | "required"
> {
  /** Not inherited: a type is abstract only when its own definition says so. */
  readonly abstract: boolean;
  /** The parent, its parent and so on, up to the root type. */
  readonly ancestors: readonly MetamodelKey[];
  /**
   * All property keys of the type, each once: those of the root type first, then down to the type
   * itself (the key order of new keys in element files, ADR-0004). Required keys count as properties.
   */
  readonly properties: readonly MetamodelKey[];
  /** All required property keys, own and inherited, in the same order. */
  readonly required: readonly MetamodelKey[];
  /** Own meaning, else the meaning of the closest ancestor that has one (metamodel.schema.json). */
  readonly meaning?: NonNullable<MetamodelType["meaning"]>;
}

/** A type definition and where it is written. */
export interface LocatedType {
  readonly definition: MetamodelType;
  /** Relative to the metamodel repository. */
  readonly file: string;
  /** Line of a node of the definition, e.g. `["extends"]` or `["required", "0"]`. */
  readonly lineOf: (segments: readonly string[]) => number | undefined;
}

export interface ResolvedTypes {
  /** In the order of the given types. */
  readonly types: readonly EffectiveType[];
  /** `metamodel.invalid` errors, in type order. */
  readonly problems: readonly Problem[];
}

const error = (type: LocatedType, segments: readonly string[], message: string): Problem => {
  const line = type.lineOf(segments);
  return {
    code: "metamodel.invalid",
    severity: "error",
    message,
    file: type.file,
    ...(line === undefined ? {} : { line }),
  };
};

/**
 * The type, its parent, its parent's parent and so on. Stops at a parent that does not exist or
 * that is already in the chain; `cycle` is true when that parent is the type itself.
 */
const chainOf = (
  start: LocatedType,
  byKey: ReadonlyMap<MetamodelKey, LocatedType>,
): { readonly chain: readonly LocatedType[]; readonly cycle: boolean } => {
  const chain = [start];
  let parentKey = start.definition.extends;
  let parent = parentKey === undefined ? undefined : byKey.get(parentKey);
  while (parent !== undefined && !chain.includes(parent)) {
    chain.push(parent);
    parentKey = parent.definition.extends;
    parent = parentKey === undefined ? undefined : byKey.get(parentKey);
  }
  return { chain, cycle: parent === start };
};

/** The problem of `extends`, if any: a parent that does not exist, or a cycle back to the type. */
const parentProblems = (
  type: LocatedType,
  chain: readonly LocatedType[],
  cycle: boolean,
  byKey: ReadonlyMap<MetamodelKey, LocatedType>,
): Problem[] => {
  const { key, extends: parent } = type.definition;
  if (parent !== undefined && !byKey.has(parent)) {
    return [error(type, ["extends"], `Type ${key} extends unknown type ${parent}`)];
  }
  if (cycle) {
    const path = [...chain, type].map((t) => t.definition.key).join(" -> ");
    return [error(type, ["extends"], `Type ${key} is part of an inheritance cycle: ${path}`)];
  }
  return [];
};

/** A property key in `properties` or `required` that no property definition has. */
const propertyProblems = (type: LocatedType, propertyKeys: ReadonlySet<MetamodelKey>): Problem[] => {
  const { key, properties = [], required = [] } = type.definition;
  const lists = [
    ["properties", properties],
    ["required", required],
  ] as const;
  return lists.flatMap(([list, keys]) =>
    keys.flatMap((property, index) =>
      propertyKeys.has(property)
        ? []
        : [error(type, [list, String(index)], `Type ${key} names unknown property ${property}`)],
    ),
  );
};

const unique = (keys: readonly MetamodelKey[]): MetamodelKey[] => [...new Set(keys)];

/** The effective type of `own`; `chain` starts with the type itself, then its ancestors. */
const effectiveType = (own: MetamodelType, chain: readonly LocatedType[]): EffectiveType => {
  const definitions = chain.map((t) => t.definition);
  const { abstract = false, properties: _properties, required: _required, meaning: _meaning, ...rest } = own;
  const rootFirst = [...definitions].reverse();
  const meaning = definitions.find((d) => d.meaning !== undefined)?.meaning;
  return {
    ...rest,
    ...(meaning === undefined ? {} : { meaning }),
    abstract,
    ancestors: definitions.slice(1).map((d) => d.key),
    properties: unique(rootFirst.flatMap((d) => [...(d.properties ?? []), ...(d.required ?? [])])),
    required: unique(rootFirst.flatMap((d) => d.required ?? [])),
  };
};

/**
 * Resolves the inheritance of all types. `types` have unique keys (the loader keeps only the first
 * definition of a key); `propertyKeys` are the keys of all defined properties.
 */
export const resolveTypes = (
  types: readonly LocatedType[],
  propertyKeys: ReadonlySet<MetamodelKey>,
): ResolvedTypes => {
  const byKey = new Map(types.map((t) => [t.definition.key, t]));
  const problems: Problem[] = [];
  const resolved = types.map((type) => {
    const { chain, cycle } = chainOf(type, byKey);
    // The parent first, then the property lists, as most definitions are written.
    problems.push(...parentProblems(type, chain, cycle, byKey), ...propertyProblems(type, propertyKeys));
    return effectiveType(type.definition, chain);
  });
  return { types: resolved, problems };
};
