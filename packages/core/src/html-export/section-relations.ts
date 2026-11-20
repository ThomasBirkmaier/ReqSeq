// The outgoing relations on an element's page (SR-232 AK1): grouped by relation kind in the order of the metamodel,
// each kind by its name, each target as a link to its page where it has one (`relationLink`). The targets of
// properties of kind relation stand with the properties and the packages with the fields.
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { relationLink } from "./links.js";
import { escapeHtml } from "./markdown.js";

/** The section of outgoing relations, or nothing for an element without one. */
export const relationsSection = (context: ElementPageContext, page: ElementPage): string => {
  const outgoing = page.data.element.relations.filter((r) => r.direction === "out" && r.property !== true);
  const groups = context.metamodel.relations.flatMap((kind) => {
    const targets = outgoing.filter((r) => r.kind === kind.key);
    return targets.length === 0
      ? []
      : [
          `<dt>${escapeHtml(kind.name)}</dt><dd><ul>${targets.map((r) => `<li>${relationLink(context.links, r)}</li>`).join("")}</ul></dd>`,
        ];
  });
  return groups.length === 0
    ? ""
    : `<section class="rq-relations"><h2 id="relations">Relations</h2><dl>${groups.join("")}</dl></section>`;
};
