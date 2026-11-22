// workspace.markOpened (SR-250): marks the workspace of the call first in the list of recent workspaces,
// strictly. The cross-access test (packages/cli/test/cross-access.test.ts) runs it through every access,
// and checks there that no other command changes the list (AK4); the CLI e2e test marks in a process of
// its own (packages/cli/test/e2e/workspace-recent.test.ts).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { lockCacheFile } from "../../workspace/cache.js";
import {
  RECENT_WORKSPACES_FILE,
  RECENT_WORKSPACES_KEEP,
  readRecentWorkspaces,
  recentWorkspacesFolder,
  rememberWorkspace,
} from "../../workspace/recent.js";

let fixture: FixtureWorkspace;
let home = "";

beforeAll(async () => {
  fixture = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
});

afterAll(async () => {
  await fixture.cleanup();
});

// The OS cache folder of this process (Linux, macOS, Windows) lies in a test folder.
beforeEach(async () => {
  home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-mark-opened-")));
  for (const name of ["HOME", "USERPROFILE", "XDG_CACHE_HOME", "LOCALAPPDATA"]) {
    vi.stubEnv(name, home);
  }
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(home, { recursive: true, force: true, maxRetries: 3 });
});

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 27, 10, minute));

const listFile = (): string => path.join(recentWorkspacesFolder(), RECENT_WORKSPACES_FILE);

/** workspace.markOpened on the workspace at `root`. */
const mark = async (root: string): Promise<CommandOutput<"workspace.markOpened">> => {
  const workspace = new Workspace(root);
  try {
    return (await invoke("workspace.markOpened", {}, { workspace })) as CommandOutput<"workspace.markOpened">;
  } finally {
    await workspace.close();
  }
};

/** workspace.recent, as another process reads the list (it reads the file on every call). */
const recentRoots = async (): Promise<string[]> => {
  const workspace = new Workspace(fixture.root);
  try {
    const output = (await invoke("workspace.recent", {}, { workspace })) as CommandOutput<"workspace.recent">;
    return output.workspaces.map((entry) => entry.root);
  } finally {
    await workspace.close();
  }
};

/** The error the call rejects with, as the schema defines it. */
const refusal = async (root: string): Promise<unknown> => {
  try {
    await mark(root);
  } catch (error) {
    return error instanceof CommandError ? error.toJSON() : error;
  }
  throw new Error("not refused");
};

describe("workspace.markOpened", () => {
  it("[SR-250/AK-dky0] puts the absolute root of the main repository first with the time of the mark, once per folder", async () => {
    const other = path.join(home, "other");
    await rememberWorkspace(other, { now: at(1) });
    const link = path.join(home, "link");
    await fs.symlink(fixture.root, link, "junction");
    await rememberWorkspace(link, { now: at(2) });

    const before = Date.now();
    const output = await mark(fixture.root);
    const after = Date.now();

    expect(output).toEqual({
      answer: `The list of recent workspaces starts with ${fixture.root}.`,
      root: fixture.root,
      opened: expect.any(String) as unknown,
    });
    const time = Date.parse(output.opened);
    expect(time >= before && time <= after).toBe(true);
    // The other spelling of the same folder is gone; workspace.recent gives the same time.
    expect(await recentRoots()).toEqual([fixture.root, other]);
    expect((await readRecentWorkspaces())[0]?.opened).toBe(output.opened);
  });

  it("[SR-250/AK-yz3j] with 20 entries, the one marked longest ago goes", async () => {
    const roots = Array.from({ length: RECENT_WORKSPACES_KEEP }, (_, n) => path.join(home, `w${String(n)}`));
    for (const [minute, root] of roots.entries()) {
      await rememberWorkspace(root, { now: at(minute) });
    }
    await mark(fixture.root);
    // The most recent first: w19 … w1; w0 was marked longest ago.
    expect(await recentRoots()).toEqual([fixture.root, ...roots.slice(1).reverse()]);
  });

  it("[SR-250/AK-vr1n] creates a missing list with this one entry", async () => {
    await expect(fs.stat(listFile())).rejects.toThrow();
    await mark(fixture.root);
    expect(await recentRoots()).toEqual([fixture.root]);
  });

  it("[SR-250/AK-vr1n] refuses a list it cannot read or write, names the reason and changes nothing", async () => {
    await fs.mkdir(path.dirname(listFile()), { recursive: true });
    // Content that is no list of ReqSeq.
    await fs.writeFile(listFile(), "not a list\n");
    expect(await refusal(fixture.root)).toEqual({
      code: "file.faulty",
      message:
        "Not marked: the list of recent workspaces cannot be read, or it is no list of ReqSeq; move the file recent-workspaces.json in the folder reqseq of the OS cache folder away",
      details: { reason: "unreadable" },
    });
    expect(await fs.readFile(listFile(), "utf8")).toBe("not a list\n");

    // A list that cannot be written: the file stays as it was.
    await rememberWorkspace(path.join(home, "other"), { now: at(1) });
    const text = await fs.readFile(listFile(), "utf8");
    const open = fs.open.bind(fs);
    const spy = vi
      .spyOn(fs, "open")
      .mockImplementation(async (...args: Parameters<typeof fs.open>) =>
        String(args[0]).endsWith(".reqseq-tmp")
          ? Promise.reject(Object.assign(new Error("EACCES"), { code: "EACCES" }))
          : open(...args),
      );
    onTestFinished(() => {
      spy.mockRestore();
    });
    expect(await refusal(fixture.root)).toEqual({
      code: "file.read-only",
      message:
        "Not marked: the list of recent workspaces cannot be written; check the permissions of the folder reqseq in the OS cache folder",
      details: { reason: "unwritable" },
    });
    spy.mockRestore();
    expect(await fs.readFile(listFile(), "utf8")).toBe(text);

    // Another process writing the list.
    const lock = await lockCacheFile(recentWorkspacesFolder(), RECENT_WORKSPACES_FILE);
    onTestFinished(async () => {
      await lock?.release();
    });
    expect(await refusal(fixture.root)).toEqual({
      code: "file.changed-on-disk",
      message: "Not marked: another process is writing the list of recent workspaces; run the command again",
      details: { reason: "locked" },
    });
    expect(await fs.readFile(listFile(), "utf8")).toBe(text);
  });

  it("never writes the list into a repository of the workspace (D-036)", async () => {
    vi.stubEnv("XDG_CACHE_HOME", fixture.root);
    vi.stubEnv("LOCALAPPDATA", fixture.root);
    vi.stubEnv("HOME", fixture.root);
    vi.stubEnv("USERPROFILE", fixture.root);
    const before = await fs.readdir(fixture.root);
    expect(await refusal(fixture.root)).toEqual({
      code: "file.read-only",
      message:
        "Not marked: the list of recent workspaces would lie inside a repository of this workspace, and ReqSeq never writes into a working tree; point XDG_CACHE_HOME or LOCALAPPDATA elsewhere",
      details: { reason: "inside-repository" },
    });
    expect(await fs.readdir(fixture.root)).toEqual(before);
  });
});
