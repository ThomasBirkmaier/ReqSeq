// The files of the evidence folders (ADR-0012 "Reading"): the walk of every `evidence` location of the
// workspace file. Enabler tests of the evidence block (#535); the SR tests come with the readers.
import fs from "node:fs/promises";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { Problem } from "../catalog.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { loadWorkspaceLayout } from "../workspace/index.js";
import { evidenceFiles } from "./folders.js";

/** A workspace in `system/` with the repositories `system` and `ci` (both in the fixture) and `gone` (not). */
const WORKSPACE = (evidence: string, ignore = ""): string =>
  "logreq-workspace: 1\nname: Station\nrepositories:\n" +
  "  - { name: system, url: u, main: true }\n  - { name: ci, url: u }\n  - { name: gone, url: u }\n" +
  `metamodel: { repository: system, path: metamodel }\nevidence:\n${evidence}${ignore}`;

const fixture = async (files: Readonly<Record<string, string>>): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ files });
  onTestFinished(() => created.cleanup());
  return created;
};

const layoutOf = (ws: FixtureWorkspace): Promise<WorkspaceLayout> => loadWorkspaceLayout(ws.path("system"));

/** The listed files as `repository:file (ext)`. */
const listed = async (ws: FixtureWorkspace): Promise<string[]> =>
  (await evidenceFiles(await layoutOf(ws))).files.map((f) => `${f.repository}:${f.file} (${f.ext})`);

