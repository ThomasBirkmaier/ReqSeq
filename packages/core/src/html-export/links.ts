// Links between the pages of the HTML export (SR-231 AK3, AK6, AK8; SR-006 AK1): the page of an element by its UUID,
// and an element named as a relation or a row names it. An element with a page (no invalid status, D-044) and one with
// the short page of SR-231 AK8 are links; any other is text. A target in a repository that is not on this machine is
// `UNKNOWN-<tail>, repository <name>, not accessible` (SR-006 AK1), as the relation gives it.
import type { DataExportRelation } from "../generated/types.js";
import { relationText } from "../displays/index.js";
import { escapeHtml } from "./markdown.js";

export { nameOf, relationText } from "../displays/index.js";

/** The page of the element with the UUID `id`, relative to the export folder. */
export const elementPage = (id: string): string => `elements/${id}.html`;

/** The pages of the export, by UUID: those of elements and the short pages of AK8. */
export interface PageLinks {
  /** The address of the page of `id` from a page in `elements/`, or undefined when it has none. */
  readonly href: (id: string) => string | undefined;
}

/** The links to the pages of the elements with the UUIDs `ids`. */
export const pageLinks = (ids: ReadonlySet<string>): PageLinks => ({
  href: (id) => (ids.has(id) ? `../${elementPage(id)}` : undefined),
});

/** `text` as a link to `href`, or as text without one. */
export const linked = (text: string, href: string | undefined): string =>
  href === undefined ? escapeHtml(text) : `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;

/** The other end of `relation` as HTML: a link to its page when it has one (see the file comment). */
export const relationLink = (links: PageLinks, relation: DataExportRelation): string =>
  linked(relationText(relation), relation.targetState === "available" ? links.href(relation.id) : undefined);
