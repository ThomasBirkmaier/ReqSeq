// The app's core process records the workspace it opened (SR-131), never into a working tree (D-036).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import type { CacheEnvironment } from "../workspace/cache.js";
import { readRecentWorkspaces, recentWorkspacesFolder } from "../workspace/recent.js";
import { recordOpenedWorkspace } from "./recent-record.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const fixture = async (): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
  cleanups.push(() => created.cleanup());
  return created;
};

/** The OS cache folder in `folder` on every platform. */
const cacheIn = (folder: string): CacheEnvironment => ({
  platform: process.platform,
  env: { XDG_CACHE_HOME: folder, LOCALAPPDATA: folder },
  home: folder,
});

describe("recordOpenedWorkspace", () => {
  it("[SR-131/AK6] records the root of the opened workspace in the list of recent workspaces", async () => {
    const ws = await fixture();
    const cache = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-recent-cache-")));
    cleanups.push(() => fs.rm(cache, { recursive: true, force: true }));
    const environment = cacheIn(cache);
    const now = new Date("2026-10-27T10:00:00Z");
    expect(await recordOpenedWorkspace(new Workspace(ws.root), { environment, now, key: "k" })).toBe(true);
    expect(await readRecentWorkspaces(environment)).toEqual([
      { root: ws.root, key: "k", opened: now.toISOString() },
    ]);
  });

  it("writes nothing when the cache folder lies inside a repository of the workspace", async () => {
    const ws = await fixture();
    const environment = cacheIn(ws.root);
    const before = await fs.readdir(ws.root);
    expect(await recordOpenedWorkspace(new Workspace(ws.root), { environment })).toBe(false);
    expect(await fs.readdir(ws.root)).toEqual(before);
    await expect(fs.stat(recentWorkspacesFolder(environment))).rejects.toThrow();
  });
});
