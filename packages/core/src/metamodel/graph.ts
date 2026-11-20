// The metamodel as a graph (SR-130 AK2, AK3), for the app's graph and the Mermaid text (SR-151 AK2,
// #1537; `@reqseq/core/metamodel-graph`, this module imports only types): which box and which curve stand for
// which field of `metamodel.get`. Pure display (ADR-0002 rule 3, SR-080 AK1): nothing is decided here, every word shown
// is a value of the output or a word for a field ("extends", "Any type", "abstract", "any source").
// - A node is one entry of `types`, in their order, with its name, prefix, every property of
//   `properties` (own and inherited) and every status of `statuses` (own and inherited), the initial and
//   the invalid ones marked as their definitions say (SR-130 AK2). A property is inherited when its key is
//   among the `properties` of the type its `extends` names; that is the one reading of the output this
//   module makes (review S2). Its owner, the type that has it itself, is the farthest ancestor up the chain
//   of `extends` that has it, so a menu on the property acts on that type (SR-199 AK6).
// - A link is an `extends` value (to the parent), one pair of the `source-types` × `target-types` of a
//   relation kind, or one target type of a property of kind `relation` that a type has as its own (ThomasBirkmaier/ReqSeq-archive#619
//   Q1: drawn as curves, labelled with the property's name). A side that a relation kind or property
//   leaves out allows every type (the schema): it is the node "Any type", which exists only then, and
//   the label says which side is open (AK3). So a kind open on one side appears once per type of the
//   other side (ThomasBirkmaier/ReqSeq-archive#619 Q2), and a kind open on both sides once, as a loop at "Any type". An empty list
//   allows no type and gives no link; a type key that names no type gives none either (core reports it).
//   Types are named as written, their subtypes not added: the inheritance curves show them.
// - The links of one ordered pair of nodes are one edge, in the order of their first link: the
//   inheritance first, then the relation kinds and then the relation properties, in metamodel order.
import type { CommandOutput } from "../catalog.js";

// The uses (SR-236 AK8) are no part of the graph: `metamodel.mermaid` draws the metamodel without them.
type MetamodelGetOutput = Omit<CommandOutput<"metamodel.get">, "uses">;

/** The key of the node of a type. */
export const typeKey = (type: string): string => `type:${type}`;

/** The key of the node "Any type". */
export const ANY_KEY = "any";

export const ANY_NAME = "Any type";

/** A property in the box of a type: its name (else its key), muted when the type inherits it. */
export interface BoxProperty {
  readonly key: string;
  readonly name: string;
  readonly inherited: boolean;
  /** The key of the type that has it itself: the box's type, or the ancestor it inherits it from. */
  readonly owner: string;
}

/** A status in the box of a type: its name (else its key), and whether it is the initial or an invalid one. */
export interface BoxStatus {
  readonly key: string;
  readonly name: string;
  readonly initial: boolean;
  readonly invalid: boolean;
}

export interface TypeNode {
  readonly key: string;
  readonly any: false;
  readonly type: string;
  readonly name: string;
  readonly prefix: string;
  readonly abstract: boolean;
  readonly properties: readonly BoxProperty[];
  readonly statuses: readonly BoxStatus[];
}

/** The node that stands for every type, on the side a relation kind or property does not restrict. */
export interface AnyNode {
  readonly key: typeof ANY_KEY;
  readonly any: true;
  readonly name: typeof ANY_NAME;
  readonly properties: readonly BoxProperty[];
  readonly statuses: readonly BoxStatus[];
}

export type MetamodelNode = TypeNode | AnyNode;

/** Which side of a relation kind or property allows every type. */
export type OpenSide = "source" | "target" | "both";

export type MetamodelLink =
  | { readonly link: "extends" }
  | {
      readonly link: "relation";
      readonly kind: string;
      readonly name: string;
      readonly open?: OpenSide;
    }
  | {
      readonly link: "property";
      readonly property: string;
      readonly name: string;
      readonly open?: "target";
    };

/** The links of one node to another (or to itself, a loop), drawn as one curve with one label line per link. */
export interface MetamodelEdge {
  readonly source: string;
  readonly target: string;
  readonly links: readonly MetamodelLink[];
}

export interface MetamodelGraph {
  readonly nodes: readonly MetamodelNode[];
  readonly edges: readonly MetamodelEdge[];
}

const OPEN_WORDS: Readonly<Record<OpenSide, string>> = {
  source: "any source",
  target: "any target",
  both: "any source and target",
};

/** The label line of a link: "extends", the name of the kind or property, and the open side (AK3). */
export const linkLabel = (link: MetamodelLink): string => {
  if (link.link === "extends") {
    return "extends";
  }
  return link.open === undefined ? link.name : `${link.name} · ${OPEN_WORDS[link.open]}`;
};

const openSide = (source: boolean, target: boolean): OpenSide | undefined =>
  source ? (target ? "both" : "source") : target ? "target" : undefined;

/** One link and the nodes it joins. */
type Joined = readonly [source: string, target: string, link: MetamodelLink];

/** What the graph reads of the output: the effective properties of each type, and the sides' nodes. */
interface Reading {
  /** The property keys a type inherits: those of the type its `extends` names (review S2). */
  readonly inherited: (type: MetamodelGetOutput["types"][number]) => ReadonlySet<string>;
  /** A side that names types: the nodes of the defined ones; a side left out: "Any type". */
  readonly ends: (keys: readonly string[] | undefined) => string[];
  readonly defined: (type: string) => boolean;
}

