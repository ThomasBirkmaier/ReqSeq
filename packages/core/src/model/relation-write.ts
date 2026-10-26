// Adding and removing one relation (enabler #264; SR-005, SR-021, SR-041, SR-086, SR-102, D-045,
// D-058; ADR-0004, ADR-0007). A relation lives only in the file of its source (ADR-0004), so both
// commands rewrite only that file, and there only the lines of the one relation (`append-item`,
// `remove-item`): one flow mapping per line, so two branches that add different relations to the
// same element each add a line of their own (SR-102 AK3).
//
// - `relation.add` stores the target as every new relation does (`currentTarget`): its UUID and
//   current version (SR-021 AK1), plus its title within the same repository, or the name of its
//   repository and no title across repositories (SR-005 AK1, D-058). A relation the metamodel does
//   not allow between the two types is refused with `relation.not-allowed`, by the rule of the
//   check of SR-086 (`relationTypeFindings`): the tool sets only allowed relations (SR-067 AK1;
//   assumption, stated in the PR of #264). A relation the source already has with a valid version
//   is kept with its stored version and nothing is written (#177 (a)). One it has only without a
//   valid version (written by hand or by a migration script, which cannot compute versions,
//   ADR-0005) gets the current version in place, with the same checks as a new relation: its line
//   is replaced by `currentTarget` (`replace-item`, the position in the list stays) and an `info`
//   problem `relation.version-added` says so (ADR-0004 "Setting a target", as `element.update`
//   does for relation-valued properties; #302). Whether it closes a cycle of derivations is the
//   command's to say (SR-067 AK3, `trace/new-cycle.ts`): the model block does not import trace.
// - `relation.remove` removes every item of the kind that names the target, and the key with the
//   last one. The target is matched by its UUID as written, so a relation to a target that is gone
//   (SR-089) can be removed too. `repository` keeps only the items into that repository. Items
//   with one UUID into several repositories are removed together only when none of these
//   repositories can hold an element with it: each is on this machine and has none, so no short ID
//   could tell them apart. Nothing to remove is an `info` problem `relation.not-found`. No element
//   and no file is deleted (D-045).
import type { Problem } from "../catalog.js";
import { CommandError } from "../catalog.js";
import type { FrontmatterEdit } from "../files/index.js";
import { editElementFile } from "../files/index.js";
import type { MetamodelEffectiveType, MetamodelRelationKind } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { allowsType, keyDefinition, metamodelState } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ElementRecord } from "./elements.js";
import { isVersion } from "./is-version.js";
import { locateFindings } from "./locate.js";
import { hasId } from "./relation-keys.js";
import { relationTypeFindings } from "./relation-types.js";
import { resolveRef } from "./resolve.js";
import { shortIdState } from "./short-id.js";
import { elementStoreState } from "./store.js";
import { elementLabel } from "./superseded.js";
import { currentTarget } from "./targets.js";
import { isUuid, normalizeRef } from "./uuid.js";
import { assertElementWritable, readUnchanged, writeElementFiles } from "./write.js";

/** The input of `relation.add` and `relation.remove`: source and target as UUID or short ID, the kind's key. */
export interface RelationInput {
  readonly source: string;
  readonly kind: string;
  readonly target: string;
}

/** The input of `relation.remove`: `repository` keeps only the relations into that repository. */
export interface RemoveRelationInput extends RelationInput {
  readonly repository?: string;
}

/** What `addRelation` did. */
export interface AddedRelation {
  /** The written file relative to the workspace root, `/` as separator; empty when the relation was there. */
  readonly files: readonly string[];
  readonly kind: MetamodelRelationKind;
  /**
   * The source as it is now, one record: as written, or as the element store holds it when nothing
   * was written. A record of its own, not the store's object: look it up by repository and file.
   */
  readonly sources: readonly ElementRecord[];
  /** The position of the relation in the list under the kind's key in the source file. */
  readonly index: number;
  /** One `info` problem `relation.version-added` when a stored entry without a valid version got its version. */
  readonly problems: readonly Problem[];
}

/** What `removeRelation` did. */
export interface RemovedRelation {
  /** The written file relative to the workspace root, `/` as separator; empty when there was nothing to remove. */
  readonly files: readonly string[];
  /** One `info` problem `relation.not-found` when the source has no such relation. */
  readonly problems: readonly Problem[];
}

const invalid = (message: string, details: Record<string, unknown>): CommandError =>
  new CommandError("input.invalid", message, details);

