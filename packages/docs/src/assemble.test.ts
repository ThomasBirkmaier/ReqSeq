import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assembleContent, contentPaths } from "./assemble.js";

describe("contentPaths", () => {
  it("reads docs/guide of the repository and writes the content folder of the site", () => {
    const packageDir = join("repo", "packages", "docs");
    expect(contentPaths(packageDir)).toEqual({
      guideDir: join("repo", "docs", "guide"),
      contentDir: join("repo", "packages", "docs", "site", "src", "content", "docs"),
    });
  });
});

describe("assembleContent", () => {
  let dir: string;
  let paths: { guideDir: string; contentDir: string };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reqseq-docs-"));
    paths = { guideDir: join(dir, "guide"), contentDir: join(dir, "site", "content") };
    await mkdir(join(paths.guideDir, "start"), { recursive: true });
    await writeFile(join(paths.guideDir, "index.md"), "# Home\n");
    await writeFile(join(paths.guideDir, "start", "first.md"), "# First\n");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("copies every page of the guide, folders included", async () => {
    expect(await assembleContent(paths)).toEqual(["index.md", "start/first.md"]);
    expect(await readFile(join(paths.contentDir, "start", "first.md"), "utf8")).toBe("# First\n");
  });

  it("removes pages of an earlier run that the guide no longer has", async () => {
    await mkdir(paths.contentDir, { recursive: true });
    await writeFile(join(paths.contentDir, "old.md"), "# Old\n");
    expect(await assembleContent(paths)).toEqual(["index.md", "start/first.md"]);
  });

  it("fails when the guide folder is missing", async () => {
    await rm(paths.guideDir, { recursive: true });
    await expect(assembleContent(paths)).rejects.toThrow(/ENOENT/);
  });
});
