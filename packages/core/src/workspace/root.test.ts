import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it } from "vitest";
import { WORKSPACE_FILE, findWorkspaceRoot } from "./root.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const fixture = async (
  files: Record<string, string>,
): Promise<Awaited<ReturnType<typeof createFixtureWorkspace>>> => {
  const ws = await createFixtureWorkspace({ files });
  cleanups.push(() => ws.cleanup());
  return ws;
};

describe("findWorkspaceRoot", () => {
  it("names the workspace file", () => {
    expect(WORKSPACE_FILE).toBe("logreq-workspace.yaml");
  });

  it("finds the workspace file in the start folder", async () => {
    const ws = await fixture({ [WORKSPACE_FILE]: "logreq-workspace: 1\n" });
    expect(await findWorkspaceRoot(ws.root)).toBe(ws.root);
  });

  it("finds the nearest workspace file upwards", async () => {
    const ws = await fixture({
      [WORKSPACE_FILE]: "logreq-workspace: 1\n",
      "inner/logreq-workspace.yaml": "logreq-workspace: 1\n",
      "inner/deep/folder/file.md": "x",
      "other/file.md": "x",
    });
    expect(await findWorkspaceRoot(ws.path("inner/deep/folder"))).toBe(ws.path("inner"));
    expect(await findWorkspaceRoot(ws.path("other"))).toBe(ws.root);
  });

  it("resolves a relative start against the current folder", async () => {
    const ws = await fixture({ [WORKSPACE_FILE]: "logreq-workspace: 1\n", "a/b.md": "x" });
    const relative = path.relative(process.cwd(), ws.path("a"));
    expect(await findWorkspaceRoot(relative)).toBe(ws.root);
  });

  it("ignores a folder with the workspace file name", async () => {
    const ws = await fixture({ "sub/logreq-workspace.yaml/keep": "x" });
    await fs.mkdir(ws.path("sub/start"));
    // The temporary folder has no workspace file above it, so nothing is found.
    expect(await findWorkspaceRoot(ws.path("sub/start"))).toBeUndefined();
  });
});