/**
 * The property keys each type inherits: those among the effective `properties` of the type its `extends`
 * names (review S2). The one reading of the output the graph and the texts make (the app's `metamodel-text.ts`).
 */
export const inheritedProperties = (
  output: Pick<MetamodelGetOutput, "types">,
): ((type: MetamodelGetOutput["types"][number]) => ReadonlySet<string>) => {
  const effective = new Map(output.types.map((type) => [type.key, type.properties]));
  return (type) => new Set(type.extends === undefined ? [] : effective.get(type.extends));
};

const reading = (output: MetamodelGetOutput): Reading => {
  const effective = new Map(output.types.map((type) => [type.key, type.properties]));
  return {
    inherited: inheritedProperties(output),
    ends: (keys) => (keys === undefined ? [ANY_KEY] : keys.filter((key) => effective.has(key)).map(typeKey)),
    defined: (type) => effective.has(type),
  };
};

/**
 * The type that has `property` itself, seen from `type`: up the chain of `extends` as long as the parent has
 * it too (the same reading as `inheritedProperties`).
 */
const ownerOf = (
  type: MetamodelGetOutput["types"][number],
  property: string,
  byKey: ReadonlyMap<string, MetamodelGetOutput["types"][number]>,
): string => {
  let owner = type;
  const seen = new Set([type.key]);
  for (;;) {
    const parent = owner.extends === undefined ? undefined : byKey.get(owner.extends);
    if (parent === undefined || seen.has(parent.key) || !parent.properties.includes(property)) {
      return owner.key;
    }
    seen.add(parent.key);
    owner = parent;
  }
};

const typeNodes = (output: MetamodelGetOutput, read: Reading): TypeNode[] => {
  const names = new Map(output.properties.map((property) => [property.key, property.name]));
  const statuses = new Map(output.statuses.map((status) => [status.key, status]));
  const byKey = new Map(output.types.map((type) => [type.key, type]));
  return output.types.map((type): TypeNode => {
    const inherited = read.inherited(type);
    return {
      key: typeKey(type.key),
      any: false,
      type: type.key,
      name: type.name,
      prefix: type.prefix,
      abstract: type.abstract,
      properties: type.properties.map((key) => ({
        key,
        name: names.get(key) ?? key,
        inherited: inherited.has(key),
        owner: inherited.has(key) ? ownerOf(type, key, byKey) : type.key,
      })),
      statuses: type.statuses.map((key) => {
        const status = statuses.get(key);
        return {
          key,
          name: status?.name ?? key,
          initial: status?.initial === true,
          invalid: status?.invalid === true,
        };
      }),
    };
  });
};

const inheritanceLinks = (output: MetamodelGetOutput, read: Reading): Joined[] =>
  output.types.flatMap((type): Joined[] =>
    type.extends !== undefined && read.defined(type.extends)
      ? [[typeKey(type.key), typeKey(type.extends), { link: "extends" }]]
      : [],
  );

const relationLinks = (output: MetamodelGetOutput, read: Reading): Joined[] =>
  output.relations.flatMap((kind) => {
    const open = openSide(kind["source-types"] === undefined, kind["target-types"] === undefined);
    const link: MetamodelLink = {
      link: "relation",
      kind: kind.key,
      name: kind.name,
      ...(open === undefined ? {} : { open }),
    };
    return read
      .ends(kind["source-types"])
      .flatMap((source) => read.ends(kind["target-types"]).map((target): Joined => [source, target, link]));
  });

/** The properties of kind `relation` a type has as its own (not inherited), to each of their target types. */
const propertyLinks = (output: MetamodelGetOutput, read: Reading): Joined[] => {
  const relations = output.properties.filter((property) => property.kind === "relation");
  return output.types.flatMap((type) => {
    const inherited = read.inherited(type);
    return relations
      .filter((property) => type.properties.includes(property.key) && !inherited.has(property.key))
      .flatMap((property) => {
        const targets = property["target-types"];
        const link: MetamodelLink = {
          link: "property",
          property: property.key,
          name: property.name,
          ...(targets === undefined ? { open: "target" as const } : {}),
        };
        return read.ends(targets).map((target): Joined => [typeKey(type.key), target, link]);
      });
  });
};

/** Builds the graph of the metamodel from the output of `metamodel.get`. */
export const metamodelGraph = (output: MetamodelGetOutput): MetamodelGraph => {
  const read = reading(output);
  const edges = new Map<string, { source: string; target: string; links: MetamodelLink[] }>();
  for (const [source, target, link] of [
    ...inheritanceLinks(output, read),
    ...relationLinks(output, read),
    ...propertyLinks(output, read),
  ]) {
    const pair = `${source}>${target}`;
    const edge = edges.get(pair);
    if (edge === undefined) {
      edges.set(pair, { source, target, links: [link] });
    } else {
      edge.links.push(link);
    }
  }
  const types = typeNodes(output, read);
  const all = [...edges.values()];
  const any = all.some((edge) => edge.source === ANY_KEY || edge.target === ANY_KEY);
  return {
    nodes: any
      ? [...types, { key: ANY_KEY, any: true, name: ANY_NAME, properties: [], statuses: [] }]
      : types,
    edges: all,
  };
};
