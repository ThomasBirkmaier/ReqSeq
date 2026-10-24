import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { removePrivateFile, writePrivateFile } from "./private.js";
import { isTempFile } from "./write.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-private-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

const posix = process.platform !== "win32";

describe("writePrivateFile", () => {
  it("creates missing folders and writes the file readable by the owner only", async () => {
    const file = path.join(root, "a", "b", "api.json");
    await writePrivateFile(file, "{}\n");
    expect(await fs.readFile(file, "utf8")).toBe("{}\n");
    if (posix) {
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
      expect((await fs.stat(path.join(root, "a", "b"))).mode & 0o777).toBe(0o700);
    }
    expect((await fs.readdir(path.dirname(file))).filter(isTempFile)).toEqual([]);
  });

  it("replaces an existing file atomically", async () => {
    const file = path.join(root, "api.json");
    await fs.writeFile(file, "old", { mode: 0o644 });
    await writePrivateFile(file, "new");
    expect(await fs.readFile(file, "utf8")).toBe("new");
    if (posix) {
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    }
  });

  it("removes its temp file and rejects when the rename fails", async () => {
    const file = path.join(root, "api.json");
    vi.spyOn(fs, "rename").mockRejectedValue(Object.assign(new Error("no"), { code: "EIO" }));
    await expect(writePrivateFile(file, "x")).rejects.toThrow("no");
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("passes the error on even when the temp file cannot be removed", async () => {
    const file = path.join(root, "api.json");
    vi.spyOn(fs, "rename").mockRejectedValue(Object.assign(new Error("no"), { code: "EIO" }));
    vi.spyOn(fs, "rm").mockRejectedValue(new Error("rm failed"));
    await expect(writePrivateFile(file, "x")).rejects.toThrow("no");
  });

  it("rejects when the folder cannot be created", async () => {
    await fs.writeFile(path.join(root, "file"), "");
    await expect(writePrivateFile(path.join(root, "file", "api.json"), "x")).rejects.toMatchObject({
      code: expect.stringMatching(/^(EEXIST|ENOTDIR)$/) as unknown,
    });
  });
});

describe("removePrivateFile", () => {
  it("removes the file, and is fine when there is none", async () => {
    const file = path.join(root, "api.json");
    await writePrivateFile(file, "{}\n");
    await removePrivateFile(file);
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(removePrivateFile(file)).resolves.toBeUndefined();
  });
});
