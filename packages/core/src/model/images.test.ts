import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureOptions, FixtureWorkspace } from "@logreq/testkit";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import YAML from "yaml";
import type { CommandOutput } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { parseFileBytes } from "../files/index.js";
import { metamodelState } from "../metamodel/index.js";
import { invoke } from "../runtime/invoke.js";
import { Workspace } from "../runtime/workspace.js";
import { computeVersion, sha256Hex } from "../version/version.js";
import { workspaceLayoutState } from "../workspace/index.js";
import type { ImageSeen, ImageSource } from "./images.js";
import { embeddedImages, imageLinks, imageMemo, imagesUnchanged, lookUpImages } from "./images.js";
import { ignoreMatcher } from "./ignore.js";
import { elementStoreState } from "./store.js";
import { currentTarget } from "./targets.js";

/** The paths `imageLinks` gives, `!` in front of those that are missing whatever is on disk. */
const links = (elementFile: string, body: string, ignore: readonly string[] = []): string[] =>
  imageLinks(elementFile, body, ignoreMatcher(ignore)).map((l) => `${l.missing ? "!" : ""}${l.path}`);

describe("imageLinks", () => {
  it("gives inline and reference-style images relative to the element folder, each once", () => {
    const body = [
      '![a](a.png) ![b](./a.png) ![c](<sub dir/c.png> "Title") ![d][logo] ![logo]',
      "",
      "[logo]: img/logo.svg",
    ].join("\n");
    expect(links("reqs/SR-1.md", body)).toEqual(["a.png", "sub dir/c.png", "img/logo.svg"]);
    expect(imageLinks("reqs/SR-1.md", "![](../x/y.png)")).toEqual([
      { path: "../x/y.png", names: ["x", "y.png"], missing: false },
    ]);
  });

  it("resolves `..` inside the repository and skips the repository, the element's folder and file", () => {
    const body = [
      "![](../shared/x.png) ![](../../out.png) ![](..) ![](.) ![](./) ![](a/../..) ![](SR-1.md)",
      "![](../reqs/SR-1.md) ![](../reqs)",
    ].join(" ");
    expect(links("reqs/SR-1.md", body)).toEqual(["../shared/x.png"]);
    expect(links("SR-1.md", "![](x.png) ![](../x.png) ![](sub/../y.png) ![](.)")).toEqual(["x.png", "y.png"]);
    // The element's folder and file in the other normal form are still themselves.
    expect(
      links("Café/SR-1.md", "![](../Cafe%CC%81/SR-1.md) ![](../Cafe%CC%81) ![](../Cafe%CC%81/x.png)"),
    ).toEqual(["../Cafe\u0301/x.png"]);
  });

  it("counts no plain link, absolute URL, absolute path, empty destination or control character", () => {
    const body = [
      "[link](a.png) ![](https://example.org/a.png) ![](file:///tmp/a.png) ![](data:image/png;base64,AA)",
      "![](C:/a.png) ![](/abs.png) ![](//host/a.png) ![]() ![](<>) ![](#top) ![](?x)",
      "![](a%01.png) ![](a%7F.png) ![](<a\tb.png>) ![](a%0A.png)",
    ].join(" ");
    expect(links("reqs/SR-1.md", body)).toEqual([]);
  });

  it("counts no path through a name the element walk skips or an ignore glob matches", () => {
    const body =
      "![](.git/config) ![](sub/.GIT/x.png) ![](node_modules/p/x.png) ![](sub/.git./x.png) " +
      "![](drafts/x.png) ![](ok/drafts/x.png)";
    expect(links("SR-1.md", body, ["drafts/**"])).toEqual(["ok/drafts/x.png"]);
  });

  it("removes escapes, drops query and fragment and percent-decodes the rest", () => {
    const body = [
      "![](my\\_image.png) ![](a.png?v=2#frag) ![](b%20c.png) ![](%E2%82%AC.png) ![](d%23e.png)",
      "![](bad%zz.png)",
    ].join(" ");
    expect(links("reqs/SR-1.md", body)).toEqual([
      "my_image.png",
      "a.png",
      "b c.png",
      "€.png",
      "d#e.png",
      "bad%zz.png",
    ]);
  });

  it("marks as missing a `\\`, a trailing `/` and a name that Windows changes, on every OS", () => {
    const body = [
      "![](a\\b.png) ![](a%5Cb.png) ![](x.png/) ![](dot./x.png) ![](space%20) ![](nul.png) ![](COM1)",
      "![](a%3Fb.png) ![](a%3Cb.png) ![](x.png)",
    ].join(" ");
    expect(links("SR-1.md", body)).toEqual([
      "!a\\b.png",
      "!x.png/",
      "!dot./x.png",
      "!space ",
      "!nul.png",
      "!COM1",
      "!a?b.png",
      "!a<b.png",
      "x.png",
    ]);
  });

  it("counts no image in code", () => {
    expect(links("SR-1.md", "`![](a.png)`\n\n```\n![](b.png)\n```\n\n    ![](c.png)\n")).toEqual([]);
  });
});

