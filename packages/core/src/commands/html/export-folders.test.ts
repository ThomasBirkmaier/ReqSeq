// html.export creates the missing folders above its target inside a repository of the workspace
// (SR-235 AK7 to AK10): the path rules apply only when a folder is missing, every refusal comes before
// any folder is created, and a failed export removes the empty folders it created.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { InvokedOutput } from "../../catalog.js";
import type { AccessName } from "../../model/activity.js";
import { CommandError } from "../../catalog.js";
import { invoke } from "../../runtime/invoke.js";
import { Workspace } from "../../runtime/workspace.js";

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
    fixture: "SR-001/two-elements",
    files: { "reqseq-workspace.yaml": WORKSPACE_FILE, "notes.txt": "notes\n" },
  });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.root);
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const exported = (workspace: Workspace, output: string, access: AccessName = "cli") =>
  invoke("html.export", { output }, { workspace, access }) as Promise<InvokedOutput<"html.export">>;

const refusal = async (promise: Promise<unknown>): Promise<CommandError> => {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(CommandError);
  return error as CommandError;
};

/** Every path below `folder`, relative with `/`, sorted. */
const paths = async (folder: string): Promise<string[]> =>
  (await fs.readdir(folder, { recursive: true })).map((p) => p.split(path.sep).join("/")).sort();

const there = (absolute: string): Promise<boolean> =>
  fs.lstat(absolute).then(
    () => true,
    () => false,
  );

afterEach(() => {
  vi.restoreAllMocks();
});

describe("html.export into missing folders (SR-235 AK7 to AK10)", () => {
  it("[SR-235/AK-hpjh] creates the missing folders and the target in a repository, over the command line, the API and the MCP server", async () => {
    const { fixture, workspace } = await open();
    for (const access of ["cli", "api", "mcp"] as const) {
      const output = `exports/${access}/html`;
      const result = await exported(workspace, output, access);
      expect([result.folder, result.pages]).toEqual([output, 2]);
      expect(await fs.readFile(fixture.path(`${output}/index.html`), "utf8")).toContain("<!doctype html>");
    }
    // A folder the workspace file excludes is no reason to refuse: the export is no element.
    expect((await exported(workspace, "build/site/html")).folder).toBe("build/site/html");
    // An existing target folder is taken as before, and only a missing target is created as before.
    expect((await exported(workspace, "exports/cli/html")).folder).toBe("exports/cli/html");
    expect((await exported(workspace, "exports/one")).folder).toBe("exports/one");
    // In a repository of the workspace nested in another, its own rules count.
    await fs.writeFile(
      fixture.path("reqseq-workspace.yaml"),
      WORKSPACE_FILE.replace("path: vendor/sensor", "path: inner"),
    );
    await fs.mkdir(fixture.path("inner"));
    const nested = new Workspace(fixture.root);
    onTestFinished(() => nested.close());
    expect((await exported(nested, "inner/exports/html")).folder).toBe("inner/exports/html");
  });

  it("[SR-235/AK-kj5b] refuses a link, .git, node_modules, an embedded repository, a missing repository, a file and a name Windows refuses on the way, and creates no folder", async () => {
    const { fixture, workspace } = await open();
    await fs.symlink(fixture.path("requirements"), fixture.path("linked"), "junction");
    await fs.mkdir(fixture.path("embedded/.git"), { recursive: true });
    const before = await paths(fixture.root);
    const refused: Record<string, unknown>[] = [];
    const names = [
      "linked/new/site",
      ".git/new/site",
      "node_modules/new/site",
      "embedded/new/site",
      "vendor/sensor/html/site",
      "notes.txt/new/site",
      "new./site/html",
      "new /site/html",
      "a|b/c/site",
      "a\u0001b/c/site",
      "nul/c/site",
      "out/new/con",
    ];
    for (const output of names) {
      const error = await refusal(exported(workspace, output));
      expect([output, error.code]).toEqual([output, "input.invalid"]);
      expect(error.message).toMatch(/^Not exported: |lies in a \.git folder/u);
      refused.push({ output, rule: error.details?.["rule"] ?? error.details?.["reason"] });
    }
    expect(refused.map((r) => r["rule"])).toEqual([
      "link",
      "git-folder",
      "skipped-name",
      "git-entry",
      "repository-missing",
      "not-a-folder",
      "not-portable",
      "not-portable",
      "not-portable",
      "not-portable",
      "not-portable",
      "not-portable",
    ]);
    expect((await refusal(exported(workspace, "linked/new/site"))).message).toBe(
      "Not exported: linked/new/site in repository system: linked is a link, which ReqSeq does not follow",
    );
    // A name spelled otherwise than on disk, where the file system ignores case.
    if (await there(fixture.path("REQUIREMENTS"))) {
      const error = await refusal(exported(workspace, "REQUIREMENTS/new/site"));
      expect(error.details?.["rule"]).toBe("spelling");
    }
    expect(await paths(fixture.root)).toEqual(before);
    // Each rule holds only when a folder is missing: an existing target is taken as before.
    await fs.mkdir(fixture.path("requirements/site"));
    expect((await exported(workspace, "linked/site")).folder).toBe("linked/site");
  });

  it("[SR-235/AK-nqgk] outside the repositories creates only the target itself, and refuses a missing folder above it", async () => {
    const { workspace } = await open();
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-html-outside-")));
    onTestFinished(() => fs.rm(outside, { recursive: true, force: true }));
    const target = path.join(outside, "html");
    expect((await exported(workspace, target)).folder).toBe(target);
    expect(await there(path.join(target, "index.html"))).toBe(true);
    const error = await refusal(exported(workspace, path.join(outside, "gone", "deeper", "html")));
    expect([error.code, error.message, error.details?.["fields"]]).toEqual([
      "file.folder-missing",
      "Not exported: the folder above html does not exist; outside the repositories of the workspace ReqSeq creates only the export folder itself",
      ["output"],
    ]);
    expect(await fs.readdir(outside)).toEqual(["html"]);
    // A link outside the repositories is followed, as before: here to a folder that is not there.
    await fs.symlink(path.join(outside, "nowhere"), path.join(outside, "dangling"), "junction");
    expect((await refusal(exported(workspace, path.join(outside, "dangling", "a", "html")))).code).toBe(
      "file.folder-missing",
    );
  });

  it("[SR-235/AK-gpr1] removes each folder it created that is empty when the export fails afterwards", async () => {
    const { fixture, workspace } = await open();
    await fs.mkdir(fixture.path("exports/kept/mine"), { recursive: true });
    const before = await paths(fixture.root);
    // The first page fails to be staged: everything the export created is empty again.
    const writeFile = fs.writeFile.bind(fs);
    const failed: string[] = [];
    vi.spyOn(fs, "writeFile").mockImplementation((file, ...rest) => {
      const name = typeof file === "string" ? file : "";
      if (name.includes(`${path.sep}new${path.sep}`)) {
        failed.push(name);
        return Promise.reject(Object.assign(new Error("disk full"), { code: "ENOSPC" }));
      }
      return writeFile(file, ...rest);
    });
    for (const output of ["exports/kept/a/b/html", "exports/fresh/a/html"]) {
      await expect(exported(workspace, output)).rejects.toThrow("Internal error in html.export");
      // It failed inside the target it created.
      expect(failed.pop()).toContain(path.join(...output.split("/"), ".reqseq-export-staging"));
      expect(await paths(fixture.root)).toEqual(before);
    }
  });
});
