// workspace.init (SR-014): create a workspace with the shipped standard model as its metamodel in
// an existing folder, then open it once and return its problems (none for a new standard
// workspace; an own metamodel repository that is not there yet shows up here, SR-018).
import fs from "node:fs/promises";
import path from "node:path";
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { STANDARD_MODEL_FILE, STANDARD_MODEL_TEXT, metamodelState } from "../../metamodel/index.js";
import { Workspace } from "../../runtime/workspace.js";
import { createWorkspace, workspaceLayoutState } from "../../workspace/index.js";

/** The path with links resolved, so two spellings of one folder compare equal; the path itself when it does not exist. */
const realPath = async (folder: string): Promise<string> => fs.realpath(folder).catch(() => folder);

export default defineCommand({
  name: "workspace.init",
  run: async (ctx, input): Promise<CommandOutput<"workspace.init">> => {
    // `localPath`: the CLI passes it absolute, API and MCP relative to the workspace root.
    const root = path.resolve(ctx.workspace.root, input.path);
    const files = await createWorkspace(root, {
      name: input.name,
      metamodel: input.metamodel,
      metamodelFile: { name: STANDARD_MODEL_FILE, text: STANDARD_MODEL_TEXT },
    });
    if ((await realPath(root)) === (await realPath(ctx.workspace.root))) {
      // Later calls on the same Workspace object (API, MCP, app) see the new workspace file.
      await ctx.workspace.reset(workspaceLayoutState);
    }
    const created = new Workspace(root);
    try {
      const layout = await created.get(workspaceLayoutState);
      const metamodel = await created.get(metamodelState);
      return { files: [...files], problems: [...layout.problems, ...metamodel.problems] };
    } finally {
      await created.close();
    }
  },
});
