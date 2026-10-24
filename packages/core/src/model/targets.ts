// Setting relation targets and inline references (SR-021, D-013, D-058; ADR-0004, ADR-0005). A
// relation or reference stores the UUID of its target and the target's version at the moment it is
// set. A target already stored keeps its stored version, so saving never confirms an outdated
// relation on its own; only confirming a hint changes a stored version (D-042, SR-027). Every new
// target gets the current version of its target (spec question #177). Used by `element.create`
// and `element.update`; `relation.add`, `element.supersede` and cross-repository relations
// (SR-005) build on `currentTarget`.
import { CommandError } from "../catalog.js";
import { readElementFile } from "../files/index.js";
import type { ElementInputValue, ElementValue, RelationTarget } from "../generated/types.js";
import type { Metamodel } from "../metamodel/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { resolveId } from "./duplicates.js";
import type { ElementMatch, ElementRecord } from "./elements.js";
import { classifyFile, isUuid } from "./elements.js";
import { markdownLinks } from "./markdown-links.js";
import { isUnavailableRepository, resolveTarget } from "./relations.js";
import type { ElementStore } from "./store.js";
import { elementVersion, titleKeyOf } from "./view.js";

/** What setting a target needs: the workspace state as read. */
export interface TargetContext {
  readonly layout: WorkspaceLayout;
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
}

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
      throw new CommandError(
        "ref.unknown",
        `No element ${repository === undefined ? "" : `of repository ${repository} `}has the UUID ${id}, so its version cannot be stored`,
        { ref: id, ...where },
      );
    case "ambiguous":
      throw new CommandError("ref.ambiguous", `${id} names more than one element; give one file a new UUID`, {
        ref: id,
        ...where,
        candidates: match.elements.map((e) => ({ id: e.id, repository: e.repository, file: e.file })),
      });
  }
};

/**
 * The current version and title of `record`, from its file as it is now (the store keeps no text):
 * a file changed since the store read it counts as it is now. `ref.unknown` when the file is gone
 * or no longer this element.
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
    version: elementVersion(element, read.file.body, context.metamodel),
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

/** The repository a stored or given target names, the source's own when it names none. */
const repositoryOf = (item: Readonly<Record<string, unknown>>, sourceRepository: string): unknown =>
  item["repository"] ?? sourceRepository;

/**
 * The value of a relation-valued property as it is stored (SR-021 AK1). A target is the pair of
 * UUID and repository: one the property already stores in `stored` keeps its stored entry
 * unchanged, whatever version the caller sends (also a malformed one; the value-kind check reports
 * it). Every other target gets its current version (`currentTarget`). Items that are no target are
 * kept; the value-kind check reports them (SR-085).
 */
export const setRelationTargets = async (
  context: TargetContext,
  sourceRepository: string,
  value: ElementInputValue,
  stored: unknown,
): Promise<ElementValue> => {
  const storedItems = (Array.isArray(stored) ? (stored as unknown[]) : [stored]).filter(isTargetInput);
  const set = async (item: unknown): Promise<unknown> => {
    if (!isTargetInput(item)) {
      return item;
    }
    const kept = storedItems.find(
      (s) => s.id === item.id && repositoryOf(s, sourceRepository) === repositoryOf(item, sourceRepository),
    );
    return kept ?? currentTarget(context, sourceRepository, item);
  };
  if (Array.isArray(value)) {
    return (await Promise.all(value.map(set))) as ElementValue;
  }
  return (await set(value)) as ElementValue;
};

/** An inline reference `[label](logreq:<uuid>?version=<version>)` in a text (ADR-0004). */
export interface InlineReference {
  readonly id: string;
  /** Undefined when the link has no `version` parameter. */
  readonly version?: string;
  /** The link destination as written: `logreq:` and the UUID, then the query, if any. */
  readonly destination: string;
  /** Offsets of the destination in the text, end exclusive. */
  readonly start: number;
  readonly end: number;
}

const SCHEME = "logreq:";

/** The query parameters of a destination, in order, as written. */
const queryOf = (destination: string): string[] => {
  const query = destination.indexOf("?");
  return query < 0 ? [] : destination.slice(query + 1).split("&");
};

/**
 * The inline references of a Markdown text in order: links (not images) whose destination is
 * `logreq:<uuid>`, outside code (`markdownLinks`). A `logreq:` link whose target is no UUID is not
 * one.
 */
export const inlineReferences = (text: string): InlineReference[] =>
  markdownLinks(text).flatMap((link): InlineReference[] => {
    if (link.image || !link.destination.startsWith(SCHEME)) {
      return [];
    }
    const rest = link.destination.slice(SCHEME.length);
    const id = rest.includes("?") ? rest.slice(0, rest.indexOf("?")) : rest;
    if (!isUuid(id)) {
      return [];
    }
    const version = queryOf(link.destination)
      .find((p) => p.startsWith("version="))
      ?.slice("version=".length);
    const { destination, start, end } = link;
    return [{ id, ...(version === undefined ? {} : { version }), destination, start, end }];
  });

/** The destination with `version` set: the parameter replaced where it is, else appended; other parameters stay. */
const withVersion = (reference: InlineReference, version: string): string => {
  const params = queryOf(reference.destination);
  const at = params.findIndex((p) => p.startsWith("version="));
  const next = at < 0 ? [...params, `version=${version}`] : params.with(at, `version=${version}`);
  return `${SCHEME}${reference.id}?${next.join("&")}`;
};

const isLookupError = (error: unknown): boolean =>
  error instanceof CommandError && (error.code === "ref.unknown" || error.code === "ref.ambiguous");

/**
 * The text as it is stored (SR-021 AK2): every inline reference carries the UUID and version of its
 * target. A reference with a UUID and version that `storedText` already has is kept. A reference
 * whose destination `storedText` has as written, but without a version, gets the current version
 * when its target can be found and is kept as it is otherwise, so it never blocks other changes.
 * Every other reference (new, or with a version changed by hand, spec question #177) gets the
 * current version of its target, looked up in the whole workspace (the link names no repository);
 * an unknown or ambiguous target refuses the write. Labels, other query parameters and everything
 * else stay as given.
 */
export const setInlineReferences = async (
  context: TargetContext,
  text: string,
  storedText: string,
): Promise<string> => {
  const before = inlineReferences(storedText);
  const pairs = new Set(before.flatMap((r) => (r.version === undefined ? [] : [`${r.id} ${r.version}`])));
  const destinations = new Set(before.map((r) => r.destination));
  const versions = new Map<string, Promise<string>>();
  const versionOf = (id: string): Promise<string> => {
    const known = versions.get(id);
    if (known !== undefined) {
      return known;
    }
    const pending = (async () =>
      (await current(context, single(context, resolveId(context.store.byId, id), id))).version)();
    versions.set(id, pending);
    return pending;
  };
  const parts: string[] = [];
  let last = 0;
  for (const reference of inlineReferences(text)) {
    if (reference.version !== undefined && pairs.has(`${reference.id} ${reference.version}`)) {
      continue;
    }
    let version: string;
    try {
      version = await versionOf(reference.id);
    } catch (error) {
      if (destinations.has(reference.destination) && isLookupError(error)) {
        continue;
      }
      throw error;
    }
    parts.push(text.slice(last, reference.start), withVersion(reference, version));
    last = reference.end;
  }
  parts.push(text.slice(last));
  return parts.join("");
};
