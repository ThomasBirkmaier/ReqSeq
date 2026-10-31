// createElementFiles (src/model/new-files.ts): all or nothing, with failures the file system cannot be
// made to produce on demand (a name taken while the call runs, a file changed before the rollback, no
// hard links). `fs.link` is wrapped so a test can make chosen calls do something else.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../catalog.js";
import { metamodelState } from "../metamodel/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation } from "../workspace/index.js";
import { locate, workspaceLayoutState } from "../workspace/index.js";
import type { NewElementFile } from "./new-files.js";
import { createElementFiles, plannedVersion } from "./new-files.js";
import { newElementBase, newElementBytes } from "./write.js";

const ID_A = "0b4a6f7e-9c1d-4e2a-8f3b-5d6c7e8f9a01";
const ID_B = "0b4a6f7e-9c1d-4e2a-8f3b-5d6c7e8f9a02";

const setup = async (): Promise<{
  workspace: Workspace;
  root: string;
  repository: RepositoryLocation;
  files: NewElementFile[];
  run: () => Promise<string[]>;
}> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-004/one-repository" });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  const layout = await workspace.get(workspaceLayoutState);
  const metamodel = await workspace.get(metamodelState);
  const repository = locate(layout, { repository: layout.main, path: "" }).repository;
  if (repository === undefined) {
    throw new Error("no main repository");
  }
  const base = newElementBase(metamodel, "need", "reqif.import");
  const files = [ID_A, ID_B].map((id, index) => ({
    file: `N-${String(index)}.md`,
    bytes: newElementBytes(base, id, `Need ${String(index)}`, "Text.", []),
  }));
  return {
    workspace,
    root: fixture.root,
    repository,
    files,
    run: () => createElementFiles(workspace, layout, repository, files),
  };
};

const failure = async (run: () => Promise<unknown>): Promise<CommandError> => {
  try {
    await run();
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("did not fail");
};

const names = async (root: string): Promise<string[]> =>
  (await fs.readdir(root)).filter((name) => name.startsWith("N-")).sort();

describe("createElementFiles", () => {
  it("writes every file, leaves no temporary sibling and gives each the version planned for it", async () => {
    const { workspace, root, repository, files, run } = await setup();
    const metamodel = await workspace.get(metamodelState);
    expect(await run()).toEqual(["N-0.md", "N-1.md"]);
    expect(await names(root)).toEqual(["N-0.md", "N-1.md"]);
    const got = (await invoke("element.get", { ref: ID_A }, { workspace })) as {
      element: { version: string };
    };
    expect(got.element.version).toBe(
      plannedVersion(metamodel, repository.name, files[0] ?? { file: "", bytes: new Uint8Array() }),
    );
  });

  it("removes what it named when a name is taken meanwhile, and refuses with file.changed-on-disk", async () => {
    const { root, run } = await setup();
    const link = fs.link.bind(fs);
    const spy = vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
      if (String(to).endsWith("N-1.md")) {
        await fs.writeFile(to, "someone else's");
      }
      await link(from, to);
    });
    onTestFinished(() => {
      spy.mockRestore();
    });
    const error = await failure(run);
    expect([error.code, error.message, error.details?.["written"]]).toEqual([
      "file.changed-on-disk",
      "Not written: N-1.md already exists. Read it again first.",
      undefined,
    ]);
    expect(await names(root)).toEqual(["N-1.md"]);
    expect(await fs.readFile(`${root}/N-1.md`, "utf8")).toBe("someone else's");
  });

  it("keeps a file it named that was changed before the rollback, and names it", async () => {
    const { root, run } = await setup();
    const link = fs.link.bind(fs);
    const spy = vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
      if (String(to).endsWith("N-1.md")) {
        await fs.writeFile(`${root}/N-0.md`, "changed");
        const error: NodeJS.ErrnoException = new Error("exists");
        error.code = "EEXIST";
        throw error;
      }
      await link(from, to);
    });
    onTestFinished(() => {
      spy.mockRestore();
    });
    const error = await failure(run);
    expect([error.code, error.details?.["written"]]).toEqual(["file.changed-on-disk", ["N-0.md"]]);
    expect(await names(root)).toEqual(["N-0.md"]);
  });

  it("counts a file it named that is gone before the rollback as removed", async () => {
    const { root, run } = await setup();
    const link = fs.link.bind(fs);
    const spy = vi.spyOn(fs, "link").mockImplementation(async (from, to) => {
      if (String(to).endsWith("N-1.md")) {
        await fs.rm(`${root}/N-0.md`);
        const gone: NodeJS.ErrnoException = new Error("exists");
        gone.code = "EEXIST";
        throw gone;
      }
      await link(from, to);
    });
    onTestFinished(() => {
      spy.mockRestore();
    });
    const removed = await failure(run);
    expect(removed.details?.["written"]).toBeUndefined();
    expect(await names(root)).toEqual([]);
  });

  it("creates each file anew where the file system has no hard links", async () => {
    const { workspace, root, run } = await setup();
    const spy = vi
      .spyOn(fs, "link")
      .mockRejectedValue(Object.assign(new Error("no links"), { code: "EPERM" }));
    onTestFinished(() => {
      spy.mockRestore();
    });
    expect(await run()).toEqual(["N-0.md", "N-1.md"]);
    expect(await names(root)).toEqual(["N-0.md", "N-1.md"]);
    const list = (await invoke("element.list", {}, { workspace })) as { elements: { id: string }[] };
    expect(list.elements.map((e) => e.id)).toEqual(expect.arrayContaining([ID_A, ID_B]));
  });

  it("removes its temp files when one cannot be written, and refuses a folder linked outside", async () => {
    const { workspace, root, repository, files } = await setup();
    const layout = await workspace.get(workspaceLayoutState);
    const before = await fs.readdir(root);
    const bytes = files[0]?.bytes ?? new Uint8Array();
    const missing = await failure(() =>
      createElementFiles(workspace, layout, repository, [...files, { file: "missing/N-2.md", bytes }]),
    );
    expect(missing.code).toBe("file.folder-missing");
    expect(await fs.readdir(root)).toEqual(before);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-outside-"));
    onTestFinished(() => fs.rm(outside, { recursive: true, force: true }));
    await fs.symlink(outside, path.join(root, "out"), "junction");
    const linked = await failure(() =>
      createElementFiles(workspace, layout, repository, [...files, { file: "out/N-2.md", bytes }]),
    );
    expect(linked.code).toBe("input.invalid");
    expect(await fs.readdir(outside)).toEqual([]);
    expect((await fs.readdir(root)).sort()).toEqual([...before, "out"].sort());
  });
});
