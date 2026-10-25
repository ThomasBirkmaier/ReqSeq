import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FixtureOptions, FixtureWorkspace } from "./index.js";
import { cloneFixtureWorkspace, createFixtureWorkspace, defaultFixturesDir } from "./index.js";

const created: FixtureWorkspace[] = [];
const make = async (options?: FixtureOptions): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace(options);
  created.push(ws);
  return ws;
};
afterEach(async () => {
  await Promise.all(created.splice(0).map((ws) => ws.cleanup()));
});

const read = (file: string): string => fs.readFileSync(file, "utf8");
const COMMIT = /^[0-9a-f]{40}$/;

describe("createFixtureWorkspace", () => {
  it("creates an empty, symlink-free temporary root without options", async () => {
    const ws = await make();
    expect(path.isAbsolute(ws.root)).toBe(true);
    expect(fs.realpathSync.native(ws.root)).toBe(ws.root);
    expect(fs.readdirSync(ws.root)).toEqual([]);
    expect(ws.root.startsWith(fs.realpathSync.native(os.tmpdir()))).toBe(true);
  });

  it("gives every call its own folder", async () => {
    const a = await make();
    const b = await make();
    expect(a.root).not.toBe(b.root);
  });

  it("writes text and binary files in nested folders", async () => {
    const ws = await make({
      files: {
        "logreq-workspace.yaml": "logreq-workspace: 1\n",
        "a/b/c.md": "text",
        "img.png": Uint8Array.of(0, 255),
      },
    });
    expect(read(ws.path("logreq-workspace.yaml"))).toBe("logreq-workspace: 1\n");
    expect(read(ws.path("a/b/c.md"))).toBe("text");
    expect([...fs.readFileSync(ws.path("img.png"))]).toEqual([0, 255]);
    await ws.write("a/new/d.md", "more");
    expect(read(path.join(ws.root, "a", "new", "d.md"))).toBe("more");
  });

  it("rejects paths that leave the workspace or use backslashes", async () => {
    const ws = await make();
    expect(() => ws.path("../x")).toThrow(/relative/);
    expect(() => ws.path("a/../../x")).toThrow(/relative/);
    expect(() => ws.path(path.resolve("/abs"))).toThrow(/relative/);
    expect(() => ws.path("a\\b")).toThrow(/relative/);
  });

  it("copies a fixture case and lets files override it", async () => {
    const fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), "logreq-fixtures-"));
    try {
      fs.mkdirSync(path.join(fixturesDir, "SR-000", "case", "sub"), { recursive: true });
      fs.writeFileSync(path.join(fixturesDir, "SR-000", "case", "keep.md"), "copied");
      fs.writeFileSync(path.join(fixturesDir, "SR-000", "case", "sub", "x.md"), "old");
      const ws = await make({ fixturesDir, fixture: "SR-000/case", files: { "sub/x.md": "new" } });
      expect(read(ws.path("keep.md"))).toBe("copied");
      expect(read(ws.path("sub/x.md"))).toBe("new");
      // The fixture itself stays untouched.
      expect(read(path.join(fixturesDir, "SR-000", "case", "sub", "x.md"))).toBe("old");
    } finally {
      fs.rmSync(fixturesDir, { recursive: true, force: true });
    }
  });

  it("looks up fixtures in the repository's fixtures folder by default", async () => {
    expect(fs.existsSync(path.join(defaultFixturesDir, "README.md"))).toBe(true);
    await expect(make({ fixture: "no-such-case" })).rejects.toThrow(/no-such-case/);
  });

  it("removes the temporary folder when building fails", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "logreq-parent-"));
    try {
      await expect(make({ tempDir, files: { "../escape.md": "x" } })).rejects.toThrow(/relative/);
      expect(fs.readdirSync(tempDir)).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("turns the root into a Git repository with one clean commit", async () => {
    const ws = await make({ files: { "a.md": "a" }, git: true });
    const head = await ws.head();
    expect(head).toMatch(COMMIT);
    expect(await ws.git(["status", "--porcelain"])).toBe("");
    expect((await ws.git(["ls-files"])).trim()).toBe("a.md");
    // Unix time instead of %aI: Git 2.55 on macOS prints UTC as "Z", older Git as "+00:00".
    expect((await ws.git(["log", "--format=%an <%ae> %at %s"])).trim()).toBe(
      "LogReq Test <test@logreq.invalid> 1767225601 fixture",
    );
    expect((await ws.git(["branch", "--show-current"])).trim()).toBe("main");
  });

  it("produces the same commit ID for the same content", async () => {
    const a = await make({ files: { "a.md": "a" }, git: true });
    const b = await make({ files: { "a.md": "a" }, git: true });
    expect(await a.head()).toBe(await b.head());
  });

  it("creates several repositories, also empty ones", async () => {
    const ws = await make({
      files: { "logreq-workspace.yaml": "x", "product/p.md": "p" },
      git: ["product", "system"],
    });
    expect(await ws.head("product")).toMatch(COMMIT);
    expect(await ws.head("system")).toMatch(COMMIT);
    expect(fs.existsSync(ws.path(".git"))).toBe(false);
    expect((await ws.git(["ls-files"], "system")).trim()).toBe("");
  });

  it("commits later changes with a new commit ID", async () => {
    const ws = await make({ files: { "a.md": "a" }, git: true });
    const first = await ws.head();
    await ws.write("a.md", "changed");
    expect((await ws.git(["status", "--porcelain"])).trim()).toBe("M a.md");
    const second = await ws.commit(".", "change a");
    expect(second).not.toBe(first);
    expect((await ws.git(["log", "-1", "--format=%s"])).trim()).toBe("change a");
    await ws.write("product/b.md", "b");
    await ws.git(["init", "--quiet"], "product");
    expect(await ws.commit("product")).toMatch(COMMIT);
    await ws.write("c.md", "c");
    expect(await ws.commit()).toMatch(COMMIT);
  });

  it("ignores Git variables inherited from the environment", async () => {
    vi.stubEnv("GIT_DIR", path.join(os.tmpdir(), "not-a-repo"));
    try {
      const ws = await make({ files: { "a.md": "a" }, git: true });
      expect(await ws.head()).toMatch(COMMIT);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("makes commits of many files without touching the working tree, the index or a branch", async () => {
    const ws = await make({ files: { "a.md": "a" }, git: true });
    const before = await ws.head();
    const first = await ws.commitFiles({
      "a.md": "changed",
      "sub/b.md": "b",
      "img.png": Uint8Array.of(0, 255),
    });
    expect(first).toMatch(COMMIT);
    expect(await ws.head()).toBe(before);
    expect(await ws.git(["status", "--porcelain"])).toBe("");
    expect(read(ws.path("a.md"))).toBe("a");
    expect(await ws.git(["show", `${first}:a.md`])).toBe("changed");
    expect((await ws.git(["log", "-1", "--format=%P %an %s", first])).trim()).toBe(
      `${before} LogReq Test fixture`,
    );
    // On another parent, with a message; no branch or other ref is left.
    const second = await ws.commitFiles({ "c.md": "c" }, { parent: first, message: "upstream" });
    expect((await ws.git(["log", "-1", "--format=%P %s", second])).trim()).toBe(`${first} upstream`);
    expect(await ws.git(["show", `${second}:sub/b.md`])).toBe("b");
    expect((await ws.git(["for-each-ref", "--format=%(refname)"])).trim()).toBe("refs/heads/main");
    await ws.git(["merge", "--quiet", "--ff-only", second]);
    expect([...fs.readFileSync(ws.path("img.png"))]).toEqual([0, 255]);
    expect(read(ws.path("c.md"))).toBe("c");
    await expect(ws.commitFiles({ "../x.md": "x" })).rejects.toThrow(/relative/);
    await expect(ws.commitFiles({ '"q.md': "x" })).rejects.toThrow(/quote/);
    await expect(ws.commitFiles({ "a\nb.md": "x" })).rejects.toThrow(/line break/);
  });

  it("rejects with git's own error when git exits before it read its input", async () => {
    const ws = await make({ git: true });
    // More than any pipe holds: the rest of the write fails (EPIPE) once git has exited.
    await expect(
      ws.git(["rev-parse", "--verify", "--quiet", "nope"], ".", Buffer.alloc(16 * 1024 * 1024)),
    ).rejects.toThrow(/rev-parse/);
  });

  it("removes everything on cleanup", async () => {
    const ws = await createFixtureWorkspace({ files: { "a.md": "a" }, git: true });
    await ws.cleanup();
    expect(fs.existsSync(ws.root)).toBe(false);
    expect(fs.existsSync(path.dirname(ws.root))).toBe(false);
  });
});

describe("cloneFixtureWorkspace", () => {
  const clone = async (...args: Parameters<typeof cloneFixtureWorkspace>): Promise<FixtureWorkspace> => {
    const ws = await cloneFixtureWorkspace(...args);
    created.push(ws);
    return ws;
  };

  it("clones the root repository into a separate working copy with the same commit", async () => {
    const origin = await make({ files: { "a.md": "a" }, git: true });
    const copy = await clone(origin);
    expect(copy.root).not.toBe(origin.root);
    expect(fs.realpathSync.native(copy.root)).toBe(copy.root);
    expect(read(copy.path("a.md"))).toBe("a");
    expect(await copy.head()).toBe(await origin.head());
    expect(await copy.git(["status", "--porcelain"])).toBe("");
    // A change in the copy stays there until someone merges it.
    await copy.write("b.md", "b");
    expect(await copy.commit()).toMatch(COMMIT);
    expect(fs.existsSync(origin.path("b.md"))).toBe(false);
  });

  it("clones another repository of the fixture, into a given parent folder", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "logreq-parent-"));
    try {
      const origin = await make({ files: { "product/p.md": "p" }, git: ["product"] });
      const copy = await clone(origin, "product", { tempDir });
      expect(read(copy.path("p.md"))).toBe("p");
      expect(copy.root.startsWith(fs.realpathSync.native(tempDir))).toBe(true);
    } finally {
      await Promise.all(created.splice(0).map((ws) => ws.cleanup()));
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("removes the temporary folder when the clone fails", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "logreq-parent-"));
    try {
      // No Git repository to clone.
      const origin = await make({ files: { "a.md": "a" } });
      await expect(cloneFixtureWorkspace(origin, ".", { tempDir })).rejects.toThrow(/git/);
      expect(fs.readdirSync(tempDir)).toEqual([]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
