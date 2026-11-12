// Cross-access scenarios of workspace.recent, in addition to the default one (cross-access.test.ts).
import path from "node:path";
import { rememberWorkspace } from "@reqseq/core";
import { scenariosOf } from "../../scenario.js";

// The list belongs to the user (`<OS cache>/reqseq/recent-workspaces.json`), not to the workspace: the
// app records it, every access reads the same list (SR-131, SR-080 AK4).
scenariosOf("workspace.recent", [
  {
    name: "the recent workspaces, the last opened first, one gone and one without a workspace file",
    tag: "[SR-131/AK-y2k4]",
    input: {},
    expect: "output",
    prepare: async ({ top, root }) => {
      const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 27, 10, minute));
      // A folder that held a workspace and is gone, and one inside the workspace without its own file.
      await rememberWorkspace(path.join(top, "gone"), { now: at(1) });
      await rememberWorkspace(path.join(root, "requirements"), { now: at(2) });
      await rememberWorkspace(root, { now: at(3) });
    },
  },
]);
