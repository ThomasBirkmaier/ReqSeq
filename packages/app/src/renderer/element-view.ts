// What the element buffer shows of an element: its properties and relations, from the command output as
// it is. Empty properties are not shown (D-062: only what means something).
import type { DataExportElement, DataExportRelation } from "@logreq/core";
import { outdatedKey } from "./editor/references.js";

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

// The hint of an inline reference has the place `.../@text/<target>?version=<v>[&repository=<name>]&n=<k>`
// in its ID (`hintId`); a hint on a relation item has a metamodel key instead of `@text`.
const TEXT_HINT = /\/@text\/[^/?]+\?(.*)$/;

/**
 * The outdated inline references of an element for the editor: `outdatedKey` of the target, the stored
 * version and the repository the link names, to the message of the hint. The hints come from core; the
 * first one of a reference wins.
 */
export const outdatedReferences = (element: DataExportElement): ReadonlyMap<string, string> => {
  const found = new Map<string, string>();
  for (const problem of element.problems ?? []) {
    const query = TEXT_HINT.exec(problem.hintId ?? "")?.[1];
    if (
      problem.code === "relation.outdated" &&
      query !== undefined &&
      problem.targetId !== undefined &&
      problem.storedVersion !== undefined
    ) {
      const named = query
        .split("&")
        .find((entry) => entry.startsWith("repository="))
        ?.slice("repository=".length);
      const key = outdatedKey(problem.targetId, problem.storedVersion, named);
      if (!found.has(key)) {
        found.set(key, problem.message);
      }
    }
  }
  return found;
};
