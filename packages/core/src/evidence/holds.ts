// Which view an evidence record holds in (SR-047, SR-173, ADR-0012 "Status rules"): the one rule the
// status, "has evidence", the lists and the chain share, and which records of a pooled view show one
// execution once (`withoutShadowedCore`). A leaf module, so that the index (`by-element.ts`) and the
// status (`status.ts`) both use it without importing each other.
import type { View } from "../variants/index.js";
import type { EvidenceRecord } from "./record.js";

/**
 * Whether `record` holds in `view` (SR-047): in the core a record without variant; in a variant a
 * record for that variant and, when `independent` (the element's repository is marked
 * `variant-independent` in the workspace file, SR-173 AK1), also a record without variant. Without
 * the mark a record without variant holds only in the core (SR-173 AK2, D-026). Whether the element
 * applies in the view at all is the view rule's (SR-047 AK3), not this.
 */
export const holdsIn = (
  record: Pick<EvidenceRecord, "variant">,
  view: View,
  independent: boolean,
): boolean =>
  view.kind === "core"
    ? record.variant === undefined
    : record.variant === view.variant.id || (independent && record.variant === undefined);

/**
 * The execution a record comes from and the element it names: two records of one JUnit test case for
 * two views share it. The date too, so that records of two runs at the same place stay apart.
 */
const executionOf = (record: EvidenceRecord): string =>
  JSON.stringify([record.repository, record.file, record.line, record.element, record.date]);

/**
 * `records`, which hold in the variant `variant` (`holdsIn`), without each record without variant of
 * the same execution (repository, file, line, date) and element as a record for the variant: a JUnit test
 * case that names the core and the variant gives both (SR-093 AK5), and in a variant of a
 * `variant-independent` repository (SR-173) both hold, so a list of the view would show one execution
 * twice. Either gives the same status (same date and result). The same array when none is dropped.
 */
export const withoutShadowedCore = (
  records: readonly EvidenceRecord[],
  variant: string,
): readonly EvidenceRecord[] => {
  const own = new Set(records.filter((r) => r.variant === variant).map(executionOf));
  if (own.size === 0) {
    return records;
  }
  const kept = records.filter((r) => r.variant !== undefined || !own.has(executionOf(r)));
  return kept.length === records.length ? records : kept;
};
