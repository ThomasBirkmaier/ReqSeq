// One element as commands return it (`data-export.schema.json#/$defs/element`), built from its file
// as just read: what `element.create` and `element.update` give back after a write (SR-001). List
// commands give the same element without its text (`listedElement`, `model/list.ts`).
import type { Problem } from "../catalog.js";
import type { ParsedFile } from "../files/index.js";
import { elementText } from "../files/index.js";
import type { DataExportElement, DataExportRelation } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, propertyWithMeaning } from "../metamodel/index.js";
import { isVersion } from "./is-version.js";
import { comparableContent, computeVersion } from "../version/version.js";
import type {
  VersionFile,
  VersionInput,
  VersionPropertyDefinition,
  VersionValue,
} from "../version/version.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { STRUCTURAL_KEYS, isUuid } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import { findingLine } from "./locate.js";
import type { RelationKey, TargetItem } from "./relation-keys.js";
import { hasId, relationItems } from "./relation-keys.js";
import { relationTypeFindings } from "./relation-types.js";
import { targetRepository, targetState } from "./relations.js";
import { requiredFindings } from "./required.js";
import { statusFindings } from "./status-findings.js";
import type { ShortIds } from "./short-id.js";
import { UNKNOWN_TYPE_PREFIX, identifierField } from "./short-id.js";
import type { ElementStore } from "./store.js";
import type { Succession } from "./successors.js";
import { supersededFindingsOf } from "./superseded.js";
import { unknownFindings } from "./unknown.js";
import { valueFindings } from "./values.js";
import { duplicateIdentifierFindings } from "./identifiers.js";
import { emergentKeyOf, isEmergent } from "./emergent.js";

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The key of the property with the meaning `title` (D-059); undefined when no property has it. */
export const titleKeyOf = (metamodel: Metamodel): string | undefined =>
  propertyWithMeaning(metamodel, "title")?.key;

