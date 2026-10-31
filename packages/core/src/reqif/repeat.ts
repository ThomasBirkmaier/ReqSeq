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
import type { FrontmatterEdit, ItemValue } from "../files/index.js";
import { sha256, zip } from "../files/index.js";
import type { ReqifObject } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord } from "../model/index.js";
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

/** A relation item as the import writes it. */
export type RelationItem = Readonly<{ id: string; version: string; repository?: string }>;

/** The parts of a stored item the import compares: target, version and repository. */
const comparable = (item: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
  id: item["id"],
  version: item["version"],
  ...(item["repository"] === undefined ? {} : { repository: item["repository"] }),
});

/**
 * The edits that give relation kind `kind` of an element with frontmatter `data` the delivery's
 * `items` to elements of the source (`ids`), keeping every other item; none when they are equal.
 */
export const relationEdits = (
  data: Readonly<Record<string, unknown>>,
  kind: string,
  items: readonly RelationItem[],
  ids: ReadonlySet<string>,
): FrontmatterEdit[] => {
  const value = data[kind];
  const stored: readonly unknown[] = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const own = stored.flatMap((item, index) => (hasId(item) && ids.has(item.id) ? [index] : []));
  const ownItems = own.map((index) => comparable(stored[index] as Readonly<Record<string, unknown>>));
  if (isDeepStrictEqual(ownItems, items)) {
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
