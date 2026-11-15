// How the app names an element by identifier and title (#545): "SR-036 Title", or the identifier alone when
// the title is empty or the same text, so a package with `spec-id: Später` and title "Später" reads "Später".
import { shownId } from "@reqseq/core/graph-words";

export { shownId };

/** `id` then `title`, separated by a space; `id` alone when `title` is missing, empty or equal to `id`. */
export const idTitle = (id: string, title?: string): string => {
  const shown = title?.trim() ?? "";
  return shown === "" || shown === id.trim() ? id.trim() : `${id} ${shown}`.trim();
};

/**
 * The shown ID then the title (`idTitle`); the title left out when it is the identifier's text (#545), so a
 * package with `spec-id: Später` and title "Später" reads "PKG-1a2b3c (Später)".
 */
export const shownIdTitle = (shortId: string, identifier: string | undefined, title?: string): string => {
  const id = shownId(shortId, identifier);
  return identifier !== undefined && title?.trim() === identifier.trim() ? id : idTitle(id, title);
};

/** The two parts of a name: the shown ID, and the title after it ("" when the name is the ID alone). */
export interface IdParts {
  readonly id: string;
  readonly title: string;
}

/**
 * The parts of what a reference is named by: the shown ID with its short ID, else its identifier, else its
 * UUID; and its title, left out as in `shownIdTitle` and `idTitle`.
 */
export const refIdParts = (ref: {
  readonly id: string;
  readonly shortId?: string | undefined;
  readonly identifier?: string | undefined;
  readonly title?: string | undefined;
}): IdParts => {
  const id = (
    ref.shortId === undefined ? (ref.identifier ?? ref.id) : shownId(ref.shortId, ref.identifier)
  ).trim();
  const title = ref.title?.trim() ?? "";
  const same = title === id || (ref.shortId !== undefined && title === ref.identifier?.trim());
  return { id, title: same ? "" : title };
};

/** The name of `parts`: the ID, then the title after a space when there is one. */
export const partsName = (parts: IdParts): string =>
  parts.title === "" ? parts.id : `${parts.id} ${parts.title}`;

/** What a reference is named by: as `shownIdTitle`; without a short ID its identifier, else its UUID. */
export const refIdTitle = (ref: Parameters<typeof refIdParts>[0]): string => partsName(refIdParts(ref));

/**
 * The shown ID at the start of a buffer name `shownIdTitle` made: the short ID with its identifier in
 * brackets, else the first word. A buffer keeps only its name, so this is how a prompt names the element
 * of a buffer by its ID alone.
 */
export const idOfName = (name: string): string =>
  /^\S+ \([^()]*\)(?= |$)/u.exec(name)?.[0] ?? name.replace(/ .*$/su, "");

/** The parts of a name `refIdTitle` made, split where `idOfName` ends. */
export const nameParts = (name: string): IdParts => {
  const id = idOfName(name);
  return { id, title: name.slice(id.length).trim() };
};
