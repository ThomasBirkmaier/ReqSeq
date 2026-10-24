import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FixtureWorkspace } from "@logreq/testkit";
import { cloneFixtureWorkspace, createFixtureWorkspace } from "@logreq/testkit";
import { afterEach, describe, expect, it } from "vitest";
import {
  cacheFolder,
  canonicalRoot,
  lockCacheFile,
  osCacheFolder,
  readCacheFile,
  removeCacheFile,
  writeCacheFile,
} from "./cache.js";

const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

describe("osCacheFolder", () => {
  it("uses LOCALAPPDATA on Windows, else the AppData folder of the profile", () => {
    const home = "C:\\Users\\ada";
    expect(osCacheFolder({ platform: "win32", env: { LOCALAPPDATA: "D:\\Local" }, home })).toBe("D:\\Local");
    expect(osCacheFolder({ platform: "win32", env: {}, home })).toBe("C:\\Users\\ada\\AppData\\Local");
    expect(osCacheFolder({ platform: "win32", env: { LOCALAPPDATA: "relative" }, home })).toBe(
      "C:\\Users\\ada\\AppData\\Local",
    );
  });

  it("uses ~/Library/Caches on macOS, whatever XDG_CACHE_HOME says", () => {
    expect(osCacheFolder({ platform: "darwin", env: { XDG_CACHE_HOME: "/x" }, home: "/Users/ada" })).toBe(
      "/Users/ada/Library/Caches",
    );
  });

  it("uses an absolute XDG_CACHE_HOME elsewhere, else ~/.cache", () => {
    expect(osCacheFolder({ platform: "linux", env: { XDG_CACHE_HOME: "/var/c" }, home: "/home/ada" })).toBe(
      "/var/c",
    );
    expect(osCacheFolder({ platform: "linux", env: { XDG_CACHE_HOME: "c" }, home: "/home/ada" })).toBe(
      "/home/ada/.cache",
    );
    expect(osCacheFolder({ platform: "freebsd", env: {}, home: "/home/ada" })).toBe("/home/ada/.cache");
  });

  it("defaults to the environment of this process", () => {
    expect(path.isAbsolute(osCacheFolder())).toBe(true);
  });
});

describe("cacheFolder", () => {
  it("is logreq/<sha256 of the absolute root> in the OS cache folder, one per working copy", () => {
    const environment = { platform: "linux" as const, env: {}, home: "/home/ada" };
    expect(cacheFolder("/work/copy-1", environment)).toBe(`/home/ada/.cache/logreq/${sha("/work/copy-1")}`);
    expect(cacheFolder("/work/copy-1/", environment)).toBe(cacheFolder("/work/copy-1", environment));
    expect(cacheFolder("/work/copy-2", environment)).not.toBe(cacheFolder("/work/copy-1", environment));
  });

  it("hashes Windows paths as Windows resolves them, in lower case", () => {
    const environment = { platform: "win32" as const, env: { LOCALAPPDATA: "C:\\L" }, home: "C:\\U" };
    expect(cacheFolder("C:\\Work\\Copy", environment)).toBe(`C:\\L\\logreq\\${sha("c:\\work\\copy")}`);
    expect(cacheFolder("c:\\WORK\\copy\\", environment)).toBe(cacheFolder("C:\\Work\\Copy", environment));
  });

  it.skipIf(process.platform === "win32")(
    "gives a folder reached through a symbolic link the cache folder of the folder itself",
    async () => {
      // Windows needs extra rights for symbolic links; canonicalRoot uses the same realpath there.
      const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-cache-root-")));
      try {
        const real = path.join(base, "copy");
        await fs.mkdir(real);
        await fs.symlink(real, path.join(base, "link"));
        expect(canonicalRoot(path.join(base, "link"))).toBe(real);
        expect(cacheFolder(path.join(base, "link"))).toBe(cacheFolder(real));
      } finally {
        await fs.rm(base, { recursive: true, force: true });
      }
    },
  );

  it("defaults to the environment of this process and resolves the root", () => {
    expect(cacheFolder(".")).toBe(cacheFolder(process.cwd()));
  });
});

/**
 * Where two working copies could share a cache folder by mistake, or one copy could get two (SR-081 AK2).
 * These tests run on every OS and check what its file system does: case and Unicode normalisation are
 * ignored by NTFS and APFS (as formatted by default), not by ext4.
 */
