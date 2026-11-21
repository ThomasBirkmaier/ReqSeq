// The outgoing relations on an element's page (SR-232 AK1): the groups of the display model of the element page
// (`elementPageDisplay`, ADR-0019: by relation kind in the order of the metamodel, each kind by its name, a kind the
// metamodel does not know after them by its key), each target as a link to its page where it has one
// (`relationLink`). The targets of properties of kind relation stand with the properties and the packages with the
// fields.
import type { ElementPageDisplay } from "../displays/index.js";
import type { ElementPageContext } from "./element-page.js";
import { relationLink } from "./links.js";
import { escapeHtml } from "./markdown.js";

/** The section of outgoing relations, or nothing for an element without one. */
export const relationsSection = (context: ElementPageContext, display: ElementPageDisplay): string => {
  const groups = display.relationGroups.map(
    (group) =>
      `<dt>${escapeHtml(group.label)}</dt><dd><ul>${group.relations.map((r) => `<li>${relationLink(context.links, r)}</li>`).join("")}</ul></dd>`,
  );
  return groups.length === 0
    ? ""
    : `<section class="rq-relations"><h2 id="relations">Relations</h2><dl>${groups.join("")}</dl></section>`;
};
