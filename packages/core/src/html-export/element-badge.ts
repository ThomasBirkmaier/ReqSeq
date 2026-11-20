// Badges on the pages of the HTML export, as the docs site shows them (the `sl-badge` of its theme): the status of an
// element in the default colour, a verification status in the colour of its kind.
import { escapeHtml } from "./markdown.js";

/** The colours of the docs theme's badges. */
export type BadgeVariant = "default" | "note" | "tip" | "success" | "caution" | "danger";

/** `label` as a small badge of `variant`. */
export const badge = (label: string, variant: BadgeVariant): string =>
  `<span class="sl-badge ${variant} small astro-qnj5uuvn">${escapeHtml(label)}</span>`;

const VERIFICATION: Readonly<Record<string, BadgeVariant>> = {
  verified: "success",
  indirect: "note",
  open: "caution",
  failed: "danger",
  outdated: "danger",
};

/** The colour of the verification status `status`; the default for any other. */
export const verificationVariant = (status: string): BadgeVariant => VERIFICATION[status] ?? "default";
