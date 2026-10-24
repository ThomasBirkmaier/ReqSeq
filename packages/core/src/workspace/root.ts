// Where an adapter started in some folder finds its workspace (ADR-0009 "Workspace discovery").
// Read only: it looks at file metadata, never at contents.
import fs from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_FILE } from "./config.js";

export { WORKSPACE_FILE };

const isFile = async (file: string): Promise<boolean> => {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    // Missing, unreadable or a broken link: not a workspace file.
    return false;
  }
};

/**
 * The nearest folder, from `start` upwards, that holds `logreq-workspace.yaml` as a file, or `undefined`
 * when no folder up to the file system root has one. `start` is resolved against the current folder.
 */
export async function findWorkspaceRoot(start: string): Promise<string | undefined> {
  let dir = path.resolve(start);
  for (;;) {
    if (await isFile(path.join(dir, WORKSPACE_FILE))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}
