// baseline.create (SR-050, SR-101): a baseline file of the elements of a selection (query/selection.ts),
// written by baselines/create.ts (ADR-0018). This file resolves the selection and the form the file
// stores it in, which SR-051, SR-094 and SR-103 read:
//
// - `ids` as UUIDs, `{ id, repository }` for an element outside the repository of the baselines
//   folder; `package` and `view` as `{ id, title }` (the title now, D-058), `{ id, repository }`
//   outside it; `view: core` as the text; `where` as filter.save writes it (`canonicalCondition`).
// - `inRepository` (#2024) in the stored `ids` in the same form, each element once; with `ids` too, only the
//   elements both name, as the selection holds both. An item that names two copies in one repository is
//   `ref.ambiguous`, as an `ids` item is: the file names an element by UUID and repository only, and reads back
//   one copy (`copyOf`, baselines/read.ts).
// - A saved filter is written resolved, never by name: its `where` (under `all` with the input's
//   `where`) and its `view`, so a later change of the filter does not change the baseline. The
//   views are the ones the selection was resolved with (`Selected.views`). When the input and the
//   filter name different views, the elements apply in both (SR-101 AK2), which one stored view
//   cannot say: refused with `input.invalid` (SR-050 AK8); the same view is stored once.
// - `selection.baseline` is refused: a baseline is not made of another one. So is `selection.output`,
//   which is no form the file stores (ADR-0018 "selection"); both before the selection is resolved,
//   so also without elements or when the baseline or command does not exist or fails, and
//   `selection.baseline` first (SR-050 AK9). `refusedSelection` holds these rules and the one of the
//   views, for baseline.prepare too (SR-242 AK4).
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { createBaseline } from "../../baselines/index.js";
import type { BaselineStoredSelection, ElementSelection } from "../../generated/types.js";
import type { ElementRecord } from "../../model/index.js";
import { resolveInRepository, resolveRef, titleKeyOrEmpty } from "../../model/index.js";
import type { QueryContext, Selected } from "../../query/index.js";
import { canonicalCondition, resolveSelection } from "../../query/index.js";
import { invalidAt } from "../../query/context.js";
import type { View } from "../../variants/index.js";
import { settingLocation, workspaceLayoutState } from "../../workspace/index.js";
import { counted, filesNote, incompleteNote, problemsNote, sentence } from "../answer.js";

/** The field of a selection `baseline.create` refuses, and why. */
export interface RefusedSelection {
  readonly field: string;
  readonly message: string;
}

const viewKey = (shown: View): string =>
  shown.kind === "core" ? "core" : `${shown.variant.id}\n${shown.variant.repository}`;

/**
 * Why `baseline.create` refuses `selection` (see the file comment), undefined when it does not: by its kind
 * alone, and with `selected`, the selection as resolved, also a saved filter with another view than the input's.
 * `baseline.prepare` leaves out its next step "Create baseline" by the same rule (SR-242 AK4).
 */
export const refusedSelection = (
  selection: ElementSelection,
  selected?: Pick<Selected, "views" | "filter">,
): RefusedSelection | undefined => {
  if (selection.baseline !== undefined) {
    return {
      field: "selection.baseline",
      message: "a baseline is not made of another baseline; leave it out",
    };
  }
  if (selection.output !== undefined) {
    return {
      field: "selection.output",
      message: "a baseline stores its selection, and a command output is no stored selection; leave it out",
    };
  }
  const [view, other] = selected?.views ?? [];
  if (view !== undefined && other !== undefined && viewKey(view) !== viewKey(other)) {
    return {
      field: "selection.view",
      message: `the saved filter ${String(selected?.filter?.name)} has the view ${String(selected?.filter?.data.view)}, another than ${String(selection.view)}; a baseline stores one view, so give the filter's view or leave view out`,
    };
  }
  return undefined;
};

/** `selection` as the baseline file stores it, for a file in the repository `home` (see the file comment). */
const storedSelection = (
  context: QueryContext,
  selection: ElementSelection,
  selected: Selected,
  home: string,
): BaselineStoredSelection => {
  const { store, shortIds } = context;
  const titleKey = titleKeyOrEmpty(context.metamodel);
  const recordOf = (ref: string): ElementRecord => resolveRef(store, shortIds, ref);
  const refOf = (
    record: Pick<ElementRecord, "id" | "repository">,
  ): { id: string; title: string } | { id: string; repository: string } => {
    const title = store.byId.get(record.id)?.find((r) => r.repository === record.repository)?.data[titleKey];
    return record.repository === home
      ? { id: record.id, title: typeof title === "string" ? title : "" }
      : { id: record.id, repository: record.repository };
  };
  const wheres = [selected.filter?.data.where, selection.where].flatMap((where) =>
    where === undefined ? [] : [canonicalCondition(context, where, "selection.where")],
  );
  const refused = refusedSelection(selection, selected);
  if (refused !== undefined) {
    throw invalidAt(context, refused.field, refused.message);
  }
  const [view] = selected.views;
  const named = [
    ...(selection.ids === undefined ? [] : [[...new Set(selection.ids.map(recordOf))]]),
    ...(selection.inRepository === undefined
      ? []
      : [
          [
            ...new Set(
              selection.inRepository.flatMap((item) => resolveInRepository(store, shortIds, item, true)),
            ),
          ],
        ]),
  ];
  const [first] = named;
  return {
    ...(first === undefined
      ? {}
      : {
          ids: first
            .filter((r) => named.every((records) => records.includes(r)))
            .map((r) => (r.repository === home ? r.id : { id: r.id, repository: r.repository })),
        }),
    ...(wheres.length === 0 ? {} : { where: wheres.length === 1 ? wheres[0] : { all: wheres } }),
    ...(selection.package === undefined ? {} : { package: refOf(recordOf(selection.package)) }),
    ...(view === undefined ? {} : { view: view.kind === "core" ? "core" : refOf(view.variant) }),
  };
};

export default defineCommand({
  name: "baseline.create",
  answer: (output) =>
    sentence(
      `Created baseline ${output.baseline.name} with ${counted(output.baseline.elements, "element")}`,
      filesNote(output.files),
      problemsNote(output.problems),
      incompleteNote(output.incomplete),
    ),
  run: async (ctx, input): Promise<CommandOutput<"baseline.create">> => {
    const command = "baseline.create";
    const { workspace } = ctx;
    const refused = refusedSelection(input.selection);
    if (refused !== undefined) {
      throw invalidAt({ command }, refused.field, refused.message);
    }
    const selected = await resolveSelection(ctx, input.selection, command);
    const layout = await workspace.get(workspaceLayoutState);
    const context: QueryContext = { ...selected, workspace, command, view: undefined };
    return createBaseline(workspace, {
      name: input.name,
      selection: storedSelection(
        context,
        input.selection,
        selected,
        settingLocation(layout, "baselines").repository,
      ),
      elements: selected.elements,
      incomplete: selected.incomplete,
      metamodel: selected.metamodel,
    });
  },
});
