// The words that several displays share (ADR-0019 point 4): the heading of a group of relations, the value shown
// where an element has none, and the note under a part that a bound cut. One function each, so the app and the
// HTML export word them alike.
import type { MetamodelGetOutput } from "../generated/types.js";

/** What the relation words read of `metamodel.get`: the relation kinds and the properties. */
export interface RelationNames {
  readonly relations: readonly Pick<
    MetamodelGetOutput["relations"][number],
    "key" | "name" | "inverse-name"
  >[];
  readonly properties: readonly Pick<MetamodelGetOutput["properties"][number], "key" | "name">[];
}

/** No names: every group is headed by its key. */
export const NO_NAMES: RelationNames = { relations: [], properties: [] };

/** A link as a group of relations names it: its key (none for an inline reference), whether it is a property, its direction. */
export interface GroupedLink {
  /** The relation kind or relation property; undefined for an inline reference. */
  readonly kind?: string | undefined;
  readonly property?: boolean | undefined;
  /** `in`: it points at the element shown. */
  readonly direction: "in" | "out";
}

/** The word of an inline reference, which no relation kind names (as `REFERENCE_NAME` of the graph). */
export const REFERENCE_WORD = "inline reference";

/**
 * The heading of a group of relations: an outgoing relation by the name of its kind, an incoming one by the
 * inverse name of its kind, else its name, as `trace.matrix` names an incoming column; a relation property by
 * the property's name; the key where the metamodel names none; an inline reference "Inline reference", capitalised
 * like the names of the metamodel that head the other groups. An incoming group starts with "← ".
 */
export const relationGroupLabel = (link: GroupedLink, names: RelationNames): string => {
  const prefix = link.direction === "in" ? "← " : "";
  const { kind } = link;
  if (kind === undefined) {
    return `${prefix}${REFERENCE_WORD.charAt(0).toUpperCase()}${REFERENCE_WORD.slice(1)}`;
  }
  if (link.property === true) {
    return `${prefix}${names.properties.find((p) => p.key === kind)?.name ?? kind}`;
  }
  const relation = names.relations.find((r) => r.key === kind);
  const name = link.direction === "in" ? (relation?.["inverse-name"] ?? relation?.name) : relation?.name;
  return `${prefix}${name ?? kind}`;
};

/** The value a display shows where an element has none, such as a status (SR-232 AK1: "–"). */
export const EMPTY_VALUE = "–";

/** `value`, or `EMPTY_VALUE` when there is none. */
export const emptyValueLabel = (value: string | undefined): string =>
  value === undefined || value === "" ? EMPTY_VALUE : value;

/** The note under a part a bound cut (SR-232 AK5): it shows only the `bound` nearest elements. */
export const boundNote = (bound: number): string => `Only the nearest ${String(bound)} are shown.`;

/** The ID of an element as every display shows it (SR-084 AK4), the rule of the graph words. */
export { degreePercent, shownId } from "../graph/words.js";
