// `reqseq:` links whose target is no UUID (#176): a short ID or an identifier such as
// `[D-031](reqseq:D-031)`, typed into a file by hand. The writer resolves such a link to
// `reqseq:<uuid>?version=…` (`setInlineReferences`, ADR-0004), so only a stored one is left: it
// counts for nothing (no outdated check, no trace), so `workspace.check` reports it as a warning,
// with the element it names when it names one. The links come from the element store
// (`ElementRecord.unresolvedLinks`), so no text is read; those in a property count only when the
// metamodel marks it `markdown` (SR-127), as for inline references.
//
// A `reqseq:` reference in the text outside a Markdown link and outside code (`reqseq:N-6010df`
// instead of `[Title](reqseq:N-6010df)`) is no link at all (ADR-0004) and counts for nothing too:
// SR-021 AK3 "Gegeben der Text eines Elements nennt außerhalb von Code und außerhalb eines
// Markdown-Links ein Element mit dem Schema `reqseq:` …, wenn der Bestand geprüft wird (CLI, API,
// MCP: `workspace.check`), dann meldet das Tool eine Warnung mit Datei und Zeile." It is reported
// as `relation.not-a-link` (#633), from `ElementRecord.bareReferences`, the same way.
import type { Problem } from "../catalog.js";
import { commandErrorOrThrow } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, markdownKeysOf, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { ElementRecord } from "./elements.js";
import type { StoredUnresolvedLink } from "./references.js";
import { placeOfReference } from "./references.js";
import { resolveRef } from "./resolve.js";
import type { ShortIds } from "./short-id.js";
import { shortIdState } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { elementStoreState } from "./store.js";

/** What the check needs: the store and short IDs to say what a link names, the metamodel for names and marks. */
export interface UnresolvedLinkContext {
  readonly store: ElementStore;
  readonly metamodel: Metamodel;
  readonly shortIds: ShortIds;
}

/** A type name (or key, when unknown) and short ID with identifier, as messages name elements. */
const nameOf = (element: ElementRecord, context: UnresolvedLinkContext): string => {
  const { metamodel, shortIds } = context;
  const identifier = shortIds.identifierOf(element);
  const name = `${findType(metamodel, element.type)?.name ?? element.type} ${shortIds.of(element)}`;
  return identifier === undefined ? name : `${name} (${identifier})`;
};

/**
 * What the link names now, resolved as the writer resolves it (`resolveRef` within the repository
 * the link names, if any), and what to do, for the message: one element (give the text or the
 * property again), copies of one UUID in several repositories (name one with `repository=`),
 * several elements (write the UUID) or none.
 */
const namesOf = (link: StoredUnresolvedLink, context: UnresolvedLinkContext): string => {
  const { target, repository, key } = link;
  try {
    const element = resolveRef(
      context.store,
      context.shortIds,
      target,
      repository === undefined ? {} : { repository },
    );
    const again = key === undefined ? "the text" : `the property ${key}`;
    return `it names ${nameOf(element, context)}; give ${again} again with element update, which writes reqseq:<uuid>?version=…`;
  } catch (error) {
    const failed = commandErrorOrThrow(error);
    if (failed.code !== "ref.ambiguous") {
      return `it names no element${repository === undefined ? "" : ` in repository ${repository}`}; point it to an element by its UUID, short ID or identifier`;
    }
    // resolveRef lists the candidates of every ref.ambiguous.
    const { candidates } = failed.details as { candidates: readonly { id: string; repository: string }[] };
    const repositories = [...new Set(candidates.map((c) => c.repository))];
    return new Set(candidates.map((c) => c.id)).size === 1 && repositories.length > 1
      ? `its UUID lies in several repositories; add repository=<name> to the link (${repositories.join(", ")})`
      : "it names more than one element; write the UUID of the one it means";
  }
};

/** The references of the text of `element` outside links and code (#633), as warnings. */
const bareReferenceProblems = (element: ElementRecord, context: UnresolvedLinkContext): Problem[] =>
  (element.bareReferences ?? []).map(({ target, line }) => ({
    code: "relation.not-a-link",
    severity: "warning",
    message: `The text of ${nameOf(element, context)} names reqseq:${target} outside a Markdown link, so it counts for nothing (no relation, no outdated check, no trace): write it as a link, [Title](reqseq:${target}), or put it in code if it is no reference`,
    repository: element.repository,
    file: element.file,
    line,
    elementId: element.id,
  }));

/**
 * The unresolved links of one element that count under the metamodel, in store order, then the
 * references of its text outside links (#633), as problems.
 */
export const unresolvedLinkProblems = (
  element: ElementRecord,
  context: UnresolvedLinkContext,
): readonly Problem[] => {
  const links = element.unresolvedLinks;
  if (links === undefined) {
    return bareReferenceProblems(element, context);
  }
  const marked = markdownKeysOf(context.metamodel);
  const problems: Problem[] = links
    .filter((link) => link.key === undefined || marked.has(link.key))
    .map((link) => ({
      code: "relation.unresolved-link",
      severity: "warning",
      message: `The link reqseq:${link.target} in ${placeOfReference(link)} of ${nameOf(element, context)} does not name its target by a UUID in lower case, so it counts for nothing: ${namesOf(link, context)}`,
      repository: element.repository,
      file: element.file,
      line: link.line,
      elementId: element.id,
    }));
  for (const problem of bareReferenceProblems(element, context)) {
    problems.push(problem);
  }
  return problems;
};

/**
 * Every unresolved link of the workspace that counts and every reference outside a link (#633), as a warning with repository, file, line and
 * element ID, for `workspace.check` (SR-019): one pass over the store, no file read (N-036).
 */
export const unresolvedLinkProblemsState = defineWorkspaceState(
  "unresolved-links",
  async (workspace): Promise<readonly Problem[]> => {
    const store = await workspace.get(elementStoreState);
    const metamodel = await workspace.get(metamodelState);
    // Nothing against a metamodel that is not valid: its errors are the findings (#208, #220).
    if (!metamodel.valid) {
      return [];
    }
    const context = { store, metamodel, shortIds: await workspace.get(shortIdState) };
    return store.elements.flatMap((element) => unresolvedLinkProblems(element, context));
  },
  { dependsOn: [elementStoreState, metamodelState, shortIdState] },
);
