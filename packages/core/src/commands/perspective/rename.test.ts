// perspective.rename (SR-217 AK1 to AK3, AK7) on fixtures/SR-069/filter (see commands/element/list.test.ts
// for its elements) with hand-written perspective files.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Renamed = CommandOutput<"perspective.rename">;

/** Whether the temporary folder tells file names apart by case (Linux; not macOS or Windows by default). */
const caseSensitive = await (async (): Promise<boolean> => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-case-"));
  try {
    await fs.writeFile(path.join(folder, "a"), "");
    return await fs.access(path.join(folder, "A")).then(
      () => false,
      () => true,
    );
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
})();

const DRAFTS =
  "# Open work\nreqseq-perspective: 1\nname: Drafts\ndescription: What is open\n" +
  "where: { status: [draft] }   # only drafts\ngroup: status\n";

const WORKSPACE = (extra: string): string =>
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
  `metamodel: { repository: system, path: metamodel }\n${extra}`;

const open = async (
  files: Record<string, string>,
  options: Partial<FixtureOptions> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-069/filter", files, ...options });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const rename = async (workspace: Workspace, name: string, newName: string): Promise<Renamed> =>
  (await invoke("perspective.rename", { name, newName }, { workspace })) as Renamed;

const failure = async (workspace: Workspace, name: string, newName: string): Promise<CommandError> => {
  try {
    await rename(workspace, name, newName);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("perspective.rename did not fail");
};

const ids = async (workspace: Workspace, perspective: string): Promise<unknown> =>
  invoke("element.list", { perspective }, { workspace });

const folder = async (fixture: FixtureWorkspace, name = "perspectives"): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const file of (await fs.readdir(fixture.path(name))).sort()) {
    out[file] = await fs.readFile(fixture.path(`${name}/${file}`), "utf8");
  }
  return out;
};

