// The change of an element since each baseline on its page (SR-232 AK7), for the baselines that list it or to which it
// is added, newest first: the change as `baseline.get` names it (changed, added, removed, unchanged; SR-051 AK2, AK3)
// with a link to the baseline's page, and the version in the baseline with its date. When its version differs from the
// one in the baseline (changed, or removed and changed), the field difference (`fieldDifference`) of its file at the
// baseline's commit in its repository against its file now: each changed text, acceptance criterion (by criterion key)
// and property that counts to the version with the old and the new wording as written, and the relations added and
// removed. Without that commit in the local history (not fetched, a shallow clone), or where Git cannot tell, the page
// says the difference is not available, and why.
import type { ChangedRelation, ElementRecord, FieldDifference, FileAtCommit } from "../model/index.js";
import { fieldDifference, fieldName } from "../model/index.js";
import type { BaselineRow, ExportBaseline } from "./baselines.js";
import { baselinePage, dayOf } from "./baselines.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { linked, nameOf } from "./links.js";
import { escapeHtml } from "./markdown.js";

/** The content of an element at a baseline's commit, or why it is not available. */
export type Before = FileAtCommit | { readonly unavailable: string };

/** An element's row in one baseline. */
export interface SinceBaseline {
  readonly baseline: ExportBaseline;
  readonly row: BaselineRow;
  /** For an element whose version differs from the baseline's: its content then, or why that is not available. */
  readonly before?: Before;
}

/** The rows of an element in the baselines, newest first. */
export type SinceOf = (record: ElementRecord) => readonly SinceBaseline[];

/** Old and new wording, each as written. */
const wording = (before: string | undefined, after: string | undefined): string =>
  `<div class="rq-diff-pair"><div class="rq-diff-old"><span class="rq-diff-label">Before</span><pre>${before === undefined ? "<em>none</em>" : escapeHtml(before)}</pre></div><div class="rq-diff-new"><span class="rq-diff-label">Now</span><pre>${after === undefined ? "<em>none</em>" : escapeHtml(after)}</pre></div></div>`;

/** A relation target as the difference names it: by the element now where the workspace has it, else its UUID. */
const target = (context: ElementPageContext, relation: ChangedRelation): string => {
  const record = context.store.byId
    .get(relation.id)
    ?.find((r) => relation.repository === undefined || r.repository === relation.repository);
  const name =
    record === undefined
      ? relation.id
      : nameOf({
          shortId: context.shortIds.of(record),
          ...(context.shortIds.identifierOf(record) === undefined
            ? {}
            : { identifier: String(context.shortIds.identifierOf(record)) }),
          ...(relation.title === undefined ? {} : { title: relation.title }),
        });
  return `${escapeHtml(fieldName(context.metamodel, relation.kind))}: ${linked(name, record === undefined ? undefined : context.links.href(record.id))}`;
};

/** The field difference as HTML. */
const differenceHtml = (context: ElementPageContext, difference: FieldDifference): string => {
  const items: string[] = [];
  if (difference.text !== undefined) {
    items.push(`<li><strong>Text</strong>${wording(difference.text.before, difference.text.after)}</li>`);
  }
  for (const c of difference.criteria) {
    const number = c.numberAfter ?? c.numberBefore;
    const label = `Acceptance criterion AK${String(number)}${c.key === undefined ? "" : ` (${c.key})`}${c.before === undefined ? ", added" : c.after === undefined ? ", removed" : ""}`;
    items.push(`<li><strong>${escapeHtml(label)}</strong>${wording(c.before, c.after)}</li>`);
  }
  for (const p of difference.properties) {
    items.push(
      `<li><strong>${escapeHtml(fieldName(context.metamodel, p.key))}</strong>${wording(p.before, p.after)}</li>`,
    );
  }
  for (const [label, relations] of [
    ["Relations added", difference.addedRelations],
    ["Relations removed", difference.removedRelations],
  ] as const) {
    if (relations.length > 0) {
      items.push(
        `<li><strong>${label}</strong><ul>${relations.map((r) => `<li>${target(context, r)}</li>`).join("")}</ul></li>`,
      );
    }
  }
  return items.length === 0
    ? "<p>No change of text, acceptance criteria, properties or relations.</p>"
    : `<ul class="rq-diff">${items.join("")}</ul>`;
};

/** The sentence of one baseline: the change, and the version in the baseline with its date. */
const changeText = ({ row }: SinceBaseline): string => {
  if (row.version === undefined) {
    return `${row.state}; the baseline does not list it`;
  }
  const date =
    row.versionDate === undefined || row.versionDate === null ? "" : ` of ${dayOf(row.versionDate)}`;
  return `${row.state}; version in the baseline ${row.version}${date}`;
};

/** The section of the change since each baseline, or nothing without one. */
export const baselinesSection = (context: ElementPageContext, page: ElementPage): string => {
  const since = context.since?.(page.record) ?? [];
  if (since.length === 0) {
    return "";
  }
  const items = since.map((entry) => {
    const { baseline, before } = entry;
    const head = `<p><a href="../${baselinePage(baseline)}">${escapeHtml(baseline.name)}</a> of ${escapeHtml(dayOf(baseline.date))}: ${escapeHtml(changeText(entry))}</p>`;
    if (before === undefined) {
      return `<li>${head}</li>`;
    }
    const difference =
      "unavailable" in before
        ? `<p>The difference is not available: ${escapeHtml(before.unavailable)}.</p>`
        : differenceHtml(
            context,
            fieldDifference(context.metamodel, before, {
              type: page.record.type,
              data: page.record.data,
              text: page.text,
            }),
          );
    return `<li>${head}${difference}</li>`;
  });
  return `<section class="rq-since"><h2 id="since-baselines">Since baselines</h2><ul class="rq-since-list">${items.join("")}</ul></section>`;
};

/** The styles of the section. */
export const BASELINES_CSS = [
  ".rq-diff-pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.5rem; }",
  ".rq-diff-pair pre { white-space: pre-wrap; margin: 0.25rem 0 0; }",
  ".rq-diff-old pre { border-inline-start: 3px solid var(--sl-color-red); }",
  ".rq-diff-new pre { border-inline-start: 3px solid var(--sl-color-green); }",
  ".rq-diff-label { color: var(--sl-color-gray-3); font-size: var(--sl-text-sm); }",
];
