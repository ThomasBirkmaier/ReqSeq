// filter.rename (SR-217 AK1, AK3, AK4, AK6, AK7) on fixtures/SR-069/filter (see commands/element/list.test.ts
// for its elements) with hand-written filter, perspective and baseline files. The file name rule (AK2)
// is shared with perspectives and shown in commands/perspective/rename.test.ts.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Renamed = CommandOutput<"filter.rename">;

const SENSORS =
  "# The sensor package\nreqseq-filter: 1\nname: Sensors\nwhere: { package: PKG-0000d1 }   # sensors\n";
const BY_STATUS =
  "# Sensors by status\nreqseq-perspective: 1\nname: By status\nfilter: sensors\n" +
  "where: { all: [] }   # the filter selects\ngroup: status\n";
const DRAFTS = "reqseq-perspective: 1\nname: Drafts\nfilter: SENSORS\nwhere: { status: [draft] }\n";
/** Hidden by `by-status.yaml`, which holds its name first. */
const HIDDEN = "reqseq-perspective: 1\nname: by status\nfilter: Sensors\nwhere: { all: [] }\n";
const OTHER = "reqseq-perspective: 1\nname: Other\nwhere: { all: [] }\n";
const BASELINE = (selection: string): string =>
  `reqseq-baseline: 1\nname: Release 1\ndate: 2026-10-24T09:30:00Z\nselection: ${selection}\nrepositories:\n` +
  "  - { name: system, commit: 3b18e512dba79e4c8300dd08aeb37f8e728b8dad }\nelements: []\n";

const FILES: Record<string, string> = {
  "filters/sensors.yaml": SENSORS,
  "perspectives/by-status.yaml": BY_STATUS,
  "perspectives/drafts.yaml": DRAFTS,
  "perspectives/hidden.yaml": HIDDEN,
  "perspectives/other.yaml": OTHER,
};

