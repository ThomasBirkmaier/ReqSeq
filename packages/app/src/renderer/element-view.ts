// What the element buffer shows of an element: its properties and relations, from the command output as
// it is. Empty properties are not shown (D-062: only what means something).
import type { DataExportElement, DataExportRelation } from "@logreq/core";

/** The lines of a property value: one per array item; an object with a `title` shows the title. */
export const propertyLines = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(propertyLines);
  }
  if (typeof value === "string") {
    return value.trim() === "" ? [] : [value];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (typeof value !== "object" || value === null || Object.keys(value).length === 0) {
    return [];
  }
  const title = (value as { readonly title?: unknown }).title;
  return typeof title === "string" && title !== "" ? [title] : [JSON.stringify(value)];
};

export interface PropertyBox {
  readonly key: string;
  readonly lines: readonly string[];
}

/**
 * The properties with something to show. A property of kind `relation` (`property: true` in the
 * relations) appears as a relation, so it is left out here.
 */
export const propertyBoxes = (element: DataExportElement): PropertyBox[] => {
  const asRelation = new Set(element.relations.filter((r) => r.property === true).map((r) => r.kind));
  return Object.entries(element.properties)
    .filter(([key]) => !asRelation.has(key))
    .map(([key, value]) => ({ key, lines: propertyLines(value) }))
    .filter((box) => box.lines.length > 0);
};

export interface RelationGroup {
  /** The relation kind; incoming relations have an arrow before it ("← derives-from"). */
  readonly heading: string;
  readonly relations: readonly DataExportRelation[];
}

/** The relations grouped by kind and direction, in the order of their first appearance. */
export const relationGroups = (relations: readonly DataExportRelation[]): RelationGroup[] => {
  const groups = new Map<string, DataExportRelation[]>();
  for (const relation of relations) {
    const heading = relation.direction === "in" ? `← ${relation.kind}` : relation.kind;
    groups.set(heading, [...(groups.get(heading) ?? []), relation]);
  }
  return [...groups].map(([heading, grouped]) => ({ heading, relations: grouped }));
};
