// The acceptance criteria on a requirement's page (SR-232 AK2): each with its number, criterion key, text (formatted
// when the metamodel marks the property Markdown, its references then as SR-231 AK6 says; else as written) and verification status, with a button that copies the reference for test names
// (`[SR-036/AK-k7f3]`, SR-205 AK1); a criterion without reference has no button. The status is that of each view the
// requirement applies in (`criterionStatusesByView`): the status alone when that is the core only, else each with
// the name of its view. Below its text, the evidence records that bear its status (`section-evidence.ts`, AK3).
import { markdownKeysOf } from "../metamodel/index.js";
import { copyButton } from "./copy-script.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { escapeHtml } from "./markdown.js";
import { criterionEvidence } from "./section-evidence.js";
import { viewName } from "./section-fields.js";

/** The verification status of criterion `index` (from 0) as the page shows it. */
const statusOf = (context: ElementPageContext, page: ElementPage, index: number): string => {
  const views = page.data.criterionStatuses ?? [];
  const only = views.length === 1 ? views[0] : undefined;
  const text =
    only?.view === "core"
      ? String(only.statuses[index])
      : views.map((v) => `${viewName(context, v.view)}: ${String(v.statuses[index])}`).join(" · ");
  return text === "" ? "" : ` <span class="rq-criterion-status">${escapeHtml(text)}</span>`;
};

/** The section of acceptance criteria, or nothing for an element without one. */
export const criteriaSection = async (context: ElementPageContext, page: ElementPage): Promise<string> => {
  const { criteria } = page.data;
  if (criteria === undefined || criteria.criteria.length === 0) {
    return "";
  }
  const markdown = markdownKeysOf(context.metamodel).has(criteria.property);
  const items: string[] = [];
  for (const [index, criterion] of criteria.criteria.entries()) {
    const label = `AK${String(criterion.criterion)}`;
    const key = criterion.key === undefined ? "" : ` <code>${escapeHtml(criterion.key)}</code>`;
    const copy =
      criterion.reference === undefined
        ? ""
        : copyButton(criterion.reference, `Copy criterion reference ${criterion.reference}`);
    const text = markdown
      ? await page.markdown(criterion.text, `Acceptance criterion ${String(criterion.criterion)}`)
      : `<p>${escapeHtml(criterion.text)}</p>`;
    items.push(
      `<li><p class="rq-criterion rq-copyable"><strong>${label}</strong>${key}${statusOf(context, page, index)}${copy}</p>${text}${criterionEvidence(context, page, criterion.criterion)}</li>`,
    );
  }
  return `<section class="rq-criteria"><h2 id="acceptance-criteria">Acceptance criteria</h2><ol class="rq-criteria-list">${items.join("")}</ol></section>`;
};

/** The styles of the criteria. */
export const CRITERIA_CSS = [
  ".sl-markdown-content ol.rq-criteria-list { list-style: none; padding-inline-start: 0; }",
  ".sl-markdown-content ol.rq-criteria-list > li { border-inline-start: 2px solid var(--sl-color-gray-5); padding-inline-start: 1rem; margin-top: 1rem; }",
  ".rq-criterion { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }",
  ".rq-criterion-status { color: var(--sl-color-gray-3); font-size: var(--sl-text-sm); }",
];
