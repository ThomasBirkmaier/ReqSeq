// filter.delete (SR-217 AK5, AK6, AK7) on fixtures/SR-069/filter with hand-written filter, perspective and
// baseline files. What filter and perspective share (the confirmation, the caller's precondition, Git,
// a read-only workspace) is shown in commands/perspective/delete.test.ts.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

type Deleted = CommandOutput<"filter.delete">;

const SENSORS = "reqseq-filter: 1\nname: Sensors\nwhere: { package: PKG-0000d1 }\n";
const FLOW = "reqseq-filter: 1\nname: Flow\nwhere: { all: [] }\n";
const OTHER = "reqseq-perspective: 1\nname: Other\nwhere: { all: [] }\n";
const naming = (name: string, filter: string): string =>
  `reqseq-perspective: 1\nname: ${name}\nfilter: ${filter}\nwhere: { all: [] }\n`;
const BASELINE = (selection: string): string =>
  `reqseq-baseline: 1\nname: Release 1\ndate: 2026-10-24T09:30:00Z\nselection: ${selection}\nrepositories:\n` +
  "  - { name: system, commit: 3b18e512dba79e4c8300dd08aeb37f8e728b8dad }\nelements: []\n";
const VAULT = (setting: string): string =>
  "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
  '  - { name: vault, url: "ssh://example.com/vault.git", path: ../vault }\n' +
  `metamodel: { repository: system, path: metamodel }\n${setting}: { repository: vault, path: ${setting} }\n`;

