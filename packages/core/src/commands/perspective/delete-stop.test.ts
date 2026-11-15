// perspective.delete (SR-217 AK7) when the delete fails only at write time, or a folder is not writable:
// the delete of the file and the writability of its folder are made to fail here, as a lock or a
// permission would.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CommandError } from "../../catalog.js";
import type * as files from "../../files/index.js";
import type * as workspaceBlock from "../../workspace/index.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

const fail = vi.hoisted(() => ({
  delete: undefined as Error | undefined,
  folder: false,
}));

vi.mock("../../files/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof files>();
  return {
    ...actual,
    deleteSavedFile: (...args: Parameters<typeof actual.deleteSavedFile>) =>
      fail.delete === undefined ? actual.deleteSavedFile(...args) : Promise.reject(fail.delete),
  };
});

vi.mock("../../workspace/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof workspaceBlock>();
  return {
    ...actual,
    isWritableFolder: async (folder: string) => (fail.folder ? false : actual.isWritableFolder(folder)),
  };
});

const DRAFTS = "reqseq-perspective: 1\nname: Drafts\nwhere: { status: [draft] }\n";

const open = async (): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-069/filter",
    files: { "perspectives/drafts.yaml": DRAFTS },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  onTestFinished(() => {
    fail.delete = undefined;
    fail.folder = false;
  });
  return { fixture, workspace };
};

const failure = async (workspace: Workspace): Promise<unknown> =>
  invoke("perspective.delete", { name: "Drafts", confirm: true }, { workspace }).then(
    () => {
      throw new Error("perspective.delete did not fail");
    },
    (error: unknown) => error,
  );

describe("perspective.delete when a write step fails (SR-217 AK7)", () => {
  it("[SR-217/AK-q14p] a delete that fails at write time names the file and its reason, and the file stays", async () => {
    const { fixture, workspace } = await open();
    fail.delete = new CommandError(
      "file.read-only",
      "Not deleted: the folder of perspectives/drafts.yaml is not writable (EPERM)",
    );
    const error = (await failure(workspace)) as CommandError;
    expect([error.code, error.message]).toEqual([
      "file.read-only",
      "Not deleted: the folder of perspectives/drafts.yaml is not writable (EPERM)",
    ]);
    // An error that is no CommandError passes on, and invoke gives it as internal.
    fail.delete = new Error("not a command error");
    expect(((await failure(workspace)) as CommandError).code).toBe("internal");
    expect(await fs.readFile(fixture.path("perspectives/drafts.yaml"), "utf8")).toBe(DRAFTS);
  });

  it("[SR-217/AK-q14p] refuses before the delete when the folder is not writable, already without confirm", async () => {
    const { fixture, workspace } = await open();
    fail.folder = true;
    for (const confirm of [false, true]) {
      const error = await invoke("perspective.delete", { name: "Drafts", confirm }, { workspace }).catch(
        (e: unknown) => e as CommandError,
      );
      expect([(error as CommandError).code, (error as CommandError).message]).toEqual([
        "file.read-only",
        "Not deleted: the folder of perspectives/drafts.yaml is not writable",
      ]);
    }
    expect(await fs.readdir(fixture.path("perspectives"))).toEqual(["drafts.yaml"]);
  });
});
