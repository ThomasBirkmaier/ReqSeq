// What the element buffer shows of an element: its properties and relations, from the command output as
// it is. Empty properties are not shown (D-062: only what means something).
import type {
  DataExportElement,
  DataExportRelation,
  MetamodelGetOutput,
  MetamodelProperty,
} from "@reqseq/core";
import { outdatedKey } from "./editor/references.js";
import type { OutdatedMark } from "./editor/references.js";
import { isOutdatedCode } from "./outdated-codes.js";

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

/** The label of a relation as the buffer shows it: the identifier or short ID, then the title. */
export const relationLabel = (relation: DataExportRelation): string =>
  `${relation.identifier ?? relation.shortId ?? relation.id} ${relation.title ?? ""}`.trim();

/** A relation that is the value of a property of kind `relation` (ADR-0004), not a relation kind. */
export const isPropertyTarget = (relation: DataExportRelation): boolean =>
  relation.property === true && relation.direction === "out";

/**
 * The field of the title in the element buffer (#621): edited in its heading, saved and compared with the
 * file like a box. Property keys are lower case (`common.schema.json#/$defs/key`), so no key is this label.
 */
export const TITLE_FIELD = "Title";

export interface PropertyBox {
  readonly key: string;
  readonly lines: readonly string[];
  /** The targets of a property of kind `relation` (SR-104): its lines are their labels. */
  readonly relations?: readonly DataExportRelation[];
}

/**
 * The properties with something to show, in the order of the file. A property of kind `relation` (the
 * outgoing relations with `property: true`) is a box like the others, with its targets as rows; the
 * incoming relations and the relations of relation kinds stay relation groups.
 */
export const propertyBoxes = (element: DataExportElement): PropertyBox[] => {
  const targets = new Map<string, DataExportRelation[]>();
  for (const relation of element.relations.filter(isPropertyTarget)) {
    targets.set(relation.kind, [...(targets.get(relation.kind) ?? []), relation]);
  }
  return Object.entries(element.properties).flatMap(([key, value]): PropertyBox[] => {
    const relations = targets.get(key);
    if (relations !== undefined) {
      return [{ key, lines: relations.map(relationLabel), relations }];
    }
    const lines = propertyLines(value);
    return lines.length === 0 ? [] : [{ key, lines }];
  });
};

/** What the app needs to know of a property to edit its box (D-012, SR-104): from `metamodel.get`. */
export interface PropertyInfo {
  /** The display name (the label of the prompt that edits the box); the key when the model gives none. */
  readonly name?: string;
  readonly kind: MetamodelProperty["kind"];
  /** The value is a list: one value per line in its box. */
  readonly many: boolean;
  /** The values are Markdown like the text and show formatted (SR-127). */
  readonly markdown: boolean;
  /** The allowed values of a choice property, in the order of the metamodel (SR-104 AK3). */
  readonly choices?: readonly { readonly key: string; readonly name: string }[];
  /** The types a relation property may point at, subtypes included; none given: every type. */
  readonly targetTypes?: readonly string[];
  /** The built-in meaning of the property (`title` is the heading of the element, not a box). */
  readonly meaning?: string;
}

/** The properties of each type, by the key of the type and then of the property, with the inherited ones. */
export type PropertyModel = ReadonlyMap<string, ReadonlyMap<string, PropertyInfo>>;

/** What the app needs of one property of the metamodel (`metamodel.get`) to edit or ask its value. */
export const propertyInfo = (property: MetamodelProperty): PropertyInfo => ({
  name: property.name,
  kind: property.kind,
  many: property.many === true,
  markdown: property.markdown === true,
  ...(property.choices === undefined
    ? {}
    : { choices: property.choices.map(({ key: choice, name }) => ({ key: choice, name })) }),
  ...(property["target-types"] === undefined ? {} : { targetTypes: property["target-types"] }),
  ...(property.meaning === undefined ? {} : { meaning: property.meaning }),
});

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
          return property === undefined ? [] : [[key, propertyInfo(property)]];
        }),
      ),
    ]),
  );
};

/** A hint of an element as `element.get` gives it. */
type Hint = NonNullable<DataExportElement["problems"]>[number];

/**
 * The word after an outdated reference: "outdated", and the version the reference stores, as the date of
 * that version (D-013), once the buffer has the dates of the hint (`hintDates`). "unknown date" when Git
 * cannot tell or no commit has that version, as "Show element ID and version" says it.
 */
export const outdatedWord = (hint: Hint): string =>
  hint.storedDate === undefined
    ? "outdated"
    : `outdated · version of ${hint.storedDate === null ? "unknown date" : hint.storedDate.slice(0, 10)}`;

const markOf = (hint: Hint): OutdatedMark => ({ message: hint.message, word: outdatedWord(hint) });

/** What makes a dated hint stand for an undated one: the same hint ID (place and stored version) and current version. */
const hintKey = (hint: Hint): string => `${hint.hintId ?? ""} ${hint.currentVersion ?? ""}`;

const undated = (hint: Hint): boolean => isOutdatedCode(hint.code) && hint.storedDate === undefined;

/**
 * The outdated relations and references of `element` that have no dates yet, as one string; empty when
 * there are none. The buffer asks `element.get` with `hintDates` for them when it changes (#702).
 */