const FILES: Record<string, string> = {
  "filters/sensors.yaml": SENSORS,
  "filters/flow.yaml": FLOW,
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

const remove = async (workspace: Workspace, input: Record<string, unknown>): Promise<Deleted> =>
  (await invoke("filter.delete", input, { workspace })) as Deleted;

const failure = async (workspace: Workspace, input: Record<string, unknown>): Promise<CommandError> => {
  try {
    await remove(workspace, input);
  } catch (error) {
    if (error instanceof CommandError) {
      return error;
    }
    throw error;
  }
  throw new Error("filter.delete did not fail");
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

describe("filter.delete (SR-217)", () => {
  it("[SR-217/AK-bxqr] names the filter and its file without confirm, deletes it with confirm, and the name is gone", async () => {
    const { fixture, workspace } = await open();
    const before = await files(fixture);
    const named = await remove(workspace, { name: "sensors" });
    expect(named).toEqual({
      name: "Sensors",
      file: "filters/sensors.yaml",
      fileSha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      deleted: false,
      files: [],
      problems: [],
    });
    expect(await files(fixture)).toEqual(before);
    const out = await remove(workspace, {
      name: "sensors",
      confirm: true,
      file: named.file,
      expectedFileSha256: named.fileSha256,
    });
    expect(out).toEqual({ ...named, deleted: true, files: ["filters/sensors.yaml"] });
    const { "filters/sensors.yaml": _gone, ...rest } = before;
    expect(await files(fixture)).toEqual(rest);
    const unknown = await failure(workspace, { name: "Sensors" });
    expect(unknown.details).toEqual({ command: "filter.delete", fields: ["name"] });
  });

  it("[SR-217/AK-fhyv] refuses, already without confirm, a filter a perspective names, hidden ones too, and names them", async () => {
    const { fixture, workspace } = await open({
      "perspectives/a.yaml": naming("A", "SENSORS"),
      "perspectives/b.yaml": naming("Other", "sensors"),
    });
    const before = await files(fixture);
    for (const confirm of [false, true]) {
      const error = await failure(workspace, { name: "Sensors", confirm });
      expect([error.code, error.details]).toEqual([
        "input.invalid",
        {
          command: "filter.delete",
          fields: ["name"],
          reason: "referenced",
          files: ["perspectives/a.yaml", "perspectives/b.yaml"],
        },
      ]);
    }
    expect(await files(fixture)).toEqual(before);
    // Another filter that no perspective names can go.
    expect((await remove(workspace, { name: "Flow", confirm: true })).deleted).toBe(true);
  });

  it("[SR-217/AK-fhyv] refuses when a baseline or a faulty file may name the filter, or a folder or repository is not there to read, and deletes nothing", async () => {
    const cases: [string, Record<string, string>, string, Record<string, unknown>][] = [
      [
        "a baseline names it",
        { "baselines/release-1.yaml": BASELINE("{ filter: SENSORS }") },
        "input.invalid",
        {
          command: "filter.delete",
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
      [
        "the perspectives folder cannot be listed",
        { "perspectives/other.yaml": null as unknown as string, perspectives: "not a folder\n" },
        "file.faulty",
        { files: ["perspectives"] },
      ],
      [
        "the baselines folder cannot be listed",
        { baselines: "not a folder\n" },
        "file.faulty",
        { files: ["baselines"] },
      ],
      [
        "the perspectives repository is missing",
        { "reqseq-workspace.yaml": VAULT("perspectives") },
        "file.folder-missing",
        { repository: "vault" },
      ],
      [
        "the baselines repository is missing",
        { "reqseq-workspace.yaml": VAULT("baselines") },
        "file.folder-missing",
        { repository: "vault" },
      ],
      [
        "the filters repository is missing",
        { "reqseq-workspace.yaml": VAULT("filters") },
        "file.folder-missing",
        { repository: "vault" },
      ],
    ];
    for (const [label, extra, code, details] of cases) {
      const { fixture, workspace } = await open(extra);
      const before = await files(fixture);
      const error = await failure(workspace, { name: "Sensors" });
      expect([label, error.code, error.details]).toEqual([label, code, details]);
      expect(error.message).toMatch(/^(Not deleted|name: )/);
      expect([label, (await failure(workspace, { name: "Sensors", confirm: true })).code]).toEqual([
        label,
        code,
      ]);
      expect(await files(fixture)).toEqual(before);
    }
  });

  it("[SR-217/AK-fhyv] deletes when faulty files name another filter and there is no baselines folder", async () => {
    const { fixture, workspace } = await open({
      "perspectives/zz.yaml":
        "reqseq-perspective: 1\nname: Z\nview: core\nfilter: Flow\nwhere: { all: [] }\n",
    });
    await expect(fs.access(fixture.path("baselines"))).rejects.toThrow();
    expect((await remove(workspace, { name: "Sensors", confirm: true })).files).toEqual([
      "filters/sensors.yaml",
    ]);
  });

  it("[SR-217/AK-fhyv] a filters folder that is the perspectives folder: a filter there is no perspective that names it", async () => {
    const { fixture, workspace } = await open({
      "reqseq-workspace.yaml":
        "reqseq-workspace: 1\nname: Weather station\nrepositories:\n" +
        '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }\n' +
        "metamodel: { repository: system, path: metamodel }\n" +
        "perspectives: { repository: system, path: filters }\n",
      "perspectives/other.yaml": null,
    });
    expect((await remove(workspace, { name: "Sensors", confirm: true })).deleted).toBe(true);
    expect(Object.keys(await files(fixture))).toEqual(["filters/flow.yaml"]);
  });

  it("[SR-217/AK-q14p] refuses a name only a faulty file holds and a file it cannot delete, and deletes nothing", async () => {
    const { fixture, workspace } = await open({
      "filters/broken.yaml": "reqseq-filter: 1\nname: Broken\nwhere: { nope: 1 }\n",
    });
    const before = await files(fixture);
    expect((await failure(workspace, { name: "broken", confirm: true })).code).toBe("file.faulty");
    await fs.chmod(fixture.path("filters/sensors.yaml"), 0o444);
    onTestFinished(() => fs.chmod(fixture.path("filters/sensors.yaml"), 0o644));
    const readOnly = await failure(workspace, { name: "Sensors", confirm: true });
    expect([readOnly.code, readOnly.message]).toEqual([
      "file.read-only",
      "Not deleted: filters/sensors.yaml is read-only",
    ]);
    expect(await files(fixture)).toEqual(before);
  });
});
