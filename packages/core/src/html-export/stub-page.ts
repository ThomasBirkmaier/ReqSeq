// The short page of an element that had a page in an earlier export and now has an invalid status (SR-231 AK8, D-044):
// at the address of its page, so a link someone passed on keeps working. It names its identifier ("–" without one), short ID, title and status and
// links each successor (SR-072 AK3: an element whose relation with the meaning succession points to it), where it has
// one. It stands in no list and not in the search, and has no copy buttons.
import type { ElementPageContext } from "./element-page.js";
import type { ElementData } from "./element-data.js";
import { relationLink } from "./links.js";
import { escapeHtml } from "./markdown.js";

/** The content of the short page of `data` (see the file comment). */
export const stubPageBody = (context: Pick<ElementPageContext, "links">, data: ElementData): string => {
  const { element } = data;
  const successors = element.relations.filter((r) => r.direction === "in" && r.meaning === "succession");
  const fields = (
    [
      ["Identifier", element.identifier],
      ["Short ID", element.shortId],
      ["Title", element.title],
      ["Status", element.status],
    ] as const
  )
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value ?? "–")}</dd>`)
    .join("");
  const list =
    successors.length === 0
      ? "<p>It has no successor.</p>"
      : `<h2 id="successors">Successors</h2><ul>${successors.map((r) => `<li>${relationLink(context.links, r)}</li>`).join("")}</ul>`;
  return `<p class="rq-invalid">This element has an invalid status and no page of its own any more.</p><dl class="rq-fields">${fields}</dl>${list}`;
};
