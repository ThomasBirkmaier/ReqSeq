// The change of an element since each baseline on its page (SR-232 AK7), for the baselines that list it or to which it
// is added, newest first: the change as `baseline.get` names it (changed, added, removed, unchanged; SR-051 AK2, AK3)
// with a link to the baseline's page, and the version in the baseline with its date. When its version differs from the
// one in the baseline (changed, or removed and changed), the field difference (`fieldDifference`) of its file at the
// baseline's commit in its repository against its file now, which the export computes before the pages (only the
// difference is kept, N-036): one row per changed text, acceptance criterion (by criterion key) and property that
// counts to the version, with the old and the new wording as one word-level difference (`word-diff.ts`: removed words
// struck through, added words marked), and the relations added and removed, each target named as it is now where the
// workspace has it (resolved from the element's repository), else by its UUID. Without that commit in the local
// history (not fetched, a shallow clone), or where Git cannot tell, the page says the difference is not available, and
// why. Each baseline with a difference is a `<details>` (the newest such baseline open, the others collapsed), so it works without
// JavaScript.
import type { ChangedRelation, ElementRecord, FieldDifference } from "../model/index.js";
import { fieldName, resolveTarget } from "../model/index.js";
import type { BaselineRow, ExportBaseline } from "./baselines.js";
import { baselinePage, dayOf } from "./baselines.js";
import type { ElementPage, ElementPageContext } from "./element-page.js";
import { escapeHtml } from "./markdown.js";
import { named } from "./variants.js";
import { wordDiff } from "./word-diff.js";

/** The field difference of an element since a baseline, or why it is not available. */
export type Difference = FieldDifference | { readonly unavailable: string };

/** An element's row in one baseline. */
export interface SinceBaseline {
  readonly baseline: ExportBaseline;
  readonly row: BaselineRow;
  /** For an element whose version differs from the baseline's: the field difference, or why it is not available. */
  readonly difference?: Difference;
}

/** The rows of an element in the baselines, newest first. */
export type SinceOf = (record: ElementRecord) => readonly SinceBaseline[];

/** Old and new wording as one word-level difference; a wording that is missing on one side is all added or removed. */
const wording = (before: string | undefined, after: string | undefined): string =>
  `<div class="rq-diff-text">${wordDiff(before ?? "", after ?? "")}</div>`;

/** A relation target as the difference names it: the element now where the workspace has it, else its UUID. */
const target = (context: ElementPageContext, source: ElementRecord, relation: ChangedRelation): string => {
  const found = resolveTarget(context.store, source.repository, relation);
  const name = found.kind === "found" ? named(context, found.element) : escapeHtml(relation.id);
  return `${escapeHtml(fieldName(context.metamodel, relation.kind))}: ${name}`;
};

/** The field difference as HTML. */
const differenceHtml = (
  context: ElementPageContext,
  source: ElementRecord,
  difference: FieldDifference,
): string => {
  const items: string[] = [];
  if (difference.text !== undefined) {
    items.push(`<dt>Text</dt><dd>${wording(difference.text.before, difference.text.after)}</dd>`);
  }
  for (const c of difference.criteria) {
    const number = c.numberAfter ?? c.numberBefore;
    const label = `Acceptance criterion AK${String(number)}${c.key === undefined ? "" : ` (${c.key})`}${c.before === undefined ? ", added" : c.after === undefined ? ", removed" : ""}`;
    items.push(`<dt>${escapeHtml(label)}</dt><dd>${wording(c.before, c.after)}</dd>`);
  }
  for (const p of difference.properties) {
    items.push(
      `<dt>${escapeHtml(fieldName(context.metamodel, p.key))}</dt><dd>${wording(p.before, p.after)}</dd>`,
    );
  }
  for (const [label, relations] of [
    ["Relations added", difference.addedRelations],
    ["Relations removed", difference.removedRelations],
  ] as const) {
    if (relations.length > 0) {
      items.push(
        `<dt>${label}</dt><dd><ul>${relations.map((r) => `<li>${target(context, source, r)}</li>`).join("")}</ul></dd>`,
      );
    }
  }
  return items.length === 0
    ? "<p>No change of text, acceptance criteria, properties or relations.</p>"
    : `<dl class="rq-diff">${items.join("")}</dl>`;
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
  // The first baseline with a difference stands open, the others collapsed.
  const first = since.find((entry) => entry.difference !== undefined);
  const items = since.map((entry) => {
    const { baseline, difference } = entry;
    const head = `<a href="../${baselinePage(baseline)}">${escapeHtml(baseline.name)}</a> of ${escapeHtml(dayOf(baseline.date))}: ${escapeHtml(changeText(entry))}`;
    if (difference === undefined) {
      return `<p class="rq-since-line">${head}</p>`;
    }
    const shown =
      "unavailable" in difference
        ? `<p>The difference is not available: ${escapeHtml(difference.unavailable)}.</p>`
        : differenceHtml(context, page.record, difference);
    return `<details class="rq-since-baseline"${entry === first ? " open" : ""}><summary>${head}</summary>${shown}</details>`;
  });
  return `<section class="rq-since"><h2 id="since-baselines">Since baselines</h2>${items.join("")}</section>`;
};

/** The styles of the section. */
export const BASELINES_CSS = [
  ".sl-markdown-content .rq-since-line { margin: 0.5rem 0; }",
  "details.rq-since-baseline { margin: 0.5rem 0; }",
  "details.rq-since-baseline > summary { cursor: pointer; }",
  ".sl-markdown-content dl.rq-diff { margin: 0.5rem 0 0; padding-inline-start: 1rem; border-inline-start: 2px solid var(--sl-color-gray-5); }",
  ".sl-markdown-content dl.rq-diff dt { margin-top: 0.5rem; font-weight: 600; font-size: var(--sl-text-sm); }",
  ".sl-markdown-content dl.rq-diff dd { margin: 0.25rem 0 0; min-width: 0; }",
  ".rq-diff-text { white-space: pre-wrap; overflow-wrap: anywhere; }",
  ".rq-diff-text del { background: var(--sl-color-red-low); color: var(--sl-color-red-high); text-decoration: line-through; }",
  ".rq-diff-text ins { background: var(--sl-color-green-low); color: var(--sl-color-green-high); text-decoration: none; }",
];
