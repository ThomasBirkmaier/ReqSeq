import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
