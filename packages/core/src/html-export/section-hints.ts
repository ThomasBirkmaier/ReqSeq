// The open hints of an element above its text (SR-232 AK4): the hints of the display model of the element page
// (`elementPageDisplay`), as `hint.list` gives them for the element (`hintsByElement`, `element-data.ts`), by their
// reason, in that order, in a caution callout as the docs show one.
import type { ElementPageDisplay } from "../displays/index.js";
import { escapeHtml } from "./markdown.js";

/** The callout of open hints; nothing without one. */
export const hintsSection = (display: ElementPageDisplay): string =>
  display.hints.length === 0
    ? ""
    : '<aside aria-label="Open hints" class="starlight-aside starlight-aside--caution rq-hints">' +
      '<p class="starlight-aside__title" aria-hidden="true">Open hints</p>' +
      `<div class="starlight-aside__content"><ul>${display.hints.map((hint) => `<li>${escapeHtml(hint.message)}</li>`).join("")}</ul></div></aside>`;
