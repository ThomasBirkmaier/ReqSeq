// One element as commands return it (`data-export.schema.json#/$defs/element`), built from its file
// as just read: what `element.create` and `element.update` give back after a write (SR-001). List
// commands give the same element without its text (`listedElement`, `model/list.ts`).
import type { Problem } from "../catalog.js";
import type { ParsedFile } from "../files/index.js";
import type { DataExportElement, DataExportRelation } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, propertyWithMeaning } from "../metamodel/index.js";
import { isVersion } from "./is-version.js";
import { computeVersion } from "../version/version.js";
import type { VersionFile, VersionPropertyDefinition, VersionValue } from "../version/version.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { STRUCTURAL_KEYS, isUuid } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import { findingLine } from "./locate.js";
import type { RelationKey } from "./relation-keys.js";
import { hasId, relationItems } from "./relation-keys.js";
import { relationTypeFindings } from "./relation-types.js";
import { targetState } from "./relations.js";
import { requiredFindings } from "./required.js";
import type { ShortIds } from "./short-id.js";
import { UNKNOWN_TYPE_PREFIX } from "./short-id.js";
import type { ElementStore } from "./store.js";
import type { Succession } from "./successors.js";
import { supersededFindingsOf } from "./superseded.js";
import { unknownFindings } from "./unknown.js";
import { valueFindings } from "./values.js";

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The key of the property with the meaning `title` (D-059); undefined when no property has it. */
export const titleKeyOf = (metamodel: Metamodel): string | undefined =>
  propertyWithMeaning(metamodel, "title")?.key;

/**
 * The relations to the targets stored under `key`: a relation kind, or a property of kind
 * `relation`, whose `kind` the entries carry; `extra` adds the relation kind's `meaning`, or
 * `property: true` for a property. The items are read as the checks read them (`relationItems`,
 * `hasId`; SR-086, SR-089), with `many` as `relationKey` gives it: a list for a relation kind and a
 * property with `many`, one target otherwise. Items of the wrong shape and items that are not a target with a
 * UUID are left out; the value-kind check reports them (SR-085). Each target has its `targetState`
 * (D-058): it is looked up in the repository it names, or in the source's own when it names none.
 * It counts as accessible only when it is `available`, that is that repository has exactly one
 * element with its UUID; then the title and short ID of that element are given, also across
 * repositories, where the file stores no title (SR-005 AK2). A target in a repository that is not
 * on this machine shows only its short ID (SR-006 AK1): the tail of its UUID with the prefix
 * `UNKNOWN`, since its type is not known (assumption until spec questions #154 and #193 are
 * answered).
 */
const relationsUnder = (
  input: ListedElementInput,
  key: string,
  relation: Pick<RelationKey, "many">,
  extra: Pick<DataExportRelation, "meaning" | "property">,
): DataExportRelation[] => {
  const { record, store, shortIds, titleKey, layout } = input;
  return relationItems(key, relation, record.data[key]).flatMap(([, item]): DataExportRelation[] => {
    if (!hasId(item) || !isUuid(item.id)) {
      return [];
    }
    const { id, version, repository } = item;
    const state = targetState(layout, store, record.repository, { id, repository });
    const target = state.kind === "available" ? state.element : undefined;
    const title = target?.data[titleKey];
    const shortId =
      target !== undefined
        ? shortIds.of(target)
        : state.kind === "inaccessible"
          ? `${UNKNOWN_TYPE_PREFIX}-${shortIds.tail(id)}`
          : undefined;
    return [
      {
        kind: key,
        ...extra,
        direction: "out",
        id,
        ...(shortId === undefined ? {} : { shortId }),
        ...(typeof title === "string" ? { title } : {}),
        accessible: target !== undefined,
        targetState: state.kind,
        ...(isVersion(version) ? { storedVersion: version } : {}),
      },
    ];
  });
};

/**
 * The element's own relations (`relationsUnder`): the targets under the keys of relation kinds, in
 * the order of the relation kinds in the metamodel, then of the items; then the targets of
 * properties of kind `relation` (validity, packages), in the order of the properties, with the
 * property key as `kind`, `property: true` and no `meaning` (#187). Those targets also stay under
 * `properties` as stored. Keys are unique across properties and relation kinds (ADR-0004), so no
 * target is listed twice.
 */