const open = async (
  files: Record<string, string | null> = {},
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const all = Object.fromEntries(
    Object.entries({ ...FILES, ...files }).filter((entry): entry is [string, string] => entry[1] !== null),
  );
  const fixture = await createFixtureWorkspace({ fixture: "SR-069/filter", files: all });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const rename = async (workspace: Workspace, name: string, newName: string): Promise<Renamed> =>
  (await invoke("filter.rename", { name, newName }, { workspace })) as Renamed;

const failure = async (workspace: Workspace, name: string, newName: string): Promise<CommandError> => {
  try {
    await rename(workspace, name, newName);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("filter.rename did not fail");
};

/** Every file of the filters, perspectives and baselines folders with its text. */
const files = async (fixture: FixtureWorkspace): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  for (const folder of ["filters", "perspectives", "baselines"]) {
    const names = await fs.readdir(fixture.path(folder)).catch(() => []);
    for (const file of names.sort()) {
      out[`${folder}/${file}`] = await fs.readFile(fixture.path(`${folder}/${file}`), "utf8");
    }
  }
  return out;
};

const list = (workspace: Workspace, selection: Record<string, unknown>): Promise<unknown> =>
  invoke("element.list", { selection }, { workspace });

describe("filter.rename (SR-217)", () => {
  it("[SR-217/AK-f79t] renames the filter and its file, keeps comments, and the new name selects the same elements", async () => {
    const { fixture, workspace } = await open();
    const before = await list(workspace, { filter: "Sensors" });
    const out = await rename(workspace, "sensors", "Sensor package");
    expect(out.renamed).toEqual([{ from: "filters/sensors.yaml", to: "filters/sensor-package.yaml" }]);
    expect((await files(fixture))["filters/sensor-package.yaml"]).toBe(
      SENSORS.replace("name: Sensors", "name: Sensor package"),
    );
    expect(await list(workspace, { filter: "Sensor package" })).toEqual(before);
    expect(
      ((await list(workspace, { filter: "Sensors" }).catch((e: unknown) => e)) as CommandError).code,
    ).toBe("input.invalid");
  });

  it("[SR-217/AK-kv9r] writes the new name into every perspective that names the filter, hidden ones too, then the filter, and names them", async () => {
    const { fixture, workspace } = await open();
    const out = await rename(workspace, "Sensors", "Sensor package");
    expect(out).toEqual({
      answer: "Renamed saved filter Sensors to Sensor package; 3 perspectives changed; 4 files written.",
      files: [
        "perspectives/by-status.yaml",
        "perspectives/drafts.yaml",
        "perspectives/hidden.yaml",
        "filters/sensor-package.yaml",
      ],
      renamed: [{ from: "filters/sensors.yaml", to: "filters/sensor-package.yaml" }],
      perspectives: [
        { name: "By status", file: "perspectives/by-status.yaml" },
        { name: "Drafts", file: "perspectives/drafts.yaml" },
        { name: "by status", file: "perspectives/hidden.yaml" },
      ],
      problems: [],
    });
    expect(await files(fixture)).toEqual({
      "filters/sensor-package.yaml": SENSORS.replace("name: Sensors", "name: Sensor package"),
      "perspectives/by-status.yaml": BY_STATUS.replace("filter: sensors", "filter: Sensor package"),
      "perspectives/drafts.yaml": DRAFTS.replace("filter: SENSORS", "filter: Sensor package"),
      "perspectives/hidden.yaml": HIDDEN.replace("filter: Sensors", "filter: Sensor package"),
      "perspectives/other.yaml": OTHER,
    });
    // The perspectives call the renamed filter.
    expect(await invoke("element.list", { perspective: "Drafts" }, { workspace })).toMatchObject({
      total: 1,
    });
  });

  it("[SR-217/AK-kv9r] also changes the perspectives when only the case of the name changes", async () => {
    const { fixture, workspace } = await open();
    const out = await rename(workspace, "Sensors", "sensors");
    expect(out.renamed).toEqual([]);
    expect(out.perspectives.map((p) => p.file)).toEqual([
      "perspectives/drafts.yaml",
      "perspectives/hidden.yaml",
    ]);
    const after = await files(fixture);
    expect(after["filters/sensors.yaml"]).toBe(SENSORS.replace("name: Sensors", "name: sensors"));
    expect(after["perspectives/drafts.yaml"]).toBe(DRAFTS.replace("filter: SENSORS", "filter: sensors"));
    expect(after["perspectives/by-status.yaml"]).toBe(BY_STATUS);
  });

  it("[SR-217/AK-dp5h] refuses a name another filter holds and writes nothing for the same name", async () => {
    const { fixture, workspace } = await open({
      "filters/flow.yaml": "reqseq-filter: 1\nname: Flow\nwhere: { all: [] }\n",
    });
    const before = await files(fixture);
    const taken = await failure(workspace, "Sensors", "FLOW");
    expect([taken.code, taken.details]).toEqual([
      "input.invalid",
      { command: "filter.rename", fields: ["newName"], reason: "name-taken", files: ["filters/flow.yaml"] },
    ]);
    expect(await rename(workspace, "Sensors", "Sensors")).toEqual({
      answer: "Renamed saved filter Sensors to Sensors; no file written.",
      files: [],
      renamed: [],
      perspectives: [],
      problems: [],
    });
    expect(await files(fixture)).toEqual(before);
  });

  it("[SR-217/AK-fhyv] refuses when a baseline file names the filter, or a faulty perspective or baseline file names it or is no YAML, and changes nothing", async () => {
    const cases: [string, Record<string, string>, string, Record<string, unknown>][] = [
      [
        "a baseline names it",
        { "baselines/release-1.yaml": BASELINE("{ filter: SENSORS }") },
        "input.invalid",
        {
          command: "filter.rename",
          fields: ["name"],
          reason: "referenced",
          files: ["baselines/release-1.yaml"],
        },
      ],
      [
        "a faulty baseline names it",
        { "baselines/release-1.yaml": BASELINE("{ filter: Sensors, nope: 1 }") },
        "file.faulty",
        { files: ["baselines/release-1.yaml"] },
      ],
      [
        "a baseline is no YAML",
        { "baselines/release-1.yaml": "reqseq-baseline: [\n" },
        "file.faulty",
        { files: ["baselines/release-1.yaml"] },
      ],
      [
        "a faulty perspective names it",
        {
          "perspectives/zz.yaml":
            "reqseq-perspective: 1\nname: Z\nview: core\nfilter: sensors\nwhere: { all: [] }\n",
        },
        "file.faulty",
        { files: ["perspectives/zz.yaml"] },
      ],
      [
        "a perspective is no YAML",
        { "perspectives/zz.yaml": "name: [\n" },
        "file.faulty",
        { files: ["perspectives/zz.yaml"] },
      ],
    ];
    for (const [label, extra, code, details] of cases) {
      const { fixture, workspace } = await open(extra);
      const before = await files(fixture);
      const error = await failure(workspace, "Sensors", "Sensor package");
      expect([label, error.code, error.details]).toEqual([label, code, details]);
      expect(await files(fixture)).toEqual(before);
    }
  });

  it("[SR-217/AK-fhyv] renames when a faulty perspective or baseline file names another filter", async () => {
    const { workspace } = await open({
      "perspectives/zz.yaml":
        "reqseq-perspective: 1\nname: Z\nview: core\nfilter: Flow\nwhere: { all: [] }\n",
      "baselines/release-1.yaml": BASELINE("{ filter: Flow, nope: 1 }"),
      "baselines/release-2.yaml": BASELINE("{ filter: Flow }").replace("Release 1", "Release 2"),
    });
    expect((await rename(workspace, "Sensors", "Sensor package")).files).toHaveLength(4);
  });

  it("[SR-217/AK-fhyv] refuses when the repository of the perspectives folder is not on this machine", async () => {
    const { fixture, workspace } = await open({
      "reqseq-workspace.yaml":
        "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
        '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
        "metamodel: { repository: system, path: metamodel }\n" +
        "perspectives: { repository: vault, path: perspectives }\n",
    });
    const before = await files(fixture);
    const error = await failure(workspace, "Sensors", "Sensor package");
    expect([error.code, error.details]).toEqual(["file.folder-missing", { repository: "vault" }]);
    expect(await files(fixture)).toEqual(before);
  });

  it("[SR-217/AK-fhyv] refuses a change of case only when a baseline file names the filter", async () => {
    const { workspace } = await open({ "baselines/release-1.yaml": BASELINE("{ filter: Sensors }") });
    expect((await failure(workspace, "Sensors", "sensors")).details?.["reason"]).toBe("referenced");
  });

  it("[SR-217/AK-fhyv] refuses when the baselines folder is in a missing repository or cannot be listed (#1739)", async () => {
    const missing = await open({
      "reqseq-workspace.yaml":
        "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
        '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
        "metamodel: { repository: system, path: metamodel }\n" +
        "baselines: { repository: vault, path: baselines }\n",
    });
    const gone = await failure(missing.workspace, "Sensors", "Sensor package");
    expect([gone.code, gone.details]).toEqual(["file.folder-missing", { repository: "vault" }]);
    const unreadable = await open({ baselines: "not a folder\n" });
    const error = await failure(unreadable.workspace, "Sensors", "Sensor package");
    expect([error.code, error.details]).toEqual(["file.faulty", { files: ["baselines"] }]);
    expect(await fs.readFile(unreadable.fixture.path("filters/sensors.yaml"), "utf8")).toBe(SENSORS);
  });

  it("[SR-217/AK-fhyv] renames when there is no baselines folder and no perspectives folder", async () => {
    const { fixture, workspace } = await open({
      "perspectives/by-status.yaml": null,
      "perspectives/drafts.yaml": null,
      "perspectives/hidden.yaml": null,
      "perspectives/other.yaml": null,
    });
    await expect(fs.access(fixture.path("baselines"))).rejects.toThrow();
    expect(await rename(workspace, "Sensors", "Sensor package")).toEqual({
      answer: "Renamed saved filter Sensors to Sensor package; 1 file written.",
      files: ["filters/sensor-package.yaml"],
      renamed: [{ from: "filters/sensors.yaml", to: "filters/sensor-package.yaml" }],
      perspectives: [],
      problems: [],
    });
  });

  it("[SR-217/AK-fhyv] refuses when the perspectives folder cannot be listed", async () => {
    const { workspace } = await open({
      "perspectives/by-status.yaml": null,
      "perspectives/drafts.yaml": null,
      "perspectives/hidden.yaml": null,
      "perspectives/other.yaml": null,
      perspectives: "not a folder\n",
    });
    const error = await failure(workspace, "Sensors", "Sensor package");
    expect([error.code, error.details]).toEqual(["file.faulty", { files: ["perspectives"] }]);
  });

  it("[SR-217/AK-q14p] refuses an unknown name, a name only a faulty file holds, a read-only workspace and a perspective it cannot write, and changes nothing", async () => {
    const { fixture, workspace } = await open({
      "filters/broken.yaml": "reqseq-filter: 1\nname: Broken\nwhere: { nope: 1 }\n",
    });
    const before = await files(fixture);
    expect((await failure(workspace, "Nope", "Other")).details).toEqual({
      command: "filter.rename",
      fields: ["name"],
    });
    expect((await failure(workspace, "broken", "Other")).code).toBe("file.faulty");
    expect((await failure(workspace, "Sensors", "broken")).code).toBe("file.faulty");
    await fs.chmod(fixture.path("perspectives/hidden.yaml"), 0o444);
    onTestFinished(() => fs.chmod(fixture.path("perspectives/hidden.yaml"), 0o644));
    const readOnly = await failure(workspace, "Sensors", "Other");
    expect([readOnly.code, readOnly.message]).toEqual([
      "file.read-only",
      "Not written: perspectives/hidden.yaml is read-only",
    ]);
    expect(await files(fixture)).toEqual(before);

    const broken = await open({ "metamodel/broken.yaml": "reqseq-metamodel: 1\ntypes: [ { key: x } ]\n" });
    expect((await failure(broken.workspace, "Sensors", "Other")).code).toBe("workspace.read-only");
  });

  it("[SR-217/AK-q14p] refuses a perspective in Git, and a filters folder in a missing repository", async () => {
    const inGit = await open({
      "reqseq-workspace.yaml":
        "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
        "metamodel: { repository: system, path: metamodel }\n" +
        "perspectives: { repository: system, path: .git/perspectives }\n",
      ".git/perspectives/drafts.yaml": DRAFTS,
    });
    const git = await failure(inGit.workspace, "Sensors", "Other");
    expect([git.code, git.details?.["reason"]]).toEqual(["input.invalid", "git-folder"]);
    expect(await fs.readFile(inGit.fixture.path(".git/perspectives/drafts.yaml"), "utf8")).toBe(DRAFTS);
    expect(await fs.readFile(inGit.fixture.path("filters/sensors.yaml"), "utf8")).toBe(SENSORS);

    const missing = await open({
      "reqseq-workspace.yaml":
        "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
        '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
        "metamodel: { repository: system, path: metamodel }\n" +
        "filters: { repository: vault, path: filters }\n",
    });
    const gone = await failure(missing.workspace, "Sensors", "Other");
    expect([gone.code, gone.details]).toEqual(["file.folder-missing", { repository: "vault" }]);
  });
});
