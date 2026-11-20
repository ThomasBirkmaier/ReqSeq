// The baselines in the HTML export (SR-234 AK1, AK2), each as `baseline.get` gives it with all its rows (`html.export`
// reads them, since the stored selection is resolved in the command layer), newest first:
//
// - `baselines/index.html` (AK2): each baseline with name (a link to its page), date, the number of its elements (the
//   entries of its file) and the number of changed elements, in the order given.
// - `baselines/<12 hex>.html` (AK1), named by the SHA-256 of the baseline file's repository and path, so the address
//   stays while the file does: name, date and the commit per repository, then its elements in the groups changed,
//   added, removed and unchanged (SR-051 AK2, AK3), each with identifier (a link to the page), title, status, and the
//   version in the baseline with its date; the superseded elements in a group of their own with identifier, title and
//   status without a link (D-044); the entries no element of the workspace holds (missing, or in a repository that is
//   not here, SR-006) by UUID. Without stored selection the page says that nothing counts as added or removed.
import type { BaselineGetOutput } from "../generated/types.js";
import { sha256 } from "../files/index.js";
import type { ElementRecord, ElementStore, ShortIds } from "../model/index.js";
import { identifierField } from "../model/index.js";
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
    : escapeHtml(
        row.versionDate === undefined || row.versionDate === null
          ? row.version
          : `${row.version} of ${dayOf(row.versionDate)}`,
      );

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
    return `<td>${cell}</td><td>${escapeHtml(shown.title)}</td><td>${escapeHtml(shown.status)}</td>`;
  };
  const groups = GROUPS.map(([state, label]) => {
    const rows = baseline.elements.filter((row) => row.state === state);
    const body =
      rows.length === 0
        ? "<p>None.</p>"
        : table(
            ["Identifier", "Title", "Status", "Version in the baseline"],
            rows.map((row) => `<tr>${named(row, true)}<td>${versionCell(row)}</td></tr>`),
          );
    return `<h2 id="${state}">${label}</h2>${body}`;
  });
  const superseded = baseline.elements.filter((row) => row.state === "superseded");
  const absent = baseline.elements.filter((row) => row.state === "missing" || row.state === "inaccessible");
  return [
    `<dl class="rq-fields"><dt>Name</dt><dd>${escapeHtml(baseline.name)}</dd><dt>Date</dt><dd>${escapeHtml(baseline.date)}</dd></dl>`,
    `<h2 id="commits">Commits</h2>${commits}`,
    baseline.selectionKnown
      ? ""
      : "<p>This baseline stores no selection, so no element counts as added or removed.</p>",
    ...groups,
    superseded.length === 0
      ? ""
      : `<h2 id="superseded">Superseded</h2>${table(
          ["Identifier", "Title", "Status"],
          superseded.map((row) => `<tr>${named(row, false)}</tr>`),
        )}`,
    absent.length === 0
      ? ""
      : `<h2 id="not-found">Not in the workspace</h2>${table(
          ["UUID", "Repository", "Why"],
          absent.map(
            (row) =>
              `<tr><td><code>${escapeHtml(row.id)}</code></td><td>${escapeHtml(row.repository ?? "")}</td><td>${row.state === "inaccessible" ? "repository not on this machine" : "no element file holds it"}</td></tr>`,
          ),
        )}`,
  ].join("");
};
