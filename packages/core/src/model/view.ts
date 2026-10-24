// One element as commands return it (`data-export.schema.json#/$defs/element`), built from its file
// as just read: what `element.create` and `element.update` give back after a write (SR-001).
import type { Problem } from "../catalog.js";
import type { ParsedFile } from "../files/index.js";
import type { DataExportElement, DataExportRelation } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, propertyWithMeaning } from "../metamodel/index.js";
import { fileSchemaValidator } from "../runtime/contracts.js";
import { computeVersion } from "../version/version.js";
import type { VersionPropertyDefinition, VersionValue } from "../version/version.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { STRUCTURAL_KEYS, isUuid } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import { findingLine } from "./locate.js";
import type { RelationKey } from "./relation-keys.js";
import { hasId, relationItems } from "./relation-keys.js";
import { targetState } from "./relations.js";
import { requiredFindings } from "./required.js";
import type { ShortIds } from "./short-id.js";
import { UNKNOWN_TYPE_PREFIX } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { supersededFindingsOf } from "./superseded.js";
import { unknownFindings } from "./unknown.js";
import { valueFindings } from "./values.js";

const isVersion = (value: unknown): value is string =>
  fileSchemaValidator("common.schema.json#/$defs/version")(value);

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
  input: ElementViewInput,
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
const outgoingRelations = (input: ElementViewInput): DataExportRelation[] => {
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

/** The definitions of the properties the element's type has; none for an unknown type. */
const versionDefinitions = (record: ElementRecord, metamodel: Metamodel): VersionPropertyDefinition[] => {
  const keys = new Set(findType(metamodel, record.type)?.properties ?? []);
  return metamodel.properties
    .filter((p) => keys.has(p.key))
    .map((p) => ({ key: p.key, kind: p.kind, ...(p.content === undefined ? {} : { content: p.content }) }));
};

/**
 * The version of an element (ADR-0005) from its record and the text of its file; embedded images
 * are not counted yet (#131). The one place model code computes it, for views and stored targets.
 */
export const elementVersion = (record: ElementRecord, body: string, metamodel: Metamodel): string =>
  computeVersion({
    text: body,
    properties: record.data as Readonly<Record<string, VersionValue>>,
    definitions: versionDefinitions(record, metamodel),
    files: [],
  });

export interface ElementViewInput {
  /** The element as classified from `file`. */
  readonly record: ElementRecord;
  /** The file as just read: its text and the lines of findings. */
  readonly file: ParsedFile;
  readonly metamodel: Metamodel;
  /** Targets of relations are looked up here. */
  readonly store: ElementStore;
  /** Short IDs that include `record`. */
  readonly shortIds: ShortIds;
  /** Key of the property with the meaning `title` (`titleKeyOf`). */
  readonly titleKey: string;
  /** Which repositories of the workspace are on this machine (`targetState`, SR-006). */
  readonly layout: Pick<WorkspaceLayout, "repositories">;
}

/**
 * The element with its text, its version (ADR-0005; embedded images are not counted yet, #131),
 * its properties (every key except `id`, `type`, `status`, the title and relation kinds, unknown
 * keys included), its own relations and the hints with their lines: unknown type and properties
 * (SR-016), required properties without a value (SR-015, SR-064), values of the wrong kind
 * (SR-085), then relations to superseded elements (SR-072 AK2). Relations pointing at it and the
 * version date are left out.
 */
export const elementView = (
  input: ElementViewInput,
): DataExportElement & { readonly problems: readonly Problem[] } => {
  const { record, file, metamodel, shortIds, titleKey } = input;
  const relationKeys = new Set(metamodel.relations.map((r) => r.key));
  const properties = Object.fromEntries(
    Object.entries(record.data).filter(
      ([key]) => !STRUCTURAL_KEYS.includes(key) && key !== titleKey && !relationKeys.has(key),
    ),
  );
  const findings: readonly LocatableFinding[] = [
    ...unknownFindings(record, metamodel),
    ...requiredFindings(record, metamodel),
    ...valueFindings(record, metamodel),
    ...supersededFindingsOf({ store: input.store, metamodel, shortIds }, record),
  ];
  const problems: Problem[] = findings.map((f) => {
    const line = findingLine(file, f);
    return line === undefined ? f.problem : { ...f.problem, line };
  });
  return {
    id: record.id,
    shortId: shortIds.of(record),
    type: record.type,
    status: text(record.data["status"]),
    title: text(record.data[titleKey]),
    text: file.body,
    version: elementVersion(record, file.body, metamodel),
    repository: record.repository,
    file: record.file,
    properties,
    relations: outgoingRelations(input),
    problems,
  };
};
