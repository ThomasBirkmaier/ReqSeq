// The folder of an export (SR-235 AK1, AK2, AK6): what opening it refuses, the lock, the writes the
// staging refuses, and what happens when putting the files in place or cleaning up fails.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../catalog.js";
import type { MarkerSpec } from "./export-folder.js";
import { openExportFolder, STAGING_FOLDER } from "./export-folder.js";

const SPEC: MarkerSpec = { file: "marker.yaml", key: "test-export", comment: "Test." };

const temp = async (): Promise<string> => {
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-export-folder-")));
  onTestFinished(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
};

const write = async (file: string, text: string): Promise<void> => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
};

const refusal = async (promise: Promise<unknown>): Promise<CommandError> => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

/** A target holding an earlier export with `files`, the marker naming them. */
const earlier = async (
  files: Readonly<Record<string, string>>,
  entries: readonly unknown[] = Object.keys(files),
) => {
  const root = await temp();
  const target = path.join(root, "site");
  for (const [file, text] of Object.entries(files)) {
    await write(path.join(target, file), text);
  }
  await write(
    path.join(target, SPEC.file),
    `test-export: 1\nfiles:\n${entries.map((e) => `  - ${JSON.stringify(e)}`).join("\n")}\n`,
  );
  return target;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("openExportFolder refuses (SR-235 AK1)", () => {
  it("a target that is no folder, a missing folder above it, and a marker it cannot read", async () => {
    const root = await temp();
    await write(path.join(root, "file"), "x");
    expect((await refusal(openExportFolder(path.join(root, "file"), SPEC))).code).toBe("file.not-regular");
    expect((await refusal(openExportFolder(path.join(root, "no/site"), SPEC))).code).toBe(
      "file.folder-missing",
    );
    const target = path.join(root, "site");
    await write(path.join(target, SPEC.file), "a: [");
    expect((await refusal(openExportFolder(target, SPEC))).message).toMatch(
      /^Not exported: the marker file marker\.yaml is no YAML: /,
    );
    for (const text of ["test-export: 2\nfiles: []\n", "just text\n", "test-export: 1\nfiles: {}\n"]) {
      await write(path.join(target, SPEC.file), text);
      expect((await refusal(openExportFolder(target, SPEC))).message).toBe(
        "Not exported: the marker file marker.yaml is not one of this version (test-export: 1 with files)",
      );
    }
    await fs.rm(path.join(target, SPEC.file));
    await fs.symlink(path.join(root, "file"), path.join(target, SPEC.file));
    expect((await refusal(openExportFolder(target, SPEC))).message).toMatch(
      /^Not exported: the marker file marker\.yaml cannot be read: /,
    );
  });

  it("passes on an error other than a missing target, and removes a target it created when it fails", async () => {
    const root = await temp();
    const target = path.join(root, "site");
    const stat = fs.stat.bind(fs);
    vi.spyOn(fs, "stat").mockImplementation(async (p, o) => {
      if (String(p) === target) {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      }
      return stat(p, o);
    });
    await expect(openExportFolder(target, SPEC)).rejects.toThrow("denied");
    vi.restoreAllMocks();
    const mkdir = fs.mkdir.bind(fs);
    vi.spyOn(fs, "mkdir").mockImplementation(async (p, o) => {
      if (String(p).endsWith(STAGING_FOLDER)) {
        throw Object.assign(new Error("no space"), { code: "ENOSPC" });
      }
      return mkdir(p, o);
    });
    vi.spyOn(fs, "rmdir").mockRejectedValueOnce(new Error("busy"));
    await expect(openExportFolder(target, SPEC)).rejects.toThrow("no space");
    vi.restoreAllMocks();
    // The removal failed once; the next run finds the folder empty, takes it and leaves it empty.
    const folder = await openExportFolder(target, SPEC);
    await folder.abort();
    expect(await fs.readdir(target)).toEqual([]);
    // A folder it created and cannot remove again stays.
    const other = path.join(root, "other");
    const created = await openExportFolder(other, SPEC);
    vi.spyOn(fs, "rmdir").mockRejectedValueOnce(new Error("busy"));
    await created.abort();
    expect(await fs.readdir(other)).toEqual([]);
  });
});

describe("openExportFolder holds a lock in the target", () => {
  it("refuses while another export runs and removes a staging folder left by one that does not", async () => {
    const target = await earlier({ "index.html": "old" });
    const first = await openExportFolder(target, SPEC);
    expect((await refusal(openExportFolder(target, SPEC))).message).toBe(
      `Not exported: another export into site is running (${STAGING_FOLDER})`,
    );
    await first.abort();
    // A process that no longer runs.
    await write(
      path.join(target, STAGING_FOLDER, "owner.json"),
      JSON.stringify({ pid: 2 ** 31 - 1, started: 0 }),
    );
    await write(path.join(target, STAGING_FOLDER, "new/index.html"), "left");
    await (await openExportFolder(target, SPEC)).abort();
    await vi.waitFor(async () => {
      expect(await fs.readdir(target)).not.toContain(STAGING_FOLDER);
    });
    // An owner file without a start time: old.
    await write(path.join(target, STAGING_FOLDER, "owner.json"), JSON.stringify({ pid: process.pid }));
    await (await openExportFolder(target, SPEC)).abort();
    // No owner file: left behind once it is older than a minute.
    await write(path.join(target, STAGING_FOLDER, "x"), "");
    const young = await refusal(openExportFolder(target, SPEC));
    expect(young.message).toContain("is running");
    const old = new Date(Date.now() - 120_000);
    await fs.utimes(path.join(target, STAGING_FOLDER), old, old);
    await (await openExportFolder(target, SPEC)).abort();
    // A file of that name is no staging folder of an export.
    await write(path.join(target, STAGING_FOLDER), "");
    expect((await refusal(openExportFolder(target, SPEC))).message).toContain("is running");
    await fs.rm(path.join(target, STAGING_FOLDER));
    // Two starting at once: the exclusive mkdir decides.
    const mkdir = fs.mkdir.bind(fs);
    vi.spyOn(fs, "mkdir").mockImplementationOnce(async (p, o) => {
      await mkdir(p, o);
      throw Object.assign(new Error("exists"), { code: "EEXIST" });
    });
    expect((await refusal(openExportFolder(target, SPEC))).message).toContain("is running");
    expect(await fs.readFile(path.join(target, "index.html"), "utf8")).toBe("old");
  });
});

describe("an export folder", () => {
  it("[SR-235/AK-pnk8] leaves entries that name nothing it may replace and refuses to write over files of another source", async () => {
    const target = await earlier({ "index.html": "old", "a/b.html": "old" }, [
      "index.html",
      "a/b.html",
      7,
      "",
      SPEC.file,
      `${STAGING_FOLDER}/x`,
      "a",
      "a/b.html/c",
    ]);
    await write(path.join(target, "foreign.txt"), "mine");
    await write(path.join(target, "assets"), "a file, not a folder");
    await write(path.join(target, "a/mine.txt"), "mine");
    const folder = await openExportFolder(target, SPEC);
    expect(folder.ignored).toEqual([
      { entry: "7", reason: "it is not a path" },
      { entry: "", reason: "it is not a path" },
      { entry: SPEC.file, reason: "it names the marker file or the staging folder" },
      { entry: `${STAGING_FOLDER}/x`, reason: "it names the marker file or the staging folder" },
      { entry: "a", reason: "it is no file the export wrote: a folder, a link or inside one" },
      { entry: "a/b.html/c", reason: "it is no file the export wrote: a folder, a link or inside one" },
    ]);
    expect(folder.foreign).toEqual(["a/mine.txt", "assets", "foreign.txt"]);
    expect((await refusal(folder.write("foreign.txt", "new"))).message).toBe(
      "Not exported: foreign.txt is taken by a file the earlier export did not write; move it away",
    );
    expect((await refusal(folder.write("assets/x.css", "new"))).code).toBe("file.faulty");
    expect((await refusal(folder.write("a", "new"))).code).toBe("file.faulty");
    await folder.write("x/y.html", "new");
    expect((await refusal(folder.write("x/y.html", "again"))).code).toBe("internal");
    expect((await refusal(folder.write("x/y.html/z", "under a file"))).code).toBe("internal");
    expect((await refusal(folder.write("../out", "out"))).code).toBe("internal");
    await folder.write("a/b.html", "new");
    expect(await folder.commit()).toEqual({ removed: 1, cleanupFailed: false });
    expect(await fs.readFile(path.join(target, "a/b.html"), "utf8")).toBe("new");
    expect(await fs.readFile(path.join(target, "a/mine.txt"), "utf8")).toBe("mine");
    await expect(fs.stat(path.join(target, "index.html"))).rejects.toThrow();
  });

  it("[SR-235/AK-k6qy] names the backup when the earlier export cannot be put back, and reports a staging folder it cannot remove", async () => {
    const target = await earlier({ "index.html": "old", "elements/a.html": "old" });
    const folder = await openExportFolder(target, SPEC);
    await folder.write("index.html", "new");
    await folder.write("elements/a.html", "new");
    const rename = fs.rename.bind(fs);
    let moved = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).startsWith(target) && String(from).includes(`${STAGING_FOLDER}${path.sep}new`)) {
        moved++;
        throw Object.assign(new Error("locked"), { code: "EBUSY" });
      }
      if (moved > 0 && String(from).startsWith(path.join(target, STAGING_FOLDER, "old"))) {
        throw Object.assign(new Error("still locked"), { code: "EBUSY" });
      }
      return rename(from, to);
    });
    expect((await refusal(folder.commit())).message).toBe(
      `Not exported: the earlier export could not be put back; its files are in ${STAGING_FOLDER}/old of the export folder`,
    );
    vi.restoreAllMocks();
    expect(await fs.readFile(path.join(target, STAGING_FOLDER, "old/elements/a.html"), "utf8")).toBe("old");
    // A later export finds the marker naming the old and new files and the staging folder pending.
    expect(await fs.readFile(path.join(target, SPEC.file), "utf8")).toContain(`pending: ${STAGING_FOLDER}`);
    await fs.rm(path.join(target, STAGING_FOLDER, "owner.json"));
    const old = new Date(Date.now() - 120_000);
    await fs.utimes(path.join(target, STAGING_FOLDER), old, old);
    const again = await openExportFolder(target, SPEC);
    await again.write("index.html", "newer");
    vi.spyOn(fs, "rm").mockRejectedValue(Object.assign(new Error("busy"), { code: "EBUSY" }));
    expect(await again.commit()).toEqual({ removed: 0, cleanupFailed: true });
    vi.restoreAllMocks();
    expect(await fs.readFile(path.join(target, "index.html"), "utf8")).toBe("newer");
    expect(await fs.readFile(path.join(target, SPEC.file), "utf8")).toBe(
      '# Test.\ntest-export: 1\nfiles:\n  - "index.html"\n',
    );
  });

  it("refuses to put files into a folder that became a link while the export ran", async () => {
    const root = await temp();
    const target = await earlier({ "elements/a.html": "old", "elements/b.html": "old" });
    await write(path.join(target, "elements/mine.txt"), "mine");
    const folder = await openExportFolder(target, SPEC);
    await folder.write("elements/a.html", "new");
    await fs.rename(path.join(target, "elements"), path.join(root, "moved"));
    await fs.symlink(path.join(root, "moved"), path.join(target, "elements"), "junction");
    expect((await refusal(folder.commit())).message).toBe(
      "Not exported: elements changed while the export ran; run it again",
    );
    expect(await fs.readFile(path.join(root, "moved/a.html"), "utf8")).toBe("old");
  });

  it("removes its staging folder when the marker cannot be written at the start", async () => {
    const target = await earlier({ "index.html": "old" });
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (String(to).endsWith(SPEC.file)) {
        throw Object.assign(new Error("no space"), { code: "ENOSPC" });
      }
      return rename(from, to);
    });
    await expect(openExportFolder(target, SPEC)).rejects.toThrow();
    vi.restoreAllMocks();
    expect((await fs.readdir(target)).sort()).toEqual(["index.html", SPEC.file]);
  });
});
