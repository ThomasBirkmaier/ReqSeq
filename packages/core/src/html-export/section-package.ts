// The elements of a package on its page (SR-233 AK4): the page of an element of a type with the meaning package is its
// package page, and this section writes the display model `packageDisplay` (`displays.md`) of its members as HTML.
// The members are the elements with a page that `element.list` `where.package` gives for it (`packageMembers` in
// `siteOf`), by identifier, each with identifier (a link to its page), title, status ("–" without one) and verification
// status in the core as a badge ("–" for an element that is no requirement and for a requirement that is not in the
// core's view, as in the lists). An element in several packages stands on each of their pages.
import type { PackageCell, PackageRowDisplay } from "../displays/index.js";
import { NO_MEMBERS, packageDisplay, targetKey } from "../displays/index.js";
import { verificationBadge } from "./badge.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { listMetamodelOf, listRowOf } from "./list-page.js";
import { elementPage } from "./links.js";
import { escapeHtml } from "./markdown.js";

/** The index of the title column, whose cells get the class `rq-title`; the others do not wrap. */
const TITLE_COLUMN = 1;

/** A cell of a member as HTML. */
const cellHtml = (row: PackageRowDisplay, cell: PackageCell, column: number): string => {
  const kind = column === TITLE_COLUMN ? "rq-title" : "rq-nowrap";
  switch (cell.kind) {
    case "id":
      return `<td class="${kind}"><a href="../${elementPage(row.ref.id)}">${escapeHtml(cell.text)}</a></td>`;
    case "verification":
      return `<td class="${kind}">${cell.cell === undefined ? escapeHtml(cell.text) : verificationBadge(cell.cell.status, cell.text)}</td>`;
    case "text":
      return `<td class="${kind}">${escapeHtml(cell.text)}</td>`;
  }
};

/** The section of the elements of a package, or nothing for an element that is no package. */
export const packageSection = (context: ElementPageContext, page: ElementPage): string => {
  const { record } = page;
  const members = context.members.get(targetKey({ id: record.id, repository: record.repository }));
  if (members === undefined) {
    return "";
  }
  const display = packageDisplay(
    { package: record, rows: members.map(listRowOf), metamodel: listMetamodelOf(context.metamodel) },
    { id: "identifier", invalid: "omit" },
  );
  const head = display.columns.map(({ label }) => `<th scope="col">${escapeHtml(label)}</th>`).join("");
  const body = display.rows
    .map((row) => `<tr>${row.cells.map((cell, column) => cellHtml(row, cell, column)).join("")}</tr>`)
    .join("");
  const table =
    display.rows.length === 0
      ? `<p>${escapeHtml(NO_MEMBERS)}</p>`
      : `<table tabindex="0"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  return `<section class="rq-package"><h2 id="elements">Elements</h2>${table}</section>`;
};
