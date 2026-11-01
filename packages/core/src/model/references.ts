// Inline references in the text of an element (ADR-0004, SR-066, D-058): Markdown links
// `[<label>](reqseq:<uuid>?version=<version>)`, plus `&repository=<name>` (the workspace name of the
// target's repository, D-041) when the target lies in another repository than the source (decision
// on spec question #177 (c), option 1). A link without `repository` (or with an empty one) points
// into the source's own repository, as a relation target without one does (D-058); so that links
// written before this decision keep working, a target that is not there but lies in exactly one
// other repository counts as found there (`resolveReference`). The element store keeps the
// references of each element (`ElementRecord.references`), so the missing-target check (SR-089)
// needs no text; the writer (`targets.ts`) sets their versions.
//
// Properties marked `markdown` in the metamodel (SR-127, `markdownKeysOf`) hold such links too, in
// each of their values, with the same rules: the store keeps them as `propertyReferences`, and
// `referencesOf` gives the ones that count for a metamodel (text and marked properties), so every
// check reads one list. Images in such a value are no embedded images (ADR-0005).
import type { Metamodel } from "../metamodel/index.js";
import { markdownKeysOf } from "../metamodel/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { ElementMatch, ElementRecord } from "./elements.js";
import { markdownLinks } from "./markdown-links.js";
import type { TargetState } from "./relations.js";
import { resolveTarget, targetState } from "./relations.js";
import type { ElementStore } from "./store.js";
import { isUuid } from "./uuid.js";

/** An inline reference `[label](reqseq:<uuid>?version=<version>&repository=<name>)` in a text. */
export interface InlineReference {
  readonly id: string;
  /** Undefined when the link has no `version` parameter. */
  readonly version?: string;
  /** The first `repository` parameter as written; undefined when the link has none. */
  readonly repository?: string;
  /** The link destination as written: `reqseq:` and the UUID, then the query, if any. */
  readonly destination: string;
  /** Offsets of the destination in the text, end exclusive. */
  readonly start: number;
  readonly end: number;
  /** The line of the destination's start in the text, from 1. */
  readonly line: number;
}

/**
 * An inline reference as the element store keeps it (`ElementRecord.references`): its target and
 * the line of the link in the file (line 1 is the opening `---`).
 */
export interface TextReference {
  readonly id: string;
  readonly version?: string;
  readonly repository?: string;
  readonly line: number;
}

/**
 * An inline reference in a value of a property of the frontmatter (SR-127): the reference of the
 * text, plus the property `key` and, for a list, the position `item` of the value (from 0) that
 * holds the link. `line` is the line of the value in the file (for a block scalar, of the link in it).
 */
export interface PropertyReference extends TextReference {
  readonly key: string;
  /** The position in the list under `key`; undefined for a single value. */
  readonly item?: number;
}

/** A reference of the text (`key` undefined) or of a property marked `markdown`. */
export type LinkedReference = TextReference & {
  readonly key?: string;
  readonly item?: number;
};

export const SCHEME = "reqseq:";

/** The query parameters of a destination, in order, as written; empty ones (`?`, `&&`) are none. */
export const queryOf = (destination: string): string[] => {
  const query = destination.indexOf("?");
  return query < 0
    ? []
    : destination
        .slice(query + 1)
        .split("&")
        .filter((p) => p !== "");
};

/** The value of the first parameter `name` of `params`, undefined when there is none. */
const param = (params: readonly string[], name: string): string | undefined =>
  params.find((p) => p.startsWith(`${name}=`))?.slice(name.length + 1);

/**
 * A `reqseq:` link of a text whose target is no UUID (#176), such as a short ID or an identifier
 * (`reqseq:D-031`): the writer resolves it (`setInlineReferences`), `workspace.check` reports one
 * that is stored (`unresolvedLinkProblemsState`).
 */
export interface UnresolvedLink {
  /** The target as written, between `reqseq:` and the query; not empty. */
  readonly target: string;
  /** The first `repository` parameter as written; undefined when the link has none or an empty one. */
  readonly repository?: string;
  readonly destination: string;
  readonly start: number;
  readonly end: number;
  readonly line: number;
}

/** The `reqseq:` links (not images) of a Markdown text in order, outside code, with their lines; an empty target is none. */
const reqseqLinks = (text: string): UnresolvedLink[] => {
  let line = 1;
  let counted = 0;
  return markdownLinks(text).flatMap((link): UnresolvedLink[] => {
    if (link.image || !link.destination.startsWith(SCHEME)) {
      return [];
    }
    const rest = link.destination.slice(SCHEME.length);
    const target = rest.includes("?") ? rest.slice(0, rest.indexOf("?")) : rest;
    if (target === "") {
      return [];
    }
    // An empty `repository=` names no repository.
    const named = param(queryOf(link.destination), "repository");
    const repository = named === "" ? undefined : named;
    const { destination, start, end } = link;
    // Links come in text order, so the lines are counted once over the whole text.
    let at = text.indexOf("\n", counted);
    while (at !== -1 && at < start) {
      line += 1;
      counted = at + 1;
      at = text.indexOf("\n", counted);
    }
    return [{ target, ...(repository === undefined ? {} : { repository }), destination, start, end, line }];
  });
};

