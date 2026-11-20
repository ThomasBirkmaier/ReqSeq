// The open hints of an element above its text (SR-232 AK4): each as `hint.list` gives it for the element
// (`hintsByElement`, `element-data.ts`), by its reason, in that order, in a caution callout as the docs show one.
import type { ElementPage } from "./element-page.js";
import { escapeHtml } from "./markdown.js";

/** The callout of open hints; nothing without one. */
export const hintsSection = (page: ElementPage): string => {
  const hints = page.data.hints ?? [];
  return hints.length === 0
    ? ""
    : '<aside aria-label="Open hints" class="starlight-aside starlight-aside--caution rq-hints">' +
        '<p class="starlight-aside__title" aria-hidden="true">Open hints</p>' +
        `<div class="starlight-aside__content"><ul>${hints.map((hint) => `<li>${escapeHtml(hint.message)}</li>`).join("")}</ul></div></aside>`;
};
