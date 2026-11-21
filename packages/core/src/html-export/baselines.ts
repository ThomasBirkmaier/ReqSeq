// The baselines in the HTML export (SR-234 AK1, AK2), each as `baseline.get` gives it with all its rows (`html.export`
// reads them, since the stored selection is resolved in the command layer), newest first:
//
// - `baselines/index.html` (AK2): each baseline with name (a link to its page), date, the number of its elements (the
//   entries of its file) and the number of changed elements, in the order given.
// - `baselines/<12 hex>.html` (AK1), named by the SHA-256 of the baseline file's repository and path, so the address
//   stays while the file does: name, date and the commit per repository, a line with the number of its elements and
//   what changed since, then its elements in the groups changed, added, removed and unchanged (SR-051 AK2, AK3), each
//   heading with its number, each element with identifier (a link to the page), title, status, and the version in the
//   baseline with its date; the superseded elements in a group of their own with identifier, title and status
//   without a link (D-044); the entries no element of the workspace holds (missing, or in a repository that is not
//   here, SR-006) by UUID. The rows of a group stand by identifier in the order of SR-075 AK1 (digit runs as
//   numbers), and the tables wrap long values within the content's width (#2139). Without stored selection the page
//   says that nothing counts as added or removed.
import type { BaselineGetOutput } from "../generated/types.js";
import { sha256 } from "../files/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import { identifierField } from "../model/index.js";
import { compareNatural } from "../query/index.js";
import { elementPage } from "./links.js";
import { escapeHtml } from "./markdown.js";

/** A baseline as the export shows it: `baseline.get` with every row. */
export type ExportBaseline = Pick<
  BaselineGetOutput,
  | "name"
  | "file"
  | "repository"
  | "date"
  | "selectionKnown"
  | "repositories"
  | "elements"
  | "counts"
  | "total"
>;

/** One row of a baseline. */
export type BaselineRow = ExportBaseline["elements"][number];

/** An element of a row as the pages name it: identifier (else short ID), title, status and its page, if it has one. */
export interface RowElement {
  readonly name: string;
  readonly title: string;
  readonly status: string;
  readonly href: string | undefined;
}

/**
 * How a baseline's page names the element of a row: identifier (else short ID), title, status ("–" without one) and
 * its page where it has one; a row whose copy the store does not hold by its UUID.
 */
export const rowElementOf =
  (context: {
    readonly store: Pick<ElementStore, "byId">;
    readonly shortIds: ShortIds;
    readonly titleKey: string;
    readonly withPage: ReadonlySet<ElementRecord>;
  }) =>
  (row: BaselineRow): RowElement => {
    const { store, shortIds, titleKey, withPage } = context;
    const record = store.byId.get(row.id)?.find((r) => r.repository === row.repository);
    if (record === undefined) {
      return { name: row.id, title: "", status: "–", href: undefined };
    }
    const title = record.data[titleKey];
    const status = record.data["status"];
    return {
      name: identifierField(shortIds, record).identifier ?? shortIds.of(record),
      title: typeof title === "string" ? title : "",
      status: typeof status === "string" ? status : "–",
      href: withPage.has(record) ? elementPage(record.id) : undefined,
    };
  };

/** The page of all baselines, relative to the export folder. */
export const BASELINES_PAGE = "baselines/index.html";

/** The page of `baseline`, relative to the export folder (see the file comment). */
export const baselinePage = (baseline: Pick<ExportBaseline, "repository" | "file">): string =>
  `baselines/${sha256(Buffer.from(`${baseline.repository}\n${baseline.file}`, "utf8")).slice(0, 12)}.html`;

/** The number of elements of a baseline: the entries of its file, not those added since. */
export const entriesOf = (baseline: ExportBaseline): number => baseline.total - baseline.counts.added;

/** The day of an ISO date-time. */
export const dayOf = (date: string): string => date.slice(0, 10);

/** The content of the page of all baselines (AK2). */
export const baselinesPageBody = (baselines: readonly ExportBaseline[]): string =>
  `<table><thead><tr><th scope="col">Name</th><th scope="col">Date</th><th scope="col">Elements</th><th scope="col">Changed</th></tr></thead><tbody>${baselines
    .map(
      (b) =>
        `<tr><td><a href="../${baselinePage(b)}">${escapeHtml(b.name)}</a></td><td>${escapeHtml(b.date)}</td><td>${String(entriesOf(b))}</td><td>${String(b.counts.changed)}</td></tr>`,
    )
    .join("")}</tbody></table>`;

const GROUPS = [
  ["changed", "Changed"],
  ["added", "Added"],
  ["removed", "Removed"],
  ["unchanged", "Unchanged"],
] as const;

/** The version of a row in the baseline with its date, as a cell. */
const versionCell = (row: BaselineRow): string =>
  row.version === undefined
    ? "–"
    : `<code>${escapeHtml(row.version)}</code>${
        row.versionDate === undefined || row.versionDate === null
          ? ""
          : ` of ${escapeHtml(dayOf(row.versionDate))}`
      }`;

/**
 * `rows` by the identifier of their element (`element(row).name`, NFC), digit runs as numbers and case ignored, then
 * as written (SR-075 AK1).
 */
