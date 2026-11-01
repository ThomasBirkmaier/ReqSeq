// A repeated delivery (SR-056, ADR-0013 "Import"): the elements of an earlier delivery of the same
// source, matched only by `source` and `source-identifier`, and the edits that update one of them.
//
// - `existingElements` reads them for `planImport`: every element of the source (all repositories)
//   whose source IDENTIFIER the file has is matched, each read as for a write (`readAllUnchanged`)
//   with its current version (`currentVersionsOf`, only these records, N-036) and the images in its
//   image folder; the others are dropped (AK3, only listed). Two elements with one IDENTIFIER of
//   the file are `input.invalid` (`reason: origin-duplicate`); an element of a type the metamodel
//   does not know is `element.read-only` (SR-016 AK3). An element whose source IDENTIFIER is no
//   text cannot be matched and is not listed.
// - `relationEdits` replaces the items of a mapped relation kind that point to elements of the
//   source with the delivery's and keeps every other item (local relations).
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CommandError } from "../catalog.js";
import type { FlowMappingValue, FrontmatterEdit, ItemValue } from "../files/index.js";
import { sha256, zip } from "../files/index.js";
import type { Problem, ReqifObject } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord, ElementStore } from "../model/index.js";
import { assertElementWritable, currentVersionsOf, elementStoreState, hasId } from "../model/index.js";
import type { UnchangedElement } from "../model/write.js";
import { readAllUnchanged } from "../model/write.js";
import type { Workspace } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { ReqifFile } from "./model.js";
import type { OriginKeys } from "./origin.js";

/** An element of an earlier delivery whose SPEC-OBJECT the file has again. */
export interface ExistingElement extends UnchangedElement {
  readonly record: ElementRecord;
  /** Its current version (C), or undefined with `unknown` saying why it has none. */
  readonly version: string | undefined;
  readonly unknown?: string;
  /** Its stored import version (I), undefined when it has none as text. */
  readonly imported: string | undefined;
  /** The files in its image folder, which keep their names (`ImageNames.reserve`). */
  readonly images: readonly { readonly name: string; readonly sha256: string }[];
}

/** The elements of the source: matched by source IDENTIFIER, dropped, and the UUIDs of all of them. */
export interface ExistingElements {
  readonly matched: ReadonlyMap<string, ExistingElement>;
  readonly dropped: readonly ReqifObject[];
  readonly ids: ReadonlySet<string>;
}

/** No earlier delivery. */
export const NO_EXISTING: ExistingElements = { matched: new Map(), dropped: [], ids: new Set() };

/**
 * The regular files in the image folder of the element file `file` (the file name without `.md`).
 * A folder that is not there, or cannot be read, has none: a copy that then clashes with a file
 * there fails in the write with its own error, and nothing is replaced.
 */
const folderImages = async (
  root: string,
  file: string,
): Promise<{ readonly name: string; readonly sha256: string }[]> => {
  const folder = path.join(root, file.slice(0, -".md".length));
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    const out: { name: string; sha256: string }[] = [];
    for (const entry of entries) {
      if (entry.isFile()) {
        out.push({ name: entry.name, sha256: sha256(await fs.readFile(path.join(folder, entry.name))) });
      }
    }
    return out;
  } catch {
    return [];
  }
};

/** The elements of `source` the delivery `file` meets again (see the file comment). */
export const existingElements = async (
  workspace: Workspace,
  layout: WorkspaceLayout,
  metamodel: Metamodel,
  file: ReqifFile,
  source: string,
  keys: OriginKeys,
): Promise<ExistingElements> => {
  const store = await workspace.get(elementStoreState);
  const delivered = new Set(file.specObjects.map((o) => o.identifier));
  const groups = new Map<string, ElementRecord[]>();
  const dropped: ReqifObject[] = [];
  const ids = new Set<string>();
  for (const record of store.elements) {
    const identifier = record.data[keys["source-identifier"]];
    if (record.data[keys.source] !== source || typeof identifier !== "string") {
      continue;
    }
    ids.add(record.id);
    if (delivered.has(identifier)) {
      groups.set(identifier, [...(groups.get(identifier) ?? []), record]);
    } else {
      dropped.push({ identifier, id: record.id });
    }
  }
  for (const [identifier, records] of groups) {
    if (records.length > 1) {
      const files = records.map((r) => `${r.repository}:${r.file}`);
      throw new CommandError(
        "input.invalid",
        `Not imported: the elements in ${files.join(" and ")} both have source ${source} and source IDENTIFIER ${identifier}; give one of them another origin or supersede it by hand`,
        { identifier, files, reason: "origin-duplicate" },
      );
    }
  }
  const records = [...groups.values()].flat();
  for (const record of records) {
    assertElementWritable(metamodel, record);
  }
  const read = await readAllUnchanged(
    workspace,
    layout,
    records.map((record) => ({ record })),
  );
  const versions = await currentVersionsOf(workspace, records);
  const matched = new Map<string, ExistingElement>();
  // currentVersionsOf gives every record asked for, in their order, as readAllUnchanged does.
  for (const [item, current] of zip(read, [...versions.values()])) {
    const { record } = item;
    const imported = record.data[keys["import-version"]];
    matched.set(String(record.data[keys["source-identifier"]]), {
      ...item,
      version: current.kind === "version" ? current.version : undefined,
      ...(current.kind === "unknown" ? { unknown: current.message } : {}),
      imported: typeof imported === "string" ? imported : undefined,
      images: await folderImages(item.repository.folder, record.file),
    });
  }
  return { matched, dropped, ids };
};