/** The key of the property with the meaning `title`, or "" when no property has it: no key is the title, so the title is empty (SR-013 AK3). */
export const titleKeyOrEmpty = (metamodel: Metamodel): string => titleKeyOf(metamodel) ?? "";

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
 * answered). Each target also names the repository it is looked up in (`targetRepository`, #416).
 */
const relationsUnder = (
  input: ListedElementInput,
  key: string,
  relation: Pick<RelationKey, "many">,
  extra: Pick<DataExportRelation, "meaning" | "property">,
): DataExportRelation[] =>
  relationItems(key, relation, input.record.data[key]).flatMap(([, item]): DataExportRelation[] =>
    hasId(item) && isUuid(item.id) ? [relationLink(input, input.record, key, item, extra)] : [],
  );

/** What a link to or from another element reads: the inputs of a view without the element itself. */
export type LinkInput = Pick<ListedElementInput, "store" | "shortIds" | "titleKey" | "layout">;

/**
 * The relation of `source` under `key` to the target `item` (a mapping with a UUID as `id`) as
 * `element.get` lists it (`relationsUnder`), with `direction: "out"` and the other end's `targetState`.
 * The one builder of an outgoing relation, shared by the element view and the traceability matrix
 * (SR-125).
 */
export const relationLink = (
  input: LinkInput,
  source: ElementRecord,
  key: string,
  item: TargetItem,
  extra: Pick<DataExportRelation, "meaning" | "property">,
): DataExportRelation => {
  const { store, shortIds, titleKey, layout } = input;
  const { id, version, repository: stored } = item;
  const state = targetState(layout, store, source.repository, { id, repository: stored });
  const repository = targetRepository(state);
  const target = state.kind === "available" ? state.element : undefined;
  const title = target?.data[titleKey];
  const shortId =
    target !== undefined
      ? shortIds.of(target)
      : state.kind === "inaccessible"
        ? `${UNKNOWN_TYPE_PREFIX}-${shortIds.tail(id)}`
        : undefined;
  return {
    kind: key,
    ...extra,
    direction: "out",
    id,
    ...(repository === undefined ? {} : { repository }),
    ...(shortId === undefined ? {} : { shortId }),
    ...(target === undefined ? {} : identifierField(shortIds, target)),
    ...(typeof title === "string" ? { title } : {}),
    accessible: target !== undefined,
    targetState: state.kind,
    ...(isVersion(version) ? { storedVersion: version } : {}),
  };
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
 * `succession` from a successor to it (`input.successionsOf`, `successionsFor`), as a relation with
 * `direction: "in"`. The other end is the successor, with its `targetState` (D-058): `available`
 * when its repository has exactly one element with its UUID, then also with its short ID and
 * title, also across repositories (SR-005 AK2); `ambiguous` when several files share it (SR-088).
 * It names the successor's repository (#416). `storedVersion` is the version the successor stores,
 * when it is one. The superseded element itself has no relation to its successor (D-045).
 */
const successorRelations = (input: ListedElementInput): DataExportRelation[] =>
  input
    .successionsOf(input.record)
    .map(({ source, kind, item }) => sourceLink(input, source, kind.key, item, { meaning: "succession" }));

/**
 * The relation under `key` in `source` that points at an element, as the element it points at sees
 * it: `direction: "in"`, the other end is `source` with its `targetState` (D-058): `available` when
 * its repository has exactly one element with its UUID, then also with its short ID and title, also
 * across repositories (SR-005 AK2); `ambiguous` when several files share it (SR-088). It names the
 * source's repository (#416). `storedVersion` is the version `item` stores, when it is one. The one
 * builder of an incoming relation, shared by the successors of a superseded element (SR-072 AK3) and
 * the traceability matrix (SR-125).
 */
export const sourceLink = (
  input: LinkInput,
  source: ElementRecord,
  key: string,
  item: TargetItem,
  extra: Pick<DataExportRelation, "meaning" | "property">,
): DataExportRelation => {
  const state = targetState(input.layout, input.store, source.repository, { id: source.id });
  const available = state.kind === "available";
  const title = source.data[input.titleKey];
  return {
    kind: key,
    ...extra,
    direction: "in",
    id: source.id,
    repository: source.repository,
    ...(available ? { shortId: input.shortIds.of(source), ...identifierField(input.shortIds, source) } : {}),
    ...(available && typeof title === "string" ? { title } : {}),
    accessible: available,
    targetState: state.kind,
    ...(isVersion(item["version"]) ? { storedVersion: item["version"] } : {}),
  };
};

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
): string => computeVersion(versionInput(record, body, metamodel, images));

/** What the version of an element is computed from (`elementVersion`, `elementContent`). */
const versionInput = (
  record: Pick<ElementRecord, "type" | "data">,
  body: string,
  metamodel: Metamodel,
  images: readonly VersionFile[],
): VersionInput => ({
  text: body,
  properties: record.data as Readonly<Record<string, VersionValue>>,
  definitions: versionDefinitions(record, metamodel),
  files: images,
});

/**
 * What the version of an element is computed from, as `comparableContent` writes it: equal for two
 * states of an element exactly when their versions are equal, also when a value that counts has
 * no normal form and there is no version (`.inf`, `.nan`, ADR-0005). For telling whether a save
 * changed the content (SR-024 AK2, AK3; #276); never shown.
 */
export const elementContent = (
  record: Pick<ElementRecord, "type" | "data">,
  body: string,
  metamodel: Metamodel,
  images: readonly VersionFile[],
): string => comparableContent(versionInput(record, body, metamodel, images));

/** Why `record` has no version, for the RangeError `versionOrRangeError` gave: its file, repository and reason. */
export const notComputableMessage = (
  record: Pick<ElementRecord, "repository" | "file">,
  error: RangeError,
): string => `${record.file} of repository ${record.repository}: ${error.message}`;

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

/**
 * Why `record` has no version (`why`: the file and the reason, as `CurrentVersion` says it), as a
 * `file.faulty` warning on the element: the same for a view (`elementView`) and a list
 * (`listElements`).
 */
export const noVersionProblem = (
  record: Pick<ElementRecord, "id" | "repository" | "file">,
  why: string,
): Problem => ({
  code: "file.faulty",
  severity: "warning",
  message: `No version: ${why}`,
  repository: record.repository,
  file: record.file,
  elementId: record.id,
});

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
  /**
   * Hints of blocks that import the model, before their lines are known, listed after the others
   * and only while the metamodel is valid: what the caller's `ElementHints` gave for `record`
   * (`showElement`, `finish` of the writes).
   */
  readonly extraFindings?: readonly LocatableFinding[];
}

/** What `listedElement` reads: the inputs of a view without the file. */
export type ListedElementInput = Pick<
  ElementViewInput,
  "record" | "metamodel" | "store" | "shortIds" | "titleKey" | "layout" | "successionsOf"
>;

