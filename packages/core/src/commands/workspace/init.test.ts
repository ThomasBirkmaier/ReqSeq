import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type { CommandCatalog } from "../../generated/types.js";
import { STANDARD_MODEL_TEXT } from "../../metamodel/index.js";
import { contractsBundle } from "../../runtime/contracts.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { WORKSPACE_FILE } from "../../workspace/index.js";
import { skillFile } from "../tool/guide/skill.js";

type Output = CommandOutput<"workspace.init">;

/** The skill file in a workspace folder without Git (D-079). */
const SKILL = ".claude/skills/managing-requirements/SKILL.md";

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

/** The next steps of a workspace created in `root` (SR-226 AK2). */
const nextIn = (root: string): unknown[] => [
  { command: "workspace.connectAgent", input: {}, open: ["client"], workspace: root },
  { command: "element.create", input: {}, open: ["type", "title"], workspace: root },
];

describe("workspace.init", () => {
  it("[SR-226/AK-sz63] names connecting an AI agent and creating an element in the new workspace as the next steps", async () => {
    const ws = await emptyFolder();
    const here = await init(open(ws.root), { path: ws.root, name: "W" });
    expect(here.next).toEqual(nextIn(ws.root));
    const other = await init(open(ws.root), { path: "sub", name: "W" });
    expect(other.next).toEqual(nextIn(path.join(ws.root, "sub")));
  });

  it("[SR-014/AK-yh7s] creates the standard model as metamodel files in an empty folder", async () => {
    const ws = await emptyFolder();
    const out = await init(open(ws.root), { path: ws.root, name: "Weather station" });
    expect(out).toEqual({
      answer: "Created workspace Weather station; 4 files written.",
      files: ["metamodel/standard-model.yaml", WORKSPACE_FILE, ".gitignore", SKILL],
      next: nextIn(ws.root),
      problems: [],
    });
    expect(await listFiles(ws.root)).toEqual([
      SKILL,
      ".gitignore",
      "metamodel/standard-model.yaml",
      WORKSPACE_FILE,
    ]);
    // The temp files and the local file stay out of Git (#271, #1456).
    expect(await fs.readFile(ws.path(".gitignore"), "utf8")).toBe("*.reqseq-tmp\n.reqseq/local.yaml\n");
    // The metamodel file is the shipped standard model, byte for byte.
    expect(await fs.readFile(ws.path("metamodel/standard-model.yaml"), "utf8")).toBe(STANDARD_MODEL_TEXT);
    const name = path.basename(ws.root);
    expect(await fs.readFile(ws.path(WORKSPACE_FILE), "utf8")).toBe(
      [
        "reqseq-workspace: 1",
        "name: Weather station",
        "repositories:",
        `  - name: ${name}`,
        '    url: ""',
        "    main: true",
        "metamodel:",
        `  repository: ${name}`,
        "  path: metamodel",
        "evidence:",
        `  - repository: ${name}`,
        "    path: evidence",
        "",
      ].join("\n"),
    );
  });

  it("[SR-014/AK-yh7s] opens the new workspace writable, with the standard model as its metamodel", async () => {
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

  it("[SR-230/AK-x4g5] names the folder evidence in the main repository as the evidence location", async () => {
    const ws = await emptyFolder();
    const workspace = open(ws.root);
    await init(workspace, { path: ws.root, name: "W" });
    const status = (await invoke("workspace.status", {}, { workspace })) as CommandOutput<"workspace.status">;
    // The folder itself is created with the first record (`evidence.folder-missing` is info).
    expect(status.evidence).toEqual([
      { repository: path.basename(ws.root), path: "evidence", available: false, folder: "evidence" },
    ]);
  });

  it("[SR-229/AK-x7d8] writes the skill file at the root of the Git repository and lists it, or none with skill false", async () => {
    const ws = await emptyFolder();
    // A `.git` folder that `workTreeOf` takes for a repository, without running git.
    await fs.mkdir(ws.path(".git/objects"), { recursive: true });
    await fs.mkdir(ws.path(".git/refs"), { recursive: true });
    await fs.writeFile(ws.path(".git/HEAD"), "ref: refs/heads/main\n");
    const workspace = open(ws.root);
    const out = await init(workspace, { path: "spec", name: "W" });
    expect(out.files).toEqual(["metamodel/standard-model.yaml", WORKSPACE_FILE, ".gitignore", `../${SKILL}`]);
    expect(out.problems).toEqual([]);
    const ENTRIES = (contractsBundle.catalog as CommandCatalog).commands;
    expect(await fs.readFile(ws.path(SKILL), "utf8")).toBe(skillFile(ENTRIES));
    // A second workspace in the same repository finds ReqSeq's own file the same and does not list it.
    const again = await init(workspace, { path: "other", name: "O" });
    expect(again.files).toEqual(["metamodel/standard-model.yaml", WORKSPACE_FILE, ".gitignore"]);
    expect(again.problems).toEqual([]);
    // `skill: false` writes none.
    const plain = await emptyFolder();
    const none = await init(open(plain.root), { path: plain.root, name: "N", skill: false });
    expect(none.files).toEqual(["metamodel/standard-model.yaml", WORKSPACE_FILE, ".gitignore"]);
    await expect(fs.lstat(plain.path(".claude"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("[SR-229/AK-x7d8] keeps a skill file ReqSeq did not write, creates the workspace and says why", async () => {
    const ws = await createFixtureWorkspace({ files: { [SKILL]: "my own skill\n" } });
    onTestFinished(() => ws.cleanup());
    const out = await init(open(ws.root), { path: ws.root, name: "W" });
    expect(out).toMatchObject({ answer: "Created workspace W; 3 files written; 1 problem." });
    expect(out.files).toEqual(["metamodel/standard-model.yaml", WORKSPACE_FILE, ".gitignore"]);
    expect(out.problems).toEqual([
      {
        code: "workspace.skill-not-written",
        severity: "warning",
        message: `Not written: the skill file ${SKILL} was not written by ReqSeq; ReqSeq replaces it only on request: \`reqseq tool guide --skill --write --replace\``,
      },
    ]);
    expect(await fs.readFile(ws.path(SKILL), "utf8")).toBe("my own skill\n");
  });

  it("resets the workspace of the call when the new folder is its root under another spelling", async () => {
    const ws = await createFixtureWorkspace({
      files: {
        [`real/${WORKSPACE_FILE}`]:
          "reqseq-workspace: 1\nname: Old\nrepositories:\n  - { name: real, url: x }\nmetamodel: { repository: real, path: metamodel }\n",
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

  it("[SR-014/AK-yh7s] takes a relative path from the workspace root (API, MCP) and writes nothing to Git", async () => {
    const ws = await createFixtureWorkspace({ files: { "new/.keep": "" } });
    onTestFinished(() => ws.cleanup());
    const out = await init(open(ws.root), { path: "new", name: "New" });
    expect(out.files).toEqual(["metamodel/standard-model.yaml", WORKSPACE_FILE, ".gitignore", SKILL]);
    expect(await listFiles(ws.root)).toEqual([
      `new/${SKILL}`,
      "new/.gitignore",
      "new/.keep",
      "new/metamodel/standard-model.yaml",
      `new/${WORKSPACE_FILE}`,
    ]);
    // ReqSeq never writes Git (D-036): no repository is created.
    await expect(fs.lstat(ws.path("new/.git"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("[SR-083/AK-zp6z] [SR-083/AK-s4q9] creates no workspace inside a .git folder, in any case and through a linked folder (#1449)", async () => {
    const ws = await createFixtureWorkspace({ files: { ".git/hooks/keep": "" } });
    onTestFinished(() => ws.cleanup());
    await fs.symlink(ws.path(".git"), ws.path("linked"), "junction");
    const refused = { code: "input.invalid", details: { reason: "git-folder" } };
    for (const folder of [".git", ".git/hooks", ".GIT", "linked/new"]) {
      await expect(init(open(ws.root), { path: folder, name: "W" })).rejects.toMatchObject(refused);
    }
    // The metamodel folder too: named in `.git`, or the default folder linked into it.
    for (const folder of ["a", "b"]) {
      await fs.mkdir(ws.path(folder));
    }
    await expect(
      init(open(ws.root), { path: "a", name: "W", metamodel: { path: ".git/x" } }),
    ).rejects.toMatchObject(refused);
    await fs.symlink(ws.path(".git/hooks"), ws.path("b/metamodel"), "junction");
    await expect(init(open(ws.root), { path: "b", name: "W" })).rejects.toMatchObject(refused);
    expect(await listFiles(ws.path(".git"))).toEqual(["hooks/keep"]);
    expect(await listFiles(ws.path("a"))).toEqual([]);
  });

  it("writes the metamodel into the folder the caller names, also the repository root", async () => {
    const ws = await emptyFolder();
    const out = await init(open(ws.root), { path: ws.root, name: "W", metamodel: { path: "model/std" } });
    expect(out).toEqual({
      answer: "Created workspace W; 4 files written.",
      files: ["model/std/standard-model.yaml", WORKSPACE_FILE, ".gitignore", SKILL],
      next: nextIn(ws.root),
      problems: [],
    });

    const root = await emptyFolder();
    const atRoot = await init(open(root.root), { path: root.root, name: "W", metamodel: { path: "." } });
    expect(atRoot).toEqual({
      answer: "Created workspace W; 4 files written.",
      files: ["standard-model.yaml", WORKSPACE_FILE, ".gitignore", SKILL],
      next: nextIn(root.root),
      problems: [],
    });
  });

  it("lists an own metamodel repository and writes nothing into it (SR-018)", async () => {
    const ws = await createFixtureWorkspace({ files: { "system/.keep": "" } });
    onTestFinished(() => ws.cleanup());
    const out = await init(open(ws.root), {
      path: ws.path("system"),
      name: "W",
      metamodel: { repository: "metamodel", path: "model" },
    });
    expect(out.files).toEqual([WORKSPACE_FILE, ".gitignore", SKILL]);
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
      'repositories:\n  - name: system\n    url: ""\n    main: true\n  - name: metamodel\n    url: ""\nmetamodel:\n  repository: metamodel\n  path: model\nevidence:\n  - repository: system\n    path: evidence\n',
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

  it("[SR-014/AK-yh7s] adds the missing lines for temp files and the local file to an existing .gitignore once, with its line ending (#271, #1456)", async () => {
    const ws = await createFixtureWorkspace({
      files: {
        "a/.gitignore": "node_modules/\r\ndist/",
        "b/.gitignore": "x\n*.reqseq-tmp  \n.reqseq/local.yaml\n",
        "d/.gitignore": "  *.reqseq-tmp\n",
        "e/.gitignore": "x\n*.reqseq-tmp\n",
        "f/.gitignore": "*.reqseq-tmp\r\n.reqseq/local.yaml",
        "c/.keep": "",
      },
    });
    onTestFinished(() => ws.cleanup());
    const workspace = open(ws.root);
    // A CRLF file whose last line has no line ending gets CRLF on both lines.
    expect((await init(workspace, { path: "a", name: "A" })).files).toContain(".gitignore");
    expect(await fs.readFile(ws.path("a/.gitignore"), "utf8")).toBe(
      "node_modules/\r\ndist/\r\n*.reqseq-tmp\r\n.reqseq/local.yaml\r\n",
    );
    expect((await init(workspace, { path: "b", name: "B" })).files).not.toContain(".gitignore");
    expect(await fs.readFile(ws.path("b/.gitignore"), "utf8")).toBe(
      "x\n*.reqseq-tmp  \n.reqseq/local.yaml\n",
    );
    // A leading space is part of a Git pattern, so that line does not count.
    await init(workspace, { path: "d", name: "D" });
    expect(await fs.readFile(ws.path("d/.gitignore"), "utf8")).toBe(
      "  *.reqseq-tmp\n*.reqseq-tmp\n.reqseq/local.yaml\n",
    );
    // Only the missing line is added.
    await init(workspace, { path: "e", name: "E" });
    expect(await fs.readFile(ws.path("e/.gitignore"), "utf8")).toBe("x\n*.reqseq-tmp\n.reqseq/local.yaml\n");
    // Both there, the last without a line ending: left as it is.
    expect((await init(workspace, { path: "f", name: "F" })).files).not.toContain(".gitignore");
    expect(await fs.readFile(ws.path("f/.gitignore"), "utf8")).toBe("*.reqseq-tmp\r\n.reqseq/local.yaml");
    // A .gitignore that is a link is not followed and left alone.
    await fs.symlink(ws.path("a/.gitignore"), ws.path("c/.gitignore"), "file");
    expect((await init(workspace, { path: "c", name: "C" })).files).not.toContain(".gitignore");
  });

  it("keeps the bytes of a .gitignore that is not UTF-8", async () => {
    const ws = await emptyFolder();
    await fs.writeFile(ws.path(".gitignore"), Buffer.from([0x62, 0xfc, 0x0a]));
    await init(open(ws.root), { path: ws.root, name: "W" });
    expect([...(await fs.readFile(ws.path(".gitignore")))]).toEqual([
      0x62,
      0xfc,
      0x0a,
      ...Buffer.from("*.reqseq-tmp\n.reqseq/local.yaml\n"),
    ]);
  });

  it("appends to an empty .gitignore without a blank line", async () => {
    const ws = await createFixtureWorkspace({ files: { ".gitignore": "" } });
    onTestFinished(() => ws.cleanup());
    await init(open(ws.root), { path: ws.root, name: "W" });
    expect(await fs.readFile(ws.path(".gitignore"), "utf8")).toBe("*.reqseq-tmp\n.reqseq/local.yaml\n");
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

  it("creates the folder of the workspace when only it is missing (#637)", async () => {
    const ws = await emptyFolder();
    await init(open(ws.root), { path: "spec", name: "W" });
    expect(await listFiles(ws.root)).toEqual([
      `spec/${SKILL}`,
      "spec/.gitignore",
      "spec/metamodel/standard-model.yaml",
      "spec/reqseq-workspace.yaml",
    ]);
  });

  it("refuses a folder whose parent is missing too and a path that is a file", async () => {
    const ws = await createFixtureWorkspace({ files: { "a-file": "x" } });
    onTestFinished(() => ws.cleanup());
    const workspace = open(ws.root);
    const missing = await init(workspace, { path: "missing/below", name: "W" }).catch((e: unknown) => e);
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
    await expect(init(workspace, { path: "a-file/below", name: "W" })).rejects.toMatchObject({
      code: "file.folder-missing",
      message: "Not written: the path above the new workspace is not a folder",
    });
    vi.spyOn(fs, "stat").mockRejectedValueOnce(Object.assign(new Error("EACCES"), { code: "EACCES" }));
    await expect(init(workspace, { path: ws.root, name: "W" })).rejects.toMatchObject({ code: "internal" });
    expect(await listFiles(ws.root)).toEqual(["a-file"]);
  });

  it("refuses a link to a missing folder instead of creating it (#637)", async () => {
    const ws = await emptyFolder();
    // lstat finds the link while stat finds no target: a dangling link, mocked to stay platform-neutral.
    vi.spyOn(fs, "lstat").mockResolvedValueOnce({} as Awaited<ReturnType<typeof fs.lstat>>);
    await expect(init(open(ws.root), { path: "dangling", name: "W" })).rejects.toMatchObject({
      code: "file.folder-missing",
      message: "Not written: the path of the new workspace links to a missing folder",
    });
    expect(await listFiles(ws.root)).toEqual([]);
  });
});
