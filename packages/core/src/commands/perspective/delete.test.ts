// perspective.delete (SR-217 AK5, AK7) on fixtures/SR-069/filter with hand-written perspective files: the
// confirmation, the caller's precondition (`file`, `expectedFileSha256`, ADR-0007) and the refusals both
// kinds share. What only a saved filter has (AK6) is in commands/filter/delete.test.ts.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Deleted = CommandOutput<"perspective.delete">;

const DRAFTS = "# Open work\nreqseq-perspective: 1\nname: Drafts\nwhere: { status: [draft] }\n";
/** Hidden by `drafts.yaml`, which holds its name first. */
const HIDDEN = "reqseq-perspective: 1\nname: drafts\nwhere: { all: [] }\n";

const open = async (
  files: Record<string, string> = { "perspectives/drafts.yaml": DRAFTS },
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-069/filter", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const remove = async (workspace: Workspace, input: Record<string, unknown>): Promise<Deleted> =>
  (await invoke("perspective.delete", input, { workspace })) as Deleted;

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await remove(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("perspective.delete did not fail");
};

const listed = async (fixture: FixtureWorkspace, folder = "perspectives"): Promise<string[]> =>
  (await fs.readdir(fixture.path(folder))).sort();

describe("perspective.delete (SR-217)", () => {
  it("[SR-217/AK-bxqr] without confirm names name and file and deletes nothing; with confirm deletes the file and the folder stays", async () => {
    const { fixture, workspace } = await open();
    const named = await remove(workspace, { name: "DRAFTS" });
    expect(named).toMatchObject({
      name: "Drafts",
      file: "perspectives/drafts.yaml",
      deleted: false,
      files: [],
    });
    expect(await fs.readFile(fixture.path("perspectives/drafts.yaml"), "utf8")).toBe(DRAFTS);
    // The file given back in another spelling of the same path is that file.
    for (const file of ["perspectives\\drafts.yaml", "./perspectives/drafts.yaml"]) {
      expect((await remove(workspace, { name: "Drafts", file })).file).toBe("perspectives/drafts.yaml");
    }
    const out = await remove(workspace, {
      name: "drafts",
      confirm: true,
      file: named.file,
      expectedFileSha256: named.fileSha256,
    });
    expect(out).toEqual({ ...named, deleted: true, files: ["perspectives/drafts.yaml"] });
    // The last file is gone; its folder stays.
    expect(await listed(fixture)).toEqual([]);
    expect((await failure(workspace, { name: "Drafts" })).details).toEqual({
      command: "perspective.delete",
      fields: ["name"],
    });
  });

  it("[SR-217/AK-bxqr] [SR-217/AK-q14p] with the file and bytes of the call without confirm, refuses a file changed since, and never a duplicate that holds the name after", async () => {
    const { fixture, workspace } = await open({
      "perspectives/drafts.yaml": DRAFTS,
      "perspectives/zz.yaml": HIDDEN,
    });
    const named = await remove(workspace, { name: "Drafts" });
    // The hidden duplicate holds the name once the file is deleted: said already without confirm.
    expect(named.problems).toEqual([
      expect.objectContaining({
        code: "perspective.duplicate-name",
        severity: "warning",
        file: "perspectives/zz.yaml",
      }) as unknown,
    ]);
    const expected = { file: named.file, expectedFileSha256: named.fileSha256 };
    await fs.writeFile(fixture.path("perspectives/drafts.yaml"), `${DRAFTS}group: status\n`);
    const changed = await failure(workspace, { name: "Drafts", confirm: true, ...expected });
    expect([changed.code, changed.details]).toEqual([
      "file.changed-on-disk",
      { files: ["perspectives/drafts.yaml"] },
    ]);
    await fs.writeFile(fixture.path("perspectives/drafts.yaml"), DRAFTS);
    expect((await remove(workspace, { name: "Drafts", confirm: true, ...expected })).deleted).toBe(true);
    // The same confirmed call again finds the duplicate under the name, in another file: refused.
    const again = await failure(workspace, { name: "Drafts", confirm: true, ...expected });
    expect([again.code, again.details]).toEqual([
      "file.changed-on-disk",
      { files: ["perspectives/zz.yaml"] },
    ]);
    expect(await listed(fixture)).toEqual(["zz.yaml"]);
  });

  it("[SR-217/AK-q14p] refuses a file in Git, a missing repository, a read-only workspace and a name only a faulty file holds, and deletes nothing", async () => {
    const inGit = await open({
      "reqseq-workspace.yaml":
        "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
        "metamodel: { repository: system, path: metamodel }\n" +
        "perspectives: { repository: system, path: .git/perspectives }\n",
      ".git/perspectives/drafts.yaml": DRAFTS,
    });
    for (const confirm of [false, true]) {
      const git = await failure(inGit.workspace, { name: "Drafts", confirm });
      expect([git.code, git.details?.["reason"]]).toEqual(["input.invalid", "git-folder"]);
      expect(git.message).toMatch(/^Not deleted: /);
    }
    expect(await listed(inGit.fixture, ".git/perspectives")).toEqual(["drafts.yaml"]);

    const missing = await open({
      "reqseq-workspace.yaml":
        "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
        '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
        "metamodel: { repository: system, path: metamodel }\n" +
        "perspectives: { repository: vault, path: perspectives }\n",
      "perspectives/drafts.yaml": DRAFTS,
    });
    const gone = await failure(missing.workspace, { name: "Drafts", confirm: true });
    expect([gone.code, gone.details, gone.message]).toEqual([
      "file.folder-missing",
      { repository: "vault" },
      "Not deleted: the perspectives folder is in repository vault, which is not available on this machine",
    ]);
    expect(await listed(missing.fixture)).toEqual(["drafts.yaml"]);

    const broken = await open({
      "perspectives/drafts.yaml": DRAFTS,
      "perspectives/broken.yaml": "reqseq-perspective: 1\nname: Broken\nwhere: { nope: 1 }\n",
      "metamodel/broken.yaml": "reqseq-metamodel: 1\ntypes: [ { key: x } ]\n",
    });
    expect((await failure(broken.workspace, { name: "Drafts", confirm: true })).code).toBe(
      "workspace.read-only",
    );
    const faulty = await open({
      "perspectives/broken.yaml": "reqseq-perspective: 1\nname: Broken\nwhere: { nope: 1 }\n",
    });
    expect((await failure(faulty.workspace, { name: "broken", confirm: true })).code).toBe("file.faulty");
    expect(await listed(faulty.fixture)).toEqual(["broken.yaml"]);
  });
});
