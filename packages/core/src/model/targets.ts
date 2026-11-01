// Setting relation targets and inline references (SR-021, D-013, D-058; ADR-0004, ADR-0005). A
// relation or reference stores the UUID of its target and the target's version at the moment it is
// set. A target already stored keeps its stored version, so saving never confirms an outdated
// relation on its own; only confirming a hint changes a stored version (D-042, SR-027). Every new
// target gets the current version of its target (spec question #177). Across repositories a
// relation target and an inline reference also name the target's repository (D-058). Used by
// `element.create` and `element.update`; `relation.add`, `element.supersede` and cross-repository
// relations (SR-005) build on `currentTarget`.
import { CommandError, commandErrorOrThrow } from "../catalog.js";
import { readElementFile } from "../files/index.js";
import type { ElementInputValue, ElementValue, RelationTarget } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import { isVersion } from "./is-version.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { ElementMatch, ElementRecord } from "./elements.js";
import { classifyFile } from "./elements.js";
import type { ImageMemo } from "./images.js";
import { embeddedImages } from "./images.js";
import type { InlineReference } from "./references.js";
import {
  inlineReferences,
  queryOf,
  resolveReference,
  SCHEME,
  unavailableRepositoryHint,
  unresolvedLinks,
} from "./references.js";
import { resolveRef } from "./resolve.js";
import type { ShortIds } from "./short-id.js";
import { buildShortIds } from "./short-id.js";
import { isUnavailableRepository, resolveTarget } from "./relations.js";
import type { ElementStore } from "./store.js";
import { ignoredBy } from "./store.js";
import { elementVersion, titleKeyOf } from "./view.js";

/** What setting a target needs: the workspace state as read. */
export interface TargetContext {
  readonly layout: WorkspaceLayout;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  /** Folder listings and image hashes shared by the targets of one command (`imageMemo`). */
  readonly images?: ImageMemo;
  /**
   * The short IDs and identifiers of the store, to resolve a `reqseq:` link that names its target by
   * one (#176); built from the store when not given, only when such a link occurs.
   */
  readonly shortIds?: ShortIds;
}

/** Short IDs built per store and metamodel for `TargetContext`s without them. */
const builtShortIds = new WeakMap<ElementStore, WeakMap<Metamodel, ShortIds>>();

const shortIdsOf = (context: TargetContext): ShortIds => {
  if (context.shortIds !== undefined) {
    return context.shortIds;
  }
  const byMetamodel = builtShortIds.get(context.store) ?? new WeakMap<Metamodel, ShortIds>();
  builtShortIds.set(context.store, byMetamodel);
  const known = byMetamodel.get(context.metamodel);
  if (known !== undefined) {
    return known;
  }
  const built = buildShortIds(context.store.byId, context.metamodel);
  byMetamodel.set(context.metamodel, built);
  return built;
};

/** The one record a match names; `ref.unknown` or `ref.ambiguous` otherwise (like `resolveRef`). */
const single = (
  context: TargetContext,
  match: ElementMatch,
  id: string,
  repository?: string,
): ElementRecord => {
  const where = repository === undefined ? {} : { repository };
  switch (match.kind) {
    case "found":
      return match.element;
    case "unknown":
      // A repository listed in the workspace file but not on this machine (SR-006): say so.
      if (isUnavailableRepository(context.layout, repository)) {
        throw new CommandError(
          "ref.unknown",
          `Repository ${String(repository)} is not on this machine, so the version of ${id} cannot be read and stored`,
          { ref: id, ...where, reason: "repository-not-available" },
        );
      }
      // Only an inline reference names no repository (a link, D-058): say how to name one not here.
      throw new CommandError(
        "ref.unknown",
        `No element ${repository === undefined ? "" : `of repository ${repository} `}has the UUID ${id}, so its version cannot be stored${repository === undefined ? unavailableRepositoryHint(context.layout) : ""}`,
        { ref: id, ...where },
      );
    case "ambiguous": {
      // Copies in several repositories: a link can name the one it means.
      const repositories = [...new Set(match.elements.map((e) => e.repository))];
      const hint =
        repository === undefined && repositories.length > 1
          ? `, or add repository=<name> to the link (${repositories.join(", ")})`
          : "";
      throw new CommandError(
        "ref.ambiguous",
        `${id} names more than one element; give one file a new UUID${hint}`,
        {
          ref: id,
          ...where,
          candidates: match.elements.map((e) => ({ id: e.id, repository: e.repository, file: e.file })),
        },
      );
    }
  }
};

