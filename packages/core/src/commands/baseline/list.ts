// baseline.list (SR-051): the valid baseline files of the workspace (baselines/read.ts, ADR-0018),
// with name, date, number of elements and the variant whose baseline it is: a stored selection of
// exactly the key `view` that names a variant (SR-103 AK4). Read on every call, kept by file.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { workspaceBaselines } from "../../baselines/index.js";
import { metamodelState } from "../../metamodel/index.js";
import { elementStoreState, shortIdState } from "../../model/index.js";
import { resolveView } from "../../variants/index.js";

export default defineCommand({
  name: "baseline.list",
  run: async ({ workspace }): Promise<CommandOutput<"baseline.list">> => {
    const found = await workspaceBaselines(workspace);
    /**
     * The UUID of the variant a stored view names, in any form (`{ id, title }` or a reference),
     * resolved as every view is (`resolveView`); undefined for the core or no variant here. The
     * states are read only when a baseline stores only a view.
     */
    const variantOf = async (view: string | { readonly id: string }): Promise<string | undefined> => {
      const context = {
        metamodel: await workspace.get(metamodelState),
        store: await workspace.get(elementStoreState),
        shortIds: await workspace.get(shortIdState),
      };
      try {
        const shown = resolveView(context, typeof view === "string" ? view : view.id, "baseline.list");
        return shown.kind === "variant" ? shown.variant.id : undefined;
      } catch {
        return undefined;
      }
    };
    const baselines: CommandOutput<"baseline.list">["baselines"][number][] = [];
    for (const b of found.baselines) {
      const { selection } = b.data;
      const view =
        selection?.view !== undefined && Object.keys(selection).length === 1
          ? await variantOf(selection.view)
          : undefined;
      baselines.push({
        name: b.name,
        file: b.shown,
        repository: b.repository,
        date: b.data.date,
        ...(view === undefined ? {} : { view }),
        elements: b.data.elements.length,
      });
    }
    return {
      baselines,
      location: found.location,
      ...(found.problems.length === 0 ? {} : { problems: [...found.problems] }),
      ...(found.incomplete ? { incomplete: true } : {}),
    };
  },
});
