// How the app names an element by identifier and title (#545): "SR-036 Title", or the identifier alone when
// the title is empty or the same text, so a package with `spec-id: Später` and title "Später" reads "Später".

/** `id` then `title`, separated by a space; `id` alone when `title` is missing, empty or equal to `id`. */
export const idTitle = (id: string, title?: string): string => {
  const shown = title?.trim() ?? "";
  return shown === "" || shown === id.trim() ? id.trim() : `${id} ${shown}`.trim();
};
