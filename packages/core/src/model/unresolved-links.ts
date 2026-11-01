// `reqseq:` links whose target is no UUID (#176): a short ID or an identifier such as
// `[D-031](reqseq:D-031)`, typed into a file by hand. The writer resolves such a link to
// `reqseq:<uuid>?version=…` (`setInlineReferences`, ADR-0004), so only a stored one is left: it
// counts for nothing (no outdated check, no trace), so `workspace.check` reports it as a warning,
// with the element it names when it names one. The links come from the element store
// (`ElementRecord.unresolvedLinks`), so no text is read; those in a property count only when the
// metamodel marks it `markdown` (SR-127), as for inline references.
import type { Problem } from "../catalog.js";
import { commandErrorOrThrow } from "../catalog.js";
import type { Metamodel } from "../metamodel/index.js";
import { findType, markdownKeysOf, metamodelState } from "../metamodel/index.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { ElementRecord } from "./elements.js";
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

/** What the target names now (one element, several or none) and what to do, for the message. */
const namesOf = (target: string, context: UnresolvedLinkContext): string => {
  try {
    return `it names ${nameOf(resolveRef(context.store, context.shortIds, target), context)}; give the text again with element update, which writes reqseq:<uuid>?version=…`;
  } catch (error) {
    return commandErrorOrThrow(error).code === "ref.ambiguous"
      ? "it names more than one element; write the UUID of the one it means"
      : "it names no element; point it to an element by its UUID, short ID or identifier";
  }
};

/** The unresolved links of one element that count under the metamodel, as problems, in store order. */
export const unresolvedLinkProblems = (
  element: ElementRecord,
  context: UnresolvedLinkContext,
): readonly Problem[] => {
  const links = element.unresolvedLinks;
  if (links === undefined) {
    return [];
  }
  const marked = markdownKeysOf(context.metamodel);
  return links
    .filter((link) => link.key === undefined || marked.has(link.key))
    .map((link) => ({
      code: "relation.unresolved-link",
      severity: "warning",
      message: `The link reqseq:${link.target} in ${placeOfReference(link)} of ${nameOf(element, context)} names no UUID, so it counts for nothing: ${namesOf(link.target, context)}`,
      repository: element.repository,
      file: element.file,
      line: link.line,
      elementId: element.id,
    }));
};

/**
 * Every unresolved link of the workspace that counts, as a warning with repository, file, line and
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
