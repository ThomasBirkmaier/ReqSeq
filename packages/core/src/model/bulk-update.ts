// Changing one property of many elements in one step (SR-071; `element.bulkUpdate`). The command
// resolves the selection (query block, SR-101) and passes its elements here in store order.
//
// - `set` replaces the value, `add` appends the items an element does not hold yet (a property with
//   `many`; relation targets are the same when UUID and repository are, other items when equal),
//   `remove` removes the key, or with a value only these items (the key when none is left). This is
//   spec question #353, option 1.
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
//   (decision on #307; the preview does not show that).
// - Cost (N-036, perf suite): one pass over the selection, the files of the candidates read 32 at a
//   time, then per file the lossless writer (about 1 to 3 ms) and, with `confirm`, an atomic write
//   that syncs to disk.
// - Without `confirm` nothing is written (AK2): the result is the same plan, so a preview and its
//   confirmation give the same elements while no file changes in between. `expected`, the count the
//   preview showed, makes a confirmation refused when the change now affects another number.
// - `id`, `type` and `status` are refused by the input schema (ADR-0002 rule 6, D-030); nothing is
//   deleted (D-045): a removed key or item is a change of the element's file only.
import { isDeepStrictEqual } from "node:util";
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { FrontmatterEdit, ItemValue, PropertyValue } from "../files/index.js";
import { editElementFile } from "../files/index.js";
import type {
  ElementInputValue,
  MetamodelEffectiveType,
  MetamodelProperty,
  RelationTarget,
} from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, keyDefinition, markdownKeysOf } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { imageMemo } from "./images.js";
import { locateIn } from "./locate.js";
import { relationTypeFindings } from "./relation-types.js";
import type { TargetItem } from "./relation-keys.js";
import { hasId } from "./relation-keys.js";
import type { ShortIds } from "./short-id.js";
import type { ElementStore } from "./store.js";
import type { TargetContext } from "./targets.js";
import { currentTarget, setMarkdownReferences, setRelationTargets } from "./targets.js";
import { valueFindings } from "./values.js";
import { titleKeyOf } from "./view.js";
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
   * The value-kind (SR-085) and relation-type (SR-086) hints at the property in the affected elements
   * after the change; in a preview also the findings of the write check that a confirmation refuses.
   */
  readonly problems: readonly Problem[];
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
 * title) and not a relation kind (relations are added one by one with `relation.add`).
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
  return found.definition;
};

const isEmpty = (value: ElementInputValue): boolean =>
  value === null || (Array.isArray(value) && value.length === 0);

/**
 * The value of the input with each choice as its key (`withChoiceKeys`), after the checks of the
 * operation: `set` and `add` need a value, `add` and `remove` with a value a property with `many`,
 * and an empty value (`null`, `[]`) is refused, since removing is `remove`.
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
  if (isEmpty(value)) {
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
  // A UUID in any case is stored in lower case (#309), as `setRelationTargets` does.
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
  const held: unknown[] = Array.isArray(stored)
    ? [...(stored as unknown[])]
    : isAbsent(stored)
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
  // the same); an item that is no target is kept as given (the value-kind check reports it).
  const added =
    plan.property.kind === "relation"
      ? await Promise.all(
          fresh.map((item) => (hasId(item) ? newTarget(plan, record.repository, item) : item)),
        )
      : markdownKeysOf(plan.context.metamodel).has(key)
        ? ((await setMarkdownReferences(
            plan.context,
            key,
            record.repository,
            fresh as ElementInputValue,
            stored,
          )) as unknown[])
        : fresh;
  if (held.length > 0 && !Array.isArray(stored)) {
    // One value where a list belongs: the key becomes the list of it and the new items.
    return [{ kind: "set", key, value: [stored, ...added] as PropertyValue }];
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
      const set =
        property.kind === "relation"
          ? await setRelationTargets(plan.context, record.repository, value, stored)
          : markdownKeysOf(plan.context.metamodel).has(key)
            ? await setMarkdownReferences(plan.context, key, record.repository, value, stored)
            : value;
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
 * The value-kind (SR-085) and relation-type (SR-086) hints at `key` in `elements` (as written, or as
 * they would be), each with its line in that file.
 */
const hintsAt = (key: string, elements: readonly ReadElement[], selection: BulkSelection): Problem[] =>
  elements.flatMap(({ file, record }) =>
    locateIn(
      file,
      [...valueFindings(record, selection.metamodel), ...relationTypeFindings(record, selection)].filter(
        (finding) => finding.path[0] === key,
      ),
    ),
  );

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
  const value = valueOf(metamodel, property, input);
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
  const planned: (ElementFileWrite & { readonly named: NamedElement })[] = [];
  let unchanged = 0;
  for (const { record, type, repository, current } of await readAllUnchanged(workspace, layout, candidates)) {
    const edits = await editsFor(plan, current.record);
    const { bytes, changed } = editElementFile(current.file, { edits, keyOrder: type.properties });
    if (changed) {
      planned.push({ repository, current, bytes, named: named(record) });
    } else {
      unchanged += 1;
    }
  }
  if (input.confirm && input.expected !== undefined && input.expected !== planned.length) {
    throw invalid(
      `expected: the change now affects ${String(planned.length)} elements, not ${String(input.expected)}; nothing was written. Preview it again`,
      { expected: input.expected, count: planned.length, reason: "count-changed" },
    );
  }
  // The write check sees each element as it would be written: a confirmation is refused as a whole.
  const found = await Promise.all(
    planned.map((p) =>
      checkedBefore(check, p.repository.name, p.bytes, p.current.file.snapshot, p.current.record.type),
    ),
  );
  const checked = found.filter((c) => c !== undefined);
  const refused = checked.flatMap((c) => c.findings);
  if (input.confirm && check !== undefined && refused.length > 0) {
    throw check.refusal(refused);
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
    : planned.map((p) => writtenElement(p.repository.name, p.bytes, p.current.file.snapshot));
  return {
    applied: input.confirm,
    affected: planned.map((p) => p.named),
    unchanged,
    skipped,
    files: written.map((w) => w.file),
    problems: [
      ...hintsAt(property.key, results, selection),
      ...checked.flatMap(({ element, findings }) => locateIn(element.file, findings)),
    ],
  };
};
