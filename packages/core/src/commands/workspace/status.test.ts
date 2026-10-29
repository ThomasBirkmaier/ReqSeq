import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type * as Reader from "../../git/reader.js";
import { headCommit } from "../../git/reader.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import { metamodelState } from "../../metamodel/index.js";
import { availableRepositories, workspaceLayoutState } from "../../workspace/index.js";
import type { CommandOutput } from "../../catalog.js";

// The real reader, wrapped so that one test can make git refuse a repository.
vi.mock("../../git/reader.js", async (importOriginal) => {
  const original = await importOriginal<typeof Reader>();
  return { ...original, headCommit: vi.fn(original.headCommit) };
});

const fixture = async (options: Parameters<typeof createFixtureWorkspace>[0]): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace(options);
  onTestFinished(() => created.cleanup());
  return created;
};

const open = (root: string): Workspace => {
  const workspace = new Workspace(root);
  onTestFinished(() => workspace.close());
  return workspace;
};

const status = async (workspace: Workspace): Promise<CommandOutput<"workspace.status">> =>
  (await invoke("workspace.status", {}, { workspace })) as CommandOutput<"workspace.status">;

/**
 * `readOnly: false` of a writable repository folder. Left out on Windows, where the operating
 * system cannot tell (`isWritableFolder`), so the expectation follows the platform.
 */
const writable: { readonly readOnly?: false } = process.platform === "win32" ? {} : { readOnly: false };

/** The three-repository fixture: `system` (main, holds the workspace file), `product`, `sensor` beside it. */
const threeRepositories = async (
  git: readonly string[] = ["system", "product", "sensor"],
): Promise<FixtureWorkspace> => fixture({ fixture: "SR-004/three-repositories", git });

