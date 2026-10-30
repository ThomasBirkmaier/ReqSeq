import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assembleContent, contentPaths, imageProblems, withBase } from "./assemble.js";

describe("contentPaths", () => {
  it("reads docs/guide of the repository and writes the content folder of the site", () => {
    const packageDir = join("repo", "packages", "docs");
    expect(contentPaths(packageDir)).toEqual({
      repoRoot: "repo",
      guideDir: join("repo", "docs", "guide"),
      contentDir: join("repo", "packages", "docs", "site", "src", "content", "docs"),
    });
  });
});

describe("assembleContent", () => {
  let dir: string;
  let paths: { repoRoot: string; guideDir: string; contentDir: string };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "reqseq-docs-"));
    paths = { repoRoot: dir, guideDir: join(dir, "guide"), contentDir: join(dir, "site", "content") };
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

  it("gives the site links of the hand-written pages the base path, and leaves other files as they are", async () => {
    await writeFile(join(paths.guideDir, "index.md"), "[First](/start/first/)\n");
    await writeFile(join(paths.guideDir, "start", "logo.svg"), "<svg>](/x)</svg>");
    await assembleContent(paths, [], "/ReqSeq");
    expect(await readFile(join(paths.contentDir, "index.md"), "utf8")).toBe(
      "[First](/ReqSeq/start/first/)\n",
    );
    expect(await readFile(join(paths.contentDir, "start", "logo.svg"), "utf8")).toBe("<svg>](/x)</svg>");
    await assembleContent(paths);
    expect(await readFile(join(paths.contentDir, "index.md"), "utf8")).toBe("[First](/start/first/)\n");
  });

  it("removes pages of an earlier run that the guide no longer has", async () => {
    await mkdir(paths.contentDir, { recursive: true });
    await writeFile(join(paths.contentDir, "old.md"), "# Old\n");
    expect(await assembleContent(paths)).toEqual(["index.md", "start/first.md"]);
  });

  it("writes the generated pages next to the hand-written ones", async () => {
    const pages = [{ path: "reference/commands/index.md", text: "# Commands\n" }];
    expect(await assembleContent(paths, pages)).toEqual([
      "index.md",
      "reference/commands/index.md",
      "start/first.md",
    ]);
    expect(await readFile(join(paths.contentDir, "reference", "commands", "index.md"), "utf8")).toBe(
      "# Commands\n",
    );
  });

  it("never lets a generated page replace a hand-written one", async () => {
    await expect(assembleContent(paths, [{ path: "index.md", text: "# Generated\n" }])).rejects.toThrow(
      /EEXIST/,
    );
  });

  it("refuses a hand-written page that no section of the sidebar lists", async () => {
    await writeFile(join(paths.guideDir, "notes.md"), "# Notes\n");
    await mkdir(join(paths.guideDir, "other"));
    await writeFile(join(paths.guideDir, "other", "page.md"), "# Other\n");
    await expect(assembleContent(paths)).rejects.toThrow(
      "docs/guide: notes.md, other/page.md not in a section of the sidebar (start, how-to, concepts)",
    );
  });

  it("copies the images of the guide, and refuses a page whose image is not there", async () => {
    await mkdir(join(paths.guideDir, "images"));
    await writeFile(join(paths.guideDir, "images", "app-overview.png"), "png");
    await writeFile(
      join(paths.guideDir, "start", "first.md"),
      "![The overview](../images/app-overview.png)\n",
    );
    expect(await assembleContent(paths)).toEqual(["images/app-overview.png", "index.md", "start/first.md"]);
    await writeFile(join(paths.guideDir, "index.md"), "![The list](images/app-list.png)\n");
    await writeFile(join(paths.guideDir, "images", "notes.md"), "# Notes\n");
    await expect(assembleContent(paths)).rejects.toThrow("docs/guide: images/notes.md not in a section");
    await rm(join(paths.guideDir, "images", "notes.md"));
    await expect(assembleContent(paths)).rejects.toThrow(
      "docs/guide: index.md: the image images/app-list.png is no file of the guide relative to the page",
    );
  });

  it("lets a generated page show an image of the guide, and refuses one whose image is not there", async () => {
    await mkdir(join(paths.guideDir, "images"));
    await writeFile(join(paths.guideDir, "images", "app-model.png"), "png");
    const page = { path: "reference/model.md", text: "![The model](../images/app-model.png)\n" };
    expect(await assembleContent(paths, [page])).toContain("reference/model.md");
    await expect(
      assembleContent(paths, [{ path: "reference/model.md", text: "![The model](../images/gone.png)\n" }]),
    ).rejects.toThrow("docs/guide: reference/model.md: the image ../images/gone.png is no file of the guide");
  });

  it("fails when the guide folder is missing", async () => {
    await rm(paths.guideDir, { recursive: true });
    await expect(assembleContent(paths)).rejects.toThrow(/ENOENT/);
  });
});

describe("imageProblems", () => {
  const files = new Set(["images/app-overview.png", "start/first.md"]);

  it("accepts an image relative to the page, with alt text and a title, and skips code", () => {
    const text = [
      '![The overview of the app](../images/app-overview.png "Overview")',
      "`![](gone.png)`",
      "```md",
      "![](gone.png)",
      "```",
    ].join("\n");
    expect(imageProblems("start/first.md", text, files)).toEqual([]);
  });

  it("names an image without alt text, a missing one, and one of another site or with a site path", () => {
    const text = [
      "![ ](../images/app-overview.png)",
      "![Gone](../images/app-gone.png)",
      "![Web](https://example.org/x.png)",
      "![Site](/images/app-overview.png)",
    ].join("\n");
    expect(imageProblems("start/first.md", text, files)).toEqual([
      "start/first.md: the image ../images/app-overview.png has no alt text",
      "start/first.md: the image ../images/app-gone.png is no file of the guide relative to the page",
      "start/first.md: the image https://example.org/x.png is no file of the guide relative to the page",
      "start/first.md: the image /images/app-overview.png is no file of the guide relative to the page",
    ]);
  });
});

describe("withBase", () => {
  it("prefixes inline links and link definitions to the site, not other sites, code or relative links", () => {
    const page = [
      "See [Get started](/start/get-started/) and [the API](/reference/commands/#api).",
      "[ref]: /reference/commands/",
      "[other](//example.org/x), [up](../x/), [web](https://example.org/), `[code](/x)`.",
    ].join("\n");
    expect(withBase(page, "/ReqSeq/")).toBe(
      [
        "See [Get started](/ReqSeq/start/get-started/) and [the API](/ReqSeq/reference/commands/#api).",
        "[ref]: /ReqSeq/reference/commands/",
        "[other](//example.org/x), [up](../x/), [web](https://example.org/), `[code](/x)`.",
      ].join("\n"),
    );
    expect(withBase(page, "/")).toBe(page);
  });
});
