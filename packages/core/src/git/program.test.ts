import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { findGit, gitProgram } from "./program.js";

/** `findGit` where exactly the files of `programs` may be run. */
const find = (platform: NodeJS.Platform, search: string | undefined, programs: readonly string[]) =>
  findGit({ platform, search, isProgram: (file) => programs.includes(file) });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("findGit (#940)", () => {
  it("takes the first git in an absolute folder of PATH and skips relative entries", () => {
    expect(find("linux", ".::bin:/opt/none:/usr/bin:/bin", ["bin/git", "/usr/bin/git", "/bin/git"])).toBe(
      "/usr/bin/git",
    );
    expect(find("darwin", "/usr/local/../bin", ["/usr/bin/git"])).toBe("/usr/bin/git");
  });

  it("looks for git.exe on Windows, in quoted entries too, never in a relative one", () => {
    const git = "C:\\Program Files\\Git\\cmd\\git.exe";
    expect(
      find("win32", `.;Git\\cmd;"C:\\Program Files\\Git\\cmd";C:\\Windows`, [git, "Git\\cmd\\git.exe"]),
    ).toBe(git);
    expect(
      find("win32", "C:\\Program Files\\Git\\cmd", ["C:\\Program Files\\Git\\cmd\\git"]),
    ).toBeUndefined();
  });

  it("finds none without PATH or without a git on it", () => {
    expect(find("linux", undefined, ["/usr/bin/git"])).toBeUndefined();
    expect(find("linux", "/usr/bin", [])).toBeUndefined();
  });
});

describe("gitProgram (#940)", () => {
  it("finds the git program of this system by an absolute path, again when PATH changes or none was found", async () => {
    const found = gitProgram();
    expect(found !== undefined && path.isAbsolute(found)).toBe(true);
    expect(gitProgram()).toBe(found);

    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-git-program-"));
    onTestFinished(() => fs.rm(folder, { recursive: true, force: true }));
    // A folder named git is no program. A git installed later is found without a restart.
    const planted = path.join(folder, process.platform === "win32" ? "git.exe" : "git");
    await fs.mkdir(planted);
    vi.stubEnv("PATH", folder);
    expect(gitProgram()).toBeUndefined();
    await fs.rmdir(planted);
    await fs.writeFile(planted, "", { mode: 0o755 });
    expect(gitProgram()).toBe(planted);
    vi.stubEnv("PATH", `${path.dirname(found ?? "")}${path.delimiter}${folder}`);
    expect(gitProgram()).toBe(found);
  });
});