/** A temporary repository folder. */
const tempRoot = async (): Promise<string> => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "logreq-images-")));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));
  return root;
};

const put = async (root: string, file: string, content: string): Promise<void> => {
  await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await fs.writeFile(path.join(root, file), content);
};

const sourceOf = (
  root: string,
  excludes: readonly string[] = [],
  ignore: readonly string[] = [],
): ImageSource => ({
  repository: { folder: root, excludes },
  ignored: ignoreMatcher(ignore),
});

/** The images as `path: hash`, with `missing` for null. */
const imagesOf = async (source: ImageSource, file: string, body: string): Promise<string[]> =>
  (await embeddedImages(source, file, body)).map((i) => `${i.path}: ${i.sha256 ?? "missing"}`);

describe("embeddedImages", () => {
  it("reads each image's SHA-256, size and mtime, and gives null for one that is missing or no file", async () => {
    const root = await tempRoot();
    await put(root, "reqs/a.png", "A");
    await put(root, "shared/b.png", "BB");
    await fs.mkdir(path.join(root, "reqs", "folder"));
    await put(root, "reqs/file.txt", "F");
    const body =
      "![](a.png) ![](../shared/b.png) ![](gone.png) ![](folder) ![](file.txt/x.png) ![](none/x.png)";
    const images = await embeddedImages(sourceOf(root), "reqs/SR-1.md", body);
    const stat = await fs.lstat(path.join(root, "reqs", "a.png"));
    expect(images[0]).toEqual({ path: "a.png", sha256: sha256Hex("A"), size: 1, mtimeMs: stat.mtimeMs });
    expect(images.map((i) => `${i.path}: ${i.sha256 ?? "missing"}`)).toEqual([
      `a.png: ${sha256Hex("A")}`,
      `../shared/b.png: ${sha256Hex("BB")}`,
      "gone.png: missing",
      "folder: missing",
      "file.txt/x.png: missing",
      "none/x.png: missing",
    ]);
  });

  it("hashes a symbolic link to a file as its link text; files below a linked folder are missing", async () => {
    const root = await tempRoot();
    await put(root, "a.png", "A");
    await put(root, "real/b.png", "B");
    // A link text without a separator: Windows writes `/` in a link text as `\`.
    await fs.symlink("a.png", path.join(root, "link.png"), "file");
    await fs.symlink(path.join(root, "real"), path.join(root, "linked"), "junction");
    expect(await imagesOf(sourceOf(root), "SR-1.md", "![](link.png) ![](linked/b.png)")).toEqual([
      `link.png: ${sha256Hex("a.png")}`,
      "linked/b.png: missing",
    ]);
  });

  it("needs every name spelled as on disk: another case is missing, NFD and NFC are the same name", async () => {
    const root = await tempRoot();
    const nfd = "Cafe\u0301";
    const nfc = "Café";
    await put(root, `${nfd}/Layout.png`, "L");
    const body = `![](${nfc}/Layout.png) ![](${nfd}/Layout.png) ![](${nfc}/layout.png) ![](CAFÉ/Layout.png)`;
    expect(await imagesOf(sourceOf(root), "SR-1.md", body)).toEqual([
      `${nfc}/Layout.png: ${sha256Hex("L")}`,
      `${nfd}/Layout.png: ${sha256Hex("L")}`,
      `${nfc}/layout.png: missing`,
      "CAFÉ/Layout.png: missing",
    ]);
  });

  it("prefers the exact spelling where the file system keeps NFC and NFD apart, else finds the one file", async () => {
    const root = await tempRoot();
    await put(root, "Cafe\u0301.png", "D");
    await put(root, "Café.png", "C");
    // APFS ignores the normal form of names; NTFS and ext4 keep NFC and NFD apart. The file system
    // decides; CI, where the platform's file system is known, also checks that.
    const [one, two] = await Promise.all(
      ["Cafe\u0301.png", "Café.png"].map((name) => fs.stat(path.join(root, name), { bigint: true })),
    );
    const same = one?.ino === two?.ino && one?.dev === two?.dev;
    if (process.env["CI"] !== undefined) {
      expect(same).toBe(process.platform === "darwin");
    }
    expect(await imagesOf(sourceOf(root), "SR-1.md", "![](Café.png) ![](Cafe\u0301.png)")).toEqual([
      `Café.png: ${sha256Hex("C")}`,
      `Cafe\u0301.png: ${sha256Hex(same ? "C" : "D")}`,
    ]);
  });

  it("gives a name that two names on disk equal after NFC as missing", async () => {
    const root = await tempRoot();
    await put(root, "\u01d8.png", "1");
    // Three spellings of one NFC name: two listed on disk (as a file system that keeps them apart
    // lists them, on every OS), the link spells the third.
    const entry = (name: string): object => ({
      name,
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    });
    vi.spyOn(fs, "readdir")
      .mockResolvedValueOnce([entry("\u01d8.png")] as never)
      .mockResolvedValueOnce([entry("u\u0308\u0301.png"), entry("\u01d8.png")] as never);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    // One name equal after NFC: found, under the spelling on disk.
    expect(await imagesOf(sourceOf(root), "SR-1.md", "![](\u00fc\u0301.png)")).toEqual([
      `\u00fc\u0301.png: ${sha256Hex("1")}`,
    ]);
    expect(await imagesOf(sourceOf(root), "SR-1.md", "![](\u00fc\u0301.png)")).toEqual([
      "\u00fc\u0301.png: missing",
    ]);
  });

  it("counts a `\\` link as missing on every OS, also where a file of that name exists", async () => {
    const root = await tempRoot();
    await put(root, "a/b.png", "B");
    // Windows takes `\\` for a separator and finds `a/b.png`; elsewhere `a\\b.png` is a name.
    if (process.platform !== "win32") {
      await put(root, "a\\b.png", "B");
    }
    expect(await imagesOf(sourceOf(root), "SR-1.md", "![](a\\b.png)")).toEqual(["a\\b.png: missing"]);
  });

  it("counts no image inside a nested repository: a folder with a `.git` entry or one in `excludes`", async () => {
    const root = await tempRoot();
    await put(root, "sub/.git", "gitdir: elsewhere");
    await put(root, "sub/a.png", "A");
    await put(root, "other/b.png", "B");
    await put(root, "plain/c.png", "C");
    const source = sourceOf(root, [path.join(root, "other")]);
    expect(await imagesOf(source, "SR-1.md", "![](sub/a.png) ![](other/b.png) ![](plain/c.png)")).toEqual([
      `plain/c.png: ${sha256Hex("C")}`,
    ]);
  });

  it("reuses what a memo holds, and reads every image of a long list", async () => {
    const root = await tempRoot();
    await put(root, "a.png", "first");
    const memo = imageMemo();
    const first = await embeddedImages(sourceOf(root), "SR-1.md", "![](a.png)", memo);
    await put(root, "a.png", "second");
    expect(await embeddedImages(sourceOf(root), "SR-1.md", "![](a.png) ![](./a.png)", memo)).toEqual(first);
    expect((await embeddedImages(sourceOf(root), "SR-1.md", "![](a.png)"))[0]?.sha256).toBe(
      sha256Hex("second"),
    );
    const many = Array.from({ length: 70 }, (_, i) => `![](i/${String(i)}.png)`).join(" ");
    await Promise.all(Array.from({ length: 70 }, (_, i) => put(root, `i/${String(i)}.png`, String(i))));
    const images = await embeddedImages(sourceOf(root), "SR-1.md", many);
    expect(images.map((i) => i.sha256)).toEqual(Array.from({ length: 70 }, (_, i) => sha256Hex(String(i))));
  });

  it("refuses with file.faulty when a folder cannot be listed for another reason than not being there", async () => {
    const root = await tempRoot();
    await put(root, "sub/a.png", "A");
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    vi.spyOn(fs, "readdir").mockRejectedValueOnce(denied);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const error = await embeddedImages(sourceOf(root), "SR-1.md", "![](sub/a.png)").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandError);
    expect(error).toMatchObject({ code: "file.faulty", details: { file: ".", reason: "EACCES" } });
  });

  it("gives every image as missing when the repository folder is not there or is a file", async () => {
    const root = await tempRoot();
    await put(root, "file", "F");
    for (const folder of [path.join(root, "gone"), path.join(root, "file")]) {
      expect(await imagesOf(sourceOf(folder), "SR-1.md", "![](a.png)")).toEqual(["a.png: missing"]);
    }
  });

  it("names the folder below the repository that cannot be listed", async () => {
    const root = await tempRoot();
    await put(root, "sub/a.png", "A");
    const readdir = fs.readdir.bind(fs);
    vi.spyOn(fs, "readdir").mockImplementation(((folder: string, options: never) =>
      folder.endsWith("sub")
        ? Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
        : readdir(folder, options)) as typeof fs.readdir);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    await expect(embeddedImages(sourceOf(root), "SR-1.md", "![](sub/a.png)")).rejects.toMatchObject({
      code: "file.faulty",
      details: { file: "sub", reason: "EACCES" },
    });
  });

  it("[SR-091/AK4] gives the images the published version test vectors list, missing ones included", async () => {
    // The folder of the vectors is their repository (schemas/examples/version/vectors.yaml).
    const dir = path.resolve(import.meta.dirname, "../../../../schemas/examples/version");
    const index = YAML.parse(await fs.readFile(path.join(dir, "vectors.yaml"), "utf8")) as {
      vectors: { element: string; files: string[]; missing: string[] }[];
    };
    expect(index.vectors.length).toBeGreaterThan(3);
    for (const vector of index.vectors) {
      const parsed = parseFileBytes(vector.element, await fs.readFile(path.join(dir, vector.element)));
      if (parsed.kind !== "parsed") {
        throw new Error(`${vector.element} does not parse`);
      }
      const images = await embeddedImages(sourceOf(dir), vector.element, parsed.content.body);
      const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : 1);
      const expected = [
        ...(await Promise.all(
          vector.files.map(async (f) => ({
            path: f,
            sha256: sha256Hex(await fs.readFile(path.join(dir, f))),
          })),
        )),
        ...vector.missing.map((f) => ({ path: f, sha256: null })),
      ];
      expect(images.map((i) => ({ path: i.path, sha256: i.sha256 })).sort(byPath)).toEqual(
        expected.sort(byPath),
      );
    }
  });
});

