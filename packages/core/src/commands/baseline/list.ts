// baseline.list (SR-051): the valid baseline files of the workspace (baselines/read.ts, ADR-0018),
// with name, date, number of elements and the variant whose baseline it is: a stored selection of
// exactly the key `view` that names a variant (SR-103 AK4). Read on every call, kept by file.
// `countedElements` gives the elements of the entries of the baseline its key names by `repository` and
// `file` (SR-224 AK4): the copy of each entry (`copyOf`), incomplete when an entry has none here.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand, matchesKey } from "../../catalog.js";
import type { ElementRecord } from "../../model/index.js";
import { copyOf, workspaceBaselines } from "../../baselines/index.js";
import { metamodelState } from "../../metamodel/index.js";
import { elementStoreState, shortIdState } from "../../model/index.js";
import { resolveView } from "../../variants/index.js";
import { counted, incompleteNote, problemsNote, sentence } from "../answer.js";

export default defineCommand({
  name: "baseline.list",
  answer: (output) =>
    sentence(
      `Found ${counted(output.baselines.length, "baseline")}`,
      problemsNote(output.problems),
      incompleteNote(output.incomplete),
    ),
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
  countedElements: async ({ workspace }, _input, count) => {
    const found = await workspaceBaselines(workspace);
    const store = await workspace.get(elementStoreState);
    const [key = {}] = count.key;
    const baseline = found.baselines.find((b) =>
      matchesKey({ repository: b.repository, file: b.shown }, key, ["repository", "file"]),
    );
    if (baseline === undefined) {
      return { elements: [], incomplete: found.incomplete };
    }
    const copies = baseline.data.elements.map((entry) => copyOf(store.byId, baseline, entry));
    const elements = copies.filter((copy): copy is ElementRecord => typeof copy === "object");
    return {
      elements: [...new Set(elements)],
      incomplete: found.incomplete || elements.length < copies.length,
    };
  },
});