/** A link whose target is a UUID as an inline reference, with its version. */
const asReference = ({
  target,
  repository,
  destination,
  start,
  end,
  line,
}: UnresolvedLink): InlineReference => {
  const version = param(queryOf(destination), "version");
  return {
    id: target,
    ...(version === undefined ? {} : { version }),
    ...(repository === undefined ? {} : { repository }),
    destination,
    start,
    end,
    line,
  };
};

/** The `reqseq:` links of a text in one scan: the inline references, and the links whose target is no UUID (#176). */
const linksOf = (text: string): { references: InlineReference[]; unresolved: UnresolvedLink[] } => {
  const references: InlineReference[] = [];
  const unresolved: UnresolvedLink[] = [];
  for (const link of reqseqLinks(text)) {
    if (isUuid(link.target)) {
      references.push(asReference(link));
    } else {
      unresolved.push(link);
    }
  }
  return { references, unresolved };
};

/**
 * The inline references of a Markdown text in order: links (not images) whose destination is
 * `reqseq:<uuid>`, outside code (`markdownLinks`). A `reqseq:` link whose target is no UUID is not
 * one (`unresolvedLinks`).
 */
export const inlineReferences = (text: string): InlineReference[] => linksOf(text).references;

/** The `reqseq:` links of a Markdown text whose target is no UUID, in order (#176). */
export const unresolvedLinks = (text: string): UnresolvedLink[] => linksOf(text).unresolved;

/**
 * A `reqseq:` link whose target is no UUID as the element store keeps it (`ElementRecord.unresolvedLinks`,
 * #176): the target and repository as written, its line in the file, and for a link in a property
 * its key and position, as `PropertyReference` has them.
 */
export interface StoredUnresolvedLink {
  readonly target: string;
  readonly repository?: string;
  readonly line: number;
  readonly key?: string;
  readonly item?: number;
}

/** Where a scalar of the frontmatter is: the line of its value and whether it is a block scalar (`|`, `>`). */
export type ValuePlace = (
  key: string,
  item: number | undefined,
) => { line: number; block: boolean } | undefined;

/** The links of an element file, as `classifyFile` keeps them in its record. */
export interface ElementLinks {
  readonly references: TextReference[];
  readonly propertyReferences: PropertyReference[];
  readonly unresolvedLinks: StoredUnresolvedLink[];
}

/** A reference or link with its target and repository, without offsets and destination. */
const stored = (link: {
  readonly version?: string;
  readonly repository?: string;
}): { version?: string; repository?: string } => ({
  ...(link.version === undefined ? {} : { version: link.version }),
  ...(link.repository === undefined ? {} : { repository: link.repository }),
});

/**
 * The links of an element file, each string scanned once (N-036): the inline references of the text
 * `body` with their lines in the file; those in the string values of the frontmatter `data` (a value,
 * or the strings of a list), whatever the key, since the metamodel is not known when a file is read
 * (`referencesOf` takes the marked properties, SR-127), with the line `place` gives; and the links
 * whose target is no UUID (#176), those of the properties first, then those of the text. A text or
 * frontmatter without `reqseq:`, which is nearly every file, is not scanned.
 */
export const elementLinks = (
  frontmatter: string,
  body: string,
  data: Readonly<Record<string, unknown>>,
  place: ValuePlace,
): ElementLinks => {
  const propertyReferences: PropertyReference[] = [];
  const unresolvedLinks: StoredUnresolvedLink[] = [];
  if (frontmatter.includes(SCHEME)) {
    const scan = (key: string, item: number | undefined, value: unknown): void => {
      if (typeof value !== "string" || !value.includes(SCHEME)) {
        return;
      }
      const where = place(key, item);
      // A link in a block scalar lies below the line with its `|` or `>`.
      const lineOf = (line: number): number => (where?.line ?? 1) + (where?.block === true ? line : 0);
      const at = { key, ...(item === undefined ? {} : { item }) };
      const found = linksOf(value);
      for (const reference of found.references) {
        propertyReferences.push({
          id: reference.id,
          ...stored(reference),
          line: lineOf(reference.line),
          ...at,
        });
      }
      for (const link of found.unresolved) {
        unresolvedLinks.push({ target: link.target, ...stored(link), line: lineOf(link.line), ...at });
      }
    };
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        value.forEach((v: unknown, i) => {
          scan(key, i, v);
        });
      } else {
        scan(key, undefined, value);
      }
    }
  }
  const references: TextReference[] = [];
  if (body.includes(SCHEME)) {
    // Line 1 is the opening `---`, then the frontmatter lines, then the closing `---`.
    const before = 2 + frontmatter.split("\n").length - 1;
    const found = linksOf(body);
    for (const reference of found.references) {
      references.push({ id: reference.id, ...stored(reference), line: before + reference.line });
    }
    for (const link of found.unresolved) {
      unresolvedLinks.push({ target: link.target, ...stored(link), line: before + link.line });
    }
  }
  return { references, propertyReferences, unresolvedLinks };
};

