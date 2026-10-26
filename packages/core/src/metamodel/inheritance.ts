// Inheritance of types (SR-012): a type that `extends` another one has all its properties and
// required properties (Pflicht-Properties), over any number of levels. A parent that does not
// exist and an inheritance cycle are metamodel errors with file and line, so the workspace opens
// read-only (SR-011 AK3). A type naming a property that no definition has is only a warning with
// file and line (#141 c, option 2): the effective type leaves the key out, so an element value under
// it is an unknown property (D-012) and the workspace stays writable. An unknown parent or property
// is reported, and the key left out, only when every metamodel file was read, since a faulty file
// may define it. Resolution never loops and resolves as far as it can, so a read-only workspace
// still knows its types.
//
// Statuses per type (#306): a type's `statuses` restrict the metamodel's statuses (the vocabulary)
// and are inherited like properties, as a union over the type and its ancestors. Without any list in
// the chain the type has every status; once any type in the chain has a list, only the listed
// statuses count, so a type with a list below a parent without one has only its own statuses. An
// empty union means the type has no status. An unknown key
// is a warning, like an unknown property, and left out.
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
 * A status key in `statuses` that no status definition has: a warning; the key is left out. When
 * that leaves the type without any status (`effective` is empty), the message says so.
 */
const statusProblems = (
  type: LocatedType,
  isStatus: (key: MetamodelKey) => boolean,
  effective: readonly MetamodelKey[],
): Problem[] =>
  (type.definition.statuses ?? []).flatMap((status, index) =>
    isStatus(status)
      ? []
      : [
          problem(
            "warning",
            type,
            ["statuses", String(index)],
            `Type ${type.definition.key} names unknown status ${status}; it is treated like a status the type does not have${effective.length === 0 ? `, so type ${type.definition.key} has no status` : ""}`,
          ),
        ],
  );

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
 * The statuses of a type whose chain (root first) is `rootFirst`: every key of `statusKeys` when no
 * definition has `statuses`, else the union of their lists in the order of `statusKeys`, then the
 * keys `statusKeys` does not have but `isStatus` keeps (only while a file is faulty), as written.
 */
const effectiveStatuses = (
  rootFirst: readonly MetamodelType[],
  statusKeys: readonly MetamodelKey[],
  isStatus: (key: MetamodelKey) => boolean,
): MetamodelKey[] => {
  const lists = rootFirst.flatMap((d) => (d.statuses === undefined ? [] : [d.statuses]));
  if (lists.length === 0) {
    return [...statusKeys];
  }
  const named = new Set(lists.flat());
  const known = new Set(statusKeys);
  return [
    ...statusKeys.filter((key) => named.has(key)),
    ...[...named].filter((key) => !known.has(key) && isStatus(key)),
  ];
};

/**
 * The effective type of `own`; `chain` starts with the type itself, then its ancestors. Keys for
 * which `isProperty` is false are left out.
 */
const effectiveType = (
  own: MetamodelType,
  chain: readonly LocatedType[],
  isProperty: (key: MetamodelKey) => boolean,
  statuses: { readonly keys: readonly MetamodelKey[]; readonly isStatus: (key: MetamodelKey) => boolean },
): EffectiveType => {
  const definitions = chain.map((t) => t.definition);
  const {
    abstract = false,
    properties: _properties,
    required: _required,
    meaning: _meaning,
    statuses: _statuses,
    ...rest
  } = own;
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
    statuses: effectiveStatuses(rootFirst, statuses.keys, statuses.isStatus),
  };
};

/** The keys of the definitions `resolveTypes` resolves the types against. */
export interface DefinedKeys {
  /** The keys of all defined properties. */
  readonly properties: ReadonlySet<MetamodelKey>;
  /** The keys of all relation kinds. */
  readonly relations: ReadonlySet<MetamodelKey>;
  /** The keys of all statuses, in metamodel order. */
  readonly statuses: readonly MetamodelKey[];
}

/**
 * Resolves the inheritance of all types. `types` have unique keys (the loader keeps only the first
 * definition of a key); `keys` are those of the defined properties, relation kinds and statuses.
 * `complete` is true when every metamodel file was read; otherwise an unknown parent, property or
 * status is not reported, and an unknown property or status is kept in the effective types.
 */
export const resolveTypes = (
  types: readonly LocatedType[],
  keys: DefinedKeys,
  complete: boolean,
): ResolvedTypes => {
  const byKey = new Map(types.map((t) => [t.definition.key, t]));
  const problems: Problem[] = [];
  // While a file is faulty, which may define it, every key counts as a property: not reported, kept.
  const isProperty = (key: MetamodelKey): boolean => !complete || keys.properties.has(key);
  const statusKeys = new Set(keys.statuses);
  const isStatus = (key: MetamodelKey): boolean => !complete || statusKeys.has(key);
  const resolved = types.map((type) => {
    const { chain, cycle } = chainOf(type, byKey);
    const effective = effectiveType(type.definition, chain, isProperty, { keys: keys.statuses, isStatus });
    // The parent first, then the property lists, then the statuses, as most definitions are written.
    problems.push(
      ...parentProblems(type, chain, cycle, byKey, complete),
      ...propertyProblems(type, isProperty, keys.relations),
      ...statusProblems(type, isStatus, effective.statuses),
    );
    return effective;
  });
  return { types: resolved, problems };
};
