// The elements of a package on its page (SR-233 AK4): the page of an element of a type with the meaning package is its
// package page, and this section lists the elements with a page whose property with the meaning `packages` names it,
// by identifier, each with identifier (a link to its page), title, status ("–" without one) and verification status in
// the core as a badge ("–" for an element that is no requirement). An element in several packages stands on each of
// their pages.
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { verificationBadge } from "./badge.js";
import type { ListEntry } from "./list-page.js";
import { coreVerification, identifierOf } from "./list-page.js";
import { elementPage } from "./links.js";
import { escapeHtml } from "./markdown.js";

const NONE = "–";

/** The section of the elements of a package, or nothing for an element that is no package. */
export const packageSection = (context: ElementPageContext, page: ElementPage): string => {
  const members = context.members.get(page.record.id);
  if (members === undefined) {
    return "";
  }
  const row = ({ element }: ListEntry): string => {
    const verification = coreVerification(element);
    return `<tr><td class="rq-nowrap"><a href="../${elementPage(element.id)}">${escapeHtml(identifierOf(element))}</a></td><td class="rq-title">${escapeHtml(element.title)}</td><td class="rq-nowrap">${escapeHtml(element.status ?? NONE)}</td><td class="rq-nowrap">${verification === undefined ? NONE : verificationBadge(verification)}</td></tr>`;
  };
  const table =
    members.length === 0
      ? "<p>No element names this package.</p>"
      : `<table tabindex="0"><thead><tr><th scope="col">Identifier</th><th scope="col">Title</th><th scope="col">Status</th><th scope="col">Verification status in the core</th></tr></thead><tbody>${members.map(row).join("")}</tbody></table>`;
  return `<section class="rq-package"><h2 id="elements">Elements</h2>${table}</section>`;
};
