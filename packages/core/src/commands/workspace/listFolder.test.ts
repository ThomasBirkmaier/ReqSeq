// workspace.listFolder (SR-143) as a read command: relative from the workspace root, `~` as home only
// with `absolute`, and the folder through the local path rule of the access (SR-142). Not tagged with
// SR-143 AKs: they describe the app's command prompt. The cross-access test runs it through every access.
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
  it("lists relative from the workspace root, with files on request, and ~ as an ordinary name", async () => {
    expect(await list({ path: "" })).toEqual({
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
      folder: path.join(top, "home"),
      name: "pro",
      entries: [{ name: "projects", kind: "folder" }],
    });
    expect(await list({ path: "out/", absolute: true })).toEqual({
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
});
