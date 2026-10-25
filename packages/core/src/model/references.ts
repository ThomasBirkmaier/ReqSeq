// Inline references in the text of an element (ADR-0004, SR-066, D-058): Markdown links
// `[<label>](logreq:<uuid>?version=<version>)`, plus `&repository=<name>` (the workspace name of the
// target's repository, D-041) when the target lies in another repository than the source (decision
// on spec question #177 (c), option 1). A link without `repository` (or with an empty one) points
// into the source's own repository, as a relation target without one does (D-058); so that links
// written before this decision keep working, a target that is not there but lies in exactly one
// other repository counts as found there (`resolveReference`). The element store keeps the
// references of each element (`ElementRecord.references`), so the missing-target check (SR-089)
// needs no text; the writer (`targets.ts`) sets their versions.
import type { WorkspaceLayout } from "../workspace/index.js";
import type { ElementMatch, ElementRecord } from "./elements.js";
import { markdownLinks } from "./markdown-links.js";
import type { TargetState } from "./relations.js";
import { resolveTarget, targetState } from "./relations.js";
import type { ElementStore } from "./store.js";
import { isUuid } from "./uuid.js";

/** An inline reference `[label](logreq:<uuid>?version=<version>&repository=<name>)` in a text. */
export interface InlineReference {
  readonly id: string;
  /** Undefined when the link has no `version` parameter. */
  readonly version?: string;
  /** The first `repository` parameter as written; undefined when the link has none. */
  readonly repository?: string;
  /** The link destination as written: `logreq:` and the UUID, then the query, if any. */
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

export const SCHEME = "logreq:";

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
 * The inline references of a Markdown text in order: links (not images) whose destination is
 * `logreq:<uuid>`, outside code (`markdownLinks`). A `logreq:` link whose target is no UUID is not
 * one.
 */
export const inlineReferences = (text: string): InlineReference[] => {
  let line = 1;
  let counted = 0;
  return markdownLinks(text).flatMap((link): InlineReference[] => {
    if (link.image || !link.destination.startsWith(SCHEME)) {
      return [];
    }
    const rest = link.destination.slice(SCHEME.length);
    const id = rest.includes("?") ? rest.slice(0, rest.indexOf("?")) : rest;
    if (!isUuid(id)) {
      return [];
    }
    const params = queryOf(link.destination);
    const version = param(params, "version");
    // An empty `repository=` names no repository.
    const named = param(params, "repository");
    const repository = named === "" ? undefined : named;
    const { destination, start, end } = link;
    // Links come in text order, so the lines are counted once over the whole text.
    let at = text.indexOf("\n", counted);
    while (at !== -1 && at < start) {
      line += 1;
      counted = at + 1;
      at = text.indexOf("\n", counted);
    }
    return [
      {
        id,
        ...(version === undefined ? {} : { version }),
        ...(repository === undefined ? {} : { repository }),
        destination,
        start,
        end,
        line,
      },
    ];
  });
};

/**
 * The inline references of the text `body` of a file whose frontmatter is `frontmatter` (the raw
 * YAML between the `---` lines), with their lines in the file, for the element store. Most texts
 * have no `logreq:` link, so they are not scanned (N-036).
 */
export const textReferences = (frontmatter: string, body: string): TextReference[] => {
  if (!body.includes(SCHEME)) {
    return [];
  }
  // Line 1 is the opening `---`, then the frontmatter lines, then the closing `---`.
  const before = 2 + frontmatter.split("\n").length - 1;
  return inlineReferences(body).map(({ id, version, repository, line }) => ({
    id,
    ...(version === undefined ? {} : { version }),
    ...(repository === undefined ? {} : { repository }),
    line: before + line,
  }));
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