const outgoingRelations = (input: ListedElementInput): DataExportRelation[] => {
  const { metamodel } = input;
  return [
    ...metamodel.relations.flatMap((kind) =>
      relationsUnder(
        input,
        kind.key,
        { many: true },
        kind.meaning === undefined ? {} : { meaning: kind.meaning },
      ),
    ),
    ...metamodel.properties
      .filter((p) => p.kind === "relation")
      .flatMap((p) => relationsUnder(input, p.key, { many: p.many === true }, { property: true })),
  ];
};

/**
 * The successors of a superseded element (SR-072 AK3): each relation with the meaning
 * `replacement` from a successor to it (`input.successionsOf`, `successionsFor`), as a relation with
 * `direction: "in"`. The other end is the successor, with its `targetState` (D-058): `available`
 * when its repository has exactly one element with its UUID, then also with its short ID and
 * title, also across repositories (SR-005 AK2); `ambiguous` when several files share it (SR-088).
 * `storedVersion` is the version the successor stores, when it is one. The superseded element
 * itself has no relation to its successor (D-045).
 */
const successorRelations = (input: ListedElementInput): DataExportRelation[] =>
  input.successionsOf(input.record).map(({ source, kind, item }): DataExportRelation => {
    const state = targetState(input.layout, input.store, source.repository, { id: source.id });
    const available = state.kind === "available";
    const title = source.data[input.titleKey];
    return {
      kind: kind.key,
      meaning: "replacement",
      direction: "in",
      id: source.id,
      ...(available ? { shortId: input.shortIds.of(source) } : {}),
      ...(available && typeof title === "string" ? { title } : {}),
      accessible: available,
      targetState: state.kind,
      ...(isVersion(item["version"]) ? { storedVersion: item["version"] } : {}),
    };
  });

/** The definitions of the properties the element's type has; none for an unknown type. */
const versionDefinitions = (
  record: Pick<ElementRecord, "type">,
  metamodel: Metamodel,
): VersionPropertyDefinition[] => {
  const keys = new Set(findType(metamodel, record.type)?.properties ?? []);
  return metamodel.properties
    .filter((p) => keys.has(p.key))
    .map((p) => ({ key: p.key, kind: p.kind, ...(p.content === undefined ? {} : { content: p.content }) }));
};

/**
 * The version of an element (ADR-0005) from its record, the text of its file and the images the
 * text embeds (`embeddedImages`). The one place model code computes it, for views, stored targets
 * and the versions at old commits (`version-date.ts`).
 */
export const elementVersion = (
  record: Pick<ElementRecord, "type" | "data">,
  body: string,
  metamodel: Metamodel,
  images: readonly VersionFile[],
): string =>
  computeVersion({
    text: body,
    properties: record.data as Readonly<Record<string, VersionValue>>,
    definitions: versionDefinitions(record, metamodel),
    files: images,
  });

/**
 * The version `compute` gives (`elementVersion`), or the RangeError it throws for a value that
 * counts and has no normal form (`.inf`, `.nan`, ADR-0005). Any other error is a bug and passed on.
 * For the readers that need a version of every element (current versions, #259) or of the element
 * before a save (SR-024 AK2) without failing on such a value.
 */
export const versionOrRangeError = (compute: () => string): string | RangeError => {
  try {
    return compute();
  } catch (error) {
    if (error instanceof RangeError) {
      return error;
    }
    throw error;
  }
};

export interface ElementViewInput {
  /** The element as classified from `file`. */
  readonly record: ElementRecord;
  /** The file as just read: its text and the lines of findings. */
  readonly file: ParsedFile;
  /** The images its text embeds, read with `embeddedImages`; they count to the version. */
  readonly images: readonly VersionFile[];
  readonly metamodel: Metamodel;
  /** Targets of relations are looked up here. */
  readonly store: ElementStore;
  /** Short IDs that include `record`. */
  readonly shortIds: ShortIds;
  /** Key of the property with the meaning `title` (`titleKeyOf`). */
  readonly titleKey: string;
  /** Which repositories of the workspace are on this machine (`targetState`, SR-006). */
  readonly layout: Pick<WorkspaceLayout, "repositories">;
  /**
   * The relations from the successors of an element in `store`: `successionsFor` with the same
   * `store` and `metamodel`; `() => []` lists none. Asked for `record` (its successors, SR-072 AK3)
   * and for the superseded targets of its relations (the successors their hints name, SR-072 AK2),
   * so no view walks the store (`supersededFindingsOf`, N-036).
   */
  readonly successionsOf: (element: ElementRecord) => readonly Succession[];
  /** Hints of blocks that import the model (variants, SR-040 AK3), listed after the others. */
  readonly extraFindings?: ExtraFindings;
}