describe("workspace.status", () => {
  it("[SR-004/AK1] exposes the roots of all three locally present repositories for element discovery", async () => {
    // #127 option 1 by analogy: element discovery is SR-003, which builds on these roots and adds
    // the element-level [SR-004/AK1] test.
    const ws = await threeRepositories();
    const workspace = open(ws.path("system"));
    const layout = await workspace.get(workspaceLayoutState);
    expect(availableRepositories(layout).map((r) => [r.name, r.folder])).toEqual([
      ["system", ws.path("system")],
      ["product", ws.path("product")],
      ["sensor", ws.path("sensor")],
    ]);
    expect(availableRepositories(layout).map((r) => r.excludes)).toEqual([[], [], []]);
  });

  it("[SR-004/AK1] reports all three repositories as available with their commits", async () => {
    const ws = await threeRepositories();
    const out = await status(open(ws.path("system")));
    expect(out).toEqual({
      name: "Weather station",
      repositories: [
        { name: "system", available: true, path: ".", commit: await ws.head("system"), ...writable },
        {
          name: "product",
          available: true,
          path: "../product",
          commit: await ws.head("product"),
          ...writable,
        },
        {
          name: "sensor",
          available: true,
          path: "../sensor",
          commit: await ws.head("sensor"),
          ...writable,
        },
      ],
      metamodel: { repository: "system", path: "metamodel", valid: true },
      readOnly: false,
      problems: [],
    });
  });

  it("[SR-004/AK2] opens a single-repository workspace the same way", async () => {
    const ws = await fixture({ fixture: "SR-004/one-repository", git: true });
    const workspace = open(ws.root);
    const out = await status(workspace);
    expect(out).toEqual({
      name: "Weather station",
      repositories: [{ name: "system", available: true, path: ".", commit: await ws.head(), ...writable }],
      metamodel: { repository: "system", path: "metamodel", valid: true },
      readOnly: false,
      problems: [],
    });
    const layout = await workspace.get(workspaceLayoutState);
    expect(availableRepositories(layout).map((r) => r.folder)).toEqual([ws.root]);
  });

  it("[SR-004/AK2] gives the same result shape as a multi-repository workspace", async () => {
    const one = await fixture({ fixture: "SR-004/one-repository", git: true });
    const three = await threeRepositories();
    const single = await status(open(one.root));
    const multi = await status(open(three.path("system")));
    const shape = (out: CommandOutput<"workspace.status">): unknown => ({
      keys: Object.keys(out).sort(),
      repository: Object.keys(out.repositories[0] ?? {}).sort(),
      metamodel: out.metamodel,
      readOnly: out.readOnly,
      problems: out.problems,
    });
    expect(shape(single)).toEqual(shape(multi));
  });

  it("[SR-004/AK2] takes the only repository as the main one without main: true", async () => {
    const ws = await fixture({
      fixture: "SR-004/one-repository",
      files: {
        "logreq-workspace.yaml":
          "logreq-workspace: 1\nname: Solo\nrepositories:\n  - { name: solo, url: x }\nmetamodel: { repository: solo, path: metamodel }\n",
      },
    });
    const out = await status(open(ws.root));
    expect(out.repositories).toEqual([{ name: "solo", available: true, path: ".", ...writable }]);
    expect(out.metamodel.valid).toBe(true);
    expect(out.problems).toEqual([]);
  });

  it("[SR-004/AK3] shows a missing repository as not available and works with the others", async () => {
    const ws = await threeRepositories(["system", "sensor"]);
    await fs.rm(ws.path("product"), { recursive: true });
    const workspace = open(ws.path("system"));
    const out = await status(workspace);
    expect(out.repositories).toEqual([
      { name: "system", available: true, path: ".", commit: await ws.head("system"), ...writable },
      { name: "product", available: false, path: "../product" },
      {
        name: "sensor",
        available: true,
        path: "../sensor",
        commit: await ws.head("sensor"),
        ...writable,
      },
    ]);
    expect(out.metamodel.valid).toBe(true);
    expect(out.readOnly).toBe(false);
    expect(out.problems).toEqual([
      {
        code: "workspace.repository-missing",
        severity: "info",
        message: "Repository product is not available locally",
      },
    ]);
    const layout = await workspace.get(workspaceLayoutState);
    expect(availableRepositories(layout).map((r) => r.name)).toEqual(["system", "sensor"]);
  });

  it("[SR-004/AK3] treats a repository whose local override points nowhere as missing", async () => {
    const ws = await threeRepositories();
    await ws.write(
      "system/.logreq/local.yaml",
      "logreq-local: 1\nrepositories:\n  sensor: { path: ../checkouts/sensor }\n",
    );
    const out = await status(open(ws.path("system")));
    expect(out.repositories.map((r) => [r.name, r.available, r.path])).toEqual([
      ["system", true, "."],
      ["product", true, "../product"],
      ["sensor", false, "../checkouts/sensor"],
    ]);
    expect(out.problems?.map((p) => p.code)).toEqual(["workspace.repository-missing"]);
  });

  it("[SR-004/AK3] treats a path that is a file as a missing repository", async () => {
    const ws = await threeRepositories(["system", "product"]);
    await fs.rm(ws.path("sensor"), { recursive: true });
    await ws.write("sensor", "not a folder");
    const out = await status(open(ws.path("system")));
    expect(out.repositories[2]).toEqual({ name: "sensor", available: false, path: "../sensor" });
  });

  it("[SR-004/AK3] reports the metamodel as not valid when its repository is missing, without failing", async () => {
    const ws = await threeRepositories(["system", "product"]);
    await ws.write(
      "system/logreq-workspace.yaml",
      "logreq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x, main: true }\n  - { name: models, url: y }\nmetamodel: { repository: models, path: model }\n",
    );
    const out = await status(open(ws.path("system")));
    expect(out.metamodel).toEqual({ repository: "models", path: "model", valid: false });
    expect(out.repositories[0]?.available).toBe(true);
    expect(out.problems?.map((p) => [p.code, p.severity, p.message])).toEqual([
      ["workspace.repository-missing", "info", "Repository models is not available locally"],
      ["metamodel.invalid", "error", "Metamodel repository models is not available"],
    ]);
  });

  it("tells when git refuses to read a repository, and keeps working", async () => {
    const ws = await threeRepositories();
    vi.mocked(headCommit).mockResolvedValueOnce({
      known: false,
      reason: "refused",
      detail: "dubious ownership",
    });
    const out = await status(open(ws.path("system")));
    expect(out.repositories.map((r) => [r.name, r.commit])).toEqual([
      ["system", undefined],
      ["product", await ws.head("product")],
      ["sensor", await ws.head("sensor")],
    ]);
    expect(out.problems).toEqual([
      {
        code: "git.unavailable",
        severity: "info",
        repository: "system",
        message:
          "Git refuses to read repository system because another user owns it (see git config safe.directory); its commit is unknown",
      },
    ]);
  });

  it("leaves the commit out for a repository folder that is not a Git repository", async () => {
    const ws = await threeRepositories(["system", "product"]);
    const out = await status(open(ws.path("system")));
    expect(out.repositories[2]).toEqual({
      name: "sensor",
      available: true,
      path: "../sensor",
      ...writable,
    });
  });

  it("reports the commit of a repository folder in a subfolder of a Git repository (#377)", async () => {
    const outer = await fixture({ files: { "top.md": "top\n" }, git: true });
    const ws = await fixture({ fixture: "SR-001/two-elements", tempDir: outer.root });
    // The commit has a tree at the folder only once the workspace is committed.
    await outer.commit();
    const out = await status(open(ws.root));
    expect(out.repositories).toEqual([
      { name: "system", available: true, path: ".", commit: await outer.head(), ...writable },
    ]);
  });

  it("leaves the commit out where the Git repository above tracks nothing in the folder (#377)", async () => {
    // A work tree that ignores the folder, as a home folder under Git with `*` ignored.
    const outer = await fixture({ files: { "top.md": "top\n", ".gitignore": "*/\n" }, git: true });
    const ws = await fixture({ fixture: "SR-001/two-elements", tempDir: outer.root });
    const out = await status(open(ws.root));
    expect(out.repositories).toEqual([{ name: "system", available: true, path: ".", ...writable }]);
    expect(out.problems).toEqual([]);
  });

  it("reads the commit on every call", async () => {
    const ws = await fixture({ fixture: "SR-004/one-repository", git: true });
    const workspace = open(ws.root);
    const before = await status(workspace);
    await ws.write("requirements/new.md", "text\n");
    const after = await ws.commit();
    expect((await status(workspace)).repositories[0]?.commit).toBe(after);
    expect(before.repositories[0]?.commit).not.toBe(after);
  });

  it("fails with workspace.not-found without a workspace file", async () => {
    const ws = await fixture({ files: { "README.md": "no workspace\n" } });
    await expect(status(open(ws.root))).rejects.toMatchObject({ code: "workspace.not-found" });
  });
});

