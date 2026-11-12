// perspective.list (SR-213 AK2, AK8): the perspectives of the workspace, read from the files of its
// perspectives folder on every call (query/perspectives.ts), so a perspective another person
// committed is there as soon as the working copy has it. Each as its file holds it, in file order;
// faulty and duplicate files are `problems` with file and reason, and nothing is written; `incomplete`
// while the folder's repository is not on this machine.
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { readPerspectives } from "../../query/index.js";
import { workspaceLayoutState } from "../../workspace/index.js";

type Listed = CommandOutput<"perspective.list">["perspectives"][number];

export default defineCommand({
  name: "perspective.list",
  run: async (ctx): Promise<CommandOutput<"perspective.list">> => {
    const folder = await readPerspectives(await ctx.workspace.get(workspaceLayoutState));
    return {
      perspectives: folder.saved.map(({ name, file, data }): Listed => {
        const { description, filter, where, group, sort } = data;
        return {
          name,
          file,
          ...(description === undefined ? {} : { description }),
          ...(filter === undefined ? {} : { filter }),
          where,
          ...(group === undefined ? {} : { group }),
          ...(sort === undefined ? {} : { sort }),
        };
      }),
      problems: [...folder.problems],
      incomplete: folder.incomplete,
    };
  },
});
