// Badges in the look of the docs (Starlight's `sl-badge`, its scoped class from the docs theme): a verification status
// as a badge, its variant by the status (verified success, indirect note, open caution, failed and outdated danger),
// so the start page and the package pages show it as the docs do (SR-233 AK3, AK4).
import { DOCS_BADGE_SCOPE } from "./docs-theme.generated.js";
import { escapeHtml } from "./markdown.js";

const VARIANT: ReadonlyMap<string, string> = new Map([
  ["verified", "success"],
  ["indirect", "note"],
  ["open", "caution"],
  ["failed", "danger"],
  ["outdated", "danger"],
]);

/** A small badge with `label`, in Starlight's `variant` (`default` for an unknown one). */
export const badge = (label: string, variant: string): string =>
  `<span class="sl-badge ${variant} small ${DOCS_BADGE_SCOPE}">${escapeHtml(label)}</span>`;

/** The badge of a verification status, labelled `label` (the status itself by default). */
export const verificationBadge = (status: string, label = status): string =>
  badge(label, VARIANT.get(status) ?? "default");
