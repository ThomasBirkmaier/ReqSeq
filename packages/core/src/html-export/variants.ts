// The variants in the HTML export (SR-234 AK3, AK4):
//
// - `variants/index.html`, the variant comparison (AK3): the verification degree in the core and in each variant with a
//   page (no invalid status, D-044), by identifier, as `evidence.degree` gives it for the whole workspace in that view
//   (`selectionDegree`), with the number per verification status; below, the requirements with a page whose
//   verification status differs between the views, by identifier, with the status in each view as a badge. A view
//   that does not hold a requirement differs from one that gives it a status ("not in the core", "not in the
//   variant"), so a requirement that stands in some views only is listed (#2140).
// - On the page of a variant (AK4, `variantSection`): what it adds, replaces and excludes compared with the core as
//   `variant.diff` gives it (the view rule of the variants block: `addedOf`, `replacedOf`, `excludedOf`), each element
//   as a link where it has a page, and its verification degree. No comparison with other variants: a variant builds
//   on the core only (D-020).
import type { DataExportVerificationDegree } from "../generated/types.js";
import { degreePercent } from "../evidence/degree-text.js";
import type { ElementRecord } from "../model/index.js";
import { findType } from "../metamodel/index.js";
import { titleKeyOrEmpty } from "../model/index.js";
import { badge, verificationVariant } from "./element-badge.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import type { ListEntry } from "./list-page.js";
import { identifierOf } from "./list-page.js";
import { elementPage, linked, nameOf } from "./links.js";
import { escapeHtml } from "./markdown.js";

/** The page of the variant comparison, relative to the export folder. */
export const VARIANTS_PAGE = "variants/index.html";

/** A list entry of a requirement: one with a verification status. */
export type RequirementEntry = ListEntry & {
  readonly element: ListEntry["element"] & {
    readonly verification: NonNullable<ListEntry["element"]["verification"]>;
  };
};

/** Whether `entry` is a requirement's. */
export const isRequirementEntry = (entry: ListEntry): entry is RequirementEntry =>
  entry.element.verification !== undefined;

/** What a variant's page shows of it (AK4). */
export interface VariantView {
  readonly added: readonly ElementRecord[];
  readonly replaced: readonly { readonly core: ElementRecord; readonly replacement: ElementRecord }[];
  readonly excluded: readonly ElementRecord[];
  readonly degree: DataExportVerificationDegree;
}

const STATUSES = ["open", "verified", "indirect", "failed", "outdated"] as const;

/** `n of m requirements are verified or indirectly verified (p %)`. */
export const degreeSentence = (degree: DataExportVerificationDegree): string => {
  const verified = degree.counts.verified + degree.counts.indirect;
  const share = degree.share === undefined ? "" : ` (${degreePercent(degree.share)})`;
  return `${String(verified)} of ${String(degree.total)} ${degree.total === 1 ? "requirement" : "requirements"} ${verified === 1 ? "is" : "are"} verified or indirectly verified${share}.`;
};

const head = (labels: readonly string[]): string =>
  `<thead><tr>${labels.map((l) => `<th scope="col">${escapeHtml(l)}</th>`).join("")}</tr></thead>`;