describe("evidenceFiles", () => {
  it("evidenceFiles lists *.md and *.xml files of every evidence location, nested folders included", async () => {
    const ws = await fixture({
      "system/logreq-workspace.yaml": WORKSPACE(
        "  - { repository: system, path: evidence }\n  - { repository: system, path: ./manual/ }\n",
      ),
      "system/evidence/b.md": "",
      "system/evidence/ci/run-2/results.xml": "",
      "system/evidence/ci/notes.txt": "",
      "system/evidence/ci/node_modules/x.xml": "",
      "system/manual/a.md": "",
      "system/requirements/SR-000000000001.md": "",
    });
    const out = await evidenceFiles(await layoutOf(ws));
    expect(out.files.map((f) => `${f.repository}:${f.file} (${f.ext})`)).toEqual([
      "system:evidence/b.md (md)",
      "system:evidence/ci/run-2/results.xml (xml)",
      "system:manual/a.md (md)",
    ]);
    expect(out.files[1]?.absolute).toBe(ws.path("system/evidence/ci/run-2/results.xml"));
    // The repository with the gone location is not named by any location: complete.
    expect(out.incomplete).toBe(false);
    expect(out.problems).toEqual([]);
  });

  it("evidenceFiles gives nothing for a workspace without evidence locations", async () => {
    const ws = await fixture({
      "system/logreq-workspace.yaml": WORKSPACE("").replace("evidence:\n", ""),
      "system/evidence/a.md": "",
    });
    expect(await evidenceFiles(await layoutOf(ws))).toEqual({ files: [], incomplete: false, problems: [] });
  });

  it("evidenceFiles reads an evidence location in another repository of the workspace", async () => {
    const ws = await fixture({
      "system/logreq-workspace.yaml": WORKSPACE(
        "  - { repository: ci, path: results }\n  - { repository: system, path: . }\n",
        "ignore: ['requirements/**']\n",
      ),
      "system/requirements/SR-000000000001.md": "",
      "system/record.md": "",
      "ci/results/junit.xml": "",
    });
    expect(await listed(ws)).toEqual(["ci:results/junit.xml (xml)", "system:record.md (md)"]);
  });

  it("evidenceFiles marks the result incomplete when the repository of a location is not available", async () => {
    const ws = await fixture({
      "system/logreq-workspace.yaml": WORKSPACE(
        "  - { repository: gone, path: results }\n  - { repository: unknown, path: x }\n  - { repository: system, path: evidence }\n",
      ),
      "system/evidence/a.md": "",
    });
    const out = await evidenceFiles(await layoutOf(ws));
    expect(out.incomplete).toBe(true);
    // A location in a repository the workspace file does not list is reported by the layout, not here.
    expect(out.problems).toEqual([]);
    expect(out.files.map((f) => f.file)).toEqual(["evidence/a.md"]);
  });

  it("evidenceFiles reports evidence.folder-missing for a location that does not exist", async () => {
    const ws = await fixture({
      "system/logreq-workspace.yaml": WORKSPACE(
        "  - { repository: system, path: evidence/missing }\n  - { repository: system, path: plain.md }\n",
      ),
      "system/plain.md": "",
    });
    const out = await evidenceFiles(await layoutOf(ws));
    expect(out).toEqual({
      files: [],
      incomplete: false,
      problems: [
        {
          code: "evidence.folder-missing",
          severity: "info",
          repository: "system",
          file: "evidence/missing",
          message: "The evidence folder evidence/missing does not exist",
        },
        {
          code: "evidence.folder-missing",
          severity: "info",
          repository: "system",
          file: "plain.md",
          message: "The evidence folder plain.md does not exist",
        },
      ],
    });
  });

  it("evidenceFiles skips linked files and folders and applies the ignore globs", async () => {
    const ws = await fixture({
      "system/logreq-workspace.yaml": WORKSPACE(
        "  - { repository: system, path: evidence }\n  - { repository: system, path: linked/inner }\n" +
          "  - { repository: system, path: evidence/sub }\n",
        "ignore: ['**/*.draft.md', 'evidence/old/**']\n",
      ),
      "system/evidence/a.md": "",
      "system/evidence/a.draft.md": "",
      "system/evidence/old/b.xml": "",
      "system/evidence/sub/c.XML": "",
      "system/evidence/sub/d.xml": "",
      "system/outside/inner/e.md": "",
    });
    await fs.symlink(ws.path("system/outside"), ws.path("system/evidence/linked"), "junction");
    await fs.symlink(ws.path("system/outside"), ws.path("system/linked"), "junction");
    await fs.symlink(ws.path("system/outside/inner/e.md"), ws.path("system/evidence/link.md"), "file");
    const out = await evidenceFiles(await layoutOf(ws));
    // evidence/sub is reached by two locations: its file and its problem once.
    expect(out.files.map((f) => f.file)).toEqual(["evidence/a.md", "evidence/sub/d.xml"]);
    expect(out.problems).toEqual([
      {
        code: "file.skipped",
        severity: "warning",
        repository: "system",
        file: "evidence/link.md",
        message: "Not read: it is a symbolic link; LogReq does not follow links",
      },
      {
        code: "file.skipped",
        severity: "warning",
        repository: "system",
        file: "evidence/sub/c.XML",
        message: "Not read: evidence files end in .md or .xml in lower case",
      },
      {
        code: "file.skipped",
        severity: "warning",
        repository: "system",
        file: "linked/inner",
        message:
          "Not read: the evidence folder is or lies below a symbolic link; LogReq does not follow links",
      },
    ]);
  });

  it("evidenceFiles applies the walk rules to the evidence folder itself", async () => {
    const ws = await fixture({
      "system/logreq-workspace.yaml":
        "logreq-workspace: 1\nname: Station\nrepositories:\n" +
        "  - { name: system, url: u, main: true }\n  - { name: ci, url: u, path: inner }\n" +
        "metamodel: { repository: system, path: metamodel }\nevidence:\n" +
        "  - { repository: system, path: node_modules/results }\n" +
        "  - { repository: system, path: website/evidence }\n" +
        "  - { repository: system, path: inner/results }\n" +
        "  - { repository: ci, path: results }\n" +
        "  - { repository: system, path: foreign/results }\n" +
        "  - { repository: system, path: plain.md/results }\n" +
        "ignore: ['website/**']\n",
      "system/node_modules/results/a.md": "",
      "system/website/evidence/b.md": "",
      "system/inner/results/c.xml": "",
      "system/foreign/.git": "gitdir: elsewhere\n",
      "system/foreign/results/d.md": "",
      "system/plain.md": "",
    });
    const out = await evidenceFiles(await layoutOf(ws));
    // The nested repository is read once, under its own name.
    expect(out.files.map((f) => `${f.repository}:${f.file}`)).toEqual(["ci:results/c.xml"]);
    const skipped = (file: string, reason: string): Problem => ({
      code: "file.skipped",
      severity: "warning",
      repository: "system",
      file,
      message: `Not read: the evidence folder ${reason}`,
    });
    expect(out.problems).toEqual([
      skipped("node_modules/results", "lies in node_modules, which LogReq never reads"),
      skipped("website/evidence", "matches an ignore glob of the workspace file"),
      skipped(
        "inner/results",
        "lies in another repository of the workspace; name that repository in the location",
      ),
      skipped("foreign/results", "lies in a nested Git repository that is not part of the workspace"),
      {
        code: "evidence.folder-missing",
        severity: "info",
        repository: "system",
        file: "plain.md/results",
        message: "The evidence folder plain.md/results does not exist",
      },
    ]);
  });

  it("evidenceFiles reports an evidence folder it cannot look at as unreadable, not as missing", async () => {
    const ws = await fixture({
      "system/logreq-workspace.yaml": WORKSPACE("  - { repository: system, path: locked/results }\n"),
      "system/locked/results/a.md": "",
    });
    const layout = await layoutOf(ws);
    const lstat = fs.lstat.bind(fs);
    const spy = vi
      .spyOn(fs, "lstat")
      .mockImplementation(((file: string) =>
        file.endsWith("locked")
          ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
          : lstat(file)) as typeof fs.lstat);
    onTestFinished(() => {
      spy.mockRestore();
    });
    expect(await evidenceFiles(layout)).toEqual({
      files: [],
      incomplete: false,
      problems: [
        {
          code: "file.unreadable",
          severity: "error",
          repository: "system",
          file: "locked/results",
          message: "Cannot read evidence folder: EACCES",
        },
      ],
    });
  });
});
