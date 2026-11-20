// The page of an element in the HTML export (SR-232): one call per section, in the order the page shows them, each
// section in a module of its own, so a new section is one more call here.
//
// - fields (`section-fields.ts`, AK1): type, identifier, short ID, status, packages, verification or validation status;
// - open hints (`section-hints.ts`, AK4): as `hint.list` gives them, above the text;
// - text: the element's text, formatted (SR-231 AK5);
// - acceptance criteria (`section-criteria.ts`, AK2), each with the evidence records that bear its status (AK3);
// - evidence records of a requirement without criteria (`section-evidence.ts`, AK3);
// - properties (`section-properties.ts`, AK1): every other filled property as in the element file;
// - relations (`section-relations.ts`, AK1): the outgoing relations by relation kind;
// - neighbourhood (`section-neighbourhood.ts`, AK5, AK6): parents, children and incoming relations and references.
import type { Metamodel } from "../metamodel/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { COPY_CSS } from "./copy-script.js";
import type { ElementData } from "./element-data.js";
import type { PageLinks } from "./links.js";
import { CRITERIA_CSS, criteriaSection } from "./section-criteria.js";
import { EVIDENCE_CSS, evidenceSection } from "./section-evidence.js";
import { FIELDS_CSS, fieldsSection } from "./section-fields.js";
import { hintsSection } from "./section-hints.js";
import type { NeighbourhoodSource } from "./section-neighbourhood.js";
import { NEIGHBOURHOOD_CSS, neighbourhoodSection } from "./section-neighbourhood.js";
import { propertiesSection } from "./section-properties.js";
import { relationsSection } from "./section-relations.js";

/** What every page of an element is built from. */
export interface ElementPageContext {
  readonly metamodel: Metamodel;
  readonly store: ElementStore;
  readonly shortIds: ShortIds;
  readonly layout: Pick<WorkspaceLayout, "repositories">;
  readonly links: PageLinks;
  readonly neighbourhood: NeighbourhoodSource;
}

/** One element's page. */
export interface ElementPage {
  readonly record: ElementRecord;
  readonly data: ElementData;
  /** The text of its file. */
  readonly text: string;
  /** Formats Markdown of the element (SR-231 AK5, AK6); `where` names the place in its findings. */
  readonly markdown: (source: string, where: string) => Promise<string>;
}

/** The styles of the element page's sections, after the export's own. */
export const ELEMENT_PAGE_CSS = [
  ...COPY_CSS,
  ...FIELDS_CSS,
  ...CRITERIA_CSS,
  ...EVIDENCE_CSS,
  ...NEIGHBOURHOOD_CSS,
];

/** The content of `page` (see the file comment). */
export const elementPageBody = async (context: ElementPageContext, page: ElementPage): Promise<string> =>
  [
    fieldsSection(context, page),
    hintsSection(page),
    `<section class="rq-text">${await page.markdown(page.text, "Text")}</section>`,
    await criteriaSection(context, page),
    evidenceSection(context, page),
    await propertiesSection(context, page),
    relationsSection(context, page),
    neighbourhoodSection(context, page),
  ].join("");