/**
 * The current version and title of `record`, from its file and the images it embeds as they are
 * now (the store keeps no text): a file changed since the store read it counts as it is now.
 * `ref.unknown` when the file is gone or no longer this element.
 */
const current = async (
  context: TargetContext,
  record: ElementRecord,
): Promise<{ readonly version: string; readonly title?: string }> => {
  const repository = context.layout.repositories.find((r) => r.name === record.repository);
  if (repository === undefined) {
    // The store reads only repositories of the layout, so this is a bug.
    throw new CommandError(
      "internal",
      `Repository ${record.repository} of ${record.file} is not in the workspace`,
    );
  }
  const read = await readElementFile(repository.folder, record.file);
  const classified = read.kind === "parsed" ? classifyFile(record.repository, read.file) : undefined;
  if (read.kind !== "parsed" || classified?.kind !== "element" || classified.element.id !== record.id) {
    throw new CommandError(
      "ref.unknown",
      `The target ${record.id} is no longer in ${record.file}, so its version cannot be stored`,
      { ref: record.id, repository: record.repository, file: record.file },
    );
  }
  const element = classified.element;
  const titleKey = titleKeyOf(context.metamodel);
  const title = titleKey === undefined ? undefined : element.data[titleKey];
  return {
    version: elementVersion(
      element,
      read.file.body,
      context.metamodel,
      await embeddedImages(
        { repository, ignored: ignoredBy(context.layout) },
        record.file,
        read.file.body,
        context.images,
      ),
    ),
    ...(typeof title === "string" ? { title } : {}),
  };
};

/**
 * The target `target` names as a source in `sourceRepository` stores it now (ADR-0004, D-058): its
 * UUID and current version, plus its title within the same repository, or the workspace name of
 * its repository (never a title) across repositories. The target is looked up with
 * `resolveTarget`; a version or title in `target` is ignored.
 */