/**
 * Where a message puts a reference (SR-127): "the text", or the property key, with the position of
 * the value (from 1) for a list, e.g. "acceptance-criteria (item 2)".
 */
export const placeOfReference = ({ key, item }: Pick<LinkedReference, "key" | "item">): string =>
  key === undefined ? "the text" : item === undefined ? key : `${key} (item ${String(item + 1)})`;

const NONE: readonly never[] = Object.freeze([]);

/**
 * The inline references of `element` that count under `metamodel` (SR-127): those of the properties
 * marked `markdown` in file order, then those of the text. A link in a title, an identifier or an
 * unmarked property is none. Most elements have no link outside the text, so the list is the
 * element's own then, not a copy.
 */
export const referencesOf = (element: ElementRecord, metamodel: Metamodel): readonly LinkedReference[] => {
  const { references = NONE, propertyReferences: found } = element;
  if (found === undefined) {
    return references;
  }
  const keys = markdownKeysOf(metamodel);
  const own = found.filter((r) => keys.has(r.key));
  return own.length === 0 ? references : [...own, ...references];
};

/**
 * The element an inline reference of a source in `sourceRepository` names. With `repository`: the
 * records of its UUID in that repository (`resolveTarget`). Without: those in the source's own
 * repository (D-058), as for a relation target; when there is none there, the one record of the
 * UUID in another repository (a link written before references named their repository, or copied
 * from one), `ambiguous` when several other repositories have it, in store order.
 */
export const resolveReference = (
  store: ElementStore,
  sourceRepository: string,
  reference: { readonly id: string; readonly repository?: string },
): ElementMatch => {
  const { id, repository } = reference;
  const named = resolveTarget(store, sourceRepository, { id, repository: repository ?? sourceRepository });
  if (repository !== undefined || named.kind !== "unknown") {
    return named;
  }
  const elsewhere = store.byId.get(id) ?? [];
  const [first] = elsewhere;
  if (first === undefined) {
    return named;
  }
  return elsewhere.length === 1
    ? { kind: "found", element: first }
    : { kind: "ambiguous", elements: elsewhere };
};

/**
 * Where the target of an inline reference is (`referenceTargetState`): a relation target's state,
 * or, when several other repositories than the source's own have the UUID, `ambiguous` without a
 * repository (its records name theirs).
 */
export type ReferenceTargetState =
  | TargetState
  | {
      readonly kind: "ambiguous";
      readonly repository?: undefined;
      readonly elements: readonly ElementRecord[];
    };

/**
 * The hint for a link without `repository` whose target is not found while repositories of the
 * workspace file are not on this machine: where to name the repository, or "" when all are here.
 */
export const unavailableRepositoryHint = (layout: Pick<WorkspaceLayout, "repositories">): string => {
  const names = layout.repositories.filter((r) => !r.available).map((r) => r.name);
  if (names.length === 0) {
    return "";
  }
  const [only] = names;
  return names.length === 1
    ? `; if it lies in repository ${String(only)}, which is not on this machine, add repository=${String(only)} to the link`
    : `; if it lies in one of the repositories ${names.join(", ")}, which are not on this machine, add repository=<name> to the link`;
};

/**
 * Where the target of an inline reference of a source in `sourceRepository` is (D-058). With
 * `repository` it is the state of a relation target that names it (`targetState`). Without, the
 * target belongs in the source's own repository, which is on this machine: `missing` (N-065,
 * SR-089) when neither it nor any other repository here has the UUID, also while some repository
 * is not on this machine; `available` or `ambiguous` (SR-088) as `resolveReference` finds it,
 * naming the source's repository when the records lie there, and no repository when they lie in
 * several others.
 */
export const referenceTargetState = (
  layout: Pick<WorkspaceLayout, "repositories">,
  store: ElementStore,
  sourceRepository: string,
  reference: { readonly id: string; readonly repository?: string },
): ReferenceTargetState => {
  if (reference.repository !== undefined) {
    return targetState(layout, store, sourceRepository, {
      id: reference.id,
      repository: reference.repository,
    });
  }
  const match = resolveReference(store, sourceRepository, reference);
  switch (match.kind) {
    case "found":
      return { kind: "available", element: match.element };
    case "unknown":
      return { kind: "missing", repository: sourceRepository };
    case "ambiguous":
      return match.elements.every((e) => e.repository === sourceRepository)
        ? { kind: "ambiguous", repository: sourceRepository, elements: match.elements }
        : { kind: "ambiguous", elements: match.elements };
  }
};