export const undatedHints = (element: DataExportElement): string =>
  (element.problems ?? []).filter(undated).map(hintKey).join("\n");

/**
 * `element` with the dated hints `dated` (the hints of `element.get` with `hintDates`) in place of its
 * undated hints with the same hint ID and current version. The dates come from core; an answer that is
 * older than a save changes only the hints that are still the same.
 */
export const withHintDates = (element: DataExportElement, dated: readonly Hint[]): DataExportElement => {
  const byKey = new Map(
    dated.filter((hint) => hint.storedDate !== undefined).map((hint) => [hintKey(hint), hint]),
  );
  return byKey.size === 0 || element.problems === undefined
    ? element
    : {
        ...element,
        problems: element.problems.map((hint) => (undated(hint) ? (byKey.get(hintKey(hint)) ?? hint) : hint)),
      };
};

// The hint of a relation item has the place `.../<key>/<target>?version=<stored>[&repository=<name>]` in its
// ID (`hintIdOf` in core): a metamodel key, where an inline reference has `@text`.
const RELATION_HINT = /\/([a-z][a-z0-9-]*)\/([^/?]+)\?version=([^&]+)(?:&repository=([^&]*))?$/;

/**
 * The mark of an outgoing relation of `element` when a hint of `OUTDATED_CODES` of the element names its
 * item (`variant.core-changed` for a `replaces` item, SR-045): its key, target, stored version and repository (#665: `element.get` gives no `relations[].outdated`).
 */
export const outdatedRelation = (
  element: Pick<DataExportElement, "problems" | "repository">,
  relation: DataExportRelation,
): OutdatedMark | undefined => {
  const own = (named: string | undefined): string =>
    named === undefined ? element.repository : decodeURIComponent(named);
  const hint = (element.problems ?? []).find((candidate) => {
    const place = isOutdatedCode(candidate.code) ? RELATION_HINT.exec(candidate.hintId ?? "") : null;
    return (
      place !== null &&
      relation.direction === "out" &&
      place[1] === relation.kind &&
      place[2] === relation.id &&
      place[3] === relation.storedVersion &&
      own(place[4]) === (relation.repository ?? element.repository)
    );
  });
  return hint === undefined ? undefined : markOf(hint);
};

/**
 * The mark of the element's own derivation to the parent `id` in `repository`, for the parents line: the
 * same hint as the relation row of that derivation.
 */
export const outdatedParent = (
  element: Pick<DataExportElement, "problems" | "repository" | "relations">,
  id: string,
  repository: string,
): OutdatedMark | undefined =>
  element.relations
    .filter(
      (relation) =>
        relation.meaning === "derivation" &&
        relation.id === id &&
        (relation.repository ?? element.repository) === repository,
    )
    .map((relation) => outdatedRelation(element, relation))
    .find((mark) => mark !== undefined);

/** A relation target as a row of the buffer: a group of relations and a relation box show the same rows. */
export interface RelationRow {
  readonly id: string;
  /** The workspace name of the repository of the target; empty when the output names none. */
  readonly repository: string;
  readonly label: string;
  readonly state: DataExportRelation["targetState"];
  /** The mark of an outdated relation; undefined when it is not outdated. */
  readonly outdated: OutdatedMark | undefined;
}

/** The row of a relation of `element`. */
export const rowOfRelation = (
  relation: DataExportRelation,
  element: Pick<DataExportElement, "problems" | "repository">,
): RelationRow => ({
  id: relation.id,
  repository: relation.repository ?? "",
  label: relationLabel(relation),
  state: relation.targetState,
  outdated: outdatedRelation(element, relation),
});

export interface RelationGroup {
  /** The relation kind; incoming relations have an arrow before it ("← derives-from"). */
  readonly heading: string;
  readonly relations: readonly DataExportRelation[];
}

/**
 * The relations grouped by kind and direction, in the order of their first appearance. The targets of a
 * property of kind `relation` are boxes (SR-104) and not in a group.
 */
export const relationGroups = (relations: readonly DataExportRelation[]): RelationGroup[] => {
  const groups = new Map<string, DataExportRelation[]>();
  for (const relation of relations.filter((candidate) => !isPropertyTarget(candidate))) {
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
 * version and the repository the link names, to the message of the hint and the word after the link
 * (`outdatedWord`, with the date of the stored version once it is there). The hints come from core; the
 * first one of a reference wins. Without `property` those of the text, else those in the values of that
 * property (SR-127): every occurrence of a reference has the same state, so the key tells enough.
 */
export const outdatedReferences = (
  element: DataExportElement,
  property?: string,
): ReadonlyMap<string, OutdatedMark> => {
  const found = new Map<string, OutdatedMark>();
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
        found.set(key, markOf(problem));
      }
    }
  }
  return found;
};

/** What an element buffer shows of its element: loading, why it could not be read, or the element. */
export type ElementLoad =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ok"; readonly element: DataExportElement };

/** The element the buffer shows: once it is loaded and its parents line has answered too. */
export const shownElement = (view: ElementLoad, parentsAnswered: boolean): DataExportElement | undefined =>
  view.status === "ok" && parentsAnswered ? view.element : undefined;

/** The loaded element is read-only. */
export const isReadOnly = (view: ElementLoad): boolean =>
  view.status === "ok" && view.element.readOnly === true;