/** The content of the variant comparison (AK3): `variants` are the variants with a page, each with its degree. */
export const variantsPageBody = (
  core: DataExportVerificationDegree,
  variants: readonly { readonly entry: ListEntry; readonly degree: DataExportVerificationDegree }[],
  requirements: readonly RequirementEntry[],
): string => {
  const degreeRow = (label: string, degree: DataExportVerificationDegree): string =>
    `<tr><th scope="row">${label}</th><td>${escapeHtml(degreeSentence(degree))}</td>${STATUSES.map((s) => `<td>${String(degree.counts[s])}</td>`).join("")}</tr>`;
  const viewLink = (entry: ListEntry): string =>
    `<a href="../${elementPage(entry.element.id)}">${escapeHtml(identifierOf(entry.element))}</a>`;
  const degrees = `<table>${head(["View", "Verification degree", ...STATUSES])}<tbody>${[
    degreeRow("core", core),
    ...variants.map(({ entry, degree }) => degreeRow(viewLink(entry), degree)),
  ].join("")}</tbody></table>`;
  const views = ["core", ...variants.map(({ entry }) => entry.element.id)];
  const statusIn = (element: RequirementEntry["element"], view: string): string | undefined =>
    element.verification.find((v) => v.view === view)?.status;
  const differing = requirements.filter(
    ({ element }) => new Set(views.map((view) => statusIn(element, view))).size > 1,
  );
  const cell = (element: RequirementEntry["element"], view: string): string => {
    const status = statusIn(element, view);
    if (status !== undefined) {
      return badge(status, verificationVariant(status));
    }
    return `<span class="rq-legend">${view === "core" ? "not in the core" : "not in the variant"}</span>`;
  };
  const rows = differing.map(({ element }) => {
    return `<tr><td><a href="../${elementPage(element.id)}">${escapeHtml(identifierOf(element))}</a></td><td>${escapeHtml(element.title)}</td>${views.map((v) => `<td>${cell(element, v)}</td>`).join("")}</tr>`;
  });
  return [
    '<h2 id="verification-degree">Verification degree per view</h2>',
    degrees,
    '<h2 id="differences">Requirements whose verification status differs</h2>',
    rows.length === 0
      ? "<p>None.</p>"
      : `<table>${head(["Identifier", "Title", "core", ...variants.map(({ entry }) => identifierOf(entry.element))])}<tbody>${rows.join("")}</tbody></table>`,
  ].join("");
};

/**
 * An element as the pages of variants and baselines name it: identifier and title now, a link where it has a page; a
 * package by its title only, as the Packages row of an element page names it.
 */
export const named = (context: ElementPageContext, record: ElementRecord): string => {
  const title = record.data[titleKeyOrEmpty(context.metamodel)];
  const isPackage = findType(context.metamodel, record.type)?.meaning === "package";
  if (isPackage && typeof title === "string" && title !== "") {
    return linked(title, context.links.href(record.id));
  }
  const identifier = context.shortIds.identifierOf(record);
  return linked(
    nameOf({
      shortId: context.shortIds.of(record),
      ...(identifier === undefined ? {} : { identifier }),
      ...(typeof title === "string" ? { title } : {}),
    }),
    context.links.href(record.id),
  );
};

/** The section of a variant compared with the core (AK4), or nothing for an element that is no variant. */
export const variantSection = (context: ElementPageContext, page: ElementPage): string => {
  const view = context.variants?.get(page.record);
  if (view === undefined) {
    return "";
  }
  const list = (records: readonly ElementRecord[]): string =>
    records.length === 0
      ? "<p>None.</p>"
      : `<ul>${records.map((r) => `<li>${named(context, r)}</li>`).join("")}</ul>`;
  const replaced =
    view.replaced.length === 0
      ? "<p>None.</p>"
      : `<table>${head(["Core requirement", "Replacement"])}<tbody>${view.replaced
          .map((r) => `<tr><td>${named(context, r.core)}</td><td>${named(context, r.replacement)}</td></tr>`)
          .join("")}</tbody></table>`;
  return [
    '<section class="rq-variant">',
    '<h2 id="variant-verification-degree">Verification degree</h2>',
    `<p>${escapeHtml(degreeSentence(view.degree))}</p>`,
    '<h2 id="variant-compared-with-the-core">Compared with the core</h2>',
    `<h3 id="variant-added">Adds</h3>${list(view.added)}`,
    `<h3 id="variant-replaced">Replaces</h3>${replaced}`,
    `<h3 id="variant-excluded">Excludes</h3>${list(view.excluded)}`,
    "</section>",
  ].join("");
};
