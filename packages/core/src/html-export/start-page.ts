// The start page of the HTML export, `index.html` (SR-233 AK3), named after the workspace:
//
// - the commit, the date of the export and the version of ReqSeq, as the footer of every page names them (SR-231 AK9);
// - when a repository of the workspace file is not on this machine, that the export is incomplete (SR-006 AK2);
// - "Verification degree": the verification degree in the core as `evidence.degree` gives it for the whole workspace
//   (`selectionDegree`), with the number per verification status in the order of `common.verificationStatus`, each
//   as a badge of the docs (`badge.ts`);
// - the requirements whose verification status in the core is failed, outdated or open, in this order, each by
//   identifier;
// - the elements with open hints (`hint.list`) and their number, by identifier;
// - the number of changed and added elements since the newest baseline, as `baseline.get` counts them (the command
//   gives them, `NewestBaseline`), the baseline a link to its page, or that there is none;
// - per type with at least one element with a page, in the metamodel's order, the number of those elements, with a
//   link to its list where it has one (`list-page.ts`; types with the meaning package or variant have none).
import type { DataExportVerificationDegree } from "../generated/types.js";
import { degreeClause } from "../evidence/degree-text.js";
import type { ListEntry, ListPage } from "./list-page.js";
import { verificationBadge } from "./badge.js";
import { coreVerification, identifierOf } from "./list-page.js";
import { elementPage } from "./links.js";
import { escapeHtml } from "./markdown.js";

/** The newest baseline of the workspace and what changed since, as `baseline.get` counts it. */
export interface NewestBaseline {
  readonly name: string;
  /** Its page, relative to the export folder (`baselinePage`). */
  readonly page: string;
  readonly date: string;
  readonly changed: number;
  readonly added: number;
  /** Whether the baseline stores its selection; without, no element counts as added (SR-051 AK2). */
  readonly selectionKnown: boolean;
}

/** What the start page shows. */
export interface StartPageInput {
  /** The text of the footer: commit, date of the export and version. */
  readonly made: string;
  /** The repositories of the workspace file that are not on this machine. */
  readonly missing: readonly string[];
  readonly degree: DataExportVerificationDegree;
  /** The elements with a page, by identifier. */
  readonly entries: readonly ListEntry[];
  /** The number of elements with a page per type, in the metamodel's order, with the name of the type. */
  readonly types: readonly { readonly type: string; readonly name: string; readonly count: number }[];
  readonly lists: readonly ListPage[];
  /** Undefined when the workspace has no baseline. */
  readonly baseline: NewestBaseline | undefined;
}

const ATTENTION = ["failed", "outdated", "open"] as const;

/** A table of elements: identifier as a link to the page, title and one more column, `value` giving its HTML. */
const elementTable = (
  entries: readonly ListEntry[],
  label: string,
  value: (entry: ListEntry) => string,
): string =>
  entries.length === 0
    ? "<p>None.</p>"
    : `<table><thead><tr><th scope="col">Identifier</th><th scope="col">Title</th><th scope="col">${escapeHtml(label)}</th></tr></thead><tbody>${entries
        .map(
          (entry) =>
            `<tr><td><a href="${elementPage(entry.element.id)}">${escapeHtml(identifierOf(entry.element))}</a></td><td>${escapeHtml(entry.element.title)}</td><td>${value(entry)}</td></tr>`,
        )
        .join("")}</tbody></table>`;

/** The sentence on the newest baseline, its name a link to its page. */
const baselineText = (baseline: NewestBaseline | undefined): string => {
  if (baseline === undefined) {
    return "The workspace has no baseline.";
  }
  const since = `Since baseline <a href="${escapeHtml(baseline.page)}">${escapeHtml(baseline.name)}</a> of ${escapeHtml(`${baseline.date.slice(0, 10)}: ${String(baseline.changed)} changed, ${String(baseline.added)} added.`)}`;
  return baseline.selectionKnown
    ? since
    : `${since} The baseline stores no selection, so no element counts as added.`;
};

/** The content of the start page (see the file comment). */
export const startPageBody = (input: StartPageInput): string => {
  const { degree } = input;
  const counts = (["open", "verified", "indirect", "failed", "outdated"] as const)
    .map((status) => verificationBadge(status, `${status} ${String(degree.counts[status])}`))
    .join(" ");
  const attention = ATTENTION.flatMap((status) =>
    input.entries.filter(({ element }) => coreVerification(element) === status),
  );
  const hinted = input.entries.filter((entry) => entry.hints > 0);
  const listOf = new Map(input.lists.map((list) => [list.type, list]));
  const types = input.types
    .map(({ type, name, count }) => {
      const list = listOf.get(type);
      const label = list === undefined ? escapeHtml(name) : `<a href="${list.path}">${escapeHtml(name)}</a>`;
      return `<tr><td>${label}</td><td>${String(count)}</td></tr>`;
    })
    .join("");
  return [
    `<p class="rq-made">${escapeHtml(input.made)}</p>`,
    input.missing.length === 0
      ? ""
      : `<p class="rq-incomplete"><strong>This export is incomplete:</strong> ${escapeHtml(`repository ${input.missing.join(", ")} ${input.missing.length === 1 ? "is" : "are"} not on this machine, so ${input.missing.length === 1 ? "its" : "their"} elements are missing.`)}</p>`,
    '<h2 id="verification-degree">Verification degree</h2>',
    `<p>${escapeHtml(`${degreeClause(degree, " in the core")}.`)}</p>`,
    `<p class="rq-degree">${counts}</p>`,
    '<h2 id="not-verified">Failed, outdated or open requirements</h2>',
    elementTable(attention, "Verification status in the core", ({ element }) =>
      verificationBadge(String(coreVerification(element))),
    ),
    '<h2 id="open-hints">Elements with open hints</h2>',
    elementTable(hinted, "Open hints", ({ hints }) => String(hints)),
    '<h2 id="since-baseline">Since the newest baseline</h2>',
    `<p>${baselineText(input.baseline)}</p>`,
    '<h2 id="types">Elements by type</h2>',
    input.types.length === 0
      ? "<p>No elements.</p>"
      : `<table><thead><tr><th scope="col">Type</th><th scope="col">Elements</th></tr></thead><tbody>${types}</tbody></table>`,
  ].join("");
};

/** The styles of the start page. */
export const START_PAGE_CSS = [
  ".rq-made { color: var(--sl-color-gray-3); font-size: var(--sl-text-sm); }",
  ".rq-incomplete { border-inline-start: 4px solid var(--sl-color-orange); padding-inline-start: 0.75rem; }",
];
