// filter.list (SR-070 AK2): the saved filters of the workspace, read from the files of its filters
// folder on every call (query/saved.ts), so a filter another person committed is there as soon as
// the working copy has it. Each with its definition as the file holds it, in file order; faulty and
// duplicate files are `problems`; `incomplete` while the folder's repository is not on this machine.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { readSavedFilters } from "../../query/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

type Listed = CommandOutput<"filter.list">["filters"][number];

export default defineCommand({
  name: "filter.list",
  run: async (ctx): Promise<CommandOutput<"filter.list">> => {
    const saved = await readSavedFilters(await ctx.workspace.get(workspaceLayoutState));
    return {
      filters: saved.filters.map(({ name, file, data }): Listed => {
        const { description, view, where, sort } = data;
        return {
          name,
          file,
          ...(description === undefined ? {} : { description }),
          ...(view === undefined ? {} : { view }),
          where,
          ...(sort === undefined ? {} : { sort }),
        };
      }),
      problems: [...saved.problems],
      incomplete: saved.incomplete,
    };
  },
});