/**
 * The element as list commands give it (`data-export.schema.json#/$defs/element`): `version` (the
 * caller gives the current one, ADR-0005; left out when it has none), `emergent: true` when it is
 * marked emergent (`isEmergent`, SR-035), its properties (every key
 * except `id`, `type`, `status`, the title and relation kinds, unknown keys included), its own
 * relations, then, when it is superseded, the relations from its successors (`successorRelations`,
 * SR-072 AK3). Without its text (the list commands leave it out, so no file is read), hints and
 * `readOnly`; `elementView` adds them. `input.successionsOf` must come from `successionsFor`.
 */
export const listedElement = (input: ListedElementInput, version: string | undefined): DataExportElement => {
  const { record, metamodel, shortIds, titleKey } = input;
  const relationKeys = new Set(metamodel.relations.map((r) => r.key));
  // Left out for an element without status, such as one of a type without status (#306).
  const status = text(record.data["status"]);
  const properties = Object.fromEntries(
    Object.entries(record.data).filter(
      ([key]) => !STRUCTURAL_KEYS.includes(key) && key !== titleKey && !relationKeys.has(key),
    ),
  );
  return {
    id: record.id,
    shortId: shortIds.of(record),
    ...identifierField(shortIds, record),
    type: record.type,
    ...(status === "" ? {} : { status }),
    title: text(record.data[titleKey]),
    ...(version === undefined ? {} : { version }),
    repository: record.repository,
    file: record.file,
    // Only `true` is given (SR-035): the property with the meaning `emergent` stays in `properties`.
    ...(isEmergent(record, emergentKeyOf(metamodel)) ? { emergent: true } : {}),
    properties,
    relations: [...outgoingRelations(input), ...successorRelations(input)],
  };
};

/**
 * The element as `listedElement` gives it, with its text, its version (ADR-0005, with the embedded
 * images of `input.images`) and the hints with their lines: unknown type and properties (SR-016),
 * required properties without a value (SR-015, SR-064), values of the wrong kind (SR-085), an
 * identifier another element of its type has (#305),
 * relations between types the metamodel does not allow (SR-086), then relations to superseded
 * elements (SR-072 AK2); no hints while the metamodel is not valid (#208, #220 option 1). The
 * successor relations are relations, not hints, so they are listed also then. Other relations
 * pointing at it and the version date are left out.
 *
 * A value that counts and has no normal form (`.inf`, `.nan`, ADR-0005) leaves out `version`, and
 * the last problem is a `file.faulty` warning that says why (`noVersionProblem`), as list commands
 * and the current versions give such an element (#259, #276): the view never fails on it.
 */
export const elementView = (
  input: ElementViewInput,
): DataExportElement & { readonly problems: readonly Problem[] } => {
  const { record, file, metamodel, shortIds } = input;
  // No hints against a metamodel that is not valid: its errors are the findings (#208, #220).
  const findings: readonly LocatableFinding[] = metamodel.valid
    ? [
        ...unknownFindings(record, metamodel),
        ...requiredFindings(record, metamodel),
        ...statusFindings(record, metamodel),
        ...valueFindings(record, metamodel),
        ...duplicateIdentifierFindings(record, { metamodel, shortIds }),
        ...relationTypeFindings(record, { store: input.store, metamodel, shortIds }),
        ...supersededFindingsOf({ store: input.store, metamodel, shortIds }, record, input.successionsOf),
        ...(input.extraFindings ?? []),
      ]
    : [];
  const problems: Problem[] = findings.map((f) => {
    const line = findingLine(file, f);
    return line === undefined ? f.problem : { ...f.problem, line };
  });
  // A number that counts and is not finite has no canonical form; anything else is a bug.
  const computed = versionOrRangeError(() => elementVersion(record, file.body, metamodel, input.images));
  const version = computed instanceof RangeError ? undefined : computed;
  if (computed instanceof RangeError) {
    problems.push(noVersionProblem(record, notComputableMessage(record, computed)));
  }
  const { id, shortId, identifier, type, status, title, ...rest } = listedElement(input, version);
  // The text after the title, as the element files and the schema order it; without the blank line
  // after the frontmatter, so element.update takes it back unchanged (#308).
  return {
    id,
    shortId,
    ...(identifier === undefined ? {} : { identifier }),
    type,
    ...(status === undefined ? {} : { status }),
    title,
    text: elementText(file.body),
    ...rest,
    problems,
  };
};
