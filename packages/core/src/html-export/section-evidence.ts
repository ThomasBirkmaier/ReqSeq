// The evidence records on a requirement's page (SR-232 AK3): at each acceptance criterion the records that bear its
// verification status (SR-032 AK3), and without criteria at the requirement; the rows of `evidence.list`'s `display`
// (`element-data.ts`), so a record without criterion stands at each criterion, as it counts for each (SR-031 AK6).
// Each line names the test case (JUnit class name and name) or else the method, then the method beside a test case,
// result, date as written and views. The records of one test case make one line with all their views when they share
// result and date; else each view has its lines (SR-223 AK4). A record without test case is a line of its own.
// Validation records are not shown.
import type { Display, EvidenceRecord } from "../evidence/index.js";
import { instantOf } from "../evidence/index.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { escapeHtml } from "./markdown.js";
import { viewName } from "./section-fields.js";

type Row = Display["rows"][number];
type Case = Row["cases"][number];

/** One line: the records it stands for and the views it names. */
interface Line {
  readonly first: EvidenceRecord;
  readonly views: readonly string[];
}

const viewOf = (record: EvidenceRecord): string => record.variant ?? "core";

const executionOf = (record: EvidenceRecord): string =>
  `${record.result}\u0000${String(instantOf(record.date))}`;

/** The lines of one case (see the file comment). */
const linesOf = (records: readonly EvidenceRecord[], entry: Case): Line[] => {
  const members = entry.records.flatMap((at) => records.slice(at, at + 1));
  const [first] = members as [EvidenceRecord, ...EvidenceRecord[]];
  if (members.every((record) => executionOf(record) === executionOf(first))) {
    return [{ first, views: entry.views }];
  }
  const lines = new Map<string, { first: EvidenceRecord; views: string[] }>();
  for (const record of members) {
    const key = `${viewOf(record)}\u0000${executionOf(record)}`;
    if (!lines.has(key)) {
      lines.set(key, { first: record, views: [viewOf(record)] });
    }
  }
  return [...lines.values()];
};

/** One line as HTML. */
const lineHtml = (context: ElementPageContext, entry: Case, line: Line): string => {
  const { first } = line;
  // A verification record names its method (D-026), and only verification records are shown.
  const method = first.method as string;
  const name =
    entry.testCase === undefined
      ? escapeHtml(method)
      : `<code dir="auto">${escapeHtml(entry.className === undefined ? entry.testCase : `${entry.className} > ${entry.testCase}`)}</code>`;
  const legend = [
    ...(entry.testCase === undefined ? [] : [method]),
    first.result,
    first.date,
    line.views.map((view) => viewName(context, view)).join(", "),
  ].join(" · ");
  return `<li>${name} <span class="rq-legend">${escapeHtml(legend)}</span></li>`;
};

/** The lines of the row `pick` finds as list items; none without a record. */
const itemsOf = (context: ElementPageContext, page: ElementPage, pick: (row: Row) => boolean): string[] => {
  const { evidence } = page.data;
  if (evidence === undefined) {
    return [];
  }
  const row = evidence.rows.find(pick);
  return (row?.cases ?? []).flatMap((entry) =>
    linesOf(evidence.records, entry).map((line) => lineHtml(context, entry, line)),
  );
};

/** The evidence records at the acceptance criterion numbered `criterion` (from 1); nothing without one. */
export const criterionEvidence = (
  context: ElementPageContext,
  page: ElementPage,
  criterion: number,
): string => {
  const items = itemsOf(context, page, (row) => row.criterion === criterion);
  return items.length === 0
    ? ""
    : `<details class="rq-evidence"><summary>Evidence records (${String(items.length)})</summary><ul>${items.join("")}</ul></details>`;
};

/** The evidence records of a requirement without acceptance criteria; nothing without one. */
export const evidenceSection = (context: ElementPageContext, page: ElementPage): string => {
  const items = itemsOf(context, page, (row) => row.criterion === undefined);
  return items.length === 0
    ? ""
    : `<section class="rq-evidence"><h2 id="evidence-records">Evidence records</h2><ul>${items.join("")}</ul></section>`;
};

/** The styles of the evidence records. */
export const EVIDENCE_CSS = [".rq-legend { color: var(--sl-color-gray-3); font-size: var(--sl-text-xs); }"];
