// Finding the element a command names (`common.schema.json#/$defs/elementRef`): its UUID or a short
// ID (SR-084), as a person or another tool gives it.
import { CommandError } from "../catalog.js";
import { resolveId } from "./duplicates.js";
import type { ElementRecord } from "./elements.js";
import { isUuid } from "./elements.js";
import type { ShortIds } from "./short-id.js";
import type { ElementStore } from "./store.js";

/**
 * The one element `ref` names. Throws `ref.unknown` when no element of an available repository has
 * it, and `ref.ambiguous` when several do: a short ID shorter than the one shown, or two files with
 * the same UUID (a copied file, SR-088), which `details.candidates` lists.
 */
export const resolveRef = (store: ElementStore, shortIds: ShortIds, ref: string): ElementRecord => {
  const match = isUuid(ref) ? resolveId(store.byId, ref) : shortIds.find(ref);
  switch (match.kind) {
    case "found":
      return match.element;
    case "unknown":
      throw new CommandError(
        "ref.unknown",
        `No element has the ${isUuid(ref) ? "UUID" : "short ID"} ${ref}`,
        {
          ref,
        },
      );
    case "ambiguous":
      throw new CommandError("ref.ambiguous", `${ref} names more than one element; give the full UUID`, {
        ref,
        candidates: match.elements.map((e) => ({ id: e.id, repository: e.repository, file: e.file })),
      });
  }
};
