// The list of the workspaces the app opened last (SR-131, `recent.ts`).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileSchemaValidator } from "../runtime/contracts.js";
import type { CacheEnvironment } from "./cache.js";
import { lockCacheFile } from "./cache.js";
import type { ExistenceChecker } from "./recent.js";
import {
  MAX_ROOT_LENGTH,
  RECENT_WORKSPACES_FILE,
  RECENT_WORKSPACES_KEEP,
  RECENT_WORKSPACES_MAX_BYTES,
  createExistenceChecker,
  parseRecentWorkspaces,
  readRecentWorkspaces,
  recentWorkspaceStates,
  recentWorkspacesFolder,
  rememberWorkspace,
  workspaceExists,
  workspaceKey,
} from "./recent.js";
import { WORKSPACE_FILE } from "./workspace-file.js";

let top = "";
let environment: CacheEnvironment;

beforeEach(async () => {
  top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-recent-")));
  const cache = path.join(top, "cache");
  environment = {
    platform: process.platform,
    env: { XDG_CACHE_HOME: cache, LOCALAPPDATA: cache },
    home: cache,
  };
});

afterEach(async () => {
  vi.useRealTimers();
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

const listFile = (): string => path.join(recentWorkspacesFolder(environment), RECENT_WORKSPACES_FILE);

const roots = async (): Promise<string[]> =>
  (await readRecentWorkspaces(environment)).map((entry) => entry.root);

describe("rememberWorkspace and readRecentWorkspaces", () => {
  it("[SR-131/AK1] rememberWorkspace puts the opened root first, once per folder, and keeps at most 20", async () => {
    const a = await folder("a");
    const b = await folder("b");
    expect(await rememberWorkspace(a, { environment, now: at(1) })).toBe(true);
    expect(await rememberWorkspace(b, { environment, now: at(2) })).toBe(true);
    expect(await roots()).toEqual([b, a]);
    // Opened again: first again, once.
    await rememberWorkspace(a, { environment, now: at(3) });
    expect(await readRecentWorkspaces(environment)).toEqual([
      { root: a, key: workspaceKey(a), opened: at(3).toISOString() },
      { root: b, key: workspaceKey(b), opened: at(2).toISOString() },
    ]);
    // 22 more: the 20 most recent stay.
    const more: string[] = [];
    for (let n = 0; n < 22; n++) {
      more.push(path.join(top, `w${String(n)}`));
      await rememberWorkspace(more[n] ?? "", { environment, now: at(10 + n) });
    }
    expect(await roots()).toEqual(more.toReversed().slice(0, RECENT_WORKSPACES_KEEP));
  });

  it("[SR-131/AK6] readRecentWorkspaces gives the stored workspaces in the stored order", async () => {
    const [a, b, c] = [await folder("a"), await folder("b"), await folder("c")];
    await rememberWorkspace(a, { environment, now: at(1) });
    await rememberWorkspace(c, { environment, now: at(2) });
    await rememberWorkspace(b, { environment, now: at(3) });
    // Another process reads the file (the app after a restart): the same order, read as often as asked.
    expect(await roots()).toEqual([b, c, a]);
    expect(await roots()).toEqual([b, c, a]);
    // The file is what its schema says.
    const validate = fileSchemaValidator("recent-workspaces.schema.json");
    expect(validate(JSON.parse(await fs.readFile(listFile(), "utf8")))).toBe(true);
  });

  it("stores the list in <OS cache>/logreq/recent-workspaces.json with mode 0600, never inside the workspace", async () => {
    const a = await folder("a");
    await rememberWorkspace(a, { environment });
    const cache = path.join(top, "cache");
    const expected =
      process.platform === "darwin"
        ? path.join(cache, "Library", "Caches", "logreq", RECENT_WORKSPACES_FILE)
        : path.join(cache, "logreq", RECENT_WORKSPACES_FILE);
    expect(listFile()).toBe(expected);
    expect(JSON.parse(await fs.readFile(expected, "utf8"))).toMatchObject({
      format: 1,
      workspaces: [{ root: a }],
    });
    if (process.platform !== "win32") {
      expect((await fs.stat(expected)).mode & 0o777).toBe(0o600);
    }
    // Nothing but the workspace file is in the workspace, and the lock is given back.
    expect(await fs.readdir(a)).toEqual([WORKSPACE_FILE]);
    expect(await fs.readdir(path.dirname(expected))).toEqual([RECENT_WORKSPACES_FILE]);
    // The folder of the list on every platform, from the given environment or this process's.
    expect(recentWorkspacesFolder({ platform: "win32", env: { LOCALAPPDATA: "D:\\L" }, home: "C:\\U" })).toBe(
      "D:\\L\\logreq",
    );
    expect(recentWorkspacesFolder({ platform: "linux", env: {}, home: "/home/ada" })).toBe(
      "/home/ada/.cache/logreq",
    );
    expect(path.isAbsolute(recentWorkspacesFolder())).toBe(true);
  });

  it("two names of one folder are one entry, and the stored root keeps its spelling", async () => {
    const real = await folder("real");
    const link = path.join(top, "link");
    await fs.symlink(real, link, "junction");
    await rememberWorkspace(link, { environment, now: at(1) });
    expect(await readRecentWorkspaces(environment)).toEqual([
      { root: link, key: workspaceKey(real), opened: at(1).toISOString() },
    ]);
    await rememberWorkspace(real, { environment, now: at(2) });
    expect(await readRecentWorkspaces(environment)).toEqual([
      { root: real, key: workspaceKey(real), opened: at(2).toISOString() },
    ]);
    // A key the caller computed is taken as it is (the core process sends it to main too).
    await rememberWorkspace(link, { environment, now: at(3), key: "given" });
    expect((await readRecentWorkspaces(environment)).map((entry) => entry.key)).toEqual([
      "given",
      workspaceKey(real),
    ]);
    expect(workspaceKey("C:\\Work\\Spec", "win32")).toBe("c:\\work\\spec");
  });

  it("broken, foreign or oversized content reads as an empty list", async () => {
    const a = await folder("a");
    const write = async (text: string): Promise<void> => {
      await fs.mkdir(path.dirname(listFile()), { recursive: true });
      await fs.writeFile(listFile(), text);
    };
    const entry = { root: a, key: a, opened: "2026-10-27T10:00:00Z" };
    for (const text of [
      "not json",
      "null",
      "[]",
      JSON.stringify({ format: 2, workspaces: [entry] }),
      JSON.stringify({ format: 1, workspaces: {} }),
      JSON.stringify({ format: 1, workspaces: [entry, "x"] }),
      JSON.stringify({ format: 1, workspaces: [{ ...entry, root: "relative" }] }),
      JSON.stringify({ format: 1, workspaces: [{ ...entry, root: 3 }] }),
      JSON.stringify({ format: 1, workspaces: [{ ...entry, root: `/${"x".repeat(MAX_ROOT_LENGTH)}` }] }),
      JSON.stringify({ format: 1, workspaces: [{ ...entry, key: "" }] }),
      JSON.stringify({ format: 1, workspaces: [{ ...entry, key: 1 }] }),
      JSON.stringify({ format: 1, workspaces: [{ ...entry, opened: "yesterday" }] }),
      JSON.stringify({ format: 1, workspaces: [{ ...entry, opened: 1 }] }),
      `{"format":1,"workspaces":[],"pad":"${"x".repeat(RECENT_WORKSPACES_MAX_BYTES)}"}`,
    ]) {
      await write(text);
      expect(await readRecentWorkspaces(environment), text.slice(0, 80)).toEqual([]);
    }
    // A folder where the file should be cannot be read: empty too.
    await fs.rm(listFile());
    await fs.mkdir(listFile());
    expect(await readRecentWorkspaces(environment)).toEqual([]);
    await fs.rm(listFile(), { recursive: true });
    // The next open overwrites a broken file.
    await write("not json");
    await rememberWorkspace(a, { environment, now: at(1) });
    expect(await roots()).toEqual([a]);
    // A key listed twice counts once, and a foreign list keeps at most 20 entries.
    const many = Array.from({ length: 25 }, (_, n) => ({ ...entry, key: `k${String(n % 23)}` }));
    expect(parseRecentWorkspaces(JSON.stringify({ format: 1, workspaces: many }))).toHaveLength(20);
    expect(
      parseRecentWorkspaces(JSON.stringify({ format: 1, workspaces: [entry, { ...entry, root: `${a}2` }] })),
    ).toEqual([entry]);
    expect(parseRecentWorkspaces(undefined)).toEqual([]);
    // Absolute as the platform of the list says.
    const windows = JSON.stringify({ format: 1, workspaces: [{ ...entry, root: "C:\\Work" }] });
    expect(parseRecentWorkspaces(windows, "linux")).toEqual([]);
    expect(parseRecentWorkspaces(windows, "win32")).toEqual([{ ...entry, root: "C:\\Work" }]);
  });

  it("leaves out the oldest entries while the file would be larger than 64 KiB", async () => {
    for (let n = 0; n < RECENT_WORKSPACES_KEEP; n++) {
      const root = path.join(top, `${String(n).padStart(2, "0")}${"x".repeat(4000)}`);
      await rememberWorkspace(root, { environment, now: at(n), key: `k${String(n)}` });
    }
    const list = await readRecentWorkspaces(environment);
    expect((await fs.stat(listFile())).size).toBeLessThanOrEqual(RECENT_WORKSPACES_MAX_BYTES);
    expect(list.length).toBeLessThan(RECENT_WORKSPACES_KEEP);
    expect(list.length).toBeGreaterThan(5);
    expect(list[0]?.key).toBe(`k${String(RECENT_WORKSPACES_KEEP - 1)}`);
  });

  it("a held lock skips the record after one wait, and a file that cannot be written rejects", async () => {
    const a = await folder("a");
    const listFolder = recentWorkspacesFolder(environment);
    const lock = await lockCacheFile(listFolder, RECENT_WORKSPACES_FILE);
    expect(await rememberWorkspace(a, { environment })).toBe(false);
    expect(await roots()).toEqual([]);
    // Given back while the record waits: it records.
    const waiting = rememberWorkspace(a, { environment });
    setTimeout(() => {
      void lock?.release();
    }, 20);
    expect(await waiting).toBe(true);
    expect(await roots()).toEqual([a]);
    // A folder in place of the file: it cannot be read or replaced, and the record rejects.
    await fs.rm(listFile());
    await fs.mkdir(path.join(listFile(), "inside"), { recursive: true });
    await expect(rememberWorkspace(a, { environment })).rejects.toThrow();
    // The lock was given back all the same.
    await fs.rm(listFile(), { recursive: true });
    expect(await rememberWorkspace(a, { environment })).toBe(true);
    // A root that is no absolute path of at most 4096 characters is not recorded.
    expect(await rememberWorkspace("relative", { environment })).toBe(false);
    expect(await rememberWorkspace(`/${"x".repeat(MAX_ROOT_LENGTH)}`, { environment })).toBe(false);
    expect(await roots()).toEqual([a]);
  });
});

describe("existence of the recent workspaces", () => {
  it("[SR-131/AK4] recentWorkspaceStates marks a root without logreq-workspace.yaml as missing and does not look upwards", async () => {
    const present = await folder("present");
    // A folder inside a workspace, whose own workspace file is gone: the workspace above does not count.
    const inside = await folder("present/requirements", false);
    const gone = path.join(top, "gone");
    const notAFile = await folder("not-a-file", false);
    await fs.mkdir(path.join(notAFile, WORKSPACE_FILE));
    for (const [minute, root] of [present, inside, gone, notAFile].entries()) {
      await rememberWorkspace(root, { environment, now: at(minute) });
    }
    expect(
      (await recentWorkspaceStates({ environment })).map(({ root, exists }) => [path.basename(root), exists]),
    ).toEqual([
      ["not-a-file", false],
      ["gone", false],
      ["requirements", false],
      ["present", true],
    ]);
    expect(await workspaceExists(present)).toBe(true);
    expect(await workspaceExists(inside)).toBe(false);
    // An own checker is used when given.
    const check: ExistenceChecker = (list) => Promise.resolve(list.map(() => true));
    expect((await recentWorkspaceStates({ environment, check })).every((state) => state.exists)).toBe(true);
    expect(await workspaceExists(gone, check)).toBe(true);
  });

  it("a check that does not answer within 1 s counts as missing, and at most 2 checks run at once", async () => {
    vi.useFakeTimers();
    type Answer = { isFile(): boolean } | Error;
    const asked: string[] = [];
    const answers = new Map<string, (answer: Answer) => void>();
    const stat = (file: string): Promise<{ isFile(): boolean }> => {
      const root = path.basename(path.dirname(file));
      asked.push(root);
      return new Promise((resolve, reject) => {
        answers.set(root, (answer) => {
          if (answer instanceof Error) {
            reject(answer);
          } else {
            resolve(answer);
          }
        });
      });
    };
    const answer = async (root: string, value: Answer): Promise<void> => {
      answers.get(root)?.(value);
      await vi.advanceTimersByTimeAsync(0);
    };
    const file = { isFile: () => true };
    const check = createExistenceChecker({ stat });
    const result = vi.fn();
    void check(["a", "b", "c", "d", "e"].map((name) => path.join(top, name))).then(result);
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(["a", "b"]);
    // A slot is freed when its stat returns.
    await answer("a", file);
    expect(asked).toEqual(["a", "b", "c"]);
    await answer("c", new Error("ENOENT"));
    expect(asked).toEqual(["a", "b", "c", "d"]);
    // b and d hang: 1 s after the call the rest counts as missing, and e gets no stat.
    await vi.advanceTimersByTimeAsync(990);
    expect(result).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(result).toHaveBeenCalledExactlyOnceWith([true, false, false, false, false]);
    // A later call while both slots hang: its own second counts from its call; f gets no stat.
    const later = vi.fn();
    void check([path.join(top, "f")]).then(later);
    await vi.advanceTimersByTimeAsync(999);
    expect(later).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(later).toHaveBeenCalledExactlyOnceWith([false]);
    expect(asked).toEqual(["a", "b", "c", "d"]);
    // b answers at last: its slot is free, the answer changes nothing that was given.
    await answer("b", file);
    expect(result).toHaveBeenCalledOnce();
    const next = vi.fn();
    void check([path.join(top, "g")]).then(next);
    await vi.advanceTimersByTimeAsync(0);
    expect(asked).toEqual(["a", "b", "c", "d", "g"]);
    await answer("g", { isFile: () => false });
    expect(next).toHaveBeenCalledExactlyOnceWith([false]);
    // No roots: answered at once.
    expect(await check([])).toEqual([]);
  });
});
