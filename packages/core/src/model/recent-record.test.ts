// `markOpenedWorkspace` records the workspace of `workspace.markOpened` (SR-131, SR-250), never into a
// working tree (D-036).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import type { CacheEnvironment } from "../workspace/cache.js";
import { readRecentWorkspaces, recentWorkspacesFolder } from "../workspace/recent.js";
import { markOpenedWorkspace } from "./recent-record.js";

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

describe("markOpenedWorkspace", () => {
  it("[SR-131/AK-w8h0] records the root of the workspace in the list of recent workspaces, as a later read gives it", async () => {
    const ws = await fixture();
    const cache = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-recent-cache-")));
    cleanups.push(() => fs.rm(cache, { recursive: true, force: true }));
    const environment = cacheIn(cache);
    const now = new Date("2026-10-27T10:00:00Z");
    const entry = { root: ws.root, key: "k", opened: now.toISOString() };
    expect(await markOpenedWorkspace(new Workspace(ws.root), { environment, now, key: "k" })).toEqual(entry);
    expect(await readRecentWorkspaces(environment)).toEqual([entry]);
  });

  it("refuses and writes nothing when the cache folder lies inside a repository of the workspace", async () => {
    const ws = await fixture();
    const environment = cacheIn(ws.root);
    const before = await fs.readdir(ws.root);
    await expect(markOpenedWorkspace(new Workspace(ws.root), { environment })).rejects.toMatchObject({
      code: "file.read-only",
      details: { reason: "inside-repository" },
    });
    expect(await fs.readdir(ws.root)).toEqual(before);
    await expect(fs.stat(recentWorkspacesFolder(environment))).rejects.toThrow();
  });

  it("refuses a root the list cannot hold, naming why, and writes nothing", async () => {
    const ws = await fixture();
    const cache = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-recent-cache-")));
    cleanups.push(() => fs.rm(cache, { recursive: true, force: true }));
    const environment = cacheIn(cache);
    await expect(markOpenedWorkspace(new Workspace(ws.root), { environment, key: "" })).rejects.toMatchObject(
      {
        code: "file.read-only",
        message:
          "Not marked: the list of recent workspaces cannot hold the root of this workspace: it is not absolute, or longer than 4096 characters with links resolved",
        details: { reason: "root-not-held" },
      },
    );
    expect(await readRecentWorkspaces(environment)).toEqual([]);
  });
});
