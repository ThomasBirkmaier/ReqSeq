// The metamodel as text (SR-130 AK5): what `metamodel.get` gives, in the words the text view shows. Pure
// display (ADR-0002 rule 3, SR-080 AK1), like `metamodel-graph.ts`: every word is a value of the output or
// a word for a field ("extends", "abstract", "required", "counts to version", "list of", "any type", "none").
// - One row per type, in metamodel order: its key, name and prefix, "abstract" when it is, its parent
//   (`extends`, by the parent's name, by the key when no type has it), its properties (own and inherited,
//   in the output's order) each with its value kind, "required" and "counts to version" (its `content`,
//   D-057, #624), and its statuses by name. A property is inherited by the same reading as in the graph
//   (`inheritedProperties`).
// - The value kind (Wertart) of a property is its `kind`; "list of" when it takes several values
//   (`many`); for kind `relation` the types it may point to. Choice values are not listed (on demand).
// - One row per relation kind, in metamodel order: its key and name, its source and target types by name.
//   A side left out allows every type ("any type"), an empty list none ("none"), as the schema says.
// - The problems of the output, one line each; they are no rows.
import type { MetamodelGetOutput } from "@reqseq/core";
import { inheritedProperties, typeKey } from "./metamodel-graph.js";

/** A property of a type, as a line of its row. */
export interface TextProperty {
  readonly key: string;
  readonly name: string;
  /** The value kind: "text", "list of choice", "relation → Package". */
  readonly value: string;
  readonly required: boolean;
  /** Whether a change of its value gives a new version (`content`, D-057). */
  readonly content: boolean;
  /** Muted, as in the graph. */
  readonly inherited: boolean;
}

export interface TypeRow {
  readonly kind: "type";
  /** The row's key, the same as the key of the type's box in the graph (`type:<key>`). */
  readonly key: string;
  readonly type: string;
  readonly name: string;
  readonly prefix: string;
  readonly abstract: boolean;
  /** The parent by its name (its key when no type has it); not set: no parent. */
  readonly parent?: string;
  readonly properties: readonly TextProperty[];
  /** The names of its statuses, in order; empty: the type has no status. */
  readonly statuses: readonly string[];
}

export interface RelationRow {
  readonly kind: "relation";
  /** `relation:<key>`. */
  readonly key: string;
  readonly relation: string;
  readonly name: string;
  /** The source types by name, "any type" or "none". */
  readonly source: string;
  /** The target types by name, "any type" or "none". */
  readonly target: string;
}

export type TextRow = TypeRow | RelationRow;

export interface MetamodelText {
  /** The types, then the relation kinds. */
  readonly rows: readonly TextRow[];
  /** One line per problem of the output: severity, code, message and where. */
  readonly problems: readonly string[];
}

/** The key of the row of a relation kind. */
export const relationKey = (relation: string): string => `relation:${relation}`;

export const ANY_TYPE = "any type";

export const NO_TYPE = "none";

/** A side of a relation kind or a relation property: its types by name, "any type" or "none". */
const sideOf = (types: readonly string[] | undefined, names: ReadonlyMap<string, string>): string => {
  if (types === undefined) {
    return ANY_TYPE;
  }
  return types.length === 0 ? NO_TYPE : types.map((key) => names.get(key) ?? key).join(", ");
};

/** The value kind of a property: its kind, "list of" for several values, the targets of a relation. */
const valueOf = (
  property: MetamodelGetOutput["properties"][number] | undefined,
  names: ReadonlyMap<string, string>,
): string => {
  if (property === undefined) {
    return "";
  }
  const kind = property.many === true ? `list of ${property.kind}` : property.kind;
  return property.kind === "relation" ? `${kind} → ${sideOf(property["target-types"], names)}` : kind;
};

const problemLine = (problem: NonNullable<MetamodelGetOutput["problems"]>[number]): string => {
  const where =
    problem.file === undefined
      ? undefined
      : problem.line === undefined
        ? problem.file
        : `${problem.file}:${String(problem.line)}`;
  return [problem.severity, problem.code, problem.message, where]
    .filter((part) => part !== undefined)
    .join("  ");
};

/** The text of the metamodel from the output of `metamodel.get`. */
export const metamodelText = (output: MetamodelGetOutput): MetamodelText => {
  const typeNames = new Map(output.types.map((type) => [type.key, type.name]));
  const properties = new Map(output.properties.map((property) => [property.key, property]));
  const statusNames = new Map(output.statuses.map((status) => [status.key, status.name]));
  const inherited = inheritedProperties(output);
  const types = output.types.map((type): TypeRow => {
    const fromParent = inherited(type);
    return {
      kind: "type",
      key: typeKey(type.key),
      type: type.key,
      name: type.name,
      prefix: type.prefix,
      abstract: type.abstract,
      ...(type.extends === undefined ? {} : { parent: typeNames.get(type.extends) ?? type.extends }),
      properties: type.properties.map((key) => ({
        key,
        name: properties.get(key)?.name ?? key,
        value: valueOf(properties.get(key), typeNames),
        required: type.required.includes(key),
        content: properties.get(key)?.content === true,
        inherited: fromParent.has(key),
      })),
      statuses: type.statuses.map((key) => statusNames.get(key) ?? key),
    };
  });
  const relations = output.relations.map((kind): RelationRow => ({
    kind: "relation",
    key: relationKey(kind.key),
    relation: kind.key,
    name: kind.name,
    source: sideOf(kind["source-types"], typeNames),
    target: sideOf(kind["target-types"], typeNames),
  }));
  return { rows: [...types, ...relations], problems: (output.problems ?? []).map(problemLine) };
};
