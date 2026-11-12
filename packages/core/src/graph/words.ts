// The words of the graph of an element (SR-111, SR-136, SR-154) that the app shows, in core so that the
// Mermaid text (SR-151 AK1, #1537) uses the same ones. The renderer imports it as `@reqseq/core/graph-words`, so this
// module imports only types and `evidence/degree-text.ts`.
import type { CommandOutput } from "../catalog.js";
import { degreePercent } from "../evidence/degree-text.js";

type GraphNode = CommandOutput<"trace.graph">["nodes"][number];
type GraphEdge = CommandOutput<"trace.graph">["edges"][number];
type GraphMark = GraphNode["marks"][number];
type Metamodel = CommandOutput<"metamodel.get">;

/** The words of the marks (SR-111 AK4), in the order of the output. */
export const MARK_WORDS: Readonly<Record<GraphMark, string>> = {
  outdated: "outdated",
  superseded: "superseded",
};

/** What a node, or a row of a list (SR-137), carries of its verification. */
export type Verifiable = Pick<GraphNode, "verification" | "criteria" | "degree">;

/** The verification status of a requirement node in the graph's view (SR-136 AK1); none for another node. */
export const statusOf = (node: Verifiable): string | undefined => node.verification?.[0]?.status;

/** A progress ring of a node (SR-136): the part that is full, 0 to 1, and its text. */
export interface Ring {
  readonly part: number;
  readonly text: string;
}

/**
 * The progress ring of a node (SR-136 AK2 to AK6): a requirement's verified acceptance criteria,
 * "2 of 3", as core counts them (`criteria`); a need's verification degree, "60 %" (`degreePercent`, as
 * the CLI); none where core gives nothing to count (indirect, no criteria, no valid derived requirement).
 */
export const ringOf = (node: Verifiable): Ring | undefined => {
  const { criteria, degree } = node;
  if (criteria !== undefined) {
    return {
      part: criteria.verified / criteria.total,
      text: `${String(criteria.verified)} of ${String(criteria.total)}`,
    };
  }
  return degree?.share === undefined ? undefined : { part: degree.share, text: degreePercent(degree.share) };
};

/** The verification of a node in words, "verification open 2 of 3", "verification 60 %"; none without. */
export const verificationWords = (node: Verifiable): string[] => {
  const parts = [statusOf(node), ringOf(node)?.text].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? [] : ["verification", ...parts];
};

/**
 * The ID of an element as the app shows it (SR-084 AK4): the short ID with the identifier in brackets
 * behind it, `SR-3c90b0 (SR-036)`, as the CLI prints it (`cli/src/present.ts`); the short ID alone
 * without an identifier.
 */
export const shownId = (shortId: string, identifier?: string): string =>
  identifier === undefined || identifier.trim() === "" ? shortId : `${shortId} (${identifier})`;

/** The name of a type: its name from the metamodel (`typeNames`), its key when the metamodel names none. */
export const typeName = (typeNames: ReadonlyMap<string, string>, type: string): string =>
  typeNames.get(type) ?? type;

/** The word of an inline reference in an edge's text: the metamodel names no such kind (SR-154 AK1). */
export const REFERENCE_NAME = "Refers to";

/** The key of a relation property in the names of `relationNames`: a property may share a kind's key. */
export const propertyNameKey = (key: string): string => `property:${key}`;

/**
 * The names of the relation kinds by their key and of the properties of kind `relation` by
 * `propertyNameKey` (SR-154 AK1).
 */
export const relationNames = (
  metamodel: Pick<Metamodel, "relations" | "properties">,
): ReadonlyMap<string, string> =>
  new Map([
    ...metamodel.relations.map((kind) => [kind.key, kind.name] as const),
    ...metamodel.properties
      .filter((property) => property.kind === "relation")
      .map((property) => [propertyNameKey(property.key), property.name] as const),
  ]);

/**
 * The name of a link's kind (SR-154 AK1): the name of its relation kind or relation property from the
 * metamodel (`kindNames`, `relationNames`), its key when the metamodel names none, `REFERENCE_NAME` for
 * an inline reference.
 */
export const kindName = (link: GraphEdge, kindNames: ReadonlyMap<string, string>): string =>
  link.kind === undefined
    ? REFERENCE_NAME
    : (kindNames.get(link.property === true ? propertyNameKey(link.kind) : link.kind) ?? link.kind);
