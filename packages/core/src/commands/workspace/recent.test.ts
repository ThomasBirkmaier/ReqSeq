// workspace.recent (SR-131, SR-080 AK4): the list of the workspaces the app opened last, as a read
// command. The cross-access test (packages/cli/test/cross-access.test.ts) runs it through every access.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { RECENT_WORKSPACES_FILE, recentWorkspacesFolder, rememberWorkspace } from "../../workspace/recent.js";
import { WORKSPACE_FILE } from "../../workspace/workspace-file.js";

let top = "";

// The OS cache folder of this process (Linux, macOS, Windows) lies in the test folder.
beforeEach(async () => {
  top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-workspace-recent-")));
  for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
    vi.stubEnv(name, path.join(top, "home"));
  }
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(top, { recursive: true, force: true, maxRetries: 3 });
});

/** A folder `name` in the test folder, with `logreq-workspace.yaml` unless `workspace` is false. */
const folder = async (name: string, workspace = true): Promise<string> => {
  const root = path.join(top, name);
  await fs.mkdir(root, { recursive: true });
  if (workspace) {
    await fs.writeFile(path.join(root, WORKSPACE_FILE), "logreq-workspace: 1\n");
  }
  return root;
};

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 27, 10, minute));

/** workspace.recent on a workspace object of `root` (a folder that need not hold a workspace). */
const recent = async (root: string): Promise<CommandOutput<"workspace.recent">> => {
  const workspace = new Workspace(root);
  try {
    return (await invoke("workspace.recent", {}, { workspace })) as CommandOutput<"workspace.recent">;
  } finally {
    await workspace.close();
  }
};

/** Every file below `root`, relative, with its text. */
const filesOf = async (root: string): Promise<Record<string, string>> => {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [path.relative(root, file), await fs.readFile(file, "utf8")]),
    ),
  ) as Record<string, string>;
};

describe("workspace.recent (SR-131)", () => {
  it("[SR-131/AK1] workspace.recent lists the recent workspaces, the last opened first, with whether each still holds a workspace", async () => {
    const wind = await folder("wind");
    const rain = await folder("rain");
    const gone = await folder("gone", false);
    await rememberWorkspace(gone, { now: at(1) });
    await rememberWorkspace(wind, { now: at(2) });
    await rememberWorkspace(rain, { now: at(3) });
    await rememberWorkspace(wind, { now: at(4) });

    expect(await recent(rain)).toEqual({
      workspaces: [
        { root: wind, opened: at(4).toISOString(), exists: true },
        { root: rain, opened: at(3).toISOString(), exists: true },
        { root: gone, opened: at(1).toISOString(), exists: false },
      ],
    });
  });

  it("gives the same list from a folder without a workspace, and reads nothing of the workspace of the call", async () => {
    const wind = await folder("wind");
    await rememberWorkspace(wind, { now: at(2) });
    const elsewhere = await folder("elsewhere", false);

    const expected = { workspaces: [{ root: wind, opened: at(2).toISOString(), exists: true }] };
    expect(await recent(elsewhere)).toEqual(expected);
    expect(await recent(path.join(top, "not-there"))).toEqual(expected);
  });

  it("is the empty list when the app recorded none", async () => {
    expect(await recent(await folder("wind"))).toEqual({ workspaces: [] });
  });

  it("writes nothing: neither the list nor the workspace changes", async () => {
    const wind = await folder("wind");
    await rememberWorkspace(wind, { now: at(2) });
    const list = path.join(recentWorkspacesFolder(), RECENT_WORKSPACES_FILE);
    const before = { cache: await filesOf(path.join(top, "home")), workspace: await filesOf(wind) };
    const { mtimeMs } = await fs.stat(list);

    await recent(wind);

    expect({ cache: await filesOf(path.join(top, "home")), workspace: await filesOf(wind) }).toEqual(before);
    expect((await fs.stat(list)).mtimeMs).toBe(mtimeMs);
  });
});
