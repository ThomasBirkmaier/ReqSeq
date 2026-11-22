import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFolder, createFolders, removeEmptyFolders } from "./folder.js";

let root: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-folder-")));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

const abs = (rel: string): string => path.join(root, rel);
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

describe("createFolder", () => {
  it("creates a folder with the missing folders above it and keeps an existing one", async () => {
    expect(await createFolder(root, "a/b/c")).toBe("a/b/c");
    expect((await fs.stat(abs("a/b/c"))).isDirectory()).toBe(true);
    await fs.writeFile(abs("a/b/c/keep.txt"), "x");
    expect(await createFolder(root, "./a/b/../b/c/")).toBe("a/b/c");
    expect(await fs.readdir(abs("a/b/c"))).toEqual(["keep.txt"]);
  });

  it("refuses paths outside the root and the root itself", async () => {
    for (const p of ["..", "../x", "", ".", path.join(root, "a")]) {
      await expect(createFolder(root, p)).rejects.toMatchObject({ code: "input.invalid" });
    }
  });

  it("refuses a folder linked outside the root and creates nothing there", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-outside-"));
    try {
      await fs.symlink(outside, abs("linked"), "junction");
      await expect(createFolder(root, "linked/new")).rejects.toMatchObject({
        code: "input.invalid",
        message: "Not created: folder linked/new is linked outside the workspace",
      });
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses a file in the way", async () => {
    await fs.writeFile(abs("file"), "x");
    for (const p of ["file", "file/below"]) {
      await expect(createFolder(root, p)).rejects.toMatchObject({ code: "file.not-regular" });
    }
  });

  it("maps a folder that is not writable to file.read-only and other failures to internal", async () => {
    vi.spyOn(fs, "mkdir").mockRejectedValueOnce(errno("EACCES"));
    await expect(createFolder(root, "a")).rejects.toMatchObject({
      code: "file.read-only",
      message: "Not created: folder a; the folder above it is not writable (EACCES)",
    });
    vi.spyOn(fs, "mkdir").mockRejectedValueOnce(errno("EIO"));
    await expect(createFolder(root, "a")).rejects.toMatchObject({ code: "internal" });
    vi.spyOn(fs, "lstat").mockRejectedValueOnce(errno("EACCES"));
    await expect(createFolder(root, "a")).rejects.toMatchObject({ code: "file.read-only" });
  });
});

describe("createFolders and removeEmptyFolders (SR-235 AK10, SR-207 AK7)", () => {
  it("creates each folder below the one before, and on a failure removes the ones it created", async () => {
    expect(await createFolders([abs("a"), abs("a/b")])).toEqual([abs("a"), abs("a/b")]);
    await fs.writeFile(abs("a/b/file"), "x");
    // A file took the place of the third folder: the two before it go again.
    const error = await createFolders([abs("x"), abs("x/y"), abs("a/b/file")]).catch((e: unknown) => e);
    expect((error as { code: string }).code).toBe("file.not-regular");
    expect(await fs.readdir(root)).toEqual(["a"]);
  });

  it("removes each folder that is empty, the deepest first, and keeps one that holds anything", async () => {
    await fs.mkdir(abs("a/b/c"), { recursive: true });
    await fs.mkdir(abs("k/l"), { recursive: true });
    await fs.writeFile(abs("k/mine"), "x");
    await removeEmptyFolders([abs("a"), abs("a/b"), abs("a/b/c"), abs("k"), abs("k/l"), abs("gone")]);
    expect((await fs.readdir(root)).sort()).toEqual(["k"]);
    expect(await fs.readdir(abs("k"))).toEqual(["mine"]);
  });
});
