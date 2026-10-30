// baseline.create (SR-050, SR-101): a baseline file of the elements of a selection (query/selection.ts),
// written by baselines/create.ts (ADR-0018). This file resolves the selection and the form the file
// stores it in, which SR-051, SR-094 and SR-103 read:
//
// - `ids` as UUIDs, `{ id, repository }` for an element outside the repository of the baselines
//   folder; `package` and `view` as `{ id, title }` (the title now, D-058), `{ id, repository }`
//   outside it; `view: core` as the text; `where` as filter.save writes it (`canonicalCondition`).
// - A saved filter is written resolved, never by name: its `where` (under `all` with the input's
//   `where`) and its `view`, so a later change of the filter does not change the baseline. When the
//   input and the filter both name a view, the input's is stored.
// - `selection.baseline` is refused: a baseline is not made of another one.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { createBaseline } from "../../baselines/index.js";
import type { BaselineStoredSelection, ElementSelection } from "../../generated/types.js";
import type { ElementRecord } from "../../model/index.js";
import { resolveRef, titleKeyOrEmpty } from "../../model/index.js";
import type { QueryContext, Selected } from "../../query/index.js";
import { canonicalCondition, resolveSelection } from "../../query/index.js";
import { invalidAt } from "../../query/context.js";
import { settingLocation, workspaceLayoutState } from "../../workspace/index.js";

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
    record: ElementRecord,
  ): { id: string; title: string } | { id: string; repository: string } => {
    const title = record.data[titleKey];
    return record.repository === home
      ? { id: record.id, title: typeof title === "string" ? title : "" }
      : { id: record.id, repository: record.repository };
  };
  const wheres = [selected.filter?.data.where, selection.where].flatMap((where) =>
    where === undefined ? [] : [canonicalCondition(context, where, "selection.where")],
  );
  const view = selection.view ?? selected.filter?.data.view;
  return {
    ...(selection.ids === undefined
      ? {}
      : {
          ids: [...new Set(selection.ids.map(recordOf))].map((r) =>
            r.repository === home ? r.id : { id: r.id, repository: r.repository },
          ),
        }),
    ...(wheres.length === 0 ? {} : { where: wheres.length === 1 ? wheres[0] : { all: wheres } }),
    ...(selection.package === undefined ? {} : { package: refOf(recordOf(selection.package)) }),
    ...(view === undefined ? {} : { view: view.toLowerCase() === "core" ? "core" : refOf(recordOf(view)) }),
  };
};

export default defineCommand({
  name: "baseline.create",
  run: async (ctx, input): Promise<CommandOutput<"baseline.create">> => {
    const command = "baseline.create";
    const { workspace } = ctx;
    if (input.selection.baseline !== undefined) {
      throw invalidAt(
        { command },
        "selection.baseline",
        "a baseline is not made of another baseline; leave it out",
      );
    }
    const selected = await resolveSelection(workspace, input.selection, command);
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