export const currentTarget = async (
  context: TargetContext,
  sourceRepository: string,
  target: { readonly id: string; readonly repository?: string },
): Promise<RelationTarget> => {
  const repository = target.repository ?? sourceRepository;
  const record = single(
    context,
    resolveTarget(context.store, sourceRepository, { id: target.id, repository }),
    target.id,
    repository,
  );
  const { version, title } = await current(context, record);
  if (repository !== sourceRepository) {
    return { id: target.id, version, repository };
  }
  return { id: target.id, version, ...(title === undefined ? {} : { title }) };
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether an item is a target given by the caller: a mapping with an `id` (the input schema checks the rest). */
const isTargetInput = (value: unknown): value is { readonly id: string; readonly repository?: string } =>
  isRecord(value) && typeof value["id"] === "string";

/** The target a stored or given item names: its UUID and repository, the source's own when it names none. */
const targetKey = (
  item: { readonly id: string; readonly repository?: unknown },
  sourceRepository: string,
): string => JSON.stringify([item.id, item.repository ?? sourceRepository]);

/** Whether a stored entry has a valid version; then it is kept unchanged, whatever else it holds. */
const hasVersion = (item: Readonly<Record<string, unknown>>): boolean => isVersion(item["version"]);

const isLookupError = (error: unknown): boolean =>
  error instanceof CommandError && (error.code === "ref.unknown" || error.code === "ref.ambiguous");

/**
 * The value of a relation-valued property as it is stored (SR-021 AK1). A target is the pair of
 * UUID and repository, and a list names each target once (the first time it is given). A target
 * the property already stores in `stored` with a valid version keeps its stored entry unchanged
 * (also other keys in it; the value-kind check reports them), whatever version the caller sends. Every other target gets its current version
 * (`currentTarget`); a stored entry without a valid version whose target cannot be found
 * (`ref.unknown`, `ref.ambiguous`) is kept as it is, so it never blocks other changes. Items that
 * are no target are kept; the value-kind check reports them (SR-085).
 */
export const setRelationTargets = async (
  context: TargetContext,
  sourceRepository: string,
  given: ElementInputValue,
  stored: unknown,
): Promise<ElementValue> => {
  // A UUID given in any case is stored in lower case (`uuidRef`, #309, spec question #316).
  const lower = (item: unknown): unknown =>
    isTargetInput(item) ? { ...item, id: item.id.toLowerCase() } : item;
  const value = (Array.isArray(given) ? (given as unknown[]).map(lower) : lower(given)) as ElementInputValue;
  const storedItems = (Array.isArray(stored) ? (stored as unknown[]) : [stored]).filter(isTargetInput);
  const set = async (item: unknown): Promise<unknown> => {
    if (!isTargetInput(item)) {
      return item;
    }
    const key = targetKey(item, sourceRepository);
    const same = storedItems.filter((s) => targetKey(s, sourceRepository) === key);
    const kept = same.find(hasVersion);
    if (kept !== undefined) {
      return kept;
    }
    try {
      return await currentTarget(context, sourceRepository, item);
    } catch (error) {
      const [unversioned] = same;
      if (unversioned !== undefined && isLookupError(error)) {
        return unversioned;
      }
      throw error;
    }
  };
  if (!Array.isArray(value)) {
    return (await set(value)) as ElementValue;
  }
  const seen = new Set<string>();
  const once = (value as unknown[]).filter((item) => {
    if (!isTargetInput(item)) {
      return true;
    }
    const key = targetKey(item, sourceRepository);
    const first = !seen.has(key);
    seen.add(key);
    return first;
  });
  return (await Promise.all(once.map(set))) as ElementValue;
};

/**
 * The destination as a reference that is set stores it (ADR-0004): `version` replaced where it is,
 * else appended; then `repository=<across>` right after `version` when the target lies in another
 * repository and the link names none. A `repository` that names the source's own repository is
 * dropped, as `currentTarget` stores no repository within it (D-058). Other parameters stay.
 */
const withTarget = (
  reference: InlineReference,
  version: string,
  across: string | undefined,
  sourceRepository: string,
): string => {
  // An empty `repository=` names none, and one naming the source's own repository is dropped.
  const params = queryOf(reference.destination).filter(
    (p) => p !== "repository=" && !(p.startsWith("repository=") && reference.repository === sourceRepository),
  );
  const at = params.findIndex((p) => p.startsWith("version="));
  const named = reference.repository !== undefined && reference.repository !== sourceRepository;
  const added = [`version=${version}`, ...(across === undefined || named ? [] : [`repository=${across}`])];
  const next = at < 0 ? [...params, ...added] : params.toSpliced(at, 1, ...added);
  return `${SCHEME}${reference.id}?${next.join("&")}`;
};

/** A reference as the stored text has it: UUID, version and repository as written. */
const referenceKey = (reference: InlineReference): string =>
  JSON.stringify([reference.id, reference.version, reference.repository]);

/**
 * The text as it is stored (SR-021 AK2, D-058): every inline reference carries the UUID and version
 * of its target and, when the target lies in another repository than `sourceRepository`, the
 * workspace name of that repository. A reference with a UUID, version and repository that
 * `storedText` already has is kept as written, also one to another repository without
 * `repository` (written before references named their repository, decision on #177 (c)). A
 * reference whose destination `storedText` has as written, but without a version, gets the current
 * version when its target can be found and is kept as it is otherwise, so it never blocks other
 * changes. Every other reference (new, or with a version or repository changed by hand, spec
 * question #177) gets the current version of its target (`resolveReference`): looked up in the
 * repository it names (`ref.unknown` with reason `repository-not-available` for one that is not on
 * this machine), or, when it names none, in the source's own repository and else in the one other
 * repository that has it; `repository` then follows `version` when the target lies in another
 * repository, and a `repository` naming the source's own is dropped (`withTarget`). An unknown or
 * ambiguous target refuses the write. Labels, other query parameters and everything else stay as
 * given.
 */
export const setInlineReferences = async (
  context: TargetContext,
  given: string,
  storedText: string,
  sourceRepository: string,
): Promise<string> => {
  const text = withUuids(context, given, storedText);
  const before = inlineReferences(storedText);
  const kept = new Set(before.flatMap((r) => (r.version === undefined ? [] : [referenceKey(r)])));
  const destinations = new Set(before.map((r) => r.destination));
  const targets = new Map<string, Promise<{ readonly version: string; readonly repository: string }>>();
  const targetOf = (
    reference: InlineReference,
  ): Promise<{ readonly version: string; readonly repository: string }> => {
    const key = JSON.stringify([reference.id, reference.repository]);
    const known = targets.get(key);
    if (known !== undefined) {
      return known;
    }
    const { id, repository } = reference;
    const pending = (async () => {
      const record = single(
        context,
        resolveReference(context.store, sourceRepository, reference),
        id,
        repository,
      );
      return { version: (await current(context, record)).version, repository: record.repository };
    })();
    targets.set(key, pending);
    return pending;
  };
  const parts: string[] = [];
  let last = 0;
  for (const reference of inlineReferences(text)) {
    if (reference.version !== undefined && kept.has(referenceKey(reference))) {
      continue;
    }
    let target: { readonly version: string; readonly repository: string };
    try {
      target = await targetOf(reference);
    } catch (error) {
      if (destinations.has(reference.destination) && isLookupError(error)) {
        continue;
      }
      throw error;
    }
    const across = target.repository === sourceRepository ? undefined : target.repository;
    parts.push(
      text.slice(last, reference.start),
      withTarget(reference, target.version, across, sourceRepository),
    );
    last = reference.end;
  }
  parts.push(text.slice(last));
  return parts.join("");
};

/**
 * `text` with every `reqseq:` link whose target is a short ID or an identifier (#176) naming the
 * target's UUID instead, the query kept as written: `[D-031](reqseq:D-031)` becomes
 * `[D-031](reqseq:<uuid>)`, which `setInlineReferences` then gives its version like any new
 * reference. The target is resolved like every element reference (`resolveRef`: UUID, short ID or
 * identifier, in any case), within the repository the link names, if any. A link that does not
 * resolve refuses the write (`ref.unknown`, `ref.ambiguous`), unless `storedText` has it as written:
 * then it stays, so it never blocks other changes (`workspace.check` reports it).
 */
const withUuids = (context: TargetContext, text: string, storedText: string): string => {
  const links = text.includes(SCHEME) ? unresolvedLinks(text) : [];
  if (links.length === 0) {
    return text;
  }
  const stored = new Set(unresolvedLinks(storedText).map((l) => l.destination));
  const parts: string[] = [];
  let last = 0;
  for (const link of links) {
    let id: string;
    try {
      id = resolveRef(
        context.store,
        shortIdsOf(context),
        link.target,
        link.repository === undefined ? {} : { repository: link.repository },
      ).id;
    } catch (error) {
      if (!isLookupError(error)) {
        throw error;
      }
      if (stored.has(link.destination)) {
        continue;
      }
      const failed = error as CommandError;
      throw new CommandError(failed.code, `${failed.message}, in the link ${link.destination}`, {
        ...failed.details,
        link: link.destination,
      });
    }
    parts.push(
      text.slice(last, link.start),
      `${SCHEME}${id}${link.destination.slice(SCHEME.length + link.target.length)}`,
    );
    last = link.end;
  }
  parts.push(text.slice(last));
  return parts.join("");
};

/** The values of a property as text: a string, or the strings of a list, joined by line breaks. */
const textOf = (value: unknown): string =>
  (Array.isArray(value) ? (value as unknown[]) : [value]).filter((v) => typeof v === "string").join("\n");

/**
 * The value of a property marked `markdown` as it is stored (SR-127): every string of it, or of its
 * list, as `setInlineReferences` stores the text, compared with all the strings the property holds
 * now in `stored`, so a reference kept as written stays and a new one gets the version of its
 * target. Other items are kept as given. A target that cannot be stored (`ref.unknown`,
 * `ref.ambiguous`) refuses the write, with the `key` of the property in the message and in the
 * details of the error.
 */
export const setMarkdownReferences = async (
  context: TargetContext,
  key: string,
  sourceRepository: string,
  given: ElementInputValue,
  stored: unknown,
): Promise<ElementValue> => {
  const storedText = textOf(stored);
  const set = async (item: unknown): Promise<unknown> =>
    typeof item === "string" && item.includes(SCHEME)
      ? await setInlineReferences(context, item, storedText, sourceRepository)
      : item;
  try {
    return (
      Array.isArray(given) ? await Promise.all((given as unknown[]).map(set)) : await set(given)
    ) as ElementValue;
  } catch (error) {
    const failed = commandErrorOrThrow(error);
    throw new CommandError(failed.code, `${failed.message} (in the property ${key})`, {
      ...failed.details,
      key,
    });
  }
};