describe("perspective.rename (SR-217)", () => {
  it("[SR-217/AK-f79t] renames the perspective and its file, keeps comments and description, and the new name lists the same elements", async () => {
    const { fixture, workspace } = await open({ "perspectives/drafts.yaml": DRAFTS });
    const before = await ids(workspace, "Drafts");
    expect(await rename(workspace, "drafts", "Open drafts")).toEqual({
      answer: "Renamed perspective drafts to Open drafts; 1 file written.",
      files: ["perspectives/open-drafts.yaml"],
      renamed: [{ from: "perspectives/drafts.yaml", to: "perspectives/open-drafts.yaml" }],
      problems: [],
    });
    expect(await folder(fixture)).toEqual({
      "open-drafts.yaml": DRAFTS.replace("name: Drafts", "name: Open drafts"),
    });
    expect(await ids(workspace, "Open drafts")).toEqual(before);
    const unknown = await invoke("element.list", { perspective: "Drafts" }, { workspace }).catch(
      (e: unknown) => e,
    );
    expect((unknown as CommandError).code).toBe("input.invalid");
    const listed = (await invoke("perspective.list", {}, { workspace })) as CommandOutput<"perspective.list">;
    expect(listed.perspectives.map((p) => p.name)).toEqual(["Open drafts"]);
  });

  it("[SR-217/AK-yt8d] names the file as a new file for the new name, the own file not taken", async () => {
    const { fixture, workspace } = await open({
      "perspectives/Drafts.yaml": DRAFTS,
      "perspectives/mine.yaml": "reqseq-perspective: 1\nname: Mine\nwhere: { all: [] }\n",
      "perspectives/x-2.yaml": "reqseq-perspective: 1\nname: X\nwhere: { all: [] }\n",
      "perspectives/taken.yaml": "reqseq-perspective: 1\nname: Taken file\nwhere: { all: [] }\n",
    });
    // Same file name ignoring case: the file name stays, only the name changes.
    expect((await rename(workspace, "Drafts", "DRAFTS")).renamed).toEqual([]);
    // A hand-named file gets the rule's name; a free name drops the suffix; a taken one gets -2.
    expect((await rename(workspace, "Mine", "Ünïcode Ä/B")).renamed[0]?.to).toBe(
      "perspectives/unicode-a-b.yaml",
    );
    expect((await rename(workspace, "X", "x.")).renamed[0]?.to).toBe("perspectives/x.yaml");
    expect((await rename(workspace, "x.", "Taken file?")).renamed[0]?.to).toBe(
      "perspectives/taken-file.yaml",
    );
    expect((await rename(workspace, "Taken file?", "Taken.file")).renamed).toEqual([]);
    // Another file's rule name is taken: -2.
    expect((await rename(workspace, "Taken file", "Taken-File")).renamed[0]?.to).toBe(
      "perspectives/taken-file-2.yaml",
    );
    expect((await rename(workspace, "Taken.file", "!!!")).renamed[0]?.to).toBe(
      "perspectives/perspective.yaml",
    );
    expect((await rename(workspace, "!!!", "NUL")).renamed[0]?.to).toBe("perspectives/nul-perspective.yaml");
    expect(Object.keys(await folder(fixture))).toEqual([
      "Drafts.yaml",
      "nul-perspective.yaml",
      "taken-file-2.yaml",
      "unicode-a-b.yaml",
    ]);
  });

  it.runIf(caseSensitive)(
    "[SR-217/AK-yt8d] keeps the file name for a change of case only, also beside a file that differs only in case",
    async () => {
      const { fixture, workspace } = await open({
        "perspectives/drafts.yaml": DRAFTS,
        "perspectives/Drafts.yaml": "reqseq-perspective: 1\nname: Other\nwhere: { all: [] }\n",
      });
      expect(await rename(workspace, "Drafts", "drafts")).toEqual({
        answer: "Renamed perspective Drafts to drafts; 1 file written.",
        files: ["perspectives/drafts.yaml"],
        renamed: [],
        problems: [],
      });
      expect(Object.keys(await folder(fixture))).toEqual(["Drafts.yaml", "drafts.yaml"]);
    },
  );

  it("[SR-217/AK-yt8d] keeps a file with a suffix whose name without it another file has", async () => {
    const { workspace } = await open({
      "perspectives/drafts.yaml": "reqseq-perspective: 1\nname: Other\nwhere: { all: [] }\n",
      "perspectives/drafts-2.yaml": DRAFTS,
    });
    expect((await rename(workspace, "Drafts", "Drafts!")).files).toEqual(["perspectives/drafts-2.yaml"]);
  });

  it("[SR-217/AK-yt8d] names a renamed file as perspective.save names a new file: accents removed, at most 64 characters", async () => {
    const { workspace } = await open({ "perspectives/drafts.yaml": DRAFTS });
    const long = `Çà ${"x".repeat(70)}`;
    const saved = (await invoke(
      "perspective.save",
      { name: `${long} new`, where: { all: [] } },
      { workspace },
    )) as {
      files: string[];
    };
    const cut = `perspectives/ca-${"x".repeat(61)}`;
    expect(saved.files).toEqual([`${cut}.yaml`]);
    expect((await rename(workspace, "Drafts", long)).renamed[0]?.to).toBe(`${cut}-2.yaml`);
  });

  it("[SR-217/AK-dp5h] refuses a name another perspective or only a faulty file holds, or that breaks the name rules, and changes nothing", async () => {
    const files = {
      "perspectives/drafts.yaml": DRAFTS,
      "perspectives/other.yaml": "reqseq-perspective: 1\nname: Größe\nwhere: { all: [] }\n",
      "perspectives/broken.yaml": "reqseq-perspective: 1\nname: Broken\nview: core\nwhere: { all: [] }\n",
    };
    const { fixture, workspace } = await open(files);
    const before = await folder(fixture);
    const taken = await failure(workspace, "Drafts", "GRÖSSE".normalize("NFD").replace("SS", "ß"));
    expect([taken.code, taken.details]).toEqual([
      "input.invalid",
      {
        command: "perspective.rename",
        fields: ["newName"],
        reason: "name-taken",
        files: ["perspectives/other.yaml"],
      },
    ]);
    expect(taken.message).toContain("perspectives/other.yaml");
    const faulty = await failure(workspace, "Drafts", "broken");
    expect([faulty.code, faulty.details]).toEqual(["file.faulty", { files: ["perspectives/broken.yaml"] }]);
    expect((await failure(workspace, "Drafts", " padded")).code).toBe("input.invalid");
    expect(await folder(fixture)).toEqual(before);
  });

  it("[SR-217/AK-dp5h] renames a change of case only, writes nothing for the same name, and lets a filter share the name", async () => {
    const { fixture, workspace } = await open({
      "perspectives/drafts.yaml": DRAFTS,
      "filters/sensors.yaml": "reqseq-filter: 1\nname: Sensors\nwhere: { package: PKG-0000d1 }\n",
    });
    expect(await rename(workspace, "drafts", "Drafts")).toEqual({
      answer: "Renamed perspective drafts to Drafts; no file written.",
      files: [],
      renamed: [],
      problems: [],
    });
    expect(await rename(workspace, "Drafts", "drafts")).toEqual({
      answer: "Renamed perspective Drafts to drafts; 1 file written.",
      files: ["perspectives/drafts.yaml"],
      renamed: [],
      problems: [],
    });
    expect((await rename(workspace, "drafts", "Sensors")).files).toEqual(["perspectives/sensors.yaml"]);
    expect(await folder(fixture)).toEqual({
      "sensors.yaml": DRAFTS.replace("name: Drafts", "name: Sensors"),
    });
  });

  it("[SR-217/AK-q14p] refuses an unknown name, a name only a faulty file holds, a missing repository, a place in Git and a read-only workspace", async () => {
    const { workspace } = await open({
      "perspectives/broken.yaml": "reqseq-perspective: 1\nname: Broken\nview: core\nwhere: { all: [] }\n",
    });
    const unknown = await failure(workspace, "Nope", "Other");
    expect([unknown.code, unknown.details]).toEqual([
      "input.invalid",
      { command: "perspective.rename", fields: ["name"] },
    ]);
    const faulty = await failure(workspace, "broken", "Other");
    expect([faulty.code, faulty.details]).toEqual(["file.faulty", { files: ["perspectives/broken.yaml"] }]);

    const missing = await open({
      "reqseq-workspace.yaml":
        "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
        '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
        "metamodel: { repository: system, path: metamodel }\n" +
        "perspectives: { repository: vault, path: perspectives }\n",
    });
    const gone = await failure(missing.workspace, "Drafts", "Other");
    expect([gone.code, gone.details]).toEqual(["file.folder-missing", { repository: "vault" }]);

    const inGit = await open({
      "reqseq-workspace.yaml": WORKSPACE("perspectives: { repository: system, path: .git/perspectives }\n"),
      ".git/perspectives/drafts.yaml": DRAFTS,
    });
    const git = await failure(inGit.workspace, "Drafts", "Other");
    expect([git.code, git.details?.["reason"]]).toEqual(["input.invalid", "git-folder"]);
    expect(await folder(inGit.fixture, ".git/perspectives")).toEqual({ "drafts.yaml": DRAFTS });

    const readOnly = await open({
      "perspectives/drafts.yaml": DRAFTS,
      "metamodel/broken.yaml": "reqseq-metamodel: 1\ntypes: [ { key: x } ]\n",
    });
    expect((await failure(readOnly.workspace, "Drafts", "Other")).code).toBe("workspace.read-only");
    expect(await folder(readOnly.fixture)).toEqual({ "drafts.yaml": DRAFTS });
  });

  it("[SR-217/AK-q14p] refuses a file that changed on disk since it was read or cannot be written, and changes nothing", async () => {
    const { fixture, workspace } = await open({ "perspectives/drafts.yaml": DRAFTS });
    await fs.chmod(fixture.path("perspectives/drafts.yaml"), 0o444);
    onTestFinished(() => fs.chmod(fixture.path("perspectives/drafts.yaml"), 0o644));
    expect((await failure(workspace, "Drafts", "Other")).code).toBe("file.read-only");
    expect(await folder(fixture)).toEqual({ "drafts.yaml": DRAFTS });
  });

  it("[SR-217/AK-f79t] warns when a file hidden by the renamed one holds the old name now", async () => {
    const { workspace } = await open({
      "perspectives/a.yaml": DRAFTS,
      "perspectives/b.yaml": "reqseq-perspective: 1\nname: drafts\nwhere: { all: [] }\n",
    });
    const out = await rename(workspace, "Drafts", "Mine");
    expect(out.problems).toEqual([
      {
        code: "perspective.duplicate-name",
        severity: "warning",
        message: 'perspectives/b.yaml has the name "drafts" too and holds it now',
        repository: "system",
        file: "perspectives/b.yaml",
      },
    ]);
  });
});
