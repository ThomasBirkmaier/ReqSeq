import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation } from "../workspace/index.js";
import { listMarkdownFiles, listsFile, newFileProblem } from "./discover.js";
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

describe("listsFile (#166)", () => {
  it("agrees with listMarkdownFiles for every rule of the walk, checking only the path", async () => {
    const ws = await fixture({
      "a.md": "",
      "deep/er/b.md": "",
      "docs/c.md": "",
      "node_modules/d.md": "",
      "nested/e.md": "",
      "own/.git": "gitdir: elsewhere\n",
      "own/f.md": "",
      "c.md/inner.md": "",
      "c.md/g.md/h.md": "",
      "outside/i.md": "",
      "skip.md": "",
    });
    await fs.symlink(ws.path("outside"), ws.path("linked"), "junction");
    await fs.symlink(ws.path("outside/i.md"), ws.path("link.md"), "file");
    const repo = repository(ws.root, [ws.path("nested")]);
    const ignored = ignoreMatcher(["docs/**", "skip.md"]);
    const listed = (await listMarkdownFiles(repo, ignored)).files;
    const candidates = [
      "a.md",
      "deep/er/b.md",
      "docs/c.md",
      "node_modules/d.md",
      "nested/e.md",
      "own/f.md",
      "c.md/inner.md",
      "c.md/g.md",
      "a.md/x.md",
      "linked/i.md",
      "link.md",
      "skip.md",
      "gone/x.md",
      "deep/gone.md",
      "outside/i.md",
    ];
    for (const file of candidates) {
      expect([file, await listsFile(repo, ignored, file)]).toEqual([file, listed.includes(file)]);
    }
    expect(candidates.filter((file) => listed.includes(file))).toEqual([
      "a.md",
      "deep/er/b.md",
      "c.md/inner.md",
      "outside/i.md",
    ]);
  });

  it("newFileProblem (#183): the rules of the walk on folders that exist, only names and globs on folders still to create", async () => {
    const ws = await fixture({
      "deep/a.md": "",
      "own/.git": "gitdir: elsewhere\n",
      "nested/b.md": "",
      "file.md": "",
    });
    await fs.symlink(ws.path("deep"), ws.path("linked"), "junction");
    const repo = repository(ws.root, [ws.path("nested"), ws.path("gone/nested")]);
    const ignored = ignoreMatcher(["docs/**", "**/*.draft.md"]);
    const answers = await Promise.all(
      [
        "new.md",
        "deep/new.md",
        "gone/er/new.md",
        "deep/gone/new.md",
        "gone/node_modules/new.md",
        "gone/.git/new.md",
        "gone/docs/new.md",
        "docs/new.md",
        "deep/x.draft.md",
        "gone/nested/new.md",
        "nested/new.md",
        "own/new.md",
        "linked/new.md",
        "file.md/new.md",
      ].map(async (file) => [file, await newFileProblem(repo, ignored, file)]),
    );
    expect(Object.fromEntries(answers)).toEqual({
      "new.md": undefined,
      "deep/new.md": undefined,
      "gone/er/new.md": undefined,
      "deep/gone/new.md": undefined,
      "gone/docs/new.md": undefined,
      "gone/node_modules/new.md": { rule: "skipped-name", path: "gone/node_modules" },
      "gone/.git/new.md": { rule: "skipped-name", path: "gone/.git" },
      "docs/new.md": { rule: "ignored", path: "docs" },
      "deep/x.draft.md": { rule: "ignored", path: "deep/x.draft.md" },
      "gone/nested/new.md": { rule: "nested-repository", path: "gone/nested" },
      "nested/new.md": { rule: "nested-repository", path: "nested" },
      "own/new.md": { rule: "git-entry", path: "own" },
      "linked/new.md": { rule: "link", path: "linked" },
      "file.md/new.md": { rule: "not-a-folder", path: "file.md" },
    });
  });

  it("newFileProblem (#183): refuses what a file system that ignores case or drops trailing dots and spaces takes for another name", async () => {
    const ws = await fixture({ ".git/HEAD": "ref: refs/heads/main\n", "requirements/a.md": "" });
    // Linux keeps case, dots and spaces, so the answers of Windows and macOS are given here.
    const fold = (p: string): string =>
      p
        .split(path.sep)
        .map((name) => (name.toLowerCase().replace(/[. ]+$/, "") === "requirements" ? "requirements" : name))
        .join(path.sep)
        .replace(`${path.sep}.GIT`, `${path.sep}.git`);
    const real = { lstat: fs.lstat.bind(fs), opendir: fs.opendir.bind(fs), realpath: fs.realpath.bind(fs) };
    const spies = [
      vi.spyOn(fs, "lstat").mockImplementation(((p: string) => real.lstat(fold(p))) as typeof fs.lstat),
      vi.spyOn(fs, "opendir").mockImplementation(((p: string) => real.opendir(fold(p))) as typeof fs.opendir),
      vi
        .spyOn(fs, "realpath")
        .mockImplementation(((p: string) => real.realpath(fold(p))) as typeof fs.realpath),
    ];
    onTestFinished(() => {
      for (const spy of spies) {
        spy.mockRestore();
      }
    });
    const repo = repository(ws.root);
    const answers = await Promise.all(
      [
        ".GIT/objects/x.md",
        "Requirements/x.md",
        "REQUIREMENTS/new/x.md",
        "requirements./x.md",
        "requirements /x.md",
      ].map(async (file) => [file, await newFileProblem(repo, nothing, file)]),
    );
    expect(Object.fromEntries(answers)).toEqual({
      ".GIT/objects/x.md": { rule: "skipped-name", path: ".GIT" },
      "Requirements/x.md": { rule: "spelling", path: "Requirements", existing: "requirements" },
      "REQUIREMENTS/new/x.md": { rule: "spelling", path: "REQUIREMENTS", existing: "requirements" },
      "requirements./x.md": { rule: "not-portable", path: "requirements." },
      "requirements /x.md": { rule: "not-portable", path: "requirements " },
    });
    expect(await newFileProblem(repo, nothing, "requirements/x.md")).toBeUndefined();
  });

  it("does not list a file below a folder the walk cannot open, or in a repository it cannot open", async () => {
    const ws = await fixture({ "locked/a.md": "", "open/b.md": "" });
    const opendir = fs.opendir.bind(fs);
    let locked = ["locked"];
    const spy = vi
      .spyOn(fs, "opendir")
      .mockImplementation(((folder: string) =>
        locked.includes(path.basename(folder))
          ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
          : opendir(folder)) as typeof fs.opendir);
    onTestFinished(() => {
      spy.mockRestore();
    });
    const repo = repository(ws.root);
    expect(await listsFile(repo, nothing, "locked/a.md")).toBe(false);
    expect(await listsFile(repo, nothing, "open/b.md")).toBe(true);
    locked = [path.basename(ws.root)];
    expect(await listsFile(repo, nothing, "open/b.md")).toBe(false);
  });

  it("rejects when a path cannot be looked at", async () => {
    const ws = await fixture({ "a/b.md": "" });
    const spy = vi
      .spyOn(fs, "lstat")
      .mockRejectedValue(Object.assign(new Error("denied"), { code: "EACCES" }));
    onTestFinished(() => {
      spy.mockRestore();
    });
    await expect(listsFile(repository(ws.root), nothing, "a/b.md")).rejects.toThrow("denied");
  });

  it("does not list a path spelled in another case than its folder, as a file system that ignores case finds it", async () => {
    const ws = await fixture({ "requirements/a.md": "" });
    // Linux tells the case apart, so the answer of Windows and macOS is given here.
    const realpath = fs.realpath.bind(fs);
    const spy = vi
      .spyOn(fs, "realpath")
      .mockImplementation(((p: string) =>
        realpath(
          p.replace(`${path.sep}Requirements${path.sep}`, `${path.sep}requirements${path.sep}`),
        )) as typeof fs.realpath);
    const lstat = fs.lstat.bind(fs);
    const lstatSpy = vi
      .spyOn(fs, "lstat")
      .mockImplementation(((p: string) =>
        lstat(p.replace(`${path.sep}Requirements`, `${path.sep}requirements`))) as typeof fs.lstat);
    onTestFinished(() => {
      spy.mockRestore();
      lstatSpy.mockRestore();
    });
    expect(await listsFile(repository(ws.root), nothing, "Requirements/a.md")).toBe(false);
    expect(await listsFile(repository(ws.root), nothing, "requirements/a.md")).toBe(true);
  });
});
