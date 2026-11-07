// The entries of the folder of a typed path (`list-folder.ts`, SR-143). Not tagged with SR-143 AKs: they
// describe the app's command prompt, whose tests show them.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FolderDirent } from "./list-folder.js";
import { LIST_TIMEOUT_MS, listFolder, listTypedFolder, splitTypedPath } from "./list-folder.js";
import { createBoundedRunner, createWorkspaceChecks, typedPathRun } from "./recent.js";

let top = "";

beforeEach(async () => {
  top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-list-folder-")));
});

afterEach(async () => {
  vi.useRealTimers();
  await fs.rm(top, { recursive: true, force: true, maxRetries: 3 });
});

/** Folders (ending in `/`) and files below `top`. */
const make = async (...names: string[]): Promise<void> => {
  for (const name of names) {
    const at = path.join(top, name);
    if (name.endsWith("/")) {
      await fs.mkdir(at, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(at), { recursive: true });
      await fs.writeFile(at, "");
    }
  }
};

const dirent = (name: string, kind: "dir" | "file" | "link" | "socket"): FolderDirent => ({
  name,
  isDirectory: () => kind === "dir",
  isFile: () => kind === "file",
  isSymbolicLink: () => kind === "link",
});

/** An `opendir` that gives `entries`, or rejects with `code`. */
const fakeDir =
  (entries: readonly FolderDirent[], code?: string) => (): Promise<AsyncIterable<FolderDirent>> =>
    code === undefined
      ? Promise.resolve(Readable.from(entries))
      : Promise.reject(Object.assign(new Error(code), { code }));