/** The need of fixtures/SR-021/targets, a target of the source element there. */
const NEED = {
  id: "0c8a3e5f-2d1b-4f6e-8a9c-7b3d5e1f2a4c",
  file: "needs/N-7b3d5e1f2a4c.md",
};
const needFile = (text: string): string =>
  `---\nid: ${NEED.id}\ntype: need\nstatus: draft\ntitle: Wind speed visible at a glance\n---\n\n${text}\n`;

const open = async (
  files: NonNullable<FixtureOptions["files"]>,
): Promise<{ fixture: FixtureWorkspace; workspace: Workspace }> => {
  const fixture = await createFixtureWorkspace({ fixture: "SR-021/targets", files });
  onTestFinished(() => fixture.cleanup());
  const workspace = new Workspace(fixture.path("system"));
  onTestFinished(() => workspace.close());
  return { fixture, workspace };
};

const storedVersion = async (workspace: Workspace): Promise<string> => {
  const context = {
    layout: await workspace.get(workspaceLayoutState),
    metamodel: await workspace.get(metamodelState),
    store: await workspace.get(elementStoreState),
  };
  return (await currentTarget(context, "system", { id: NEED.id })).version;
};

describe("lookUpImages and imagesUnchanged (a version kept across watcher batches, ADR-0008)", () => {
  const BODY = "![](a.png) ![](gone.png) ![](sub/b.png) ![](dir) ![](a\\b.png) ![](plain/c.png)";

  /** A repository with a file, a folder, a nested repository and a missing image. */
  const repository = async (): Promise<{ root: string; source: ImageSource }> => {
    const root = await tempRoot();
    await put(root, "a.png", "A");
    await put(root, "sub/.git", "gitdir: elsewhere");
    await put(root, "sub/b.png", "B");
    await fs.mkdir(path.join(root, "dir"));
    await put(root, "plain/c.png", "C");
    return { root, source: sourceOf(root) };
  };

  const seenOf = async (source: ImageSource): Promise<readonly ImageSeen[]> =>
    (await lookUpImages(source, imageLinks("SR-1.md", BODY))).seen;

  it("gives the images embeddedImages gives and what each lookup found, leaving out links missing on every OS", async () => {
    const { root, source } = await repository();
    const found = await lookUpImages(source, imageLinks("SR-1.md", BODY));
    expect(found.images).toEqual(await embeddedImages(source, "SR-1.md", BODY));
    const [a, c] = await Promise.all(["a.png", "plain/c.png"].map((f) => fs.lstat(path.join(root, f))));
    expect(found.seen).toEqual([
      { names: ["a.png"], found: { size: 1, mtimeMs: a?.mtimeMs } },
      { names: ["gone.png"], found: null },
      { names: ["sub", "b.png"], found: "nested" },
      { names: ["dir"], found: null },
      { names: ["plain", "c.png"], found: { size: 1, mtimeMs: c?.mtimeMs } },
    ]);
  });

  it("finds every image as it was when nothing changed", async () => {
    const { source } = await repository();
    expect(await imagesUnchanged(source, await seenOf(source), imageMemo())).toBe(true);
    expect(await imagesUnchanged(source, [], imageMemo())).toBe(true);
  });

  const changes: readonly (readonly [string, (root: string) => Promise<void>])[] = [
    ["a file with another size", (root) => put(root, "a.png", "AA")],
    [
      "a file with another modification time",
      (root) => fs.utimes(path.join(root, "a.png"), new Date(2020, 0, 1), new Date(2020, 0, 1)),
    ],
    ["a file deleted", (root) => fs.rm(path.join(root, "a.png"))],
    [
      "a file renamed to another case",
      (root) => fs.rename(path.join(root, "a.png"), path.join(root, "A.png")),
    ],
    ["a missing image created", (root) => put(root, "gone.png", "G")],
    [
      "a folder replaced by a file",
      (root) => fs.rm(path.join(root, "dir"), { recursive: true }).then(() => put(root, "dir", "D")),
    ],
    ["a nested repository that is one no longer", (root) => fs.rm(path.join(root, "sub", ".git"))],
    ["a `.git` entry above a counted image", (root) => put(root, "plain/.git", "gitdir: elsewhere")],
  ];

  it.each(changes)("sees %s", async (_, change) => {
    const { root, source } = await repository();
    const seen = await seenOf(source);
    await change(root);
    expect(await imagesUnchanged(source, seen, imageMemo())).toBe(false);
  });

  it("refuses with file.faulty when a folder cannot be listed", async () => {
    const { source } = await repository();
    const seen = await seenOf(source);
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    vi.spyOn(fs, "readdir").mockRejectedValueOnce(denied);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    await expect(imagesUnchanged(source, seen, imageMemo())).rejects.toMatchObject({ code: "file.faulty" });
  });
});

