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

/** What a reference is named by: as `shownIdTitle`; without a short ID its identifier, else its UUID. */
export const refIdTitle = (ref: {
  readonly id: string;
  readonly shortId?: string | undefined;
  readonly identifier?: string | undefined;
  readonly title?: string | undefined;
}): string =>
  ref.shortId === undefined
    ? idTitle(ref.identifier ?? ref.id, ref.title)
    : shownIdTitle(ref.shortId, ref.identifier, ref.title);

/**
 * The shown ID at the start of a buffer name `shownIdTitle` made: the short ID with its identifier in
 * brackets, else the first word. A buffer keeps only its name, so this is how a prompt names the element
 * of a buffer by its ID alone.
 */
export const idOfName = (name: string): string =>
  /^\S+ \([^()]*\)(?= |$)/u.exec(name)?.[0] ?? name.replace(/ .*$/su, "");
