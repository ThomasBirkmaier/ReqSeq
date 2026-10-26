// Stored titles of relation targets follow their targets (spec question #307, product owner decision,
// 2026-10-26; ADR-0004 "Stored titles"). A relation target within the source's repository stores
// the target's title so that the file reads well without LogReq (SR-010, D-058). The title does not
// count to any version (ADR-0005), so a rename gives no hint; instead, whenever a command writes a
// source file anyway, the stored titles of its same-repository targets are set to the targets'
// current titles. `hint.confirm` writes through the same path, so confirming writes the current
// version and the current title of the target.
//
// - Only inside a write the user asked for: the planned bytes of a file a command writes get the
//   refresh; a planned write that changes nothing is passed as it is, and no other file is written.
// - Lossless: only the text of each stale `title` scalar is replaced, in its own quoting
//   (`set-scalar` of `editElementFile`); every other byte of the file stays. A version is never
//   changed here. An entry without a `title` gets none (adding a key would rewrite the entry).
// - Same repository only: an entry that names another repository is never touched (D-058,
//   SR-005 AK1). An entry without `repository`, or with the source's own, whose target is exactly
//   one element of the source's repository (`resolveTarget`) and whose title is text, gets it;
//   a missing, ambiguous or untitled target leaves the entry as it is.
// - Only entries the file stored before this call: an entry the call itself set (a new target, a
//   target set anew; `currentTarget` read its title from the target's file just now) is left as
//   set. An entry counts as stored when the file as read holds it under the same key with the same
//   keys and values, `version` aside (so the entry `hint.confirm` confirms is refreshed).
// - The current title is that of the element store the command read, or, for an element the same
//   call writes, the one of its planned bytes (an element renamed by `element.update` with a
//   relation to itself).
// - A title the writer cannot change in place (an alias, a block scalar, an anchored scalar) stays
//   as it is (`set-scalar` with `ifPlain`); the refresh never blocks the write it is part of.
// - Cost (N-036): one parse of each planned file, then per relation entry a lookup of its UUID in
//   the store's index (`byId`), then one pass of the writer for all stale titles of the file:
//   O(relations of the written files), never a walk over the store.
import { commandErrorOrThrow } from "../catalog.js";
import type { EditableFile, FileSnapshot, FrontmatterEdit } from "../files/index.js";
import { editElementFile, parseFileBytes, sha256 } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord } from "./elements.js";
import { hasId, relationItems, relationKey } from "./relation-keys.js";
import { resolveTarget } from "./relations.js";
import type { ElementStore } from "./store.js";
import { titleKeyOf } from "./view.js";

/** What the refresh needs of the workspace state the command read. */
export interface TitleContext {
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
}

/** A planned write of an existing element file, as `writeElementFiles` takes it. */
export interface PlannedTitleWrite {
  readonly repository: { readonly name: string };
  readonly current: {
    readonly record: Pick<ElementRecord, "file" | "data">;
    readonly file: { readonly snapshot: Pick<FileSnapshot, "sha256"> };
  };
  readonly bytes: Uint8Array;
}

/** A planned file that changes, parsed. */
interface Parsed {
  readonly file: EditableFile;
  readonly data: Readonly<Record<string, unknown>>;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const placeOf = (repository: string, file: string): string => JSON.stringify([repository, file]);

/** The planned bytes parsed; undefined when they change nothing or are no frontmatter mapping (the write then fails as before). */
const parsedOf = (write: PlannedTitleWrite): Parsed | undefined => {
  if (sha256(write.bytes) === write.current.file.snapshot.sha256) {
    return undefined;
  }
  const outcome = parseFileBytes(write.current.record.file, write.bytes);
  if (outcome.kind !== "parsed" || !isRecord(outcome.content.data)) {
    return undefined;
  }
  const { frontmatter, body, eol, closingEol, bom } = outcome.content;
  return { file: { frontmatter, body, eol, closingEol, bom }, data: outcome.content.data };
};

/** An entry without its `version`, as text: entries that differ only in their version are the same entry. */
const entryKey = (item: Readonly<Record<string, unknown>>): string =>
  JSON.stringify(
    Object.entries(item)
      .filter(([key]) => key !== "version")
      .sort(([a], [b]) => a.localeCompare(b)),
  );

/**
 * The `set-scalar` edits of the stale titles of `data`, a file of `repository` that held `stored`
 * before this call (see the file comment).
 */
const titleEdits = (
  context: TitleContext,
  repository: string,
  data: Readonly<Record<string, unknown>>,
  stored: Readonly<Record<string, unknown>>,
  titleOf: (record: ElementRecord) => unknown,
): FrontmatterEdit[] => {
  const edits: FrontmatterEdit[] = [];
  for (const [key, value] of Object.entries(data)) {
    const relation = relationKey(context.metamodel, key);
    if (relation === undefined) {
      continue;
    }
    const before = new Set(
      relationItems(key, relation, stored[key]).flatMap(([, item]) => (hasId(item) ? [entryKey(item)] : [])),
    );
    for (const [[, index], item] of relationItems(key, relation, value)) {
      if (!hasId(item) || !before.has(entryKey(item))) {
        continue;
      }
      const title = item["title"];
      const named = item["repository"];
      if (typeof title !== "string" || (named !== undefined && named !== repository)) {
        continue;
      }
      const match = resolveTarget(context.store, repository, { id: item.id });
      const current = match.kind === "found" ? titleOf(match.element) : undefined;
      if (typeof current === "string" && current !== title) {
        const path = index === undefined ? ["title"] : [index, "title"];
        edits.push({ kind: "set-scalar", key, path, value: current, ifPlain: true });
      }
    }
  }
  return edits;
};

/**
 * The bytes of `file` with `edits`, in one pass of the writer; `bytes` when the writer refuses them
 * (it should not: `ifPlain` leaves every title it cannot change in place), so the write goes on.
 */
const applied = (file: EditableFile, bytes: Uint8Array, edits: readonly FrontmatterEdit[]): Uint8Array => {
  try {
    return editElementFile(file, { edits }).bytes;
  } catch (error) {
    commandErrorOrThrow(error);
    return bytes;
  }
};

/**
 * `writes` with the stored titles of the same-repository relation targets of each planned file set
 * to the targets' current titles (see the file comment); the other fields of each write unchanged.
 */
export const withCurrentTitles = <T extends PlannedTitleWrite>(
  context: TitleContext,
  writes: readonly T[],
): T[] => {
  const titleKey = titleKeyOf(context.metamodel);
  if (titleKey === undefined) {
    return [...writes];
  }
  const parsed = writes.map(parsedOf);
  // The titles of the elements this call writes, as planned.
  const planned = new Map<string, unknown>();
  writes.forEach((write, i) => {
    const data = parsed[i]?.data;
    if (data !== undefined) {
      planned.set(placeOf(write.repository.name, write.current.record.file), data[titleKey]);
    }
  });
  const titleOf = (record: ElementRecord): unknown => {
    const place = placeOf(record.repository, record.file);
    return planned.has(place) ? planned.get(place) : record.data[titleKey];
  };
  return writes.map((write, i) => {
    const file = parsed[i];
    if (file === undefined) {
      return write;
    }
    const edits = titleEdits(context, write.repository.name, file.data, write.current.record.data, titleOf);
    return edits.length === 0 ? write : { ...write, bytes: applied(file.file, write.bytes, edits) };
  });
};
