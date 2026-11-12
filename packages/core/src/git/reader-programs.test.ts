// SR-208 AK1: reading files, versions, commits and differences starts no program that a repository
// or its Git configuration names: a file system monitor, an external diff or textconv program, or a
// clean or process filter (as Git LFS sets one), also in a submodule. Each program only appends to a
// marker file. A positive check runs plain git on the same setup and shows that it starts the
// monitor, both filters, the submodule's filter, the diff command and the textconv program, so the
// test cannot pass because the setup never made git start them.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  changedPaths,
  commitBlobs,
  fileHistory,
  fileMoves,
  headCommit,
  openObjectReader,
  resolveCommit,
  trackedFile,
} from "./reader.js";

const run = promisify(execFile);

/** A shell command that appends to the marker `name` (forward slashes, also on Windows). */
const marking = (markers: string, name: string): string =>
  `echo x >> "${path.join(markers, name).split(path.sep).join("/")}"`;

const markersIn = async (markers: string): Promise<string[]> => (await fs.readdir(markers)).sort();

/** Makes every tracked file racily clean: the index gets the time of the oldest file, to the millisecond. */
const racy = async (repo: string, files: readonly string[]): Promise<void> => {
  const times = await Promise.all(files.map(async (file) => (await fs.stat(path.join(repo, file))).mtime));
  const oldest = new Date(Math.min(...times.map((t) => t.getTime())));
  await fs.utimes(path.join(repo, ".git", "index"), oldest, oldest);
};

const setUp = async (): Promise<{
  ws: FixtureWorkspace;
  repo: string;
  markers: string;
  first: string;
  second: string;
}> => {
  const ws = await createFixtureWorkspace({
    files: {
      "repo/a.md": "alpha\nbeta\ngamma\ndelta\n",
      "repo/b.txt": "text\n",
      "repo/.gitattributes": "*.md filter=clean-it diff=shown\n*.txt filter=lfs-like\n",
      "subsource/in.s": "inner\n",
      "subsource/.gitattributes": "*.s filter=inner\n",
    },
    git: ["repo", "subsource"],
  });
  onTestFinished(() => ws.cleanup());
  const markers = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-markers-"));
  onTestFinished(() => fs.rm(markers, { recursive: true, force: true }));
  const repo = ws.path("repo");
  await ws.git(
    ["-c", "protocol.file.allow=always", "submodule", "--quiet", "add", "../subsource", "sub"],
    "repo",
  );
  await ws.git(["commit", "--quiet", "-m", "submodule"], "repo");
  const first = (await ws.git(["rev-parse", "HEAD"], "repo")).trim();
  // A move with an edit, which rename detection compares by content.
  await ws.git(["mv", "a.md", "c.md"], "repo");
  await fs.writeFile(path.join(repo, "c.md"), "alpha\nbeta\ngamma\nepsilon\n");
  await ws.git(["commit", "--quiet", "-am", "move"], "repo");
  const second = (await ws.git(["rev-parse", "HEAD"], "repo")).trim();
  // The programs, configured after the setup so that its own git calls start none.
  const monitor = path.join(markers, "..", `${path.basename(markers)}-fsmonitor.sh`);
  await fs.writeFile(monitor, `#!/bin/sh\n${marking(markers, "fsmonitor")}\n`, { mode: 0o755 });
  onTestFinished(() => fs.rm(monitor, { force: true }));
  const config: [string, string][] = [
    ["core.fsmonitor", monitor.split(path.sep).join("/")],
    ["diff.external", marking(markers, "external")],
    ["diff.shown.command", marking(markers, "diff-command")],
    ["diff.shown.textconv", `${marking(markers, "textconv")}; cat`],
    ["filter.clean-it.clean", `${marking(markers, "clean")}; cat`],
    ["filter.lfs-like.process", marking(markers, "process")],
    ["filter.lfs-like.required", "true"],
  ];
  for (const [key, value] of config) {
    await ws.git(["config", key, value], "repo");
  }
  await ws.git(["config", "filter.inner.clean", `${marking(markers, "inner")}; cat`], "repo/sub");
  // A new time for the submodule's file: its `status` would hash it through the filter.
  const later = new Date(Date.now() + 5_000);
  await fs.utimes(path.join(repo, "sub", "in.s"), later, later);
  await racy(repo, ["c.md", "b.txt", ".gitattributes"]);
  return { ws, repo, markers, first, second };
};

describe("reading Git starts no program the repository names (SR-208)", () => {
  it("[SR-208/AK-z02x] reads files, versions, commits and differences without a monitor, diff program or filter", async () => {
    const { repo, markers, first, second } = await setUp();
    expect(await headCommit(repo)).toMatchObject({ known: true, commit: second });
    expect(await resolveCommit(repo, "HEAD")).toMatchObject({ known: true });
    const changed = await changedPaths(repo, first);
    expect(changed).toMatchObject({
      known: true,
      paths: expect.arrayContaining(["a.md", "c.md"]) as unknown,
    });
    expect(await fileHistory(repo, second, ["c.md", "b.txt"])).toMatchObject({ known: true });
    expect(await fileMoves(repo, [second])).toMatchObject({ known: true });
    expect(await commitBlobs(repo, second, ["c.md", "b.txt"])).toMatchObject({ known: true });
    expect(await trackedFile(repo, "b.txt")).toEqual({ known: true, tracked: true });
    const objects = openObjectReader(repo);
    onTestFinished(() => {
      objects.close();
    });
    const read: string[] = [];
    await objects.read([`${second}:c.md`], () => (chunk) => {
      read.push(chunk.toString("utf8"));
    });
    expect(read.join("")).toContain("epsilon");
    expect(await markersIn(markers)).toEqual([]);
    // The same setup makes plain git start them: the process filter first, which fails and stops
    // the diff, so a second run without it shows the clean filter and the submodule's filter.
    await run("git", ["diff", "--name-only", "HEAD"], { cwd: repo }).catch(() => undefined);
    expect(await markersIn(markers)).toEqual(["fsmonitor", "process"]);
    const withoutProcess = ["-c", "filter.lfs-like.process=", "-c", "filter.lfs-like.required=false"];
    await run("git", [...withoutProcess, "diff", "--name-only", "HEAD"], { cwd: repo }).catch(
      () => undefined,
    );
    expect(await markersIn(markers)).toEqual(expect.arrayContaining(["clean", "inner"]));
    // A patch starts the diff command of the attributes, or without external diffs the textconv program.
    await run("git", [...withoutProcess, "diff", first, second], { cwd: repo }).catch(() => undefined);
    await run("git", [...withoutProcess, "diff", "--no-ext-diff", first, second], { cwd: repo }).catch(
      () => undefined,
    );
    expect(await markersIn(markers)).toEqual(expect.arrayContaining(["diff-command", "textconv"]));
  });
});
