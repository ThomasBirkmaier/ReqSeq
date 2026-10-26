// Finding the element a command names (`common.schema.json#/$defs/elementRef`): its UUID or a short
// ID (SR-084), as a person or another tool gives it; for reading, optionally one copy of several
// (#255).
import { CommandError } from "../catalog.js";
import { resolveId } from "./duplicates.js";
import type { ElementMatch, ElementRecord } from "./elements.js";
import { isUuid } from "./elements.js";
import type { ShortIds } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { normalizeRef } from "./uuid.js";

/**
 * Which of the elements a reference names is meant: the repository and/or the file (relative to the
 * repository) of one of the `details.candidates` of `ref.ambiguous`, for example one copy of a file
 * whose UUID another file shares (SR-088). Only `element.get` and `element.resolve` take it (#255).
 */
export interface ElementCopy {
  readonly repository?: string | undefined;
  readonly file?: string | undefined;
}

const candidatesOf = (
  elements: readonly ElementRecord[],
): { id: string; repository: string; file: string }[] =>
  elements.map((e) => ({ id: e.id, repository: e.repository, file: e.file }));

/** The given fields of `copy`, for the details of an error. */
const givenOf = (copy: ElementCopy): { repository?: string; file?: string } => ({
  ...(copy.repository === undefined ? {} : { repository: copy.repository }),
  ...(copy.file === undefined ? {} : { file: copy.file }),
});

/**
 * `match` narrowed to the elements in the repository and file of `copy` (each only when given). A
 * match that fits none of them is unknown and keeps them as `named`, for the error.
 */
const narrow = (
  match: ElementMatch,
  copy: ElementCopy,
): ElementMatch | { readonly kind: "elsewhere"; readonly named: readonly ElementRecord[] } => {
  if (match.kind === "unknown" || (copy.repository === undefined && copy.file === undefined)) {
    return match;
  }
  const named = match.kind === "found" ? [match.element] : match.elements;
  const fitting = named.filter(
    (e) =>
      (copy.repository === undefined || e.repository === copy.repository) &&
      (copy.file === undefined || e.file === copy.file),
  );
  const [first] = fitting;
  if (first === undefined) {
    return { kind: "elsewhere", named };
  }
  return fitting.length === 1 ? { kind: "found", element: first } : { kind: "ambiguous", elements: fitting };
};

/**
 * The one element `ref` names. Throws `ref.unknown` when no element of an available repository has
 * it, and `ref.ambiguous` when several do: a short ID shorter than the one shown, or two files with
 * the same UUID (a copied file, SR-088), which `details.candidates` lists. With `copy`, only the
 * elements `ref` names in that repository and/or file count; when it fits none of them, `ref.unknown`
 * lists them as `details.candidates`. `copy` never finds an element `ref` does not name. A UUID or
 * short ID in any case names the same element (`normalizeRef`, #309); messages show `ref` as given.
 */
export const resolveRef = (
  store: ElementStore,
  shortIds: ShortIds,
  ref: string,
  copy: ElementCopy = {},
): ElementRecord => {
  const canonical = normalizeRef(ref);
  const match = narrow(isUuid(canonical) ? resolveId(store.byId, canonical) : shortIds.find(canonical), copy);
  switch (match.kind) {
    case "found":
      return match.element;
    case "unknown":
      throw new CommandError(
        "ref.unknown",
        `No element has the ${isUuid(canonical) ? "UUID" : "short ID"} ${ref}`,
        {
          ref,
        },
      );
    case "elsewhere": {
      const where = [
        ...(copy.file === undefined ? [] : [copy.file]),
        ...(copy.repository === undefined ? [] : [`repository ${copy.repository}`]),
      ].join(" of ");
      throw new CommandError(
        "ref.unknown",
        `${ref} names no element in ${where}; see the candidates for where it is`,
        {
          ref,
          ...givenOf(copy),
          candidates: candidatesOf(match.named),
        },
      );
    }
    case "ambiguous":
      throw new CommandError(
        "ref.ambiguous",
        copy.repository === undefined && copy.file === undefined
          ? `${ref} names more than one element; give the full UUID`
          : `${ref} names more than one element there; give the repository and file of one of the candidates`,
        {
          ref,
          ...givenOf(copy),
          candidates: candidatesOf(match.elements),
        },
      );
  }
};