/**
 * The element files the store cannot read (an error at a file: faulty YAML, conflict markers, an
 * invalid `id` or `type`, SR-008). One of them may be an element of the source, which the import
 * then could not match and would create again (#575/8).
 */
export const unreadableFiles = (store: ElementStore): Problem[] =>
  store.problems.filter((p) => p.severity === "error" && p.file !== undefined);

/** A relation item as the import writes it. */
export type RelationItem = FlowMappingValue;

/** The target of a relation item: UUID and repository, not the version. */
const targetKey = (item: Readonly<Record<string, unknown>>): string =>
  JSON.stringify([item["id"], item["repository"] ?? null]);

/** The items stored under `kind`, as a list (one value as one item). */
const storedItems = (data: Readonly<Record<string, unknown>>, kind: string): readonly unknown[] => {
  const value = data[kind];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
};

/**
 * The indexes of the stored items the delivery decides: those to an element of the source (`ids`)
 * and those to a target the delivery's `items` name (such as a missing one of a file of ReqSeq).
 */
const decided = (
  stored: readonly unknown[],
  items: readonly RelationItem[],
  ids: ReadonlySet<string>,
): number[] => {
  const named = new Set(items.map(targetKey));
  return stored.flatMap((item, index) =>
    hasId(item) && (ids.has(item.id) || named.has(targetKey(item))) ? [index] : [],
  );
};

/**
 * Whether the targets (UUID and repository, not the version) of the items of `kind` the delivery
 * decides differ from its `items`: a local relation edit the delivery replaces (#575/4).
 */
export const targetsDiffer = (
  data: Readonly<Record<string, unknown>>,
  kind: string,
  items: readonly RelationItem[],
  ids: ReadonlySet<string>,
): boolean => {
  const stored = storedItems(data, kind);
  const own = new Set(
    decided(stored, items, ids).map((i) => targetKey(stored[i] as Readonly<Record<string, unknown>>)),
  );
  const delivered = new Set(items.map(targetKey));
  return own.size !== delivered.size || [...own].some((k) => !delivered.has(k));
};

/**
 * Whether the stored and the planned value of a relation-valued property name other targets (UUID
 * and repository, not the version): a local edit the delivery replaces (#575/4).
 */
export const propertyTargetsDiffer = (stored: unknown, planned: unknown): boolean => {
  const targets = (value: unknown): string[] =>
    storedItems({ value }, "value").flatMap((item) => (hasId(item) ? [targetKey(item)] : []));
  const before = new Set(targets(stored));
  const after = new Set(targets(planned));
  return before.size !== after.size || [...before].some((k) => !after.has(k));
};

/** The parts of an item the import compares: target, version and repository. */
const comparable = (item: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
  id: item["id"],
  version: item["version"],
  ...(item["repository"] === undefined ? {} : { repository: item["repository"] }),
});

/**
 * The edits that give relation kind `kind` of an element with frontmatter `data` the delivery's
 * `items` in place of the items it decides (`decided`), keeping every other item; none when they
 * are equal apart from other fields of an item (such as `title`).
 */
export const relationEdits = (
  data: Readonly<Record<string, unknown>>,
  kind: string,
  items: readonly RelationItem[],
  ids: ReadonlySet<string>,
): FrontmatterEdit[] => {
  const value = data[kind];
  const stored = storedItems(data, kind);
  const own = decided(stored, items, ids);
  const ownItems = own.map((index) => comparable(stored[index] as Readonly<Record<string, unknown>>));
  if (isDeepStrictEqual(ownItems, items.map(comparable))) {
    return [];
  }
  if (!Array.isArray(value)) {
    // One target where the import writes a list: kept unless it is an element of the source.
    const all: ItemValue[] = [
      ...(own.length === 0 && value !== undefined ? [value as ItemValue] : []),
      ...items,
    ];
    return all.length === 0 ? [{ kind: "remove", key: kind }] : [{ kind: "set", key: kind, value: all }];
  }
  if (own.length === stored.length && items.length === 0) {
    return [{ kind: "remove", key: kind }];
  }
  return [
    ...own.reverse().map((index): FrontmatterEdit => ({ kind: "remove-item", key: kind, index })),
    ...items.map((item): FrontmatterEdit => ({ kind: "append-item", key: kind, value: item })),
  ];
};