/**
 * The relation kind `key` names (`keyDefinition`: a property of the same key wins, as in every
 * check). A property is `reason: "property"`; any other key is `reason: "unknown-relation"` with
 * the relation kinds the metamodel allows from the source's type as `allowed`.
 */
const relationKindOf = (
  metamodel: Metamodel,
  key: string,
  sourceType: MetamodelEffectiveType,
): MetamodelRelationKind => {
  const found = keyDefinition(metamodel, key);
  if (found?.kind === "relation") {
    return found.definition;
  }
  if (found?.kind === "property") {
    throw invalid(`${key} is a property, not a relation kind; set it with element.update`, {
      kind: key,
      reason: "property",
    });
  }
  const allowed = metamodel.relations
    .filter((r) => allowsType(r["source-types"], sourceType.key, metamodel))
    .map((r) => r.key);
  throw invalid(
    `The metamodel has no relation kind ${key}; relation kinds from ${sourceType.name}: ${allowed.length === 0 ? "none" : allowed.join(", ")}`,
    { kind: key, reason: "unknown-relation", allowed },
  );
};

/** The items under a relation kind's key: a list (ADR-0004); an absent key holds none. */
const itemsUnder = (source: ElementRecord, key: string): readonly unknown[] => {
  const value = source.data[key];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw invalid(`${key} of ${source.file} is not a list of relations; correct the file first`, {
      kind: key,
      file: source.file,
      reason: "not-a-list",
    });
  }
  return value;
};

/** The repository an item points into: the one it names, else the source's own (D-058). */
const repositoryOf = (item: Readonly<Record<string, unknown>>, sourceRepository: string): unknown =>
  item["repository"] ?? sourceRepository;

/** What the commands read: layout, metamodel, store and short IDs as they are now. */
const stateOf = async (workspace: Workspace) => ({
  layout: await workspace.get(workspaceLayoutState),
  metamodel: await workspace.get(metamodelState),
  store: await workspace.get(elementStoreState),
  shortIds: await workspace.get(shortIdState),
});

/**
 * `relation.add`: a relation of kind `input.kind` from `input.source` to `input.target`, written
 * into the source file (see the file comment). Every check comes before the write: both references
 * (`ref.unknown`, `ref.ambiguous`), that the source may be written (SR-016 AK3), the kind, the
 * types (`relation.not-allowed`) and that the file is as the store read it (`file.changed-on-disk`).
 */
export const addRelation = async (workspace: Workspace, input: RelationInput): Promise<AddedRelation> => {
  const { layout, metamodel, store, shortIds } = await stateOf(workspace);
  const source = resolveRef(store, shortIds, input.source);
  const sourceType = assertElementWritable(metamodel, source);
  const kind = relationKindOf(metamodel, input.kind, sourceType);
  const target = resolveRef(store, shortIds, input.target);
  const items = itemsUnder(source, kind.key);
  const namesTarget = (item: unknown): item is Readonly<Record<string, unknown>> =>
    hasId(item) && item.id === target.id && repositoryOf(item, source.repository) === target.repository;
  const present = items.findIndex((item) => namesTarget(item) && isVersion(item["version"]));
  if (present >= 0) {
    return { files: [], kind, sources: [source], index: present, problems: [] };
  }
  // A stored entry without a valid version is set anew in its place (ADR-0004, #302).
  const unversioned = items.findIndex(namesTarget);
  const stored = await currentTarget({ layout, metamodel, store }, source.repository, {
    id: target.id,
    repository: target.repository,
  });
  // The rule of the check (SR-086) on the source with only the new relation.
  const [finding] = relationTypeFindings(
    { ...source, data: { [kind.key]: [stored] } },
    { store, metamodel, shortIds },
  );
  if (finding !== undefined) {
    throw new CommandError("relation.not-allowed", finding.problem.message, {
      relation: kind.key,
      sourceType: source.type,
      targetType: target.type,
    });
  }
  const unchanged = await readUnchanged(workspace, layout, source);
  // A relation target is a flow mapping of strings on one line (ADR-0004).
  const value = { ...stored };
  const { bytes } = editElementFile(unchanged.current.file, {
    edits: [
      unversioned < 0
        ? { kind: "append-item", key: kind.key, value }
        : { kind: "replace-item", key: kind.key, index: unversioned, value },
    ],
    keyOrder: sourceType.properties,
  });
  const written = await writeElementFiles(workspace, layout, [{ ...unchanged, bytes }], {
    titles: { metamodel, store },
  });
  const sources = written.map((w) => w.written.record);
  const index = unversioned < 0 ? items.length : unversioned;
  const added: Problem = {
    code: "relation.version-added",
    severity: "info",
    message: `${elementLabel({ metamodel, shortIds }, source)} had the relation ${kind.name} (${kind.key}) to ${elementLabel({ metamodel, shortIds }, target)} without a valid version; its current version is stored now`,
    repository: source.repository,
    file: source.file,
    elementId: source.id,
    targetId: target.id,
    currentVersion: stored.version,
  };
  return {
    files: written.map((w) => w.file),
    kind,
    sources,
    index,
    problems:
      unversioned < 0
        ? []
        : await locateFindings(
            layout,
            sources.map((element) => ({ element, path: [kind.key, index], problem: added })),
          ),
  };
};

