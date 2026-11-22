// workspace.listFolder (SR-143) as a read command: relative from the workspace root, `~` as home with
// `absolute` and in the app, and the folder through the local path rule of the access (SR-142). The
// criteria of the listing (SR-143 AK3, AK4, AK6, AK7) are tagged here; those of the command prompt are
// not. The cross-access test runs it through every access.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type { InvokeContext } from "../../runtime/invoke.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

let top = "";
let root = "";

beforeEach(async () => {
  top = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-list-folder-command-")));
  root = path.join(top, "ws");
  for (const folder of ["ws/out", "ws/~/inner", "home/projects"]) {
    await fs.mkdir(path.join(top, folder), { recursive: true });
  }
  await fs.writeFile(path.join(root, "a.reqif"), "");
  for (const name of ["HOME", "USERPROFILE"]) {
    vi.stubEnv(name, path.join(top, "home"));
  }
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(top, { recursive: true, force: true, maxRetries: 3 });
});

const list = async (
  input: Record<string, unknown>,
  access?: InvokeContext["access"],
): Promise<CommandOutput<"workspace.listFolder">> => {
  const workspace = new Workspace(root);
  try {
    return (await invoke(
      "workspace.listFolder",
      input,
      access === undefined ? { workspace } : { workspace, access },
    )) as CommandOutput<"workspace.listFolder">;
  } finally {
    await workspace.close();
  }
};