describe("the version counts embedded images (SR-091 AK4, ADR-0005)", () => {
  const text = "The wind speed can be read from three metres.\n\n![Layout](N-7b3d5e1f2a4c/layout.png)";

  it("[SR-091/AK4] the version stored for a target changes when an image it embeds changes, appears or goes", async () => {
    const { fixture, workspace } = await open({
      [`system/${NEED.file}`]: needFile(text),
      "system/needs/N-7b3d5e1f2a4c/layout.png": "first",
    });
    const first = await storedVersion(workspace);
    expect(first).toBe(
      computeVersion({
        text: `\n${text}\n`,
        properties: {},
        definitions: [],
        files: [{ path: "N-7b3d5e1f2a4c/layout.png", sha256: sha256Hex("first") }],
      }),
    );
    await fixture.write("system/needs/N-7b3d5e1f2a4c/layout.png", "second");
    const second = await storedVersion(workspace);
    expect(second).not.toBe(first);
    await fs.rm(fixture.path("system/needs/N-7b3d5e1f2a4c/layout.png"));
    const missing = await storedVersion(workspace);
    expect(missing).not.toBe(second);
    expect(missing).not.toBe(first);
    await fixture.write("system/needs/N-7b3d5e1f2a4c/layout.png", "first");
    expect(await storedVersion(workspace)).toBe(first);
  });

  it("[SR-091/AK4] the version of a written element counts its images and equals the one stored for it", async () => {
    const { fixture, workspace } = await open({ "system/needs/N-7b3d5e1f2a4c/layout.png": "first" });
    const update = async (): Promise<string> =>
      (
        (await invoke(
          "element.update",
          { ref: NEED.id, text },
          { workspace },
        )) as CommandOutput<"element.update">
      ).element.version;
    const shown = await update();
    expect(shown).toBe(await storedVersion(workspace));
    await fixture.write("system/needs/N-7b3d5e1f2a4c/layout.png", "second");
    expect(await update()).not.toBe(shown);
  });

  it("[SR-091/AK4] a plain link, an absolute URL or an ignored path to a changed file does not change the version", async () => {
    const plain = [
      "See [the layout](N-7b3d5e1f2a4c/layout.png) and ![remote](https://example.org/layout.png).",
      "![Git](../.git/config) ![Self](N-7b3d5e1f2a4c.md)",
    ].join(" ");
    const { fixture, workspace } = await open({
      [`system/${NEED.file}`]: needFile(plain),
      "system/needs/N-7b3d5e1f2a4c/layout.png": "first",
    });
    const before = await storedVersion(workspace);
    expect(before).toBe(computeVersion({ text: `\n${plain}\n`, properties: {}, definitions: [], files: [] }));
    await fixture.write("system/needs/N-7b3d5e1f2a4c/layout.png", "second");
    expect(await storedVersion(workspace)).toBe(before);
  });
});
