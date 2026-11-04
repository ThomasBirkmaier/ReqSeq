// element.bulkUpdate (SR-071) into a folder that is not writable (#836, SR-018 AK2) on fixtures/SR-069/filter.
// `isWritableFolder` asks `access(W_OK)`, which is always true for root (as in a container) and
// unknown on Windows, so the test decides which folders are not writable.
import fs from "node:fs/promises";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";
import type * as layout from "../../workspace/index.js";

/** Folders (relative to `root`, `/` as separator) that count as not writable. */
const locked = vi.hoisted(() => ({ root: "", folders: [] as string[] }));

vi.mock("../../workspace/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof layout>();
  return {
    ...actual,
    isWritableFolder: (folder: string): Promise<boolean> =>
      Promise.resolve(
        !locked.folders.includes(path.relative(locked.root, folder).split(path.sep).join("/") || "."),
      ),
  };
});

type Output = CommandOutput<"element.bulkUpdate">;

const P = "69069069-0000-4000-8000-0000000000";
const [B1, N1, N2, B9] = ["b1", "a1", "a2", "b9"].map((tail) => `${P}${tail}`) as [
  string,
  string,
  string,
  string,
];
const FILES = ["needs/N-0000000000a1.md", "needs/N-0000000000a2.md", "requirements/SR-0000000000b1.md"];
/** An element at the root of the repository. */
const ROOT_FILE = "SR-0000000000b9.md";

const open = async (): Promise<{ root: string; read: () => Promise<string[]>; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-069/filter",
    files: {
      [ROOT_FILE]: `---\nid: ${B9}\ntype: system-requirement\nstatus: draft\ntitle: At the root\nrequirement-type: functional\nacceptance-criteria: [Given it, then it holds.]\n---\n`,
    },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  locked.root = fixture.root;
  return {
    root: fixture.root,
    workspace,
    read: () => Promise.all([...FILES, ROOT_FILE].map((f) => fs.readFile(fixture.path(f), "utf8"))),
  };
};

const bulk = async (workspace: Workspace, input: Record<string, unknown>): Promise<Output> =>
  (await invoke("element.bulkUpdate", input, { workspace })) as Output;

describe("element.bulkUpdate into a folder that is not writable (#836)", () => {
  it("names the folder in the preview and refuses the confirmation before any write", async () => {
    const { workspace, read } = await open();
    locked.folders = ["needs"];
    const input = { selection: { ids: [B1, N1, N2] }, property: "topic", operation: "set", value: "Locked" };
    const preview = await bulk(workspace, input);
    expect(preview.count).toBe(3);
    expect(preview.problems).toEqual([
      {
        code: "file.read-only",
        severity: "error",
        message:
          "folder needs of repository system is not writable (2 of the planned files), so a confirmation is refused; check the permissions of the folder",
        repository: "system",
      },
    ]);
    const before = await read();
    const error = await invoke(
      "element.bulkUpdate",
      { ...input, confirm: true, plan: preview.plan },
      { workspace },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandError);
    const { code, message, details } = error as CommandError;
    expect([code, message, details]).toEqual([
      "file.read-only",
      "Not written: folder needs of repository system is not writable; nothing was written",
      { repository: "system", folder: "needs" },
    ]);
    // Refused before the first write: the file in the writable folder is as it was too.
    expect(await read()).toEqual(before);
  });

  it("names the folder of the repository itself as such, and nothing when every folder is writable", async () => {
    const { workspace } = await open();
    locked.folders = ["."];
    const input = { selection: { ids: [B9, B1] }, property: "topic", operation: "set", value: "Locked" };
    expect((await bulk(workspace, input)).problems.map((p) => p.message)).toEqual([
      "the folder of repository system is not writable (1 of the planned files), so a confirmation is refused; check the permissions of the folder",
    ]);
    locked.folders = [];
    const written = await bulk(workspace, { ...input, confirm: true });
    expect([written.problems, written.count]).toEqual([[], 2]);
  });
});
