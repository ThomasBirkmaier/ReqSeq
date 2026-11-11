// Assigning the missing criterion keys of a selection in one step (SR-204 AK3, D-072;
// `element.assignCriterionKeys`). The command resolves the selection (query block, SR-101) and
// passes its elements here in store order.
//
// - Each acceptance criterion stored as plain text, the items `element.criterion-key-missing`
//   counts, gets a new key (`newCriterionKey`); every other item stays as it is, also a key in
//   another form or a key two items carry (workspace.check reports those, AK10), so no existing key
//   changes. Its new key differs from every key the element's items carry.
// - The keys come from `seededRandom` with the SHA-256 of the file as read and the property key,
//   as `element.bulkUpdate` draws them: the same file gets the same keys in every access.
// - The version stays the same, since it never counts a criterion key (ADR-0005, SR-091 AK6).
// - An element whose type has no such property, or whose list has no item without key, is left
//   alone; an element whose type the metamodel does not know is only read (SR-016 AK3) and named
//   in `skipped` when it has items without key. Its file is not read.
// - The write path is `element.bulkUpdate`'s: the files are read again and refused when they changed
//   on disk (`readAllUnchanged`), only the lines of the acceptance criteria are edited
//   (`editElementFile`, SR-102), the write check of the caller sees each element as written
//   (`checkedBefore`: a variant with validity entries, SR-039 AK2, refuses the call before any write),
//   and the files are written atomically, several at a time, with a rollback on a failure
//   (`writeElementFiles`), which also refreshes the stored titles of same-repository relation targets.
// - Cost (N-036): one pass over the selection, then only the files that change are read and
//   written. A repeated call after a crash writes only the elements that still lack keys.
import type { PropertyValue } from "../files/index.js";
import { editElementFile } from "../files/index.js";
import type { MetamodelEffectiveType } from "../generated/types.js";
import { findType } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { RandomInt } from "./acceptance-criteria.js";
import { acceptanceCriteriaKeyOf, newCriterionKey, seededRandom } from "./acceptance-criteria.js";
import type { BulkSelection, NamedElement, SkippedElement } from "./bulk-update.js";
import { isCriterionMapping } from "./criterion-items.js";
import type { ElementRecord } from "./elements.js";
import type { LocatableFinding } from "./locate.js";
import type { ElementFileWrite, WriteCheck } from "./write.js";
import { checkedBefore, readAllUnchanged, writeElementFiles } from "./write.js";

/** A changed element: how many of its acceptance criteria got a key. */
export interface KeyedElement extends NamedElement {
  readonly assigned: number;
}

/** An element of an unknown type with criteria without key, left out (SR-016 AK3). */
export interface UnknownTypeElement extends SkippedElement {
  readonly reason: "unknown-type";
}

export interface AssignCriterionKeysResult {
  /** The changed elements, in store order. */
  readonly changed: readonly KeyedElement[];
  /** Elements of an unknown type with criteria without key (SR-016 AK3). */
  readonly skipped: readonly UnknownTypeElement[];
  /** Written files relative to the workspace root, `/` as separator. */
  readonly files: readonly string[];
}

/** Files written at the same time, as `element.bulkUpdate` writes them. */
const WRITE_CONCURRENCY = 16;

/** How many items of `value` are acceptance criteria without key: plain texts. */
const missingKeys = (value: unknown): number =>
  Array.isArray(value) ? (value as unknown[]).filter((item) => typeof item === "string").length : 0;

/**
 * `items` with a new criterion key on every plain text (see the file comment); the other items as
 * they are. A new key differs from every key a mapping item carries, in its form or not.
 */
export const withMissingKeys = (items: readonly unknown[], random: RandomInt): unknown[] => {
  const taken = new Set<string>();
  for (const item of items) {
    if (isCriterionMapping(item) && typeof item.key === "string") {
      taken.add(item.key);
    }
  }
  return items.map((item) => {
    if (typeof item !== "string") {
      return item;
    }
    const key = newCriterionKey(taken, random);
    taken.add(key);
    return { key, text: item };
  });
};

/**
 * `element.assignCriterionKeys` on the elements of `selection` (see the file comment). Every file is
 * read and checked before the first write.
 */
export const assignCriterionKeys = async (
  workspace: Workspace,
  selection: BulkSelection,
  check?: WriteCheck,
): Promise<AssignCriterionKeysResult> => {
  const { metamodel, store, shortIds } = selection;
  const key = acceptanceCriteriaKeyOf(metamodel);
  const named = (record: ElementRecord): NamedElement => ({ id: record.id, shortId: shortIds.of(record) });
  const skipped: UnknownTypeElement[] = [];
  const candidates: { readonly record: ElementRecord; readonly type: MetamodelEffectiveType }[] = [];
  if (key !== undefined) {
    for (const record of selection.elements) {
      if (missingKeys(record.data[key]) === 0) {
        continue;
      }
      const type = findType(metamodel, record.type);
      if (type === undefined) {
        skipped.push({
          ...named(record),
          reason: "unknown-type",
          message: `The metamodel has no type ${record.type}, so ReqSeq only reads ${record.file}`,
        });
      } else if (type.properties.includes(key)) {
        candidates.push({ record, type });
      }
    }
  }
  if (key === undefined || candidates.length === 0) {
    return { changed: [], skipped, files: [] };
  }
  const layout = await workspace.get(workspaceLayoutState);
  const planned: (ElementFileWrite & { readonly changed: KeyedElement })[] = [];
  const refused: LocatableFinding[] = [];
  for (const { record, type, repository, current } of await readAllUnchanged(workspace, layout, candidates)) {
    const items = current.record.data[key] as unknown[];
    const random = seededRandom(`${current.file.snapshot.sha256}\0${key}`);
    const value = withMissingKeys(items, random) as PropertyValue;
    const { bytes, parsed } = editElementFile(current.file, {
      edits: [{ kind: "set", key, value }],
      keyOrder: type.properties,
    });
    const found = await checkedBefore(
      check,
      repository.name,
      bytes,
      current.file.snapshot,
      current.record.type,
      parsed,
    );
    refused.push(...(found?.findings ?? []));
    planned.push({ repository, current, bytes, changed: { ...named(record), assigned: missingKeys(items) } });
  }
  // The write check sees each element as it would be written: the call is refused as a whole.
  if (refused.length > 0 && check !== undefined) {
    throw check.refusal(refused);
  }
  const written = await writeElementFiles(workspace, layout, planned, {
    concurrency: WRITE_CONCURRENCY,
    titles: { metamodel, store },
  });
  return { changed: planned.map((p) => p.changed), skipped, files: written.map((w) => w.file) };
};
