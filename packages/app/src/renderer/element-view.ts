// What the element buffer shows of an element: its properties and relations, from the command output as
// it is. Empty properties are not shown (D-062: only what means something).
import type {
  DataExportElement,
  DataExportRelation,
  MetamodelGetOutput,
  MetamodelProperty,
} from "@logreq/core";
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

/** What the app needs to know of a property to edit its box (D-012, SR-104): from `metamodel.get`. */
export interface PropertyInfo {
  readonly kind: MetamodelProperty["kind"];
  /** The value is a list: one value per line in its box. */
  readonly many: boolean;
  /** The values are Markdown like the text and show formatted (SR-127). */
  readonly markdown: boolean;
}

/** The properties of each type, by the key of the type and then of the property, with the inherited ones. */
export type PropertyModel = ReadonlyMap<string, ReadonlyMap<string, PropertyInfo>>;

/**
 * The properties of each type as the metamodel defines them (`metamodel.get`, SR-127 AK5): kind, list or
 * single value, and whether the values are Markdown. The app only reads what core says; a key a type does
 * not list is not in its map (D-012), so its box stays as it is shown.
 */
export const propertyModel = (metamodel: Pick<MetamodelGetOutput, "types" | "properties">): PropertyModel => {
  const defined = new Map(metamodel.properties.map((property) => [property.key, property]));
  return new Map(
    metamodel.types.map((type) => [
      type.key,
      new Map(
        type.properties.flatMap((key): [string, PropertyInfo][] => {
          const property = defined.get(key);
          return property === undefined
            ? []
            : [
                [
                  key,
                  { kind: property.kind, many: property.many === true, markdown: property.markdown === true },
                ],
              ];
        }),
      ),
    ]),
  );
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
// in its ID (`hintId`), and `.../@text:<key>/<target>?...` when the link is in a property marked
// `markdown` (SR-127); a hint on a relation item has a metamodel key instead of `@text`.
const TEXT_HINT = /\/@text(?::([^/?]+))?\/[^/?]+\?(.*)$/;

/**
 * The outdated inline references of an element for the editor: `outdatedKey` of the target, the stored
 * version and the repository the link names, to the message of the hint. The hints come from core; the
 * first one of a reference wins. Without `property` those of the text, else those in the values of that
 * property (SR-127): every occurrence of a reference has the same state, so the key tells enough.
 */
export const outdatedReferences = (
  element: DataExportElement,
  property?: string,
): ReadonlyMap<string, string> => {
  const found = new Map<string, string>();
  for (const problem of element.problems ?? []) {
    const place = TEXT_HINT.exec(problem.hintId ?? "");
    const query = place?.[2];
    if (
      problem.code === "relation.outdated" &&
      place?.[1] === property &&
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

/** The label of a relation as the buffer shows it: the identifier or short ID, then the title. */
export const relationLabel = (relation: DataExportRelation): string =>
  `${relation.identifier ?? relation.shortId ?? relation.id} ${relation.title ?? ""}`.trim();
