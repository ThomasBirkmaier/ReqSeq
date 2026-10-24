import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation } from "../workspace/index.js";
import { listMarkdownFiles } from "./discover.js";
import { ignoreMatcher } from "./ignore.js";
import { elementStoreState } from "./store.js";

const fixture = async (files: Readonly<Record<string, string>>): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ files });
  onTestFinished(() => created.cleanup());
  return created;
};

const repository = (folder: string, excludes: readonly string[] = []): RepositoryLocation => ({
  name: "r",
  url: "u",
  main: true,
  path: ".",
  folder,
  available: true,
  excludes,
});

const nothing = (): boolean => false;

const skippedWarning = (file: string, reason: string): unknown => ({
  code: "file.skipped",
  severity: "warning",
  repository: "r",
  file,
  message: `Not read: ${reason}`,
});

/** Spies on `readdir`; `fail` names the folders (by base name) that cannot be listed. */
const spyReaddir = (fail: readonly string[] = []): string[] => {
  const listed: string[] = [];
  const readdir = fs.readdir.bind(fs);
  const spy = vi.spyOn(fs, "readdir").mockImplementation(((folder: string, options: never) => {
    listed.push(folder);
    return fail.includes(path.basename(folder))
      ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
      : readdir(folder, options);
  }) as typeof fs.readdir);
  onTestFinished(() => {
    spy.mockRestore();
  });
  return listed;
};

describe("listMarkdownFiles", () => {
  it("lists only .md files, sorted by code units, whatever their folder", async () => {
    const ws = await fixture({
      "b.md": "",
      "a/z.md": "",
      "a/B.md": "",
      "a/notes.txt": "",
      "c.md/inner.md": "",
      ".hidden/x.md": "",
    });
    expect(await listMarkdownFiles(repository(ws.root), nothing)).toEqual({
      files: [".hidden/x.md", "a/B.md", "a/z.md", "b.md", "c.md/inner.md"],
      problems: [],
    });
  });

  it("warns about Markdown files whose extension is not lower-case .md and does not read them", async () => {
    const ws = await fixture({ "a.md": "", "b.MD": "", "sub/c.Md": "" });
    expect(await listMarkdownFiles(repository(ws.root), nothing)).toEqual({
      files: ["a.md"],
      problems: [
        skippedWarning("b.MD", "element files end in .md in lower case"),
        skippedWarning("sub/c.Md", "element files end in .md in lower case"),
      ],
    });
  });

  it("skips the folders it is told to exclude", async () => {
    const ws = await fixture({ "a.md": "", "nested/b.md": "", "other/c.md": "" });
    const listed = await listMarkdownFiles(repository(ws.root, [ws.path("nested")]), nothing);
    expect(listed.files).toEqual(["a.md", "other/c.md"]);
  });

  it("skips an ignored folder as a whole, without listing it", async () => {
    const ws = await fixture({ "a.md": "", "docs/b.md": "", "docs/deep/c.md": "", "docsx/d.md": "" });
    const listed = spyReaddir();
    const result = await listMarkdownFiles(repository(ws.root), ignoreMatcher(["docs/**"]));
    expect(result.files).toEqual(["a.md", "docsx/d.md"]);
    expect(listed.map((folder) => path.relative(ws.root, folder))).not.toContain("docs");
  });

  it("does not follow links and warns about a linked .md file", async () => {
    const ws = await fixture({ "real/a.md": "", "outside/b.md": "" });
    await fs.symlink(ws.path("outside"), ws.path("real/linked"), "junction");
    await fs.symlink(ws.path("outside/b.md"), ws.path("real/link.md"), "file");
    await fs.symlink(ws.path("outside/b.md"), ws.path("real/link.txt"), "file");
    expect(await listMarkdownFiles(repository(ws.path("real")), nothing)).toEqual({
      files: ["a.md"],
      problems: [skippedWarning("link.md", "it is a symbolic link; LogReq does not follow links")],
    });
  });

  it("reports folders that cannot be listed, sorted with the other problems, and lists the rest", async () => {
    const ws = await fixture({ "a.md": "", "x/b.md": "", "y/c.md": "", "y/w.MD": "", "z/d.md": "" });
    spyReaddir(["x", "z"]);
    const denied = (file: string): unknown => ({
      code: "file.unreadable",
      severity: "error",
      repository: "r",
      file,
      message: "Cannot read folder: EACCES",
    });
    expect(await listMarkdownFiles(repository(ws.root), nothing)).toEqual({
      files: ["a.md", "y/c.md"],
      problems: [
        denied("x"),
        skippedWarning("y/w.MD", "element files end in .md in lower case"),
        denied("z"),
      ],
    });
  });

  it("warns about a .md entry that is not a regular file (FIFO, socket, device)", async () => {
    const ws = await fixture({ "a.md": "" });
    const readdir = fs.readdir.bind(fs);
    const fifo = {
      name: "pipe.md",
      isDirectory: () => false,
      isFile: () => false,
      isSymbolicLink: () => false,
    };
    const spy = vi
      .spyOn(fs, "readdir")
      .mockImplementation((async (folder: string, options: never) => [
        ...((await readdir(folder, options)) as unknown[]),
        fifo,
      ]) as typeof fs.readdir);
    onTestFinished(() => {
      spy.mockRestore();
    });
    expect(await listMarkdownFiles(repository(ws.root), nothing)).toEqual({
      files: ["a.md"],
      problems: [skippedWarning("pipe.md", "it is not a regular file")],
    });
  });

  it("gives the store a warning, not an error, for a linked Markdown file", async () => {
    const ws = await fixture({
      "logreq-workspace.yaml":
        "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: solo, url: x }\nmetamodel: { repository: solo, path: metamodel }\n",
      "metamodel/m.yaml": "logreq-metamodel: 1\n",
      "AGENTS.md": "# Rules\n",
      "elsewhere/SR-0c1d2e3f4a5b.md": "---\nid: 6b1f1b9e-2a39-4c4c-9a4e-0c1d2e3f4a5b\ntype: t\n---\n",
    });
    await fs.symlink(ws.path("AGENTS.md"), ws.path("CLAUDE.md"), "file");
    const workspace = new Workspace(ws.root);
    onTestFinished(() => workspace.close());
    const s = await workspace.get(elementStoreState);
    expect(s.elements.map((e) => e.file)).toEqual(["elsewhere/SR-0c1d2e3f4a5b.md"]);
    expect(s.problems.map((p) => [p.code, p.severity, p.repository, p.file])).toEqual([
      ["file.skipped", "warning", "solo", "CLAUDE.md"],
    ]);
  });
});
