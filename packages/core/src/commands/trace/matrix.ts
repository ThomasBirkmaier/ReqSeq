// trace.matrix (SR-125, SR-126, N-076, D-062): the traceability matrix of a selection. The rows are the
// elements of the selection in the order `element.list` gives (query/ordered.ts), one page at a time;
// the columns are the relation kinds and directions that occur in the whole selection, each with the
// rows that have a link and their share; the cells hold the elements at the other end, outdated or
// missing marked (trace/matrix.ts). With an evidence location (SR-126, `showsEvidence`) each
// requirement row of the page also has its test cases and its verification status, and `evidence`
// heads them with the view and the verification degree of the whole selection (evidence/matrix.ts,
// evidence/degree.ts). All of it is computed here, so every access shows the same (SR-125 AK6,
// D-029). `incomplete` follows SR-006 AK2 over the whole selection and the evidence locations.
// `evidence` comes right after `columns`, as the degree stands above the status column (SR-126 AK4);
// `names` names the variant of its view and the missing children of the rows (#588).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import {
  degreeOf,
  evidenceIndexState,
  evidenceReadState,
  matrixEvidence,
  showsEvidence,
  verificationState,
  variantIdsOf,
  verificationNameIds,
  viewIdOf,
} from "../../evidence/index.js";
import { namesField, namesOf } from "../../model/index.js";
import type { Selected } from "../../query/index.js";
import { orderedSelection, resolveSelection } from "../../query/index.js";
import type { Workspace } from "../../runtime/workspace.js";
import type { MatrixRowFields } from "../../trace/index.js";
import {
  checkRelationKinds,
  columnOutput,
  currentVersionLookup,
  matrixColumns,
  matrixContext,
  matrixRows,
  traceContext,
} from "../../trace/index.js";
import type { View } from "../../variants/index.js";
import { appliesIn, validityOf } from "../../variants/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

const CORE: View = Object.freeze({ kind: "core" });

/** The evidence columns of a matrix: the fields of each row, the header and whether records are missing. */
interface MatrixEvidence {
  readonly rowFields: MatrixRowFields;
  readonly header: NonNullable<CommandOutput<"trace.matrix">["evidence"]>;
  readonly incomplete: boolean;
}

/**
 * The evidence columns of the matrix of `selected` (SR-126), undefined when it shows none
 * (`showsEvidence`; then nothing is read). The view is the selection's, else the saved filter's, else
 * the core (as evidence.degree). The whole selection is prepared once (`own`), so the degree and the
 * rows of the page are measured on the versions they need; rows are evaluated after that, never
 * against unprepared children (plan review S1).
 */
const evidenceOf = async (workspace: Workspace, selected: Selected): Promise<MatrixEvidence | undefined> => {
  const layout = await workspace.get(workspaceLayoutState);
  if (!showsEvidence(layout, selected.metamodel, selected.elements)) {
    return undefined;
  }
  const view = selected.views[0] ?? CORE;
  const [status, index, read] = await Promise.all([
    workspace.get(verificationState),
    workspace.get(evidenceIndexState),
    workspace.get(evidenceReadState),
  ]);
  await status.prepare(selected.elements, { own: true });
  return {
    rowFields: matrixEvidence({ status, index, view }),
    header: { view: viewIdOf(view), degree: degreeOf(status, selected.elements, view) },
    incomplete: read.incomplete,
  };
};

export default defineCommand({
  name: "trace.matrix",
  run: async (ctx, input): Promise<CommandOutput<"trace.matrix">> => {
    const command = "trace.matrix";
    const base = await traceContext(ctx.workspace);
    checkRelationKinds(base.metamodel, input.kinds, command);
    const selected = await resolveSelection(ctx.workspace, input.selection ?? {}, command);
    const sorted = orderedSelection(selected, command, input.sort);
    const { views } = selected;
    const validity = validityOf(selected.metamodel);
    const context = matrixContext(base, {
      shortIds: selected.shortIds,
      kinds: input.kinds,
      // A row applies in every view of the selection (the selection's and the saved filter's), so does the other end of a link.
      ...(views.length === 0
        ? {}
        : { includes: (element) => views.every((view) => appliesIn(validity, element, view)) }),
    });
    const total = selected.elements.length;
    const columns = matrixColumns(context, selected.elements);
    const evidence = await evidenceOf(ctx.workspace, selected);
    const end = input.offset + input.limit;
    const page =
      sorted.tree === undefined
        ? sorted.elements.slice(input.offset, end).map((element) => ({ element }))
        : sorted.tree.slice(input.offset, end).map(({ element, depth }) => ({ element, depth }));
    const rows = await matrixRows(
      context,
      page,
      columns,
      currentVersionLookup(ctx.workspace),
      evidence?.rowFields,
    );
    const named = [
      ...(evidence === undefined ? [] : variantIdsOf(evidence.header.view)),
      ...verificationNameIds(rows.flatMap((row) => row.verification ?? [])),
    ];
    return {
      columns: columns.map((column) => columnOutput(column, total)),
      ...(evidence === undefined ? {} : { evidence: evidence.header }),
      rows,
      total,
      incomplete: selected.incomplete || evidence?.incomplete === true,
      ...namesField(namesOf(selected, named)),
    };
  },
});
