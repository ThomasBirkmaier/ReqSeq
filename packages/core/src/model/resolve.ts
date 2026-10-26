// Finding the element a command names (`common.schema.json#/$defs/elementRef`): its UUID, a short
// ID (SR-084) or its identifier (#305), as a person or another tool gives it; for reading,
// optionally one copy of several (#255).
//
// Which element a reference names, in this order (#305):
// 1. A reference of the UUID form names the elements with that UUID and nothing else: UUIDs are
//    unique by design (D-017), so a UUID a tool stored never comes to name another element. An
//    identifier of the UUID form therefore cannot be used as a reference.
// 2. Any other reference names every element whose short ID it is (when it has the form of one)
//    and every element whose identifier it is. One element: that one. More than one, for example a
//    short ID of one element that is the identifier of another, or an identifier that elements of
//    two types share (it is unique per type only): `ref.ambiguous` with all of them as candidates;
//    the tool never picks one. None: `ref.unknown`.
//    A short ID that names no element as it is now, but whose tail fits elements of another type
//    (the prefix changed since it was stored, SR-015, #275), is never left out silently when the
//    reference is also an identifier: those elements join the candidates, so it is `ref.ambiguous`.
//    Without an identifier match it stays `ref.unknown`, and element.resolve names the candidate.
import { CommandError } from "../catalog.js";
import { resolveId } from "./duplicates.js";
import type { ElementMatch, ElementRecord } from "./elements.js";
import { isUuid } from "./elements.js";
import type { ShortIds } from "./short-id.js";
import type { ElementStore } from "./store.js";
import { isShortIdForm, normalizeRef } from "./uuid.js";

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

/** The elements a match names. */
const elementsOf = (match: ElementMatch): readonly ElementRecord[] =>
  match.kind === "found" ? [match.element] : match.kind === "ambiguous" ? match.elements : [];

/**
 * What a reference that is not a UUID names: by short ID, by identifier, by the tail of a short ID
 * whose prefix may be outdated, and all of them.
 */
interface Named {
  readonly byShortId: readonly ElementRecord[];
  readonly byIdentifier: readonly ElementRecord[];
  readonly byTail: readonly ElementRecord[];
  readonly match: ElementMatch;
}

/**
 * The elements `ref` (not of the UUID form) names as short ID and as identifier (rule 2 of the file
 * comment): short-ID matches first, in their order, then the other elements with the identifier,
 * then, only when it names none as short ID but some as identifier, the other elements whose UUID
 * ends with its tail (the prefix may be outdated).
 */
const named = (shortIds: ShortIds, ref: string): Named => {
  const byShortId = elementsOf(shortIds.find(ref));
  const byIdentifier = shortIds.withIdentifier(ref).filter((e) => !byShortId.includes(e));
  const byTail =
    byShortId.length === 0 && byIdentifier.length > 0
      ? shortIds.withTail(ref).filter((e) => !byIdentifier.includes(e))
      : [];
  const all = [...byShortId, ...byIdentifier, ...byTail];
  const [first] = all;
  return {
    byShortId,
    byIdentifier,
    byTail,
    match:
      first === undefined
        ? { kind: "unknown" }
        : all.length === 1
          ? { kind: "found", element: first }
          : { kind: "ambiguous", elements: all },
  };
};

/** What `ref` was taken as, for the message of `ref.unknown`. */
const formOf = (canonical: string): string =>
  isUuid(canonical) ? "UUID" : isShortIdForm(canonical) ? "short ID or identifier" : "identifier";

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
 * How an ambiguous reference names its elements, when identifiers take part (#305): ` (as a short
 * ID and as an identifier)`, ` (as the identifier of each)`, ` (as an identifier, and as a short ID
 * whose prefix may be outdated)`; nothing for a UUID or a short ID alone, as before.
 */
const asWhat = (byName: Named | undefined): string => {
  if (byName === undefined || byName.byIdentifier.length === 0) {
    return "";
  }
  if (byName.byTail.length > 0) {
    return " (as an identifier, and as a short ID whose prefix may be outdated)";
  }
  return byName.byShortId.length === 0
    ? " (as the identifier of each)"
    : " (as a short ID and as an identifier)";
};

/**
 * The one element `ref` names (see the file comment for the rules). Throws `ref.unknown` when no
 * element of an available repository has it, and `ref.ambiguous` when several do: a short ID
 * shorter than the one shown, two files with the same UUID (a copied file, SR-088), or a reference
 * that is the short ID or identifier of more than one element (#305), which `details.candidates`
 * lists. With `copy`, only the elements `ref` names in that repository and/or file count; when it
 * fits none of them, `ref.unknown` lists them as `details.candidates`. `copy` never finds an element
 * `ref` does not name. A UUID, short ID or identifier in any case names the same element
 * (`normalizeRef`, #309); messages show `ref` as given.
 */
export const resolveRef = (
  store: ElementStore,
  shortIds: ShortIds,
  ref: string,
  copy: ElementCopy = {},
): ElementRecord => {
  const canonical = normalizeRef(ref);
  const byName = isUuid(canonical) ? undefined : named(shortIds, canonical);
  const match = narrow(byName?.match ?? resolveId(store.byId, canonical), copy);
  switch (match.kind) {
    case "found":
      return match.element;
    case "unknown":
      throw new CommandError(
        "ref.unknown",
        `No element has the ${formOf(canonical)} ${JSON.stringify(ref)}`,
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
          ? `${ref} names more than one element${asWhat(byName)}; give the full UUID`
          : `${ref} names more than one element there${asWhat(byName)}; give the repository and file of one of the candidates`,
        {
          ref,
          ...givenOf(copy),
          candidates: candidatesOf(match.elements),
        },
      );
  }
};
