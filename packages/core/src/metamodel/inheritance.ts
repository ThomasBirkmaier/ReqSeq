// Inheritance of types (SR-012): a type that `extends` another one has all its properties and
// required properties (Pflicht-Properties), over any number of levels. A parent that does not
// exist and an inheritance cycle are metamodel errors with file and line, so the workspace opens
// read-only (SR-011 AK3). A type naming a property that no definition has is only a warning with
// file and line (#141 c, option 2): the effective type leaves the key out, so an element value under
// it is an unknown property (D-012) and the workspace stays writable. An unknown parent or property
// is reported, and the key left out, only when every metamodel file was read, since a faulty file
// may define it. Resolution never loops and resolves as far as it can, so a read-only workspace
// still knows its types.
import type { Problem } from "../catalog.js";
import type { MetamodelEffectiveType, MetamodelKey, MetamodelType } from "../generated/types.js";

/**
 * A type with inheritance resolved; everything else as written in its file. Its schema is
 * `metamodel.schema.json#/$defs/effectiveType`, which `metamodel.get` returns.
 */
export type EffectiveType = MetamodelEffectiveType;

/** A definition of the metamodel and where it is written. */
export interface Located<T> {
  readonly definition: T;
  /** Relative to the metamodel repository. */
  readonly file: string;
  /** Line of a node of the definition, e.g. `["extends"]` or `["required", "0"]`. */
  readonly lineOf: (segments: readonly string[]) => number | undefined;
}

/** A type definition and where it is written. */
export type LocatedType = Located<MetamodelType>;

export interface ResolvedTypes {
  /** In the order of the given types. */
  readonly types: readonly EffectiveType[];
  /** `metamodel.invalid` errors and warnings, in type order. */
  readonly problems: readonly Problem[];
}

const problem = (
  severity: Problem["severity"],
  type: LocatedType,
  segments: readonly string[],
  message: string,
): Problem => {
  const line = type.lineOf(segments);
  return {
    code: "metamodel.invalid",
    severity,
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

/**
 * The problem of `extends`, if any: a parent that does not exist (only when `complete`), or a cycle
 * back to the type.
 */
const parentProblems = (
  type: LocatedType,
  chain: readonly LocatedType[],
  cycle: boolean,
  byKey: ReadonlyMap<MetamodelKey, LocatedType>,
  complete: boolean,
): Problem[] => {
  const { key, extends: parent } = type.definition;
  if (parent !== undefined && !byKey.has(parent)) {
    // The chain stops at the unknown parent, so there is no cycle to report either.
    return complete
      ? [problem("error", type, ["extends"], `Type ${key} extends unknown type ${parent}`)]
      : [];
  }
  if (cycle) {
    const path = [...chain, type].map((t) => t.definition.key).join(" -> ");
    return [problem("error", type, ["extends"], `Type ${key} is part of an inheritance cycle: ${path}`)];
  }
  return [];
};

/**
 * A property key in `properties` or `required` that no property definition has: a warning, as the
 * key is treated like a property the type does not have (D-012). The message says when the key is
 * a relation kind.
 */
const propertyProblems = (
  type: LocatedType,
  isProperty: (key: MetamodelKey) => boolean,
  relationKeys: ReadonlySet<MetamodelKey>,
): Problem[] => {
  const { key, properties = [], required = [] } = type.definition;
  const lists = [
    ["properties", properties],
    ["required", required],
  ] as const;
  return lists.flatMap(([list, keys]) =>
    keys.flatMap((property, index) =>
      isProperty(property)
        ? []
        : [
            problem(
              "warning",
              type,
              [list, String(index)],
              relationKeys.has(property)
                ? `Type ${key} names ${property}, which is a relation kind, not a property`
                : `Type ${key} names unknown property ${property}; it is treated like a property the type does not have`,
            ),
          ],
    ),
  );
};

const unique = (keys: readonly MetamodelKey[]): MetamodelKey[] => [...new Set(keys)];

/**
 * The effective type of `own`; `chain` starts with the type itself, then its ancestors. Keys for
 * which `isProperty` is false are left out.
 */
const effectiveType = (
  own: MetamodelType,
  chain: readonly LocatedType[],
  isProperty: (key: MetamodelKey) => boolean,
): EffectiveType => {
  const definitions = chain.map((t) => t.definition);
  const { abstract = false, properties: _properties, required: _required, meaning: _meaning, ...rest } = own;
  const rootFirst = [...definitions].reverse();
  const meaning = definitions.find((d) => d.meaning !== undefined)?.meaning;
  return {
    ...rest,
    ...(meaning === undefined ? {} : { meaning }),
    abstract,
    ancestors: definitions.slice(1).map((d) => d.key),
    properties: unique(rootFirst.flatMap((d) => [...(d.properties ?? []), ...(d.required ?? [])])).filter(
      isProperty,
    ),
    required: unique(rootFirst.flatMap((d) => d.required ?? [])).filter(isProperty),
  };
};

/**
 * Resolves the inheritance of all types. `types` have unique keys (the loader keeps only the first
 * definition of a key); `propertyKeys` are the keys of all defined properties, `relationKeys` those
 * of all relation kinds. `complete` is true
 * when every metamodel file was read; otherwise an unknown parent or property is not reported, and
 * an unknown property is kept in the effective types.
 */
export const resolveTypes = (
  types: readonly LocatedType[],
  propertyKeys: ReadonlySet<MetamodelKey>,
  relationKeys: ReadonlySet<MetamodelKey>,
  complete: boolean,
): ResolvedTypes => {
  const byKey = new Map(types.map((t) => [t.definition.key, t]));
  const problems: Problem[] = [];
  // While a file is faulty, which may define it, every key counts as a property: not reported, kept.
  const isProperty = (key: MetamodelKey): boolean => !complete || propertyKeys.has(key);
  const resolved = types.map((type) => {
    const { chain, cycle } = chainOf(type, byKey);
    // The parent first, then the property lists, as most definitions are written.
    problems.push(
      ...parentProblems(type, chain, cycle, byKey, complete),
      ...propertyProblems(type, isProperty, relationKeys),
    );
    return effectiveType(type.definition, chain, isProperty);
  });
  return { types: resolved, problems };
};
