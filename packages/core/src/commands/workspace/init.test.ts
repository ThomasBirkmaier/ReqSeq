import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { STANDARD_MODEL_TEXT } from "../../metamodel/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { WORKSPACE_FILE } from "../../workspace/index.js";

type Output = CommandOutput<"workspace.init">;

/** An empty temporary folder (the fixture without files), removed after the test. */
const emptyFolder = async (): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace();
  onTestFinished(() => ws.cleanup());
  return ws;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

/** `workspace.init` through `invoke`, like every access (SR-080). */
const init = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("workspace.init", input, { workspace })) as Output;

/** All files below `root`, relative, `/` as separator, sorted. */
const listFiles = async (root: string): Promise<string[]> =>
  (await fs.readdir(root, { recursive: true, withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)).split(path.sep).join("/"))
    .sort();

describe("workspace.init", () => {
  it("[SR-014/AK1] creates the standard model as metamodel files in an empty folder", async () => {
    const ws = await emptyFolder();
    const out = await init(open(ws.root), { path: ws.root, name: "Weather station" });
    expect(out).toEqual({ files: ["metamodel/standard-model.yaml", WORKSPACE_FILE], problems: [] });
    expect(await listFiles(ws.root)).toEqual([WORKSPACE_FILE, "metamodel/standard-model.yaml"]);
    // The metamodel file is the shipped standard model, byte for byte.
    expect(await fs.readFile(ws.path("metamodel/standard-model.yaml"), "utf8")).toBe(STANDARD_MODEL_TEXT);
    const name = path.basename(ws.root);
    expect(await fs.readFile(ws.path(WORKSPACE_FILE), "utf8")).toBe(
      [
        "logreq-workspace: 1",
        "name: Weather station",
        "repositories:",
        `  - name: ${name}`,
        '    url: ""',
        "    main: true",
        "metamodel:",
        `  repository: ${name}`,
        "  path: metamodel",
        "",
      ].join("\n"),
    );
  });

  it("[SR-014/AK1] opens the new workspace writable, with the standard model as its metamodel", async () => {
    const ws = await emptyFolder();
    const workspace = open(ws.root);
    await init(workspace, { path: ws.root, name: "Weather station" });
    // The same Workspace object sees the new workspace (API, MCP and app keep it open).
    const status = (await invoke("workspace.status", {}, { workspace })) as CommandOutput<"workspace.status">;
    expect(status).toMatchObject({
      name: "Weather station",
      metamodel: { path: "metamodel", valid: true },
      readOnly: false,
      problems: [],
    });
    const metamodel = (await invoke("metamodel.get", {}, { workspace })) as CommandOutput<"metamodel.get">;
    expect(metamodel.problems).toEqual([]);
    expect(metamodel.types.map((t) => t.key)).toEqual([
      "need",
      "use-case",
      "system-requirement",
      "decision",
      "variant",
      "package",
    ]);
    expect(metamodel.statuses.map((s) => s.key)).toEqual(["draft", "approved", "obsolete"]);
  });

  it("resets the workspace of the call when the new folder is its root under another spelling", async () => {
    const ws = await createFixtureWorkspace({
      files: {
        [`real/${WORKSPACE_FILE}`]:
          "logreq-workspace: 1\nname: Old\nrepositories:\n  - { name: real, url: x }\nmetamodel: { repository: real, path: metamodel }\n",
      },
    });
    onTestFinished(() => ws.cleanup());
    await fs.symlink(ws.path("real"), ws.path("link"), "junction");
    const workspace = open(ws.path("link"));
    // The layout of an earlier workspace file is kept by the Workspace object; the file is gone since.
    await expect(invoke("workspace.status", {}, { workspace })).resolves.toMatchObject({ name: "Old" });
    await fs.rm(ws.path(`real/${WORKSPACE_FILE}`));
    await init(workspace, { path: ws.path("real"), name: "Linked" });
    const status = (await invoke("workspace.status", {}, { workspace })) as CommandOutput<"workspace.status">;
    expect(status).toMatchObject({ name: "Linked", readOnly: false });
  });

  it("creates a workspace from a call whose own root does not exist", async () => {
    const ws = await emptyFolder();
    const out = await init(open(ws.path("not-there")), { path: ws.root, name: "W" });
    expect(out.problems).toEqual([]);
  });

  it("[SR-014/AK1] takes a relative path from the workspace root (API, MCP) and writes nothing to Git", async () => {
    const ws = await createFixtureWorkspace({ files: { "new/.keep": "" } });
    onTestFinished(() => ws.cleanup());
    const out = await init(open(ws.root), { path: "new", name: "New" });
    expect(out.files).toEqual(["metamodel/standard-model.yaml", WORKSPACE_FILE]);
    expect(await listFiles(ws.root)).toEqual([
      "new/.keep",
      `new/${WORKSPACE_FILE}`,
      "new/metamodel/standard-model.yaml",
    ]);
    // LogReq never writes Git (D-036): no repository is created.
    await expect(fs.lstat(ws.path("new/.git"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes the metamodel into the folder the caller names, also the repository root", async () => {
    const ws = await emptyFolder();
    const out = await init(open(ws.root), { path: ws.root, name: "W", metamodel: { path: "model/std" } });
    expect(out).toEqual({ files: ["model/std/standard-model.yaml", WORKSPACE_FILE], problems: [] });

    const root = await emptyFolder();
    const atRoot = await init(open(root.root), { path: root.root, name: "W", metamodel: { path: "." } });
    expect(atRoot).toEqual({ files: ["standard-model.yaml", WORKSPACE_FILE], problems: [] });
  });

  it("lists an own metamodel repository and writes nothing into it (SR-018)", async () => {
    const ws = await createFixtureWorkspace({ files: { "system/.keep": "" } });
    onTestFinished(() => ws.cleanup());
    const out = await init(open(ws.root), {
      path: ws.path("system"),
      name: "W",
      metamodel: { repository: "metamodel", path: "model" },
    });
    expect(out.files).toEqual([WORKSPACE_FILE]);
    expect(out.problems).toEqual([
      {
        code: "workspace.repository-missing",
        severity: "info",
        message: "Repository metamodel is not available locally",
      },
      {
        code: "metamodel.invalid",
        severity: "error",
        file: WORKSPACE_FILE,
        message: "Metamodel repository metamodel is not available",
      },
    ]);
    expect(await fs.readFile(ws.path(`system/${WORKSPACE_FILE}`), "utf8")).toContain(
      'repositories:\n  - name: system\n    url: ""\n    main: true\n  - name: metamodel\n    url: ""\nmetamodel:\n  repository: metamodel\n  path: model\n',
    );
  });

  it("refuses a folder that is a workspace already, and changes nothing", async () => {
    const ws = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
    onTestFinished(() => ws.cleanup());
    const before = await fs.readFile(ws.path(WORKSPACE_FILE), "utf8");
    await expect(init(open(ws.root), { path: ws.root, name: "Again" })).rejects.toMatchObject({
      code: "file.changed-on-disk",
      message: `Not written: ${WORKSPACE_FILE} already exists; workspace.init only creates a new workspace`,
    });
    expect(await fs.readFile(ws.path(WORKSPACE_FILE), "utf8")).toBe(before);
  });

  it("refuses an existing metamodel file before it writes anything", async () => {
    const ws = await createFixtureWorkspace({ files: { "metamodel/standard-model.yaml": "mine\n" } });
    onTestFinished(() => ws.cleanup());
    await expect(init(open(ws.root), { path: ws.root, name: "W" })).rejects.toMatchObject({
      code: "file.changed-on-disk",
      details: { file: "metamodel/standard-model.yaml" },
    });
    expect(await listFiles(ws.root)).toEqual(["metamodel/standard-model.yaml"]);
  });

  it("refuses a missing folder and a path that is a file", async () => {
    const ws = await createFixtureWorkspace({ files: { "a-file": "x" } });
    onTestFinished(() => ws.cleanup());
    const workspace = open(ws.root);
    const missing = await init(workspace, { path: "missing", name: "W" }).catch((e: unknown) => e);
    expect(missing).toMatchObject({
      code: "file.folder-missing",
      message: expect.not.stringContaining(ws.root) as string,
    });
    await expect(init(workspace, { path: "a-file", name: "W" })).rejects.toMatchObject({
      code: "input.invalid",
    });
    expect(await listFiles(ws.root)).toEqual(["a-file"]);
  });

  it("refuses input that would give an invalid workspace file, before it writes anything", async () => {
    const ws = await emptyFolder();
    const workspace = open(ws.root);
    for (const input of [
      { path: ws.root, name: "" },
      { path: ws.root, name: "W", metamodel: { path: "../outside" } },
      { path: ws.root, name: "W", metamodel: { repository: "Not A Name" } },
    ]) {
      await expect(init(workspace, input)).rejects.toMatchObject({
        code: "input.invalid",
        details: { file: WORKSPACE_FILE },
      });
    }
    expect(await listFiles(ws.root)).toEqual([]);
  });
});

describe("workspace.init when the folder cannot be read", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports a path below a file as missing and any other failure as internal", async () => {
    const ws = await createFixtureWorkspace({ files: { "a-file": "x" } });
    onTestFinished(() => ws.cleanup());
    const workspace = open(ws.root);
    await expect(init(workspace, { path: "a-file/below", name: "W" })).rejects.toMatchObject({
      code: "file.folder-missing",
    });
    vi.spyOn(fs, "stat").mockRejectedValueOnce(Object.assign(new Error("EACCES"), { code: "EACCES" }));
    await expect(init(workspace, { path: ws.root, name: "W" })).rejects.toMatchObject({ code: "internal" });
    expect(await listFiles(ws.root)).toEqual(["a-file"]);
  });
});
