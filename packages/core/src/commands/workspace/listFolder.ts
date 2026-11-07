// workspace.listFolder (SR-143): the entries of the folder of a typed path, which the app's command
// prompt completes a path argument with (ADR-0002 rule 1: the one read command made for completion,
// because only core reads the file system). The folder is resolved as the commands resolve a path
// argument: relative from the workspace root, `~` as home only with `absolute` ("Open workspace").
// Then it goes through the local path rule of the access (`ctx.localPaths`, SR-142), and is listed in
// the bounded slot of `workspace/list-folder.ts`. `run` uses `ctx.workspace` only for its root, so an
// absolute path is listed from any folder (ADR-0002 rule 7).
import os from "node:os";
import type { CommandOutput } from "../../catalog.js";
import { defineCommand } from "../../catalog.js";
import { listTypedFolder } from "../../workspace/list-folder.js";

export default defineCommand({
  name: "workspace.listFolder",
  run: (ctx, input): Promise<CommandOutput<"workspace.listFolder">> =>
    listTypedFolder(input.path, {
      files: input.files,
      home: os.homedir(),
      ...(input.absolute ? {} : { base: ctx.workspace.root }),
      check: (folder) => ctx.localPaths.check([{ field: "path", path: folder }]),
    }),
});