/**
 * The target `ref` names for a removal: a UUID as given, so a relation to a target that is gone can
 * be removed, matched in `repository` or else in every repository; a short ID names an element,
 * matched in its repository (`repository`, when given, must be that one: `input.invalid`).
 */
const removalTarget = (
  state: Awaited<ReturnType<typeof stateOf>>,
  ref: string,
  repository: string | undefined,
): { readonly id: string; readonly repository?: string } => {
  // As given, for the message; a UUID in any case is the lower-case UUID (#309).
  const given: string = ref;
  const id = normalizeRef(ref);
  if (isUuid(id)) {
    return repository === undefined ? { id } : { id, repository };
  }
  const record = resolveRef(state.store, state.shortIds, ref);
  if (repository !== undefined && repository !== record.repository) {
    throw invalid(`${given} is an element of repository ${record.repository}, not of ${repository}`, {
      ref: given,
      repository,
      reason: "repository-mismatch",
    });
  }
  return { id: record.id, repository: record.repository };
};

/**
 * `relation.remove`: removes the relation of kind `input.kind` from `input.source` to
 * `input.target` from the source file (see the file comment). A UUID whose relations under the
 * kind point into several repositories, one of which may hold an element with that UUID (it has
 * one, is not on this machine or is not in the workspace file), is `ref.ambiguous`; give the short
 * ID or `repository`.
 */
export const removeRelation = async (
  workspace: Workspace,
  input: RemoveRelationInput,
): Promise<RemovedRelation> => {
  const state = await stateOf(workspace);
  const { layout, metamodel, store, shortIds } = state;
  const source = resolveRef(store, shortIds, input.source);
  const sourceType = assertElementWritable(metamodel, source);
  const kind = relationKindOf(metamodel, input.kind, sourceType);
  const target = removalTarget(state, input.target, input.repository);
  const items = itemsUnder(source, kind.key);
  const indexes: number[] = [];
  const repositories = new Set<unknown>();
  items.forEach((item, index) => {
    if (hasId(item) && item.id === target.id) {
      const repository = repositoryOf(item, source.repository);
      if ((target.repository ?? repository) === repository) {
        indexes.push(index);
        repositories.add(repository);
      }
    }
  });
  // A repository may hold the element unless it is here and has none: then its short ID could name it.
  const records = store.byId.get(target.id) ?? [];
  const mayHold = (repository: unknown): boolean =>
    layout.repositories.find((r) => r.name === repository)?.available !== true ||
    records.some((r) => r.repository === repository);
  if (repositories.size > 1 && [...repositories].some(mayHold)) {
    throw new CommandError(
      "ref.ambiguous",
      `${input.target} names relations ${kind.key} into more than one repository (${[...repositories].map(String).join(", ")}); give the short ID of the target or repository`,
      { ref: input.target, repositories: [...repositories] },
    );
  }
  if (indexes.length === 0) {
    const problem: Problem = {
      code: "relation.not-found",
      severity: "info",
      message: `${elementLabel({ metamodel, shortIds }, source)} has no relation ${kind.name} (${kind.key}) to ${input.target}; nothing removed`,
      repository: source.repository,
      file: source.file,
      elementId: source.id,
      targetId: target.id,
    };
    return { files: [], problems: [problem] };
  }
  const unchanged = await readUnchanged(workspace, layout, source);
  // Items from the last, so each index still names its item; the key goes with its last item.
  const edits: FrontmatterEdit[] =
    indexes.length === items.length
      ? [{ kind: "remove", key: kind.key }]
      : indexes.toReversed().map((index) => ({ kind: "remove-item", key: kind.key, index }));
  const { bytes } = editElementFile(unchanged.current.file, { edits });
  const written = await writeElementFiles(workspace, layout, [{ ...unchanged, bytes }], {
    titles: { metamodel, store },
  });
  return { files: written.map((w) => w.file), problems: [] };
};
