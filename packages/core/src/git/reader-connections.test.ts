// SR-208 AK2: reading a repository with a submodule and remotes opens no connection (SR-078). The
// repository is a partial clone, so an object it lacks would be fetched from its promisor remote on
// a read. Every transport goes to a recorder: HTTP through a proxy on a loopback port that counts
// connections, `git://` through a proxy command and SSH through an SSH command that each append to
// a marker file. A positive check runs plain git on the same setup and shows that each transport
// reaches its recorder, so the test cannot pass because the setup never made git connect.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  changedPaths,
  commitBlobs,
  commitsBetween,
  fileHistory,
  fileMoves,
  firstParentChanges,
  headCommit,
  headFiles,
  historyRange,
  openObjectReader,
  resolveCommit,
  trackedFile,
} from "./reader.js";

const run = promisify(execFile);

/** A shell command that appends to the marker `name` (forward slashes, also on Windows). */
const marking = (markers: string, name: string): string =>
  `echo x >> "${path.join(markers, name).split(path.sep).join("/")}"`;

const markersIn = async (markers: string): Promise<string[]> => (await fs.readdir(markers)).sort();

/** A loopback server that counts each connection and closes it: the HTTP proxy of the repository. */
const recorder = async (): Promise<{ port: string; connections: () => number }> => {
  let count = 0;
  const server = net.createServer((socket) => {
    count += 1;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  );
  return { port: String((server.address() as net.AddressInfo).port), connections: () => count };
};

const setUp = async (): Promise<{
  repo: string;
  markers: string;
  connections: () => number;
  first: string;
  second: string;
}> => {
  const ws = await createFixtureWorkspace({
    files: {
      "origin/a.md": "alpha\nbeta\ngamma\ndelta\n",
      "origin/b.md": "text\n",
      "subsource/in.s": "inner\n",
    },
    git: ["origin", "subsource"],
  });
  onTestFinished(() => ws.cleanup());
  const markers = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-markers-"));
  onTestFinished(() => fs.rm(markers, { recursive: true, force: true }));
  const local = ["-c", "protocol.file.allow=always"];
  await ws.git([...local, "submodule", "--quiet", "add", "../subsource", "sub"], "origin");
  await ws.git(["commit", "--quiet", "-m", "submodule"], "origin");
  const first = (await ws.git(["rev-parse", "HEAD"], "origin")).trim();
  await ws.git(["mv", "a.md", "c.md"], "origin");
  await fs.writeFile(ws.path("origin/c.md"), "alpha\nbeta\ngamma\nepsilon\n");
  await ws.git(["commit", "--quiet", "-am", "move"], "origin");
  const second = (await ws.git(["rev-parse", "HEAD"], "origin")).trim();
  await ws.git(["config", "uploadpack.allowFilter", "true"], "origin");
  // A partial clone holds only the files of its checkout: `a.md` of the first commit is missing.
  await ws.git([
    ...local,
    "clone",
    "--quiet",
    "--filter=blob:none",
    "--recurse-submodules",
    pathToFileURL(ws.path("origin")).href,
    "repo",
  ]);
  // The remotes and the submodule then point at other machines, each through a recorder.
  const { port, connections } = await recorder();
  // git starts the proxy command of `git://` as a program, not through a shell.
  const gitProxy = path.join(markers, "..", `${path.basename(markers)}-git-proxy.sh`);
  await fs.writeFile(gitProxy, `#!/bin/sh\n${marking(markers, "git-proxy")}\n`, { mode: 0o755 });
  onTestFinished(() => fs.rm(gitProxy, { force: true }));
  const config: [string, string, string][] = [
    ["repo", "remote.origin.url", "http://example.invalid/origin.git"],
    ["repo", "http.proxy", `http://127.0.0.1:${port}`],
    ["repo", "remote.mirror.url", "git://example.invalid/origin.git"],
    ["repo", "remote.mirror.fetch", "+refs/heads/*:refs/remotes/mirror/*"],
    ["repo", "core.gitProxy", gitProxy.split(path.sep).join("/")],
    ["repo", "submodule.sub.url", "ssh://example.invalid/subsource.git"],
    ["repo", "fetch.recurseSubmodules", "true"],
    ["repo/sub", "remote.origin.url", "ssh://example.invalid/subsource.git"],
    ["repo/sub", "core.sshCommand", `${marking(markers, "ssh")} #`],
  ];
  for (const [repository, key, value] of config) {
    await ws.git(["config", key, value], repository);
  }
  return { repo: ws.path("repo"), markers, connections, first, second };
};

describe("reading Git opens no connection (SR-208)", () => {
  it("[SR-208/AK-nj6c] reads files, versions, commits and differences of a repository with a submodule and remotes without connecting", async () => {
    const { repo, markers, connections, first, second } = await setUp();
    expect(await headCommit(repo)).toMatchObject({ known: true, commit: second });
    expect(await headFiles(repo)).toBeDefined();
    expect(await resolveCommit(repo, "HEAD~1")).toEqual({ known: true, commit: first });
    expect(await changedPaths(repo, first)).toMatchObject({
      known: true,
      paths: expect.arrayContaining(["a.md", "c.md"]) as unknown,
    });
    expect(await fileHistory(repo, second, ["c.md", "b.md"])).toMatchObject({ known: true });
    expect(await historyRange(repo, first, second, ["c.md"])).toMatchObject({ known: true });
    expect(await commitsBetween(repo, second, first)).toMatchObject({ known: true });
    expect(await firstParentChanges(repo, [second])).toMatchObject({ known: true });
    expect(await fileMoves(repo, [second])).toMatchObject({ known: true });
    expect(await commitBlobs(repo, second, ["c.md", "b.md"])).toMatchObject({ known: true });
    expect(await trackedFile(repo, "b.md")).toEqual({ known: true, tracked: true });
    const objects = openObjectReader(repo);
    onTestFinished(() => {
      objects.close();
    });
    const read: string[] = [];
    await objects.read([`${second}:c.md`], () => (chunk) => {
      read.push(chunk.toString("utf8"));
    });
    expect(read.join("")).toContain("epsilon");
    // The blob the clone lacks is not fetched: missing (null), or unknown where git fails the read.
    const missing = await objects.read([`${first}:a.md`], () => () => undefined);
    expect([[null], "not-a-repository"]).toContainEqual(missing.known ? missing.objects : missing.reason);
    expect(connections()).toBe(0);
    expect(await markersIn(markers)).toEqual([]);
    // The same setup makes plain git connect: a read of the missing blob through the HTTP proxy,
    // a fetch over `git://` and one over SSH.
    await run("git", ["cat-file", "-p", `${first}:a.md`], { cwd: repo }).catch(() => undefined);
    expect(connections()).toBeGreaterThan(0);
    await run("git", ["fetch", "mirror"], { cwd: repo }).catch(() => undefined);
    await run("git", ["fetch", "origin"], { cwd: path.join(repo, "sub") }).catch(() => undefined);
    expect(await markersIn(markers)).toEqual(["git-proxy", "ssh"]);
  });
});
