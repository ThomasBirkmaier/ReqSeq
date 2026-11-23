// The records of one element that bear its status, grouped for display (SR-032 AK3): the
// `bearing` and `display` of `evidence.list`, and the evidence records the HTML export shows at each
// acceptance criterion (SR-232 AK3), from one rule so both give the same. `bearingRecords` picks the
// records, `displayOf` groups them over the views the element applies in (the view rule of the
// status: `holders` that include it, without that of a variant whose status is invalid unless `asked`
// names it, SR-047 AK6; none for an element that is no requirement). Pure.
import type { ElementRecord, VersionForms } from "../model/index.js";
import type { View } from "../variants/index.js";
import { bearingRecords } from "./bearing.js";
import type { Display } from "./display.js";
import { displayOf } from "./display.js";
import type { EvidenceRecord } from "./record.js";
import { validatesType } from "./status.js";
import type { ViewHolder, WorkspaceStatus } from "./verification.js";

/** The positions of the bearing records and their display. */
export interface ElementDisplay {
  readonly bearing: number[];
  readonly display: Display;
}

/**
 * Whether the view of `holder` is `asked`; when none is asked, every view but that of a variant
 * whose status is invalid (SR-047 AK6, as `verificationOf`).
 */
const shownView = ({ view: holder, invalid }: ViewHolder, asked: View | undefined): boolean =>
  asked === undefined
    ? !invalid
    : holder.kind === "core"
      ? asked.kind === "core"
      : asked.kind === "variant" && asked.variant.id === holder.variant.id;

/**
 * The display of `records` of `element` (see the file comment), measured against its `current`
 * version; `asked`: the view `records` were listed for, none for every view.
 */
export const elementDisplay = (
  status: Pick<WorkspaceStatus, "source" | "holders">,
  element: ElementRecord,
  current: VersionForms | undefined,
  records: readonly EvidenceRecord[],
  asked?: View,
): ElementDisplay => {
  const { source } = status;
  // Its criteria as the status counts them (key or number, older versions through Git, SR-031 AK11).
  const criteria = source.criteriaOf(element);
  const independent = source.independent(element);
  const bearing = bearingRecords(records, current, criteria, independent);
  const views = source.requirements.has(element.type)
    ? status.holders
        .filter((holder) => holder.includes(element) && shownView(holder, asked))
        .map(({ view }) => view)
    : [];
  return {
    bearing,
    display: displayOf(records, {
      bearing,
      current,
      criteria,
      views,
      independent,
      validates: validatesType(source, element.type),
    }),
  };
};