/**
 * Hints on one element from a block that imports the model, so the model cannot ask it itself
 * (`supersededValidityFindingsOf`, SR-040 AK3), before their lines are known. Asked only while
 * the metamodel is valid. `record` is the element as shown.
 */
export type ExtraFindings = (
  context: Pick<ElementViewInput, "store" | "metamodel" | "shortIds">,
  record: ElementRecord,
) => readonly LocatableFinding[];

/** What `listedElement` reads: the inputs of a view without the file. */
export type ListedElementInput = Pick<
  ElementViewInput,
  "record" | "metamodel" | "store" | "shortIds" | "titleKey" | "layout" | "successionsOf"
>;

/**
 * The element as list commands give it (`data-export.schema.json#/$defs/element`): `version` (the
 * caller gives the current one, ADR-0005; left out when it has none), its properties (every key
 * except `id`, `type`, `status`, the title and relation kinds, unknown keys included), its own
 * relations, then, when it is superseded, the relations from its successors (`successorRelations`,
 * SR-072 AK3). Without its text (the list commands leave it out, so no file is read), hints and
 * `readOnly`; `elementView` adds them. `input.successionsOf` must come from `successionsFor`.
 */
export const listedElement = (input: ListedElementInput, version: string | undefined): DataExportElement => {
  const { record, metamodel, shortIds, titleKey } = input;
  const relationKeys = new Set(metamodel.relations.map((r) => r.key));
  const properties = Object.fromEntries(
    Object.entries(record.data).filter(
      ([key]) => !STRUCTURAL_KEYS.includes(key) && key !== titleKey && !relationKeys.has(key),
    ),
  );
  return {
    id: record.id,
    shortId: shortIds.of(record),
    type: record.type,
    status: text(record.data["status"]),
    title: text(record.data[titleKey]),
    ...(version === undefined ? {} : { version }),
    repository: record.repository,
    file: record.file,
    properties,
    relations: [...outgoingRelations(input), ...successorRelations(input)],
  };
};

/**
 * The element as `listedElement` gives it, with its text, its version (ADR-0005, with the embedded
 * images of `input.images`) and the hints with their lines: unknown type and properties (SR-016),
 * required properties without a value (SR-015, SR-064), values of the wrong kind (SR-085),
 * relations between types the metamodel does not allow (SR-086), then relations to superseded
 * elements (SR-072 AK2); no hints while the metamodel is not valid (#208, #220 option 1). The
 * successor relations are relations, not hints, so they are listed also then. Other relations
 * pointing at it and the version date are left out.
 */
export const elementView = (
  input: ElementViewInput,
): DataExportElement & { readonly version: string; readonly problems: readonly Problem[] } => {
  const { record, file, metamodel, shortIds } = input;
  // No hints against a metamodel that is not valid: its errors are the findings (#208, #220).
  const findings: readonly LocatableFinding[] = metamodel.valid
    ? [
        ...unknownFindings(record, metamodel),
        ...requiredFindings(record, metamodel),
        ...valueFindings(record, metamodel),
        ...relationTypeFindings(record, { store: input.store, metamodel, shortIds }),
        ...supersededFindingsOf({ store: input.store, metamodel, shortIds }, record, input.successionsOf),
        ...(input.extraFindings?.(input, record) ?? []),
      ]
    : [];
  const problems: Problem[] = findings.map((f) => {
    const line = findingLine(file, f);
    return line === undefined ? f.problem : { ...f.problem, line };
  });
  const version = elementVersion(record, file.body, metamodel, input.images);
  const { id, shortId, type, status, title, ...rest } = listedElement(input, version);
  // The text after the title, as the element files and the schema order it; a view always has its
  // version (the version date of `element.get` is asked for it).
  return { id, shortId, type, status, title, text: file.body, version, ...rest, problems };
};
