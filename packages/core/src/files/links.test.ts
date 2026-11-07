import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_LINKS, linksStayInside } from "./links.js";

let root: string;
let outside: string;

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-links-")));
  outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-away-")));
  await fs.mkdir(path.join(root, "a", "b"), { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

const abs = (rel: string): string => path.join(root, ...rel.split("/"));
const stays = (absolute: string): Promise<boolean> => linksStayInside(root, absolute);
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

describe("linksStayInside", () => {
  it("accepts a path without links, and one that ends before a name that is not there", async () => {
    expect(await stays(abs("a/b"))).toBe(true);
    expect(await stays(abs("a/b/missing/x.md"))).toBe(true);
    await fs.writeFile(abs("a/file"), "x");
    expect(await stays(abs("a/file/below"))).toBe(true);
  });

  it("follows links that stay inside, relative or absolute, and judges the rest from their target", async () => {
    await fs.symlink(path.join("..", "a", "b"), abs("a/up"), "junction");
    await fs.symlink(abs("a/b"), abs("abs"), "junction");
    await fs.symlink("b", abs("a/rel"), "dir");
    expect(await stays(abs("a/up/x.md"))).toBe(true);
    expect(await stays(abs("abs/x.md"))).toBe(true);
    expect(await stays(abs("a/rel/x.md"))).toBe(true);
  });

  it("takes `..` in a link text from the real folder, as the file system does", async () => {
    // `m -> l/..` is `a`, not the root: `l` is `a/b`. So `m/z` is `a/z`, which leads out.
    await fs.symlink(path.join("a", "b"), abs("l"), "dir");
    await fs.symlink(["l", ".."].join(path.sep), abs("m"), "dir");
    await fs.symlink(outside, abs("a/z"), "junction");
    expect(await stays(abs("m/z/x"))).toBe(false);
    expect(await stays(abs("m/b/x"))).toBe(true);
  });

  it("refuses a link that leaves the root before anything follows it (#294)", async () => {
    await fs.symlink(outside, abs("a/away"), "junction");
    await fs.symlink(path.join("..", "..", "..", path.basename(outside)), abs("a/b/up"), "dir");
    await fs.symlink(path.join(outside, "x.png"), abs("img.png"), "file");
    const lstat = vi.spyOn(fs, "lstat");
    const realpath = vi.spyOn(fs, "realpath");
    expect(await stays(abs("a/away/deep/x.md"))).toBe(false);
    expect(await stays(abs("a/b/up/x.md"))).toBe(false);
    expect(await stays(abs("img.png"))).toBe(false);
    const asked = [...lstat.mock.calls, ...realpath.mock.calls].map(([p]) => String(p));
    // Neither the target nor a path spelled through the links (which would follow them).
    const below = [outside, abs("a/away"), abs("a/b/up")].map((p) => p + path.sep);
    expect(asked.filter((p) => below.some((b) => p.startsWith(b)))).toEqual([]);
  });

  it("refuses `..` above the root and more links than MAX_LINKS", async () => {
    await fs.symlink(path.join("..", ".."), abs("a/parent"), "dir");
    expect(await stays(abs("a/parent/x"))).toBe(false);
    await fs.symlink(Array.from({ length: 64 }, () => "..").join(path.sep), abs("a/top"), "dir");
    expect(await stays(abs("a/top/x"))).toBe(false);
    // A link whose text ends in `..` above the root, as the folder of a file read or written.
    await fs.symlink("..", abs("up"), "dir");
    await fs.symlink("..", abs("a/b/back"), "dir");
    expect(await stays(abs("up"))).toBe(false);
    expect(await stays(abs("a/b/back"))).toBe(true);
    for (let i = 0; i <= MAX_LINKS; i++) {
      await fs.symlink(`l${String(i + 1)}`, abs(`l${String(i)}`), "dir");
    }
    await fs.mkdir(abs(`l${String(MAX_LINKS + 1)}`));
    expect(await stays(abs("l1/x"))).toBe(true);
    expect(await stays(abs("l0/x"))).toBe(false);
  });

  it("lets a link lead into a further folder, and nowhere else", async () => {
    await fs.symlink(path.join("..", "..", path.basename(outside)), abs("a/sibling"), "dir");
    await fs.symlink(path.join(outside, "x"), abs("a/abs-sibling"), "junction");
    await fs.symlink(path.join("..", "..", path.basename(outside), "..", "else"), abs("a/through"), "dir");
    for (const p of ["a/sibling/x", "a/abs-sibling/y"]) {
      expect(await linksStayInside(root, abs(p), { alsoInside: [outside] }), p).toBe(true);
      expect(await stays(abs(p)), p).toBe(false);
    }
    expect(await linksStayInside(root, abs("a/through/x"), { alsoInside: [outside] })).toBe(false);
  });

  it("judges an absolute link text that names the root by its real path", async () => {
    const given = path.join(outside, "given");
    await fs.symlink(root, given, "junction");
    await fs.symlink(abs("a/b"), abs("a/real"), "junction");
    expect(await linksStayInside(given, path.join(given, "a", "real", "x"))).toBe(true);
  });

  it("refuses Windows link texts that name a share or another drive", async () => {
    const at = abs("a/win");
    await fs.symlink("placeholder", at, "dir");
    const texts = [
      "\\\\host\\share\\x",
      "//host/share",
      "\\\\?\\UNC\\host\\share",
      "\\\\.\\pipe\\x",
      "\\x",
      "Z:x",
      "b\\file.png:stream",
      "b\\nul",
      "b.\\x",
      "Z:\\elsewhere",
      "\\\\?\\Z:\\elsewhere",
    ];
    for (const text of texts) {
      vi.spyOn(fs, "readlink").mockResolvedValueOnce(text);
      expect(await linksStayInside(root, path.join(at, "x"), { platform: "win32" }), text).toBe(false);
    }
    vi.spyOn(fs, "readlink").mockResolvedValueOnce("..\\b");
    expect(await linksStayInside(root, path.join(at, "x"), { platform: "win32" })).toBe(true);
  });

  it("rejects on errors other than 'not there'", async () => {
    vi.spyOn(fs, "lstat").mockRejectedValueOnce(errno("EACCES"));
    await expect(linksStayInside(root, abs("a"))).rejects.toMatchObject({ code: "EACCES" });
  });
});
