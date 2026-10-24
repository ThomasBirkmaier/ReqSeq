import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFolder } from "./folder.js";

let root: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-folder-")));
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
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-outside-"));
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
