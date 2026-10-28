// `logreq workspace recent` end to end (SR-131, SR-080 AK4): the built binary reads the list of the
// workspaces the app opened last from the OS cache folder of its environment, from any folder, as JSON
// and readable, and writes nothing. Only the app records the list; here core's `rememberWorkspace`
// seeds it, as the app's core process would.
// Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CacheEnvironment } from "@logreq/core";
import { RECENT_WORKSPACES_FILE, recentWorkspacesFolder, rememberWorkspace } from "@logreq/core";
import type { FixtureWorkspace } from "@logreq/testkit";
import { createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Run } from "../support/logreq.js";
import { logreq as run, requireBuiltCli } from "../support/logreq.js";

let home = "";
let fixture: FixtureWorkspace;

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-recent-home-")));
  fixture = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
});

afterEach(async () => {
  await fixture.cleanup();
  await fs.rm(home, { recursive: true, force: true, maxRetries: 3 });
});

/** The OS cache folder of a CLI started by `logreq` below, on every OS. */
const environment = (): CacheEnvironment => ({
  platform: process.platform,
  env: { XDG_CACHE_HOME: home, LOCALAPPDATA: home },
  home,
});

/** `logreq <args>` with home and OS cache folder in `home` (as `cliEnv(home)`). */
const logreq = (args: readonly string[], cwd: string): Promise<Run> =>
  run(args, { cwd, env: { HOME: home, USERPROFILE: home, XDG_CACHE_HOME: home, LOCALAPPDATA: home } });

const at = (minute: number): string => new Date(Date.UTC(2026, 9, 27, 10, minute)).toISOString();

/** Records `root` as the app's core process does when it opened it at `minute`. */
const opened = async (root: string, minute: number): Promise<void> => {
  await rememberWorkspace(root, { now: new Date(at(minute)), environment: environment() });
};

describe("logreq workspace recent (SR-131)", () => {
  it("[SR-131/AK1] prints the recent workspaces, the last opened first, with whether each still holds a workspace", async () => {
    const gone = path.join(home, "gone");
    await opened(gone, 1);
    await opened(fixture.root, 2);

    const json = await logreq(["workspace", "recent", "--json"], fixture.root);
    expect([json.code, json.stderr]).toEqual([0, ""]);
    expect(JSON.parse(json.stdout)).toEqual({
      workspaces: [
        { root: fixture.root, opened: at(2), exists: true },
        { root: gone, opened: at(1), exists: false },
      ],
    });

    const readable = await logreq(["workspace", "recent"], fixture.root);
    expect([readable.code, readable.stderr]).toEqual([0, ""]);
    expect(readable.stdout).toContain(`root: ${fixture.root}`);
    expect(readable.stdout.indexOf(fixture.root)).toBeLessThan(readable.stdout.indexOf(gone));
    expect(readable.stdout).toContain("exists: false");
  });

  it("gives the same list from a folder without a workspace and writes nothing", async () => {
    await opened(fixture.root, 2);
    const list = path.join(recentWorkspacesFolder(environment()), RECENT_WORKSPACES_FILE);
    const text = await fs.readFile(list, "utf8");
    const elsewhere = path.join(home, "elsewhere");
    await fs.mkdir(elsewhere);

    const result = await logreq(["workspace", "recent", "--json"], elsewhere);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(JSON.parse(result.stdout)).toEqual({
      workspaces: [{ root: fixture.root, opened: at(2), exists: true }],
    });
    expect(await fs.readFile(list, "utf8")).toBe(text);
    expect(await fs.readdir(elsewhere)).toEqual([]);
    // No cache folder of a copy (model cache, api.json) for the folder it ran in: only the list is there.
    expect(await fs.readdir(recentWorkspacesFolder(environment()))).toEqual([RECENT_WORKSPACES_FILE]);
  });

  it("prints an empty list when the app recorded none", async () => {
    const result = await logreq(["workspace", "recent", "--json"], fixture.root);
    expect([result.code, result.stderr, JSON.parse(result.stdout)]).toEqual([0, "", { workspaces: [] }]);
  });
});