describe("cache folders of separate working copies (SR-081)", () => {
  const made: FixtureWorkspace[] = [];
  afterEach(async () => {
    await Promise.all(made.splice(0).map((ws) => ws.cleanup()));
  });
  const make = async <T extends FixtureWorkspace>(ws: Promise<T>): Promise<T> => {
    made.push(await ws);
    return ws;
  };

  /** Whether two paths name one existing folder (same device and inode, or file index on Windows). */
  const sameFolder = async (a: string, b: string): Promise<boolean> => {
    try {
      const [one, two] = await Promise.all([fs.stat(a, { bigint: true }), fs.stat(b, { bigint: true })]);
      return one.dev === two.dev && one.ino === two.ino;
    } catch {
      return false;
    }
  };

  it("[SR-081/AK2] gives two clones of one repository their own cache folders, outside both copies", async () => {
    const origin = await make(createFixtureWorkspace({ files: { "a.md": "a" }, git: true }));
    const one = await make(cloneFixtureWorkspace(origin));
    const two = await make(cloneFixtureWorkspace(origin));
    expect(cacheFolder(one.root)).not.toBe(cacheFolder(two.root));
    for (const copy of [one, two]) {
      for (const folder of [cacheFolder(one.root), cacheFolder(two.root)]) {
        // Outside: a relative path that leaves the copy, or an absolute one (another drive on Windows).
        const relative = path.relative(copy.root, folder);
        expect(relative.startsWith("..") || path.isAbsolute(relative)).toBe(true);
      }
    }
  });

  it("[SR-081/AK2] follows a copy that was moved, and gives a new copy at the old path the old path's folder", async () => {
    const origin = await make(createFixtureWorkspace({ files: { "a.md": "a" }, git: true }));
    const copy = await make(cloneFixtureWorkspace(origin));
    const before = cacheFolder(copy.root);
    // Next to the root, inside the fixture's temporary folder: cleanup removes it.
    const moved = `${copy.root}-moved`;
    await fs.rename(copy.root, moved);
    // The cache belongs to the path: the moved copy gets a new folder, and a new copy at the old path
    // takes over the old one (ADR-0008). So every cache content is checked against the files.
    expect(cacheFolder(moved)).not.toBe(before);
    await fs.mkdir(copy.root);
    await copy.git(["clone", "--quiet", origin.root, "."]);
    expect(cacheFolder(copy.root)).toBe(before);
  });

  it("[SR-081/AK2] gives a copy named in another case one cache folder where the file system ignores case", async () => {
    const ws = await make(createFixtureWorkspace({ files: { "Working-Copy/a.md": "a" } }));
    const real = ws.path("Working-Copy");
    const other = ws.path("wORKING-cOPY");
    // The file system decides; on CI (NTFS, APFS as formatted by default, ext4) the platform is known,
    // so CI proves that the branch for one folder runs on Windows and macOS.
    const same = await sameFolder(real, other);
    if (process.env["CI"] !== undefined) {
      expect(same).toBe(process.platform === "win32" || process.platform === "darwin");
    }
    if (same) {
      expect(canonicalRoot(other)).toBe(canonicalRoot(real));
      expect(cacheFolder(other)).toBe(cacheFolder(real));
    } else {
      // Two names, two folders (or none): never one cache folder.
      expect(cacheFolder(other)).not.toBe(cacheFolder(real));
    }
  });

  it("[SR-081/AK2] gives a copy named in another Unicode normal form one cache folder where the file system ignores it", async () => {
    const nfc = `Kopie-${String.fromCodePoint(0xe9)}`;
    const nfd = `Kopie-e${String.fromCodePoint(0x301)}`;
    expect(nfc).not.toBe(nfd);
    expect(nfc.normalize("NFD")).toBe(nfd);
    const ws = await make(createFixtureWorkspace({ files: { [`${nfc}/a.md`]: "a" } }));
    const real = ws.path(nfc);
    const other = ws.path(nfd);
    // APFS ignores the normal form of names; NTFS and ext4 keep NFC and NFD apart. The file system
    // decides; CI, where the platform's file system is known, also checks that.
    const same = await sameFolder(real, other);
    if (process.env["CI"] !== undefined) {
      expect(same).toBe(process.platform === "darwin");
    }
    if (same) {
      expect(canonicalRoot(other)).toBe(canonicalRoot(real));
      expect(cacheFolder(other)).toBe(cacheFolder(real));
    } else {
      expect(cacheFolder(other)).not.toBe(cacheFolder(real));
    }
  });
});

describe("writeCacheFile", () => {
  let folder: string | undefined;
  afterEach(async () => {
    if (folder !== undefined) {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });

  it("writes a private file into the folder, creating it, and returns its path", async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-cache-"));
    const target = path.join(folder, "logreq", "abc");
    const file = await writeCacheFile(target, "api.json", '{"port":1}\n');
    expect(file).toBe(path.join(target, "api.json"));
    expect(await fs.readFile(file, "utf8")).toBe('{"port":1}\n');
  });

  it("refuses names that are not plain cache file names", async () => {
    for (const name of ["../api.json", "a/b.json", "API.json", "api.txt", ".json"]) {
      await expect(writeCacheFile("/nowhere", name, "")).rejects.toThrow(/not a cache file name/);
      await expect(readCacheFile("/nowhere", name)).rejects.toThrow(/not a cache file name/);
      await expect(removeCacheFile("/nowhere", name)).rejects.toThrow(/not a cache file name/);
      await expect(lockCacheFile("/nowhere", name)).rejects.toThrow(/not a cache file name/);
    }
  });

  it("reads a cache file back, gives undefined when there is none, and removes it", async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-cache-"));
    expect(await readCacheFile(folder, "api.json")).toBeUndefined();
    await writeCacheFile(folder, "api.json", "{}\n");
    expect(await readCacheFile(folder, "api.json")).toBe("{}\n");
    await removeCacheFile(folder, "api.json");
    expect(await readCacheFile(folder, "api.json")).toBeUndefined();
    await expect(removeCacheFile(folder, "api.json")).resolves.toBeUndefined();
  });

  it("locks a cache file with <name>.lock next to it, once at a time", async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-cache-"));
    const lock = await lockCacheFile(folder, "api.json");
    expect(lock?.file).toBe(path.join(folder, "api.json.lock"));
    expect(await lockCacheFile(folder, "api.json")).toBeUndefined();
    await lock?.release();
    await expect(fs.stat(path.join(folder, "api.json.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("gives undefined when a folder on the path is a file", async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-cache-"));
    await fs.writeFile(path.join(folder, "file"), "");
    expect(await readCacheFile(path.join(folder, "file"), "api.json")).toBeUndefined();
  });

  it("rejects with the Node error when a cache file cannot be read", async () => {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-cache-"));
    await fs.mkdir(path.join(folder, "api.json"));
    await expect(readCacheFile(folder, "api.json")).rejects.toMatchObject({
      code: expect.stringMatching(/^(EISDIR|EPERM|EACCES)$/) as unknown,
    });
  });
});
