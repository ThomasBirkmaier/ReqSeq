// The elements behind the numbers of a list of element.list and element.search (SR-224 AK4, #1915), for
// `selection.output.count`: the rows of every page, not of the page the input names.
//
// - `groups[].count`: the rows of the group the key names by its `value` (`{}` the last group), as
//   `groupsOf` deals them; `groups[].unavailable`: the elements of the last group that name only targets
//   not available (`Grouping.unavailable`). Without grouping, or for a group without rows, none.
// - `rowVerification[].degree.*`: with `withVerification`, the derivation children of the row's element
//   that its degree counts (`needDegreeElements`, the rule of the node in trace.graph), in the view of the
//   list; the key names the row by `id`, `repository` and `file`, and a row of any page counts. None for an
//   element that is no row or no need.
import type { OutputCount, OutputElements } from "../catalog.js";
import { matchesKey } from "../catalog.js";
import { degreeFieldElements, needDegreeElements } from "../evidence/index.js";
import type { ElementRecord } from "../model/index.js";
import type { Grouping } from "../query/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { View } from "../variants/index.js";

const CORE: View = Object.freeze({ kind: "core" });

/** What a list gives for its numbers: its rows over all pages, how they are grouped and its views. */
export interface ListRows {
  /** The records of the rows of every page, each once. */
  readonly records: readonly ElementRecord[];
  readonly grouping: Grouping | undefined;
  readonly withVerification: boolean;
  readonly views: readonly View[];
  readonly incomplete: boolean;
}

/** The elements of the number `count` of a list (see the file comment). */
export const listCountElements = async (
  workspace: Workspace,
  rows: ListRows,
  count: OutputCount,
): Promise<OutputElements> => {
  const [key = {}] = count.key;
  const { grouping, records, incomplete } = rows;
  if (count.field.startsWith("groups[].")) {
    const at = grouping?.heads.findIndex((head) => matchesKey(head, key, ["value"])) ?? -1;
    const last = grouping !== undefined && at === grouping.heads.length - 1;
    const elements =
      grouping === undefined || at < 0
        ? []
        : count.field === "groups[].unavailable"
          ? last
            ? records.filter((record) => grouping.unavailable(record))
            : []
          : records.filter((record) => grouping.groupsOf(record).includes(at));
    return { elements, incomplete };
  }
  const view = rows.views[0] ?? CORE;
  const row = rows.withVerification
    ? records.find((record) => matchesKey(record, key, ["id", "repository", "file"]))
    : undefined;
  const by = row === undefined ? undefined : await needDegreeElements(workspace, row, view);
  const field = count.field.slice("rowVerification[].degree.".length);
  return {
    elements: by === undefined ? [] : degreeFieldElements(by, field),
    incomplete,
    view,
  };
};
