// Changing one property of many elements in one step (SR-071; `element.bulkUpdate`). The command
// resolves the selection (query block, SR-101) and passes its elements here in store order.
//
// - `set` replaces the value (one item of a property with `many` as a list of one, #1209), `add`
//   appends the items an element does not hold yet (a property with `many`; relation targets are
//   the same when UUID and repository are, other items when equal), `remove` removes the key, or
//   with a value only these items (the key when none is left). This is spec question
//   ThomasBirkmaier/ReqSeq-archive#353, option 1.
// - An element whose type does not have the property, or whose type the metamodel does not know
//   (it is only read, SR-016 AK3), is skipped and named (AK3); its file is not read.
// - The write path is the one of `element.update` and `element.setStatus`: choice values become
//   their keys (`withChoiceKeys`), relation targets get their version and, within the repository,
//   their title (`setRelationTargets`; a target that `add` adds is new to the element, so it gets
//   `currentTarget`, read once per call), every file is read again and refused when it changed on
//   disk (`readAllUnchanged`, `readUnchanged` for many), only that key's lines are edited
//   (`editElementFile`, SR-102), and the files are written atomically with a rollback on a failure
//   (`writeElementFiles`, several at a time), which also gives the store, the versions and the hints
//   the files as written, and refreshes the stored titles of their same-repository relation targets
//   (decision on ThomasBirkmaier/ReqSeq-archive#307; the preview does not show that).
// - Cost (N-036, perf suite): one pass over the selection, the files of the candidates read 32 at a
//   time without parsing them (`readAllUnchanged`: the store parsed the same bytes), then per file the
//   lossless writer (about 1 ms: its parse and the parse of its check, which the preview and the
//   write check take as the read-back, `FileEditResult.parsed`) and, with `confirm`, an atomic write
//   that syncs to disk. A not writable folder is asked once (`readOnlyFolders`).
// - Hints at the property include `element.missing-required` (a `remove` of a required property) and
//   `element.text-emptied` (a Markdown or list property that held a value and holds none, #841);
//   a preview names a not writable folder with `file.read-only`, which a confirmation refuses before
//   its first write (#836).
// - Without `confirm` nothing is written (AK2): the result is the same plan, so a preview and its
//   confirmation give the same elements while no file changes in between. `plan`, the fingerprint
//   the preview returned (`bulk-plan.ts`, #158), makes a confirmation refused when the change now
//   writes other files or other bytes; `expected`, the count the preview showed, when it now affects
//   another number. Both are checked after planning and before any write; the write still checks
//   each file against the bytes it read. After a crash, the same call without `expected` and `plan`
//   writes only the remaining elements.
// - `id`, `type` and `status` are refused by the input schema (ADR-0002 rule 6, D-030); nothing is
//   deleted (D-045): a removed key or item is a change of the element's file only.
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { FrontmatterEdit, ItemValue, ParsedContent, PropertyValue } from "../files/index.js";
import { editElementFile, zip } from "../files/index.js";
import type {
  ElementInputValue,
  MetamodelEffectiveType,
  MetamodelProperty,
  RelationTarget,
} from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, keyDefinition, markdownKeysOf, originMeaning } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation } from "../workspace/index.js";
import { isWritableFolder, workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { imageMemo } from "./images.js";
import { propertiesEmptied } from "./emptied.js";
import { locateIn } from "./locate.js";
import { relationTypeFindings } from "./relation-types.js";
import { isEmptyValue, requiredFindings } from "./required.js";
import type { TargetItem } from "./relation-keys.js";
import { hasId } from "./relation-keys.js";
import type { ShortIds } from "./short-id.js";
import type { ElementStore } from "./store.js";
import type { TargetContext } from "./targets.js";
import { listWhereMany } from "./many-input.js";
import { numberInput } from "./number-input.js";
import { currentTarget, relationTargetRefs, setMarkdownReferences, setRelationTargets } from "./targets.js";
import { itemLimitFindings } from "./item-limits.js";
import { valueFindings } from "./values.js";
import { titleKeyOf } from "./view.js";
import { planFingerprint } from "./bulk-plan.js";
import type { ElementFileWrite, ReadElement, WriteCheck } from "./write.js";
import {
  checkedBefore,
  readAllUnchanged,
  withChoiceKeys,
  writeElementFiles,
  writtenElement,
} from "./write.js";

export type BulkOperation = "set" | "add" | "remove";

export interface BulkUpdateInput {
  readonly property: string;
  readonly operation: BulkOperation;
  readonly value?: ElementInputValue;
  readonly confirm: boolean;
  readonly expected?: number;
  /** The fingerprint of the preview (`planFingerprint`); checked only with `confirm`. */
  readonly plan?: string;
}

/** The selected elements (in store order) and the states they were selected from. */
export interface BulkSelection {
  readonly elements: readonly ElementRecord[];
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
}

/** An element as the result names it. */
export interface NamedElement {
  readonly id: string;
  readonly shortId: string;
}

/** An element left out (AK3). */
export interface SkippedElement extends NamedElement {
  readonly reason: "not-a-property" | "unknown-type";
  readonly message: string;
}

export interface BulkUpdateResult {
  /** True when the files were written. */
  readonly applied: boolean;
  /** The elements whose file the change rewrites (rewrote), in store order. */
  readonly affected: readonly NamedElement[];
  /** Elements that allow the property and have the result already. */
  readonly unchanged: number;
  readonly skipped: readonly SkippedElement[];
  /** Written files relative to the workspace root, `/` as separator; empty in a preview. */
  readonly files: readonly string[];
  /**
   * The value-kind (SR-085), item-limit (SR-171) and relation-type (SR-086) hints at the property
   * in the affected elements after the change; in a preview also the findings of the write check that a confirmation refuses.
   */
  readonly problems: readonly Problem[];
  /** The fingerprint of the planned writes (`planFingerprint`), the same in a preview and its confirmation. */
  readonly plan: string;
}

/**
 * Files written at the same time: each write syncs the file and its folder to disk, which is most of
 * its time, so 1,000 files take seconds one by one (`writeElementFiles`).
 */
const WRITE_CONCURRENCY = 16;

const invalid = (message: string, details: Record<string, unknown>): CommandError =>
  new CommandError("input.invalid", message, details);

/**
 * The property `key` names: a property of the metamodel, not the title key (each element has its own
 * title), not a relation kind (relations are added one by one with `relation.add`) and not a property
 * of the origin, which only `reqif.import` writes (SR-057 AK3).
 */
const propertyOf = (metamodel: Metamodel, key: string): MetamodelProperty => {
  const found = keyDefinition(metamodel, key);
  if (found?.kind === "relation") {
    throw invalid(`property: ${key} is a relation kind, not a property; add relations with relation.add`, {
      key,
      reason: "relation",
    });
  }
  if (found === undefined) {
    throw invalid(`property: the metamodel has no property ${key}`, { key, reason: "not-a-property" });
  }
  if (key === titleKeyOf(metamodel)) {
    throw invalid(
      `property: ${key} is the title, which is each element's own; change it with element.update`,
      {
        key,
        reason: "title",
      },
    );
  }
  const origin = originMeaning(found.definition);
  if (origin !== undefined) {
    throw invalid(`property: ${key} holds the origin (${origin}), which only reqif.import writes`, {
      key,
      reason: "origin",
    });
  }
  return found.definition;
};

/**
 * Whether `value` is empty for the operation: `null` and `[]`, and for `set` and `add` of a choice
 * also an empty or blank string (`isEmptyValue`), which `withChoiceKeys` would keep as no value (#242).
 */
const isEmpty = (value: ElementInputValue, property: MetamodelProperty, operation: BulkOperation): boolean =>
  value === null ||
  (Array.isArray(value) && value.length === 0) ||
  (property.kind === "choice" && operation !== "remove" && isEmptyValue(value));

/**
 * The value of the input with each choice as its key (`withChoiceKeys`), after the checks of the
 * operation: `set` and `add` need a value, `add` and `remove` with a value a property with `many`,
 * and an empty value (`null`, `[]`, for `set` and `add` of a choice a blank string) is refused,
 * since removing is `remove`.
 */
const valueOf = (
  metamodel: Metamodel,
  property: MetamodelProperty,
  input: BulkUpdateInput,
): ElementInputValue | undefined => {
  const { operation, value } = input;
  if (value === undefined) {
    if (operation !== "remove") {
      throw invalid(`value: ${operation} needs a value`, { operation, reason: "value-missing" });
    }
    return undefined;
  }
  if (isEmpty(value, property, operation)) {
    throw invalid(
      `value: an empty value changes nothing; to remove ${property.key}, use remove without a value`,
      {
        operation,
        reason: "value-empty",
      },
    );
  }
  if (operation !== "set" && property.many !== true) {
    throw invalid(
      `value: ${operation} with a value works on a property with many values; ${property.name} (${property.key}) has one. Use set${operation === "remove" ? ", or remove without a value" : ""}`,
      { key: property.key, operation, reason: "not-many" },
    );
  }
  // One entry in, one out.
  const [[, keyed]] = withChoiceKeys(metamodel, [[property.key, value]], "value") as [
    [string, ElementInputValue],
  ];
  return keyed;
};

/**
 * The value with each item of a relation-valued property as a target `{ id }` (`relationTargetRefs`,
 * #287): a short ID or identifier is resolved and any other item that is no reference refused,
 * before a file is read. A value of a number property that is no number is refused for `set` and
 * `add` (`numberInput`, #614); `remove` writes no value, so it can remove a hand-written text item.
 */
const refsOf = (
  selection: BulkSelection,
  property: MetamodelProperty,
  operation: BulkOperation,
  value: ElementInputValue | undefined,
): ElementInputValue | undefined => {
  if (value === undefined) {
    return value;
  }
  if (property.kind === "number") {
    if (operation === "remove") {
      return value;
    }
    return numberInput(property.key, value);
  }
  return property.kind === "relation"
    ? relationTargetRefs(selection.store, selection.shortIds, property.key, value)
    : value;
};

/** The target an item names, as UUID and repository (the source's own when it names none). */
const targetOf = (item: TargetItem, repository: string): string =>
  JSON.stringify([
    item.id.toLowerCase(),
    typeof item["repository"] === "string" ? item["repository"] : repository,
  ]);

/** Whether two items are the same: relation targets by target, other items by value. */
const sameItem = (a: unknown, b: unknown, repository: string): boolean =>
  hasId(a) && hasId(b) ? targetOf(a, repository) === targetOf(b, repository) : isDeepStrictEqual(a, b);

const itemsOf = (value: ElementInputValue): readonly unknown[] => (Array.isArray(value) ? value : [value]);

/** What the edits of every element are made from. */
interface Plan {
  readonly context: TargetContext;
  readonly property: MetamodelProperty;
  readonly operation: BulkOperation;
  readonly value: ElementInputValue | undefined;
  /** A new target as stored from a source repository (`currentTarget`), read once per call. */
  readonly targets: Map<string, Promise<RelationTarget>>;
}

/** A target that `add` gives an element, as stored (SR-021): its current version, read once per call. */
const newTarget = (plan: Plan, sourceRepository: string, item: TargetItem): Promise<RelationTarget> => {
  // A UUID in any case is stored in lower case (ThomasBirkmaier/ReqSeq-archive#309), as `setRelationTargets` does.
  const target =
    typeof item["repository"] === "string"
      ? { id: item.id.toLowerCase(), repository: item["repository"] }
      : { id: item.id.toLowerCase() };
  const key = JSON.stringify([sourceRepository, target]);
  const known = plan.targets.get(key) ?? currentTarget(plan.context, sourceRepository, target);
  plan.targets.set(key, known);
  return known;
};

/** `remove` with the items `given`: the items of the element that are given, the key with its last item. */
const removeEdits = (
  key: string,
  stored: unknown,
  given: readonly unknown[],
  repository: string,
): FrontmatterEdit[] => {
  if (!Array.isArray(stored)) {
    // One value where a list belongs (the value-kind check reports it): removed when it is given.
    return stored !== undefined && given.some((g) => sameItem(stored, g, repository))
      ? [{ kind: "remove", key }]
      : [];
  }
  const indexes = (stored as unknown[]).flatMap((item, i) =>
    given.some((g) => sameItem(item, g, repository)) ? [i] : [],
  );
  // From the last item, so each index still names its item.
  return indexes.length > 0 && indexes.length === stored.length
    ? [{ kind: "remove", key }]
    : indexes.toReversed().map((index): FrontmatterEdit => ({ kind: "remove-item", key, index }));
};

/** `add` with the items `given`: each one the element does not hold yet, as a new line. */
const addEdits = async (
  plan: Plan,
  record: ElementRecord,
  stored: unknown,
  given: readonly unknown[],
): Promise<FrontmatterEdit[]> => {
  const { key } = plan.property;
  // A blank scalar (`isEmptyValue`, e.g. `key: ""`) holds no item.
  const held: unknown[] = Array.isArray(stored)
    ? [...(stored as unknown[])]
    : isEmptyValue(stored)
      ? []
      : [stored];
  const fresh: unknown[] = [];
  for (const item of given) {
    if (![...held, ...fresh].some((h) => sameItem(h, item, record.repository))) {
      fresh.push(item);
    }
  }
  if (fresh.length === 0) {
    return [];
  }
  // A new item is no stored target, so it gets its current version (`setRelationTargets` would give
  // the same); every item of a relation-valued property is a target by now (`refsOf`).
  const added =
    plan.property.kind === "relation"
      ? await Promise.all(fresh.map((item) => newTarget(plan, record.repository, item as TargetItem)))
      : markdownKeysOf(plan.context.metamodel).has(key)
        ? ((await setMarkdownReferences(
            plan.context,
            key,
            record.repository,
            fresh as ElementInputValue,
            stored,
          )) as unknown[])
        : fresh;
  if (!Array.isArray(stored) && !isAbsent(stored)) {
    // One value where a list belongs: the key becomes the list of it (none when it is blank) and the
    // new items.
    return [{ kind: "set", key, value: [...held, ...added] as PropertyValue }];
  }
  return added.map((item): FrontmatterEdit => ({ kind: "append-item", key, value: item as ItemValue }));
};

const isAbsent = (value: unknown): boolean => value === undefined || value === null;

/** The edits of the operation for one element as read now (`record`); none when it has the result already. */
const editsFor = async (plan: Plan, record: ElementRecord): Promise<FrontmatterEdit[]> => {
  const { property, operation, value } = plan;
  const { key } = property;
  const stored = record.data[key];
  if (value === undefined) {
    // `remove` without a value (`valueOf`); an absent key gives no change.
    return [{ kind: "remove", key }];
  }
  switch (operation) {
    case "set": {
      // One item of a property with many is set as a list of one (#1209).
      const given = listWhereMany(plan.context.metamodel, key, value);
      const set =
        property.kind === "relation"
          ? await setRelationTargets(plan.context, record.repository, given, stored)
          : markdownKeysOf(plan.context.metamodel).has(key)
            ? await setMarkdownReferences(plan.context, key, record.repository, given, stored)
            : given;
      // Relation targets are plain string records (`toPropertyValue` in write.ts).
      return [{ kind: "set", key, value: set as PropertyValue }];
    }
    case "remove":
      return removeEdits(key, stored, itemsOf(value), record.repository);
    case "add":
      return addEdits(plan, record, stored, itemsOf(value));
  }
};

/**
 * The missing-required (SR-064), value-kind (SR-085), item-limit (SR-171) and relation-type (SR-086)
 * hints at `key` in `elements` (as written, or as they would be), each with its line in that file.
 */
const hintsAt = (key: string, elements: readonly ReadElement[], selection: BulkSelection): Problem[] =>
  elements.flatMap(({ file, record }) =>
    locateIn(
      file,
      [
        ...requiredFindings(record, selection.metamodel),
        ...valueFindings(record, selection.metamodel),
        ...itemLimitFindings(record, selection.metamodel),
        ...relationTypeFindings(record, selection),
      ].filter((finding) => finding.path[0] === key),
    ),
  );

/** The planned writes of one folder: its repository, its path in it (`/`) and how many files. */
interface PlannedFolder {
  readonly repository: RepositoryLocation;
  readonly folder: string;
  readonly files: number;
}

/**
 * The folders of the planned files that this process cannot write (`isWritableFolder`, SR-018 AK2:
 * a read-only file system or no write permission; unknown on Windows, where the write itself
 * refuses), in the order of their first file: every write there is refused with `file.read-only`.
 * One check per folder (N-036).
 */
const readOnlyFolders = async (planned: readonly ElementFileWrite[]): Promise<PlannedFolder[]> => {
  const folders = new Map<string, PlannedFolder>();
  for (const { repository, current } of planned) {
    const folder = path.posix.dirname(current.record.file);
    const place = JSON.stringify([repository.name, folder]);
    folders.set(place, { repository, folder, files: (folders.get(place)?.files ?? 0) + 1 });
  }
  const checked = await Promise.all(
    [...folders.values()].map(async (f) => ({
      ...f,
      writable: await isWritableFolder(path.join(f.repository.folder, f.folder)),
    })),
  );
  return checked
    .filter((f) => f.writable === false)
    .map(({ repository, folder, files }) => ({ repository, folder, files }));
};

/** The folder as a message names it. */
const folderName = ({ repository, folder }: PlannedFolder): string =>
  folder === "."
    ? `the folder of repository ${repository.name}`
    : `folder ${folder} of repository ${repository.name}`;

/**
 * `file.read-only` of a preview for a folder it would write into but cannot (`readOnlyFolders`): the
 * confirmation is refused.
 */
const readOnlyProblem = (folder: PlannedFolder): Problem => ({
  code: "file.read-only",
  severity: "error",
  message: `${folderName(folder)} is not writable (${String(folder.files)} of the planned files), so a confirmation is refused; check the permissions of the folder`,
  repository: folder.repository.name,
});

/**
 * Refuses a confirmation (nothing is written) whose plan is not the preview's `plan` (#158), or whose
 * count is not the preview's `expected`. The current fingerprint is not in the error: a caller has to
 * preview again to get it.
 */
const confirmable = (input: BulkUpdateInput, fingerprint: string, count: number): void => {
  if (input.plan !== undefined && input.plan !== fingerprint) {
    throw invalid(
      "plan: the change now writes other elements or other content than the preview showed; nothing was written. Preview it again",
      { count, reason: "plan-changed" },
    );
  }
  if (input.expected !== undefined && input.expected !== count) {
    throw invalid(
      `expected: the change now affects ${String(count)} elements, not ${String(input.expected)}; nothing was written. Preview it again`,
      { expected: input.expected, count, reason: "count-changed" },
    );
  }
};

/**
 * `element.bulkUpdate` (SR-071) on the elements of `selection` (see the file comment). Every check
 * of the input comes before a file is read; every file is read and checked before the first write.
 */
export const bulkUpdateElements = async (
  workspace: Workspace,
  selection: BulkSelection,
  input: BulkUpdateInput,
  check?: WriteCheck,
): Promise<BulkUpdateResult> => {
  const { metamodel, store, shortIds } = selection;
  const property = propertyOf(metamodel, input.property);
  const value = refsOf(selection, property, input.operation, valueOf(metamodel, property, input));
  const layout = await workspace.get(workspaceLayoutState);
  const named = (record: ElementRecord): NamedElement => ({ id: record.id, shortId: shortIds.of(record) });
  const skipped: SkippedElement[] = [];
  const candidates: { readonly record: ElementRecord; readonly type: MetamodelEffectiveType }[] = [];
  for (const record of selection.elements) {
    const type = findType(metamodel, record.type);
    if (type === undefined) {
      skipped.push({
        ...named(record),
        reason: "unknown-type",
        message: `The metamodel has no type ${record.type}, so ReqSeq only reads ${record.file}`,
      });
    } else if (type.properties.includes(property.key)) {
      candidates.push({ record, type });
    } else {
      skipped.push({
        ...named(record),
        reason: "not-a-property",
        message: `Type ${type.name} (${type.key}) has no property ${property.name} (${property.key})`,
      });
    }
  }
  const plan: Plan = {
    context: { layout, metamodel, store, images: imageMemo() },
    property,
    operation: input.operation,
    value,
    targets: new Map(),
  };
  // `parsed`: the planned bytes as the writer's check read them back, so a preview and the write
  // check do not parse them again (N-036).
  const planned: (ElementFileWrite & {
    readonly named: NamedElement;
    readonly parsed: ParsedContent | undefined;
  })[] = [];
  let unchanged = 0;
  for (const { record, type, repository, current } of await readAllUnchanged(workspace, layout, candidates)) {
    const edits = await editsFor(plan, current.record);
    const { bytes, changed, parsed } = editElementFile(current.file, { edits, keyOrder: type.properties });
    if (changed) {
      planned.push({ repository, current, bytes, named: named(record), parsed });
    } else {
      unchanged += 1;
    }
  }
  const fingerprint = planFingerprint(
    planned.map((p) => ({
      repository: p.repository.name,
      file: p.current.record.file,
      id: p.current.record.id,
      sha256: p.current.file.snapshot.sha256,
      bytes: p.bytes,
    })),
  );
  if (input.confirm) {
    confirmable(input, fingerprint, planned.length);
  }
  // The write check sees each element as it would be written: a confirmation is refused as a whole.
  const found = await Promise.all(
    planned.map((p) =>
      checkedBefore(
        check,
        p.repository.name,
        p.bytes,
        p.current.file.snapshot,
        p.current.record.type,
        p.parsed,
      ),
    ),
  );
  const checked = found.filter((c) => c !== undefined);
  const refused = checked.flatMap((c) => c.findings);
  if (input.confirm && check !== undefined && refused.length > 0) {
    throw check.refusal(refused);
  }
  const readOnly = await readOnlyFolders(planned);
  const [first] = readOnly;
  if (input.confirm && first !== undefined) {
    // Refused before the first write, rather than rolled back after it.
    throw new CommandError(
      "file.read-only",
      `Not written: ${folderName(first)} is not writable; nothing was written`,
      { repository: first.repository.name, folder: first.folder },
    );
  }
  const written = input.confirm
    ? await writeElementFiles(workspace, layout, planned, {
        concurrency: WRITE_CONCURRENCY,
        titles: { metamodel, store },
      })
    : [];
  // A preview checks that every planned file reads back as an element, as the write does.
  const results = input.confirm
    ? written.map((w) => w.written)
    : planned.map((p) => writtenElement(p.repository.name, p.bytes, p.current.file.snapshot, p.parsed));
  return {
    applied: input.confirm,
    affected: planned.map((p) => p.named),
    unchanged,
    skipped,
    files: written.map((w) => w.file),
    problems: [
      ...hintsAt(property.key, results, selection),
      ...zip(planned, results).flatMap(([p, result]) =>
        propertiesEmptied(p.repository.name, p.current.record, result.record, [property], input.confirm),
      ),
      ...checked.flatMap(({ element, findings }) => locateIn(element.file, findings)),
      ...readOnly.map(readOnlyProblem),
    ],
    plan: fingerprint,
  };
};
