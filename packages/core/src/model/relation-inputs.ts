// Relations given to `element.create` (`relations`) and `element.update` (`addRelations`,
// `removeRelations`), written in the command's one file write (#175). Each map names relation kinds
// by key and their targets by element reference (UUID, short ID or identifier), with the rules of
// `relation.add` and `relation.remove` (relation-write.ts):
//
// - Every check comes before a file is read: the kind (`relationKindFor`: `input.invalid` with
//   `reason` `property` or `unknown-relation`), each target to add (`resolveRef`: `ref.unknown`,
//   `ref.ambiguous`, with the kind in the message and in `details.kind`), the types
//   (`relation.not-allowed`, by the rule of the check of SR-086), and that no target is both added
//   and removed under one kind (`input.invalid`, `reason: "add-and-remove"`).
// - A target to add is stored as `relation.add` stores it (`currentTarget`), once per kind. On
//   update, a relation the element has with a valid version is kept; one it has only without a
//   valid version gets its version in place (`replace-item`).
// - A target to remove is matched as `relation.remove` matches it (`removalMatch`: a UUID as given,
//   so a relation to a target that is gone can be removed). Nothing to remove is an `info` problem
//   `relation.not-found`; the key goes with its last item unless the same call adds to it.
import type { Problem } from "../catalog.js";
import { CommandError, commandErrorOrThrow } from "../catalog.js";
import type { FrontmatterEdit, ItemValue, PropertyValue } from "../files/index.js";
import type { MetamodelRelationKind, RelationTarget } from "../generated/types.js";
import { relationKindFor } from "../metamodel/index.js";
import type { ElementRecord } from "./elements.js";
import { isVersion } from "./is-version.js";
import { hasId } from "./relation-keys.js";
import type { RelationState } from "./relation-write.js";
import { itemsUnder, notFoundProblem, removalEdits, removalMatch } from "./relation-write.js";
import { relationTypeFindings } from "./relation-types.js";
import { resolveRef } from "./resolve.js";
import type { TargetContext } from "./targets.js";
import { currentTarget } from "./targets.js";

/** Relation kinds by key, each with the references of its targets. */
export type RelationRefs = Readonly<Record<string, readonly string[]>>;

/** A target to add under a kind, resolved and checked. */
interface Addition {
  readonly kind: MetamodelRelationKind;
  readonly target: ElementRecord;
}

/** A target to remove under a kind, with the reference as given (for `relation.not-found`). */
interface Removal {
  readonly kind: MetamodelRelationKind;
  readonly ref: string;
}

/** The checked relations of one call, before any file is read. */
export interface RelationPlan {
  readonly additions: readonly Addition[];
  readonly removals: readonly Removal[];
}

/** A version of valid form for the type check of a target not stored yet. */
const CHECK_VERSION = "n1:0000000000000000";

const NO_RELATIONS: RelationPlan = { additions: [], removals: [] };

/** `error` with the relation kind in its message and details. */
const inKind = (error: unknown, key: string): CommandError => {
  const failed = commandErrorOrThrow(error);
  return new CommandError(failed.code, `${failed.message} (in the relation ${key})`, {
    ...failed.details,
    kind: key,
  });
};

/** The target as the source file names it: its repository only across repositories (D-058). */
const asItem = (source: ElementRecord, target: ElementRecord): { id: string; repository?: string } =>
  target.repository === source.repository
    ? { id: target.id }
    : { id: target.id, repository: target.repository };

const sameTarget = (a: ElementRecord, b: ElementRecord): boolean =>
  a.id === b.id && a.repository === b.repository;

/**
 * The relations `add` and `remove` for `source` (for `element.create` a record of the new element
 * with no data), checked as the file comment says. Reads no file.
 */
