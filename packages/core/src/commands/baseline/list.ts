// baseline.list (SR-051): the valid baseline files of the workspace (baselines/read.ts, ADR-0018),
// with name, date, number of elements and the variant whose baseline it is: a stored selection of
// exactly the key `view` that names a variant (SR-103 AK4). Read on every call, kept by file.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { workspaceBaselines } from "../../baselines/index.js";
import { elementStoreState, resolveRef, shortIdState } from "../../model/index.js";

export default defineCommand({
  name: "baseline.list",
  run: async ({ workspace }): Promise<CommandOutput<"baseline.list">> => {
    const found = await workspaceBaselines(workspace);
    /**
     * The UUID of the variant a stored view names, or undefined (the core, or no element here). The
     * store is read only for a view written by hand as a short ID or identifier.
     */
    const variantOf = async (view: string | { readonly id: string }): Promise<string | undefined> => {
      if (typeof view !== "string") {
        return view.id;
      }
      if (view.toLowerCase() === "core") {
        return undefined;
      }
      const store = await workspace.get(elementStoreState);
      try {
        return resolveRef(store, await workspace.get(shortIdState), view).id;
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
