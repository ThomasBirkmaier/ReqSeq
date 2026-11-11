// How the app names an element by identifier and title (#545): "SR-036 Title", or the identifier alone when
// the title is empty or the same text, so a package with `spec-id: Später` and title "Später" reads "Später".

/** `id` then `title`, separated by a space; `id` alone when `title` is missing, empty or equal to `id`. */
export const idTitle = (id: string, title?: string): string => {
  const shown = title?.trim() ?? "";
  return shown === "" || shown === id.trim() ? id.trim() : `${id} ${shown}`.trim();
};

/**
 * The ID of an element as the app shows it (SR-084 AK4): the short ID with the identifier in brackets
 * behind it, `SR-3c90b0 (SR-036)`, as the CLI prints it (`cli/src/present.ts`); the short ID alone
 * without an identifier.
 */
export const shownId = (shortId: string, identifier?: string): string =>
  identifier === undefined || identifier.trim() === "" ? shortId : `${shortId} (${identifier})`;

/**
 * The shown ID then the title (`idTitle`); the title left out when it is the identifier's text (#545), so a
 * package with `spec-id: Später` and title "Später" reads "PKG-1a2b3c (Später)".
 */
export const shownIdTitle = (shortId: string, identifier: string | undefined, title?: string): string => {
  const id = shownId(shortId, identifier);
  return identifier !== undefined && title?.trim() === identifier.trim() ? id : idTitle(id, title);
};