describe("workspace.status with the metamodel (SR-011)", () => {
  const splitFolder = async (
    options: Parameters<typeof createFixtureWorkspace>[0] = {},
  ): Promise<FixtureWorkspace> => fixture({ fixture: "SR-011/split-folder", ...options });

  it("[SR-011/AK1] opens with the metamodel of the folder named in the workspace file", async () => {
    const ws = await splitFolder({ git: true });
    const out = await status(open(ws.root));
    expect(out).toEqual({
      name: "Weather station",
      repositories: [{ name: "system", available: true, path: ".", commit: await ws.head(), ...writable }],
      metamodel: { repository: "system", path: "model", valid: true },
      readOnly: false,
      problems: [
        {
          code: "metamodel.invalid",
          severity: "warning",
          repository: "system",
          file: "model/legacy.yml",
          message: "model/legacy.yml is not read: metamodel files end in .yaml",
        },
      ],
    });
  });

  it("[SR-011/AK2] is read-only only while the checked-out state has a faulty metamodel", async () => {
    const ws = await splitFolder({ git: true });
    await ws.git(["checkout", "--quiet", "-b", "broken"]);
    await ws.write("model/statuses.yaml", "statuses: [draft\n");
    await ws.commit(".", "break the metamodel");
    const workspace = open(ws.root);
    expect(await status(workspace)).toMatchObject({ metamodel: { valid: false }, readOnly: true });
    await ws.git(["checkout", "--quiet", "main"]);
    await workspace.reset(metamodelState);
    expect(await status(workspace)).toMatchObject({ metamodel: { valid: true }, readOnly: false });
  });

  it("[SR-011/AK3] opens the workspace read-only and reports file, line and reason of faulty YAML", async () => {
    const ws = await splitFolder({
      files: { "model/statuses.yaml": "logreq-metamodel: 1\nstatuses:\n  - key: draft\n    name: [Draft\n" },
    });
    const out = await status(open(ws.root));
    expect(out.metamodel).toEqual({ repository: "system", path: "model", valid: false });
    expect(out.readOnly).toBe(true);
    expect(out.problems?.filter((p) => p.severity === "error")).toEqual([
      {
        code: "file.invalid-yaml",
        severity: "error",
        repository: "system",
        file: "model/statuses.yaml",
        line: 4,
        message: expect.stringMatching(/^Invalid YAML at line 4, column \d+: .+/) as unknown,
      },
    ]);
  });

  it("is read-only when the metamodel folder is missing", async () => {
    const ws = await splitFolder();
    await fs.rm(ws.path("model"), { recursive: true });
    const out = await status(open(ws.root));
    expect(out).toMatchObject({ metamodel: { valid: false }, readOnly: true });
    expect(out.problems?.map((p) => p.message)).toEqual([
      "Metamodel folder model is missing in repository system",
    ]);
  });
});
