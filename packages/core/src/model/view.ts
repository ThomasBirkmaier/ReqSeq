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
import { resolveId } from "./duplicates.js";
import type { ElementRecord } from "./elements.js";
import { STRUCTURAL_KEYS, isUuid, lineOf } from "./elements.js";
import type { ShortIds } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { valueFindings } from "./values.js";

const isVersion = (value: unknown): value is string =>
  fileSchemaValidator("common.schema.json#/$defs/version")(value);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The key of the property with the meaning `title` (D-059); undefined when no property has it. */
export const titleKeyOf = (metamodel: Metamodel): string | undefined =>
  propertyWithMeaning(metamodel, "title")?.key;

/**
 * The element's own relations: the targets under the keys of relation kinds, in the order of the
 * relation kinds in the metamodel, then of the items. Items that are not a target with a UUID are
 * left out; the value-kind check reports them (SR-085). A target counts as accessible only when the
 * store has exactly one element with its UUID; then its title and short ID are given (SR-005 AK2,
 * SR-006). A UUID shared by several files (SR-088) is not accessible: which one is meant is unknown.
 * Repository-aware lookup (D-058) and a target state follow with `resolveTarget` (#162, #18).
 */
const outgoingRelations = (
  record: ElementRecord,
  metamodel: Metamodel,
  store: ElementStore,
  shortIds: ShortIds,
  titleKey: string,
): DataExportRelation[] =>
  metamodel.relations.flatMap((kind) => {
    const value = record.data[kind.key];
    const items: readonly unknown[] = Array.isArray(value) ? value : value === undefined ? [] : [value];
    return items.filter(isRecord).flatMap((item): DataExportRelation[] => {
      const { id, version } = item;
      if (!isUuid(id)) {
        return [];
      }
      const match = resolveId(store.byId, id);
      const target = match.kind === "found" ? match.element : undefined;
      const title = target?.data[titleKey];
      return [
        {
          kind: kind.key,
          ...(kind.meaning === undefined ? {} : { meaning: kind.meaning }),
          direction: "out",
          id,
          ...(target === undefined ? {} : { shortId: shortIds.of(target) }),
          ...(typeof title === "string" ? { title } : {}),
          accessible: target !== undefined,
          ...(isVersion(version) ? { storedVersion: version } : {}),
        },
      ];
    });
  });

/** The definitions of the properties the element's type has; none for an unknown type. */
const versionDefinitions = (record: ElementRecord, metamodel: Metamodel): VersionPropertyDefinition[] => {
  const keys = new Set(findType(metamodel, record.type)?.properties ?? []);
  return metamodel.properties
    .filter((p) => keys.has(p.key))
    .map((p) => ({ key: p.key, kind: p.kind, ...(p.content === undefined ? {} : { content: p.content }) }));
};

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
}

/**
 * The element with its text, its version (ADR-0005; embedded images are not counted yet, #131),
 * its properties (every key except `id`, `type`, `status`, the title and relation kinds, unknown
 * keys included), its own relations and the value-kind hints with their lines (SR-085). Relations
 * pointing at it and the version date are left out.
 */
export const elementView = (
  input: ElementViewInput,
): DataExportElement & { readonly problems: readonly Problem[] } => {
  const { record, file, metamodel, store, shortIds, titleKey } = input;
  const relationKeys = new Set(metamodel.relations.map((r) => r.key));
  const properties = Object.fromEntries(
    Object.entries(record.data).filter(
      ([key]) => !STRUCTURAL_KEYS.includes(key) && key !== titleKey && !relationKeys.has(key),
    ),
  );
  const problems: Problem[] = valueFindings(record, metamodel).map((f) => {
    const line = lineOf(file, f.path);
    return line === undefined ? f.problem : { ...f.problem, line };
  });
  return {
    id: record.id,
    shortId: shortIds.of(record),
    type: record.type,
    status: text(record.data["status"]),
    title: text(record.data[titleKey]),
    text: file.body,
    version: computeVersion({
      text: file.body,
      properties: record.data as Readonly<Record<string, VersionValue>>,
      definitions: versionDefinitions(record, metamodel),
      files: [],
    }),
    repository: record.repository,
    file: record.file,
    properties,
    relations: outgoingRelations(record, metamodel, store, shortIds, titleKey),
    problems,
  };
};
