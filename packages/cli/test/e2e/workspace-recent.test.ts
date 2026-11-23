// `reqseq workspace recent` end to end (SR-131): the built binary reads the list of the workspaces
// opened last from the OS cache folder of its environment, from any folder, as JSON and readable, and
// writes nothing. Here core's `rememberWorkspace` seeds the list, as the app's core process would;
// `reqseq workspace mark-opened` marks a workspace in a process of its own (SR-250 AK1).
// Run after `pnpm build` with `pnpm test:e2e`.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CacheEnvironment } from "@reqseq/core";
import { RECENT_WORKSPACES_FILE, recentWorkspacesFolder, rememberWorkspace } from "@reqseq/core";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Run } from "../support/reqseq.js";
import { reqseq as run, requireBuiltCli } from "../support/reqseq.js";

let home = "";
let fixture: FixtureWorkspace;

beforeAll(() => {
  requireBuiltCli("pnpm test:e2e");
});

beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-recent-home-")));
  fixture = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
});

afterEach(async () => {
  await fixture.cleanup();
  await fs.rm(home, { recursive: true, force: true, maxRetries: 3 });
});

/** The OS cache folder of a CLI started by `reqseq` below, on every OS. */
const environment = (): CacheEnvironment => ({
  platform: process.platform,
  env: { XDG_CACHE_HOME: home, LOCALAPPDATA: home },
  home,
});

/** `reqseq <args>` with home and OS cache folder in `home` (as `cliEnv(home)`). */
const reqseq = (args: readonly string[], cwd: string): Promise<Run> =>
  run(args, { cwd, env: { HOME: home, USERPROFILE: home, XDG_CACHE_HOME: home, LOCALAPPDATA: home } });

const at = (minute: number): string => new Date(Date.UTC(2026, 9, 27, 10, minute)).toISOString();

/** Records `root` as the app's core process does when it opened it at `minute`. */
const opened = async (root: string, minute: number): Promise<void> => {
  await rememberWorkspace(root, { now: new Date(at(minute)), environment: environment() });
};

describe("reqseq workspace recent (SR-131)", () => {
  it("[SR-131/AK-y2k4] prints the recent workspaces, the last opened first, with whether each still holds a workspace", async () => {
    const gone = path.join(home, "gone");
    await opened(gone, 1);
    await opened(fixture.root, 2);

    const json = await reqseq(["workspace", "recent", "--json"], fixture.root);
    expect([json.code, json.stderr]).toEqual([0, ""]);
    expect(JSON.parse(json.stdout)).toEqual({
      answer: "The list of recent workspaces holds 2 workspaces.",
      workspaces: [
        { root: fixture.root, opened: at(2), exists: true },
        { root: gone, opened: at(1), exists: false },
      ],
    });

    const readable = await reqseq(["workspace", "recent"], fixture.root);
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

    const result = await reqseq(["workspace", "recent", "--json"], elsewhere);
    expect([result.code, result.stderr]).toEqual([0, ""]);
    expect(JSON.parse(result.stdout)).toEqual({
      answer: "The list of recent workspaces holds 1 workspace.",
      workspaces: [{ root: fixture.root, opened: at(2), exists: true }],
    });
    expect(await fs.readFile(list, "utf8")).toBe(text);
    expect(await fs.readdir(elsewhere)).toEqual([]);
    // No cache folder of a copy (model cache, api.json) for the folder it ran in: only the list is there,
    // and Node's compile cache of the CLI, which belongs to no copy (#178). In the e2e suite that cache
    // lies in the shared folder of support/compile-cache.ts; the filter covers a run without it.
    const names = await fs.readdir(recentWorkspacesFolder(environment()));
    expect(names.filter((name) => name !== "node-compile-cache")).toEqual([RECENT_WORKSPACES_FILE]);
  });

  it("prints an empty list when the app recorded none", async () => {
    const result = await reqseq(["workspace", "recent", "--json"], fixture.root);
    expect([result.code, result.stderr, JSON.parse(result.stdout)]).toEqual([
      0,
      "",
      { answer: "The list of recent workspaces holds 0 workspaces.", workspaces: [] },
    ]);
  });
});

describe("reqseq workspace mark-opened (SR-250)", () => {
  it("[SR-250/AK-dky0] [SR-131/AK-w8h0] marks the workspace it runs on, and a process started later lists it first with the time of the mark", async () => {
    await opened(path.join(home, "other"), 1);
    const inside = path.join(fixture.root, "requirements");
    await fs.mkdir(inside, { recursive: true });

    // Run from a folder inside the workspace: the root of the main repository is marked.
    const marked = await reqseq(["workspace", "mark-opened", "--json"], inside);
    expect([marked.code, marked.stderr]).toEqual([0, ""]);
    const output = JSON.parse(marked.stdout) as { root: string; opened: string };
    expect(output.root).toBe(fixture.root);

    const elsewhere = path.join(home, "elsewhere");
    await fs.mkdir(elsewhere);
    const listed = await reqseq(["workspace", "recent", "--json"], elsewhere);
    expect([listed.code, listed.stderr]).toEqual([0, ""]);
    expect((JSON.parse(listed.stdout) as { workspaces: unknown[] }).workspaces).toEqual([
      { root: fixture.root, opened: output.opened, exists: true },
      { root: path.join(home, "other"), opened: at(1), exists: false },
    ]);
  });
});
