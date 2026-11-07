import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LINKED_OUTSIDE, listFolderFiles } from "./list-folder.js";

let root: string;
let outside: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-list-")));
  outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-away-")));
  await fs.writeFile(path.join(outside, "a.yaml"), "x");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

describe("listFolderFiles with the repository it lies in (#294)", () => {
  it("refuses a folder linked out of the repository before it lists it", async () => {
    await fs.symlink(outside, path.join(root, "linked"), "junction");
    const readdir = vi.spyOn(fs, "readdir");
    expect(await listFolderFiles(path.join(root, "linked"), root)).toEqual({
      kind: "error",
      reason: LINKED_OUTSIDE,
    });
    expect(readdir).not.toHaveBeenCalled();
    expect(await listFolderFiles(path.join(root, "linked"))).toMatchObject({
      kind: "names",
      names: ["a.yaml"],
    });
  });

  it("lists a folder inside the repository as before", async () => {
    await fs.mkdir(path.join(root, "real"));
    await fs.writeFile(path.join(root, "real", "b.yaml"), "x");
    expect(await listFolderFiles(path.join(root, "real"), root)).toMatchObject({ names: ["b.yaml"] });
    expect(await listFolderFiles(path.join(root, "gone"), root)).toEqual({ kind: "missing" });
  });
});
