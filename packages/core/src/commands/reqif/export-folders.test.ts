// reqif.export creates the missing folders above its file inside a repository of the workspace
// (SR-207 AK4 to AK7): the path rules apply only when a folder is missing, every refusal comes before
// any folder is created, and a failed export removes the empty folders it created.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { CommandOutput } from "../../catalog.js";
import type { AccessName } from "../../model/activity.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

/** Embeds an image, which is copied next to the file. */
const WIND = "52052052-0000-4000-8000-0000000052a1";
/** Embeds none. */
const TEMPERATURE = "52052052-0000-4000-8000-0000000052a3";

const WORKSPACE_FILE = [
  "reqseq-workspace: 1",
  "name: Weather station",
  "repositories:",
  '  - { name: system, url: "git@git.example.com:ws/system.git", main: true }',
  '  - { name: sensor, url: "git@git.example.com:ws/sensor.git", path: vendor/sensor }',
  "metamodel: { repository: system, path: metamodel }",
  "ignore:",
  '  - "build/**"',
  "",
].join("\n");

const open = async () => {
  const fixture = await createFixtureWorkspace({
    fixture: "SR-052/package",
    files: { "reqseq-workspace.yaml": WORKSPACE_FILE, "notes.txt": "notes\n" },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const exported = (workspace: Workspace, output: string, id = WIND, access: AccessName = "cli") =>
  invoke("reqif.export", { output, selection: { ids: [id] } }, { workspace, access }) as Promise<
    CommandOutput<"reqif.export">
  >;

const refusal = async (promise: Promise<unknown>): Promise<CommandError> => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

/** Every path below `folder`, relative with `/`, sorted. */
const paths = async (folder: string): Promise<string[]> =>
  (await fs.readdir(folder, { recursive: true })).map((p) => p.split(path.sep).join("/")).sort();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reqif.export into missing folders (SR-207 AK4 to AK7)", () => {
  it("[SR-207/AK-b0rs] creates the missing folders above the file in a repository, over the command line, the API and the MCP server", async () => {
    const { fixture, workspace } = await open();
    for (const access of ["cli", "api", "mcp"] as const) {
      const output = `exports/${access}/reqif/s.reqif`;
      const result = await exported(workspace, output, WIND, access);
      expect([result.file, result.files]).toEqual([
        output,
        [`exports/${access}/reqif/s-images/SR-0000000052a1/anemometer.png`],
      ]);
      expect(await fs.readFile(fixture.path(output), "utf8")).toContain("<REQ-IF");
    }
    // The list of AK5 is closed: a short name that names no other folder and an invisible character are fine.
    for (const output of ["exports/draft~1/s.reqif", "exports/a\u200bb/s.reqif"]) {
      expect((await exported(workspace, output, TEMPERATURE)).file).toBe(output);
    }
    // A folder the workspace file excludes is no reason to refuse.
    expect((await exported(workspace, "build/out/s.reqif", TEMPERATURE)).file).toBe("build/out/s.reqif");
  });

  it("[SR-207/AK-d980] refuses a link, .git, node_modules, an embedded repository, a missing repository, a file and a name Windows refuses on the way, and creates no folder", async () => {
    const { fixture, workspace } = await open();
    await fs.symlink(fixture.path("requirements"), fixture.path("linked"), "junction");
    await fs.mkdir(fixture.path("embedded/.git"), { recursive: true });
    const before = await paths(fixture.root);
    const refused: unknown[] = [];
    for (const output of [
      "linked/new/s.reqif",
      ".git/new/s.reqif",
      "node_modules/new/s.reqif",
      "embedded/new/s.reqif",
      "vendor/sensor/out/s.reqif",
      "Vendor/Sensor/out/s.reqif",
      "notes.txt/new/s.reqif",
      "new./s.reqif",
      "a?b/s.reqif",
      "aux/s.reqif",
      // On Windows `\` separates the names.
      ...(path.sep === "/" ? ["a\\b/s.reqif"] : []),
    ]) {
      for (const id of [WIND, TEMPERATURE]) {
        const error = await refusal(exported(workspace, output, id));
        expect([output, error.code]).toEqual([output, "input.invalid"]);
        refused.push(error.details?.["rule"] ?? error.details?.["reason"]);
      }
    }
    expect(refused).toEqual(
      [
        "link",
        "git-folder",
        "skipped-name",
        "git-entry",
        "repository-missing",
        "repository-missing",
        "not-a-folder",
        "not-portable",
        "not-portable",
        "not-portable",
        ...(path.sep === "/" ? ["not-portable"] : []),
      ].flatMap((rule) => [rule, rule]),
    );
    expect((await refusal(exported(workspace, "vendor/sensor/out/s.reqif"))).message).toBe(
      "Not exported: s.reqif: the folder lies in the folder of repository sensor of the workspace, which is not on this machine",
    );
    expect(await paths(fixture.root)).toEqual(before);
    // The rules hold only when a folder is missing: an existing folder is taken as before.
    expect((await exported(workspace, "linked/s.reqif", TEMPERATURE)).file).toBe("linked/s.reqif");
  });

  it("[SR-207/AK-p2qv] outside the repositories refuses a file whose folder is missing, and creates no folder", async () => {
    const { workspace } = await open();
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-reqif-outside-")));
    onTestFinished(() => fs.rm(outside, { recursive: true, force: true }));
    for (const id of [WIND, TEMPERATURE]) {
      const error = await refusal(exported(workspace, path.join(outside, "gone", "s.reqif"), id));
      expect([error.code, error.message, error.details?.["fields"]]).toEqual([
        "file.folder-missing",
        "Not exported: the folder of s.reqif does not exist; outside the repositories of the workspace ReqSeq creates no folder",
        ["output"],
      ]);
    }
    expect(await fs.readdir(outside)).toEqual([]);
    // In an existing folder outside, the file is written as before.
    const file = path.join(outside, "s.reqif");
    expect((await exported(workspace, file, TEMPERATURE)).file).toBe(file);
  });

  it("[SR-207/AK-c90h] removes each folder it created above the file that is empty when the export fails afterwards", async () => {
    const { fixture, workspace } = await open();
    await fs.mkdir(fixture.path("exports/kept/mine"), { recursive: true });
    const before = await paths(fixture.root);
    const open_ = fs.open.bind(fs);
    const failed: string[] = [];
    vi.spyOn(fs, "open").mockImplementation((file, ...rest) => {
      if (rest[0] === "wx" && String(file).includes(`${path.sep}exports${path.sep}`)) {
        failed.push(String(file));
        return Promise.reject(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
      }
      return open_(file, ...rest);
    });
    for (const id of [WIND, TEMPERATURE]) {
      for (const output of ["exports/kept/a/b/s.reqif", "exports/fresh/s.reqif"]) {
        await expect(exported(workspace, output, id)).rejects.toThrow();
        // It failed inside a folder it created.
        expect(failed.pop()).toContain(path.join(...path.posix.dirname(output).split("/")));
        expect(await paths(fixture.root)).toEqual(before);
      }
    }
  });
});