export const planRelations = (
  state: RelationState,
  source: ElementRecord,
  add: RelationRefs | undefined,
  remove: RelationRefs | undefined,
): RelationPlan => {
  if (add === undefined && remove === undefined) {
    return NO_RELATIONS;
  }
  const { metamodel, store, shortIds } = state;
  const additions: Addition[] = [];
  for (const [key, refs] of Object.entries(add ?? {})) {
    const kind = relationKindFor(metamodel, key, source.type);
    for (const ref of refs) {
      let target: ElementRecord;
      try {
        target = resolveRef(store, shortIds, ref);
      } catch (error) {
        throw inKind(error, key);
      }
      if (additions.some((a) => a.kind === kind && sameTarget(a.target, target))) {
        continue;
      }
      const [finding] = relationTypeFindings(
        // The check reads a target with a version; which one does not matter to it.
        { ...source, data: { [kind.key]: [{ ...asItem(source, target), version: CHECK_VERSION }] } },
        { store, metamodel, shortIds },
      );
      if (finding !== undefined) {
        throw new CommandError("relation.not-allowed", finding.problem.message, {
          relation: kind.key,
          sourceType: source.type,
          targetType: target.type,
        });
      }
      additions.push({ kind, target });
    }
  }
  const removals: Removal[] = [];
  for (const [key, refs] of Object.entries(remove ?? {})) {
    const kind = relationKindFor(metamodel, key, source.type);
    for (const ref of refs) {
      const { target } = removalMatch(state, source, kind, ref, undefined);
      const added = additions.find(
        (a) =>
          a.kind === kind &&
          a.target.id === target.id &&
          // A UUID removes in every repository, a short ID or identifier in its element's.
          [undefined, a.target.repository].includes(target.repository),
      );
      if (added !== undefined) {
        throw new CommandError(
          "input.invalid",
          `${ref} is both added and removed under ${key}; give it in one of addRelations and removeRelations`,
          { kind: key, ref, reason: "add-and-remove" },
        );
      }
      removals.push({ kind, ref });
    }
  }
  return { additions, removals };
};

/** The relations of a new element as its file stores them: one list per kind, in the order given. */
export const newRelations = async (
  context: TargetContext,
  source: ElementRecord,
  plan: RelationPlan,
): Promise<[string, PropertyValue][]> => {
  const byKind = new Map<string, RelationTarget[]>();
  for (const { kind, target } of plan.additions) {
    const stored = await currentTarget(context, source.repository, {
      id: target.id,
      repository: target.repository,
    });
    byKind.set(kind.key, [...(byKind.get(kind.key) ?? []), stored]);
  }
  // Relation targets are plain string records (`toPropertyValue` in write.ts).
  return [...byKind].map(([key, targets]) => [key, targets as unknown as PropertyValue]);
};

/**
 * The edits of `plan` on `source` as read for the write, and the `relation.not-found` problems of
 * removals that find nothing. Per kind: items given a version in place, then removed items from the
 * last, then new items appended, so every index names the item it was computed for.
 */
export const relationEdits = async (
  context: TargetContext,
  state: RelationState,
  source: ElementRecord,
  plan: RelationPlan,
): Promise<{ readonly edits: FrontmatterEdit[]; readonly problems: Problem[] }> => {
  const replaced: FrontmatterEdit[] = [];
  const appended: FrontmatterEdit[] = [];
  const addedKeys = new Set<string>();
  for (const { kind, target } of plan.additions) {
    const items = itemsUnder(source, kind.key);
    const names = (item: unknown): boolean =>
      hasId(item) && item.id === target.id && (item["repository"] ?? source.repository) === target.repository;
    if (items.some((item) => names(item) && isVersion((item as Record<string, unknown>)["version"]))) {
      continue;
    }
    const value = (await currentTarget(context, source.repository, {
      id: target.id,
      repository: target.repository,
    })) as unknown as ItemValue;
    const unversioned = items.findIndex(names);
    if (unversioned < 0) {
      appended.push({ kind: "append-item", key: kind.key, value });
      addedKeys.add(kind.key);
    } else {
      replaced.push({ kind: "replace-item", key: kind.key, index: unversioned, value });
    }
  }
  const problems: Problem[] = [];
  const removed = new Map<string, Set<number>>();
  for (const { kind, ref } of plan.removals) {
    const { target, indexes } = removalMatch(state, source, kind, ref, undefined);
    if (indexes.length === 0) {
      problems.push(notFoundProblem(state, source, kind, ref, target.id));
      continue;
    }
    const set = removed.get(kind.key) ?? new Set<number>();
    indexes.forEach((i) => set.add(i));
    removed.set(kind.key, set);
  }
  const removing = [...removed].flatMap(([key, indexes]) =>
    removalEdits(
      key,
      [...indexes].toSorted((a, b) => a - b),
      // The key stays when the call adds to it.
      addedKeys.has(key) ? Number.POSITIVE_INFINITY : itemsUnder(source, key).length,
    ),
  );
  return { edits: [...replaced, ...removing, ...appended], problems };
};