describe("the folder of a typed path", () => {
  it("splits at the last separator, and at a backslash only on Windows", () => {
    expect(splitTypedPath("~/pro", "linux")).toEqual({ folder: "~/", name: "pro" });
    expect(splitTypedPath("/", "linux")).toEqual({ folder: "/", name: "" });
    expect(splitTypedPath("pro", "linux")).toEqual({ folder: "", name: "pro" });
    expect(splitTypedPath("a\\b", "linux")).toEqual({ folder: "", name: "a\\b" });
    expect(splitTypedPath("C:\\Work/x\\sp", "win32")).toEqual({ folder: "C:\\Work/x\\", name: "sp" });
    expect(splitTypedPath("C:/Work\\x/sp", "win32")).toEqual({ folder: "C:/Work\\x/", name: "sp" });
    expect(splitTypedPath("x/y").name).toBe("y");
  });

  it("lists folders and links first, then files, by name; dot names only when asked; never follows a link", async () => {
    await make("b/", "A/", "é/", "z.txt", "a.txt", ".hidden/", ".env");
    await fs.symlink(path.join(top, "missing"), path.join(top, "dangling"), "junction");
    await fs.symlink(path.join(top, "b"), path.join(top, "c-link"), "junction");
    expect(await listFolder(top, { files: true, dots: false })).toEqual({
      entries: [
        { name: "A", kind: "folder" },
        { name: "b", kind: "folder" },
        { name: "c-link", kind: "link" },
        { name: "dangling", kind: "link" },
        { name: "é", kind: "folder" },
        { name: "a.txt", kind: "file" },
        { name: "z.txt", kind: "file" },
      ],
    });
    expect((await listFolder(top, { files: false, dots: true })).entries.map((e) => e.name)).toEqual([
      ".hidden",
      "A",
      "b",
      "c-link",
      "dangling",
      "é",
    ]);
  });

  it("sorts by the NFC form, keeps the spelling on disk, and leaves out sockets and devices", async () => {
    const decomposed = "U\u0308ber";
    const listing = await listFolder("/x", {
      files: true,
      dots: false,
      opendir: fakeDir([
        dirent("Zeta", "dir"),
        dirent(decomposed, "dir"),
        dirent("\u00dcber", "dir"),
        dirent("Ab", "dir"),
        dirent("Ab", "file"),
        dirent("sock", "socket"),
      ]),
    });
    expect(listing.entries).toEqual([
      { name: "Ab", kind: "folder" },
      { name: "Zeta", kind: "folder" },
      { name: decomposed, kind: "folder" },
      { name: "\u00dcber", kind: "folder" },
      { name: "Ab", kind: "file" },
    ]);
  });

  it("says missing for a folder that is not there, unreadable for a file and for other errors", async () => {
    await make("file.txt");
    expect(await listFolder(path.join(top, "gone"), { files: true, dots: false })).toEqual({
      entries: [],
      problem: "missing",
    });
    expect(await listFolder(path.join(top, "file.txt"), { files: true, dots: false })).toEqual({
      entries: [],
      problem: "unreadable",
    });
    for (const code of ["EACCES", "EPERM", "EIO"]) {
      expect(await listFolder("/x", { files: true, dots: false, opendir: fakeDir([], code) })).toEqual({
        entries: [],
        problem: "unreadable",
      });
    }
  });

  it("lists at most maxEntries and says truncated", async () => {
    const entries = ["d", "c", ".x", "b", "a"].map((name) => dirent(name, "dir"));
    const opendir = fakeDir(entries);
    expect(await listFolder("/x", { files: true, dots: false, opendir, maxEntries: 3 })).toEqual({
      entries: ["b", "c", "d"].map((name) => ({ name, kind: "folder" })),
      truncated: true,
    });
    expect((await listFolder("/x", { files: true, dots: false, opendir, maxEntries: 4 })).truncated).toBe(
      undefined,
    );
    // Folders first when cut: files read before folders give way to them.
    const mixed = fakeDir([
      dirent("f1", "file"),
      dirent("a", "dir"),
      dirent("f2", "file"),
      dirent("b", "link"),
      dirent("f3", "file"),
    ]);
    const cut = async (maxEntries: number): Promise<unknown> =>
      listFolder("/x", { files: true, dots: false, opendir: mixed, maxEntries });
    expect(await cut(2)).toEqual({
      entries: [
        { name: "a", kind: "folder" },
        { name: "b", kind: "link" },
      ],
      truncated: true,
    });
    expect(await cut(3)).toEqual({
      entries: [
        { name: "a", kind: "folder" },
        { name: "b", kind: "link" },
        { name: "f1", kind: "file" },
      ],
      truncated: true,
    });
  });

  it("can run in the slot for typed paths of a process, which the folders of a typed path share", async () => {
    const checks = createWorkspaceChecks({ timeoutMs: 50 });
    let release: () => void = () => undefined;
    const hung = vi.fn(
      () =>
        new Promise<AsyncIterable<FolderDirent>>((resolve) => {
          release = () => {
            resolve(Readable.from([]));
          };
        }),
    );
    const listing = listFolder("/nfs", {
      files: false,
      dots: false,
      run: checks.typedRun,
      opendir: hung,
      timeoutMs: 50,
    });
    // While the listing holds the one slot, a typed path gets no answer in time.
    expect(await checks.typed([top])).toEqual(["timeout"]);
    release();
    expect(await listing).toEqual({ entries: [], problem: "unreadable" });
    expect(typedPathRun).toBeTypeOf("function");
  });

  it("a folder without an answer is unreadable after the timeout and holds only the listing slot", async () => {
    vi.useFakeTimers();
    const run = createBoundedRunner(1);
    let release: () => void = () => undefined;
    const hung = (): Promise<AsyncIterable<FolderDirent>> =>
      new Promise((resolve) => {
        release = () => {
          resolve(Readable.from([dirent("late", "dir"), dirent("later", "dir")]));
        };
      });
    const opendir = vi.fn(hung);
    const first = listFolder("/nfs", { files: false, dots: false, run, opendir });
    const second = listFolder("/nfs/b", { files: false, dots: false, run, opendir });
    await vi.advanceTimersByTimeAsync(LIST_TIMEOUT_MS);
    expect(await first).toEqual({ entries: [], problem: "unreadable" });
    expect(await second).toEqual({ entries: [], problem: "unreadable" });
    // The second never started: the one slot was still held.
    expect(opendir).toHaveBeenCalledTimes(1);
    // When the hung folder answers late, the listing stops reading and frees the slot.
    release();
    await vi.advanceTimersByTimeAsync(0);
    const third = listFolder("/x", {
      files: false,
      dots: false,
      run,
      opendir: fakeDir([dirent("a", "dir")]),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(await third).toEqual({ entries: [{ name: "a", kind: "folder" }] });
  });

  it("lists the folder of a typed path from the base, or absolute with ~ for home", async () => {
    await make("ws/out/", "ws/.git/", "ws/a.reqif", "home/projects/");
    const base = path.join(top, "ws");
    const home = path.join(top, "home");
    expect(await listTypedFolder("o", { files: false, home, base })).toEqual({
      folder: base,
      name: "o",
      entries: [{ name: "out", kind: "folder" }],
    });
    expect((await listTypedFolder(".g", { files: true, home, base })).entries).toEqual([
      { name: ".git", kind: "folder" },
      { name: "out", kind: "folder" },
      { name: "a.reqif", kind: "file" },
    ]);
    expect(await listTypedFolder("~/pro", { files: false, home })).toEqual({
      folder: home,
      name: "pro",
      entries: [{ name: "projects", kind: "folder" }],
    });
    // Without a base, a relative path is refused by its text; `~` for home only then.
    expect(await listTypedFolder("out/", { files: false, home })).toEqual({
      name: "",
      entries: [],
      problem: "invalid",
    });
    expect((await listTypedFolder("~/", { files: false, home, base })).problem).toBe("missing");
  });

  it("passes the folder through the check before it lists it", async () => {
    await make("ws/out/");
    const check = vi.fn(() => Promise.reject(new Error("outside")));
    await expect(
      listTypedFolder(`${top}/ws/`, { files: false, home: top, base: top, check }),
    ).rejects.toThrow("outside");
    expect(check).toHaveBeenCalledExactlyOnceWith(path.join(top, "ws"));
  });
});
