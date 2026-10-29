import { constants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { isWritableFolder } from "./writable.js";

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

const tempFolder = async (): Promise<string> => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-writable-"));
  onTestFinished(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
};

afterEach(() => {
  vi.restoreAllMocks();
});

// The access() cases name a POSIX platform, so they run the same on every OS of the CI matrix.
describe("isWritableFolder", () => {
  it("is true for a folder this process may write", async () => {
    expect(await isWritableFolder(await tempFolder(), "linux")).toBe(true);
  });

  it("asks the operating system for write access to the folder", async () => {
    const folder = await tempFolder();
    const access = vi.spyOn(fs, "access");
    await isWritableFolder(folder, "linux");
    expect(access).toHaveBeenCalledWith(folder, constants.W_OK);
  });

  it.each([
    ["EROFS", "a read-only file system"],
    ["EACCES", "a folder without write permission"],
    ["ENOENT", "a folder that vanished"],
  ])("is false for %s (%s)", async (code) => {
    const folder = await tempFolder();
    vi.spyOn(fs, "access").mockRejectedValueOnce(errno(code));
    expect(await isWritableFolder(folder, "linux")).toBe(false);
  });

  it("is unknown on Windows, where access never reports a folder as read-only", async () => {
    const access = vi.spyOn(fs, "access");
    expect(await isWritableFolder(await tempFolder(), "win32")).toBeUndefined();
    expect(access).not.toHaveBeenCalled();
  });
});