const byIdentifier = (
  rows: readonly BaselineRow[],
  element: (row: BaselineRow) => RowElement,
): BaselineRow[] =>
  rows
    .map((row) => ({ row, name: element(row).name.normalize("NFC") }))
    .sort(
      (a, b) =>
        compareNatural(a.name.toLowerCase(), b.name.toLowerCase()) ||
        (a.name < b.name ? -1 : Number(a.name > b.name)),
    )
    .map(({ row }) => row);

/** "1 element" or "2 elements". */
const elementsText = (count: number): string => `${String(count)} ${count === 1 ? "element" : "elements"}`;

/** The line on the number of elements of `baseline` and what changed since. */
const summaryOf = (baseline: ExportBaseline): string => {
  const { counts } = baseline;
  const since = [
    `${String(counts.changed)} changed`,
    ...(baseline.selectionKnown
      ? [`${String(counts.added)} added`, `${String(counts.removed)} removed`]
      : []),
    `${String(counts.superseded)} superseded`,
  ];
  return `${elementsText(entriesOf(baseline))} in the baseline. Since then ${since.join(", ")}.`;
};

/** A table of `rows`, or nothing without one. */
const table = (heads: readonly string[], rows: readonly string[]): string =>
  `<table><thead><tr>${heads.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;

/** The content of the page of `baseline` (AK1); `element` names the element of a row (`rowElementOf`). */
export const baselinePageBody = (
  baseline: ExportBaseline,
  element: (row: BaselineRow) => RowElement,
): string => {
  const commits = table(
    ["Repository", "Commit"],
    baseline.repositories.map(
      (r) => `<tr><td>${escapeHtml(r.name)}</td><td><code>${escapeHtml(r.commit)}</code></td></tr>`,
    ),
  );
  const named = (row: BaselineRow, linked: boolean): string => {
    const shown = element(row);
    const name = escapeHtml(shown.name);
    const cell = linked && shown.href !== undefined ? `<a href="../${shown.href}">${name}</a>` : name;
    return `<td class="rq-nowrap">${cell}</td><td class="rq-title">${escapeHtml(shown.title)}</td><td class="rq-nowrap">${escapeHtml(shown.status)}</td>`;
  };
  const of = (states: readonly string[]): BaselineRow[] =>
    byIdentifier(
      baseline.elements.filter((row) => states.includes(row.state)),
      element,
    );
  const heading = (id: string, label: string, count: number): string =>
    `<h2 id="${id}">${escapeHtml(`${label} (${String(count)})`)}</h2>`;
  const groups = GROUPS.map(([state, label]) => {
    const rows = of([state]);
    const body =
      rows.length === 0
        ? "<p>None.</p>"
        : table(
            ["Identifier", "Title", "Status", "Version in the baseline"],
            rows.map((row) => `<tr>${named(row, true)}<td>${versionCell(row)}</td></tr>`),
          );
    return `${heading(state, label, rows.length)}${body}`;
  });
  const superseded = of(["superseded"]);
  const absent = of(["missing", "inaccessible"]);
  return [
    `<div class="rq-baseline"><p class="rq-summary">${escapeHtml(summaryOf(baseline))}</p>`,
    `<dl class="rq-fields"><dt>Name</dt><dd>${escapeHtml(baseline.name)}</dd><dt>Date</dt><dd>${escapeHtml(baseline.date)}</dd></dl>`,
    `<h2 id="commits">Commits</h2>${commits}`,
    baseline.selectionKnown
      ? ""
      : "<p>This baseline stores no selection, so no element counts as added or removed.</p>",
    ...groups,
    superseded.length === 0
      ? ""
      : `${heading("superseded", "Superseded", superseded.length)}${table(
          ["Identifier", "Title", "Status"],
          superseded.map((row) => `<tr>${named(row, false)}</tr>`),
        )}`,
    absent.length === 0
      ? ""
      : `${heading("not-found", "Not in the workspace", absent.length)}${table(
          ["UUID", "Repository", "Why"],
          absent.map(
            (row) =>
              `<tr><td><code>${escapeHtml(row.id)}</code></td><td>${escapeHtml(row.repository ?? "")}</td><td>${row.state === "inaccessible" ? "repository not on this machine" : "no element file holds it"}</td></tr>`,
          ),
        )}`,
    "</div>",
  ].join("");
};

/**
 * The styles of a baseline's page and of the elements of a package: from 50em their tables as wide as the content and
 * no wider, below it the docs' table that scrolls in itself, so a phone does not scroll the page (#2181); long values
 * wrapped anywhere, a title kept at least 10rem wide, identifier and status in one line (#2139); the summary line in
 * the docs' larger text.
 */
export const BASELINE_PAGE_CSS = [
  "@media (min-width: 50em) { .rq-baseline table:not(:where(.not-content *)), .rq-package table:not(:where(.not-content *)) { display: table; width: 100%; } }",
  ".rq-baseline td, .rq-package td, .rq-baseline td code { overflow-wrap: anywhere; }",
  ".rq-baseline td.rq-title, .rq-package td.rq-title { min-width: 10rem; }",
  ".rq-baseline td.rq-nowrap, .rq-package td.rq-nowrap { white-space: nowrap; }",
  ".rq-summary { font-size: var(--sl-text-lg); color: var(--sl-color-white); }",
];