describe("workspace.listFolder", () => {
  it("[SR-143/AK-r68p] lists relative from the workspace root, folders before files on request, and ~ as an ordinary name", async () => {
    expect(await list({ path: "" })).toEqual({
      answer: "Found 2 entries.",
      folder: root,
      name: "",
      entries: [
        { name: "out", kind: "folder" },
        { name: "~", kind: "folder" },
      ],
    });
    expect((await list({ path: "a", files: true })).entries.map((e) => e.name)).toEqual([
      "out",
      "~",
      "a.reqif",
    ]);
    expect(await list({ path: "~/in" })).toMatchObject({ folder: path.join(root, "~"), name: "in" });
  });

  it("with absolute takes ~ as home and refuses a relative path", async () => {
    expect(await list({ path: "~/pro", absolute: true })).toEqual({
      answer: "Found 1 entry.",
      folder: path.join(top, "home"),
      name: "pro",
      entries: [{ name: "projects", kind: "folder" }],
    });
    expect(await list({ path: "out/", absolute: true })).toEqual({
      answer: "Found no entries: the path is refused.",
      name: "",
      entries: [],
      problem: "invalid",
    });
    expect(await list({ path: `${path.join(top, "gone")}${path.sep}`, absolute: true })).toMatchObject({
      problem: "missing",
    });
  });

  it("through the API only inside the repositories of the workspace, as the command line takes any folder", async () => {
    expect((await list({ path: `out${path.sep}` }, "api")).folder).toBe(path.join(root, "out"));
    await expect(list({ path: "~/", absolute: true }, "mcp")).rejects.toMatchObject({
      code: "input.invalid",
      details: { reason: "outside-repositories", fields: ["path"] },
    });
    expect((await list({ path: "~/", absolute: true }, "cli")).entries).toEqual([
      { name: "projects", kind: "folder" },
    ]);
  });

  it("through the web UI takes any folder, as its folder field names places outside the workspace (ADR-0020)", async () => {
    expect((await list({ path: "~/", absolute: true }, "ui")).entries).toEqual([
      { name: "projects", kind: "folder" },
    ]);
  });

  it("in the app takes ~ for home in every path, as the app's path arguments, and the command line does not", async () => {
    expect(await list({ path: "~/pro" }, "app")).toMatchObject({
      folder: path.join(top, "home"),
      name: "pro",
    });
    expect(await list({ path: "out/" }, "app")).toMatchObject({ folder: path.join(root, "out") });
    expect(await list({ path: "~/in" }, "cli")).toMatchObject({ folder: path.join(root, "~"), name: "in" });
  });

  it("[SR-143/AK-r68p] puts every folder before every file, whatever their names", async () => {
    await fs.writeFile(path.join(root, "out", "0-first.txt"), "");
    await fs.mkdir(path.join(root, "out", "zz"));
    await fs.writeFile(path.join(root, "out", "b.md"), "");
    await fs.mkdir(path.join(root, "out", "a"));
    expect((await list({ path: "out/", files: true })).entries).toEqual([
      { name: "a", kind: "folder" },
      { name: "zz", kind: "folder" },
      { name: "0-first.txt", kind: "file" },
      { name: "b.md", kind: "file" },
    ]);
  });

  it("[SR-143/AK-hfz0] gives no entries for a missing folder and says it is missing", async () => {
    for (const input of [
      { path: "gone/x" },
      { path: `${path.join(top, "gone")}${path.sep}`, absolute: true },
    ]) {
      expect(await list({ ...input, files: true })).toEqual({
        answer: "Found no entries: the folder does not exist.",
        folder: input.absolute === true ? path.join(top, "gone") : path.join(root, "gone"),
        name: input.absolute === true ? "" : "x",
        entries: [],
        problem: "missing",
      });
    }
  });

  it("[SR-143/AK-hfz0] gives no entries for a folder it cannot read and says it is not readable", async () => {
    // A file in place of the folder cannot be listed.
    expect(await list({ path: "a.reqif/x", files: true })).toEqual({
      answer: "Found no entries: the folder cannot be read.",
      folder: path.join(root, "a.reqif"),
      name: "x",
      entries: [],
      problem: "unreadable",
    });
    // A folder the system refuses to open (no permission), as a user without rights to it meets it.
    const locked = path.join(root, "out");
    const opendir = fs.opendir.bind(fs);
    vi.spyOn(fs, "opendir").mockImplementation((folder, options) =>
      path.resolve(String(folder)) === locked
        ? Promise.reject(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }))
        : opendir(folder, options),
    );
    try {
      expect(await list({ path: "out/", files: true })).toEqual({
        answer: "Found no entries: the folder cannot be read.",
        folder: locked,
        name: "",
        entries: [],
        problem: "unreadable",
      });
      expect((await list({ path: "", files: true })).problem).toBeUndefined();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('[SR-143/AK-gdy1] gives names that start with "." only when the last part of the path starts with "."', async () => {
    await fs.mkdir(path.join(root, ".hidden"));
    await fs.writeFile(path.join(root, ".env"), "");
    await fs.mkdir(path.join(root, "out", ".cache"));
    const names = async (typed: string): Promise<string[]> =>
      (await list({ path: typed, files: true })).entries.map((e) => e.name);
    expect(await names("")).toEqual(["out", "~", "a.reqif"]);
    expect(await names("h")).toEqual(["out", "~", "a.reqif"]);
    expect(await names(".")).toEqual([".hidden", "out", "~", ".env", "a.reqif"]);
    expect(await names(".h")).toEqual([".hidden", "out", "~", ".env", "a.reqif"]);
    // Only the last part counts: a dot folder before it lists its plain names only.
    expect(await names("out/")).toEqual([]);
    expect(await names("out/.")).toEqual([".cache"]);
    expect(await names(".hidden/")).toEqual([]);
  });

  it("[SR-143/AK-nqsj] gives no entries for a path it does not take by its text, and says the path is invalid", async () => {
    for (const typed of ["out/", "", "relative/x"]) {
      expect(await list({ path: typed, absolute: true, files: true })).toEqual({
        answer: "Found no entries: the path is refused.",
        name: typed === "relative/x" ? "x" : "",
        entries: [],
        problem: "invalid",
      });
    }
  });

  it("[SR-143/AK-nqsj] gives no entries and no problem for an empty folder", async () => {
    await fs.mkdir(path.join(root, "empty"));
    for (const files of [false, true]) {
      expect(await list({ path: "empty/", files })).toEqual({
        answer: "Found 0 entries.",
        folder: path.join(root, "empty"),
        name: "",
        entries: [],
      });
    }
  });
});
