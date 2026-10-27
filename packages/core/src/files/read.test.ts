import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { Problem } from "../catalog.js";
import { Alias, Document, parseDocument } from "yaml";
import { findUnresolvedAlias } from "./parse.js";
import {
  linkText,
  readElementBodySync,
  readElementFile,
  readElementFileSync,
  readElementFiles,
  readFileSha256,
  readFileSnapshot,
  readFileStat,
  readYamlFile,
} from "./read.js";
import type { FileReadResult, YamlReadResult } from "./read.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-files-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const put = async (rel: string, content: string | Uint8Array): Promise<void> => {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), content);
};

const problemOf = (r: FileReadResult): Problem => {
  if (r.kind !== "problem") {
    throw new Error(`expected a problem, got ${r.kind}`);
  }
  return r.problem;
};

const good = (title: string): string =>
  `---\nid: ${title}\ntype: system-requirement\ntitle: ${title}\n---\nText of ${title}\n`;

describe("readElementFile", () => {
  it("returns the parsed frontmatter, the kept YAML document and the body", async () => {
    await put("req/a.md", "---\n# comment\nid: a\ntags: [x, y]\n---\n# Heading\n\nText\n");
    const r = await readElementFile(root, "req/a.md");
    expect(r.kind).toBe("parsed");
    if (r.kind !== "parsed") {
      return;
    }
    expect(r.file.path).toBe("req/a.md");
    expect(r.file.data).toEqual({ id: "a", tags: ["x", "y"] });
    expect(r.file.body).toBe("# Heading\n\nText\n");
    expect(r.file.eol).toBe("\n");
    expect(r.file.bom).toBe(false);
    expect(r.file.document.get("id")).toBe("a");
    expect(r.file.document.toString()).toContain("# comment");
    expect(r.file.snapshot.size).toBe(
      Buffer.byteLength("---\n# comment\nid: a\ntags: [x, y]\n---\n# Heading\n\nText\n"),
    );
    expect(r.file.snapshot.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r.file.snapshot.path).toBe("req/a.md");
    expect(Object.isFrozen(r.file.snapshot)).toBe(true);
    expect(r.file.frontmatter).toBe("# comment\nid: a\ntags: [x, y]\n");
    expect(r.file.warnings).toEqual([]);
  });

  it("strips a byte order mark and remembers it", async () => {
    await put("a.md", `\uFEFF${good("a")}`);
    const r = await readElementFile(root, "a.md");
    expect(r.kind === "parsed" && r.file.bom).toBe(true);
  });

  it("keeps CRLF line endings", async () => {
    await put("a.md", "---\r\nid: a\r\n---\r\nText\r\n");
    const r = await readElementFile(root, "a.md");
    expect(r.kind === "parsed" && r.file.eol).toBe("\r\n");
  });

  it("ignores Markdown files without frontmatter", async () => {
    await put("README.md", "# Readme\n");
    expect(await readElementFile(root, "README.md")).toEqual({ kind: "no-frontmatter", path: "README.md" });
  });

  it("returns null data for empty frontmatter", async () => {
    await put("a.md", "---\n---\nText\n");
    const r = await readElementFile(root, "a.md");
    expect(r.kind === "parsed" && r.file.data).toBeNull();
  });

  it("reports a missing file as unreadable", async () => {
    const p = problemOf(await readElementFile(root, "missing.md"));
    expect(p).toMatchObject({ code: "file.unreadable", severity: "error", file: "missing.md" });
    expect(p.message).toBe("Cannot read file: ENOENT");
    expect(p.message).not.toContain(root);
  });

  it("reports a directory as unreadable", async () => {
    await fs.mkdir(path.join(root, "dir.md"));
    expect(problemOf(await readElementFile(root, "dir.md"))).toMatchObject({ code: "file.unreadable" });
  });

  it("reports invalid UTF-8 as unreadable", async () => {
    await put("a.md", new Uint8Array([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe, 0x0a]));
    const p = problemOf(await readElementFile(root, "a.md"));
    expect(p).toMatchObject({ code: "file.unreadable", file: "a.md" });
    expect(p.message).toContain("UTF-8");
  });

  it("refuses paths outside the root", async () => {
    await expect(readElementFile(root, "../x.md")).rejects.toMatchObject({ code: "input.invalid" });
    await expect(readElementFile(root, path.join(root, "a.md"))).rejects.toMatchObject({
      code: "input.invalid",
    });
  });

  it("reports excessive aliases as invalid YAML at the frontmatter line", async () => {
    const lines = ["a: &a [x, x, x, x, x, x, x, x, x, x]"];
    for (let i = 0; i < 6; i++) {
      lines.push(
        `${String.fromCharCode(98 + i)}: &${String.fromCharCode(98 + i)} [${Array(10)
          .fill(`*${String.fromCharCode(97 + i)}`)
          .join(", ")}]`,
      );
    }
    await put("a.md", `---\n${lines.join("\n")}\n---\n`);
    const p = problemOf(await readElementFile(root, "a.md"));
    expect(p).toMatchObject({ code: "file.invalid-yaml", file: "a.md", line: 2 });
  });
});

describe("SR-008 AK1: faulty YAML frontmatter is reported with file, line and reason", () => {
  it("[SR-008/AK1] reports bad indentation with the line in the file", async () => {
    await put("req/bad.md", "---\nid: a\ntags: [x, y\ntitle: t\n---\nText\n");
    const p = problemOf(await readElementFile(root, "req/bad.md"));
    expect(p.code).toBe("file.invalid-yaml");
    expect(p.severity).toBe("error");
    expect(p.file).toBe("req/bad.md");
    expect(p.line).toBe(4);
    expect(p.message).toMatch(/line 4, column 1/);
    expect(p.message).toMatch(/indented/);
  });

  it("[SR-008/AK1] reports a duplicate key", async () => {
    await put("a.md", "---\nid: a\ntype: x\nid: b\n---\n");
    const p = problemOf(await readElementFile(root, "a.md"));
    expect(p).toMatchObject({ code: "file.invalid-yaml", file: "a.md", line: 4 });
    expect(p.message).toMatch(/unique/);
  });

  it("[SR-008/AK1] reports a missing closing quote", async () => {
    await put("a.md", '---\nid: a\ntitle: "open\n---\nText\n');
    const p = problemOf(await readElementFile(root, "a.md"));
    expect(p).toMatchObject({ code: "file.invalid-yaml", file: "a.md", line: 3 });
    expect(p.message).toMatch(/quote/);
  });

  it("[SR-008/AK1] reports an unresolved alias at its line", async () => {
    await put("a.md", "---\nid: a\ntitle: *missing\n---\n");
    const p = problemOf(await readElementFile(root, "a.md"));
    expect(p).toMatchObject({ code: "file.invalid-yaml", file: "a.md", line: 3 });
    expect(p.message).toMatch(/alias/i);
  });

  it("[SR-008/AK1] reports a frontmatter without closing line at line 1", async () => {
    await put("a.md", "---\nid: a\ntype: x\n\nText\n");
    const p = problemOf(await readElementFile(root, "a.md"));
    expect(p).toMatchObject({ code: "file.invalid-yaml", file: "a.md", line: 1 });
    expect(p.message).toMatch(/closing ---/);
  });

  it("[SR-008/AK1] counts lines correctly in CRLF files and after a byte order mark", async () => {
    await put("a.md", "\uFEFF---\r\nid: a\r\nid: b\r\n---\r\n");
    expect(problemOf(await readElementFile(root, "a.md"))).toMatchObject({
      code: "file.invalid-yaml",
      line: 3,
    });
  });
});

describe("SR-008 AK2: files with Git conflict markers are reported as unresolved conflicts", () => {
  const conflicted =
    "---\nid: a\n<<<<<<< HEAD\ntitle: ours\n=======\ntitle: theirs\n>>>>>>> feature\n---\nText\n";

  it("[SR-008/AK2] reports conflict markers in the frontmatter", async () => {
    await put("req/c.md", conflicted);
    const p = problemOf(await readElementFile(root, "req/c.md"));
    expect(p.code).toBe("file.conflict-markers");
    expect(p.severity).toBe("error");
    expect(p.file).toBe("req/c.md");
    expect(p.line).toBe(3);
    expect(p.message).toMatch(/unresolved Git merge conflict/);
  });

  it("[SR-008/AK2] reports conflict markers in the text even when the YAML is valid", async () => {
    await put("a.md", "---\nid: a\n---\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> 1a2b3c\n");
    expect(problemOf(await readElementFile(root, "a.md"))).toMatchObject({
      code: "file.conflict-markers",
      line: 4,
    });
  });

  it("[SR-008/AK2] reports conflicts instead of YAML errors and in files without frontmatter", async () => {
    await put("a.md", "<<<<<<< HEAD\n---\nid: a\n=======\n>>>>>>> x\n");
    expect(problemOf(await readElementFile(root, "a.md"))).toMatchObject({
      code: "file.conflict-markers",
      line: 1,
    });
  });

  it("[SR-008/AK2] does not treat a setext heading underline as a conflict", async () => {
    await put("a.md", "---\nid: a\n---\nHeading\n=======\n\n>>>>>>> deep quote\n");
    expect((await readElementFile(root, "a.md")).kind).toBe("parsed");
  });
});

describe("SR-008 AK3: other elements keep working, the faulty file is never written", () => {
  it("[SR-008/AK3] reads all good files normally when some files are faulty", async () => {
    await put("a.md", good("a"));
    await put("b.md", "---\nid: b\n  type: [\n---\n");
    await put("c.md", good("c"));
    await put("d.md", "---\nid: d\n<<<<<<< HEAD\ntitle: x\n=======\ntitle: y\n>>>>>>> b\n---\n");
    await put("e.md", "# not an element\n");
    await put("f.md", good("f"));
    const r = await readElementFiles(root, ["a.md", "b.md", "c.md", "d.md", "e.md", "missing.md", "f.md"], {
      concurrency: 2,
    });
    expect(r.files.map((f) => f.path)).toEqual(["a.md", "c.md", "f.md"]);
    expect(r.files.map((f) => f.data)).toEqual([
      { id: "a", type: "system-requirement", title: "a" },
      { id: "c", type: "system-requirement", title: "c" },
      { id: "f", type: "system-requirement", title: "f" },
    ]);
    expect(r.files[1]?.body).toBe("Text of c\n");
    expect(r.ignored).toEqual(["e.md"]);
    expect(r.problems.map((p) => [p.file, p.code])).toEqual([
      ["b.md", "file.invalid-yaml"],
      ["d.md", "file.conflict-markers"],
      ["missing.md", "file.unreadable"],
    ]);
  });

  it("[SR-008/AK3] reading never changes a faulty file", async () => {
    const content = "---\nid: a\n  bad: [\n---\n";
    await put("a.md", content);
    const before = await fs.stat(path.join(root, "a.md"));
    await readElementFiles(root, ["a.md"]);
    const after = await fs.stat(path.join(root, "a.md"));
    expect(await fs.readFile(path.join(root, "a.md"), "utf8")).toBe(content);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await fs.readdir(root)).toEqual(["a.md"]);
  });

  it("[SR-008/AK3] a faulty file yields no snapshot to write with", async () => {
    await put("a.md", "---\nid: a\nid: b\n---\n");
    const r = await readElementFile(root, "a.md");
    expect(r.kind).toBe("problem");
    expect(Object.keys(r)).toEqual(["kind", "problem"]);
  });

  it("handles an empty list and the default concurrency", async () => {
    expect(await readElementFiles(root, [])).toEqual({ files: [], ignored: [], problems: [] });
    await put("a.md", good("a"));
    expect((await readElementFiles(root, ["a.md"])).files).toHaveLength(1);
  });

  it("rejects a concurrency below 1", async () => {
    await expect(readElementFiles(root, ["a.md"], { concurrency: 0 })).rejects.toMatchObject({
      code: "input.invalid",
    });
  });
});

describe("findUnresolvedAlias", () => {
  it("finds an alias created in code without a source position", () => {
    const doc = new Document({ a: 1 });
    doc.set("b", new Alias("missing"));
    expect(findUnresolvedAlias(doc)).toEqual({ offset: 0, source: "missing" });
  });

  it("returns undefined when every alias resolves", () => {
    const doc = parseDocument("a: &x 1\nb: *x\n");
    expect(findUnresolvedAlias(doc)).toBeUndefined();
  });
});

describe("YAML warnings, links and aborting", () => {
  it("reports YAML warnings with severity warning and still parses the file", async () => {
    await put("a.md", "---\nid: a\ntitle: !custom x\n---\n");
    const r = await readElementFile(root, "a.md");
    expect(r.kind).toBe("parsed");
    const warnings = r.kind === "parsed" ? r.file.warnings : [];
    expect(warnings).toEqual([
      expect.objectContaining({ code: "file.yaml-warning", severity: "warning", file: "a.md", line: 3 }),
    ]);
    const all = await readElementFiles(root, ["a.md"]);
    expect(all.files).toHaveLength(1);
    expect(all.problems.map((p) => p.code)).toEqual(["file.yaml-warning"]);
  });

  it("does not follow a symbolic link to a file", async () => {
    await put("target.md", good("t"));
    await fs.symlink(path.join(root, "target.md"), path.join(root, "link.md"), "file");
    const p = problemOf(await readElementFile(root, "link.md"));
    expect(p).toMatchObject({ code: "file.unreadable", file: "link.md" });
    expect(p.message).toMatch(/symbolic link/);
  });

  it("does not read through a folder linked outside the root", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-outside-"));
    try {
      await fs.writeFile(path.join(outside, "a.md"), good("a"));
      await fs.symlink(outside, path.join(root, "linked"), "junction");
      const p = problemOf(await readElementFile(root, "linked/a.md"));
      expect(p).toMatchObject({ code: "file.unreadable", file: "linked/a.md" });
      expect(p.message).toMatch(/outside the workspace/);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("reads through a folder linked inside the root", async () => {
    await put("real/a.md", good("a"));
    await fs.symlink(path.join(root, "real"), path.join(root, "alias"), "junction");
    expect((await readElementFile(root, "alias/a.md")).kind).toBe("parsed");
  });

  it("stops when the signal is aborted", async () => {
    await put("a.md", good("a"));
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(readElementFiles(root, ["a.md"], { signal: controller.signal })).rejects.toThrow("stop");
    const running = new AbortController();
    expect((await readElementFiles(root, ["a.md"], { signal: running.signal })).files).toHaveLength(1);
  });
});

describe("canonical paths", () => {
  it("normalises the path in results and reads the same file once", async () => {
    await put("d/a.md", good("a"));
    const r = await readElementFile(root, "./d/../d/a.md");
    expect(r.kind === "parsed" && [r.file.path, r.file.snapshot.path]).toEqual(["d/a.md", "d/a.md"]);
    expect(problemOf(await readElementFile(root, "./d/../d/missing.md")).file).toBe("d/missing.md");
    const all = await readElementFiles(root, ["d/a.md", "./d/../d/a.md", "d//a.md"]);
    expect(all.files.map((f) => f.path)).toEqual(["d/a.md"]);
  });

  it("does not echo an absolute path in the error", async () => {
    const error = await readElementFile(root, path.join(root, "a.md")).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "input.invalid" });
    expect((error as Error).message).not.toContain(root);
  });
});

const yamlProblem = (r: YamlReadResult): Problem => {
  if (r.kind !== "problem") {
    throw new Error("expected a problem");
  }
  return r.problem;
};

describe("readYamlFile", () => {
  it("returns document, data and snapshot of a YAML file", async () => {
    await put("logreq-workspace.yaml", "# workspace\nname: demo\nrepositories: [a, b]\n");
    const r = await readYamlFile(root, "logreq-workspace.yaml");
    expect(r.kind).toBe("parsed");
    if (r.kind !== "parsed") {
      return;
    }
    expect(r.file.path).toBe("logreq-workspace.yaml");
    expect(r.file.data).toEqual({ name: "demo", repositories: ["a", "b"] });
    expect(r.file.document.get("name")).toBe("demo");
    expect(r.file.bom).toBe(false);
    expect(r.file.warnings).toEqual([]);
    expect(r.file.snapshot.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns null data for an empty file", async () => {
    await put("e.yaml", "");
    const r = await readYamlFile(root, "e.yaml");
    expect(r.kind === "parsed" && r.file.data).toBeNull();
  });

  it("reports invalid YAML with the line in the file", async () => {
    await put("m.yaml", "types:\n  - a\n bad: [\n");
    const p = yamlProblem(await readYamlFile(root, "m.yaml"));
    expect(p).toMatchObject({ code: "file.invalid-yaml", file: "m.yaml" });
    expect(p.message).toMatch(/^Invalid YAML at line/);
  });

  it("reports an error at the end of a file without final newline on its last line", async () => {
    await put("m.yaml", 'a: 1\nb: "open');
    expect(yamlProblem(await readYamlFile(root, "m.yaml"))).toMatchObject({
      code: "file.invalid-yaml",
      line: 2,
    });
  });

  it("reports conflict markers and unreadable files", async () => {
    await put("c.yaml", "a: 1\n<<<<<<< HEAD\nb: 1\n=======\nb: 2\n>>>>>>> x\n");
    expect(yamlProblem(await readYamlFile(root, "c.yaml"))).toMatchObject({
      code: "file.conflict-markers",
      line: 2,
    });
    expect(yamlProblem(await readYamlFile(root, "missing.yaml"))).toMatchObject({ code: "file.unreadable" });
  });
});

describe("readFileSnapshot (a file LogReq rewrites as a whole, SR-029)", () => {
  it("gives the bytes as read and their snapshot", async () => {
    await put("ci/results.xml", "\uFEFF<testsuites/>\r\n");
    const r = await readFileSnapshot(path.join(root, "ci"), "results.xml");
    if (r.kind !== "read") {
      throw new Error("expected read");
    }
    expect(Buffer.from(r.bytes).toString("utf8")).toBe("\uFEFF<testsuites/>\r\n");
    expect(r.snapshot).toMatchObject({
      path: "results.xml",
      size: r.bytes.byteLength,
      sha256: createHash("sha256").update(r.bytes).digest("hex"),
    });
  });

  it("tells a missing file from a link and from a folder", async () => {
    await put("ci/results.xml", "<testsuites/>");
    await fs.symlink(path.join(root, "ci", "results.xml"), path.join(root, "ci", "link.xml"));
    expect(await readFileSnapshot(root, "ci/gone.xml")).toMatchObject({
      kind: "problem",
      missing: true,
      problem: { code: "file.unreadable", file: "ci/gone.xml" },
    });
    expect(await readFileSnapshot(root, "ci/results.xml/below.xml")).toMatchObject({ missing: true });
    expect(await readFileSnapshot(root, "ci/link.xml")).toMatchObject({
      kind: "problem",
      missing: false,
      problem: { message: expect.stringContaining("symbolic link") as string },
    });
    expect(await readFileSnapshot(root, "ci")).toMatchObject({
      kind: "problem",
      missing: false,
      problem: { message: expect.stringContaining("not a regular file") as string },
    });
  });
});

describe("readElementFileSync (worker threads of a cold load, ADR-0008)", () => {
  it("gives what readElementFile gives for every kind of file", async () => {
    await put("req/a.md", "---\n# comment\nid: a\ntags: [x, y]\n---\n# Heading\n\nText\n");
    await put("bom.md", `\uFEFF${good("bom")}`);
    await put("crlf.md", good("crlf").replaceAll("\n", "\r\n"));
    await put("plain.md", "# Just Markdown\n");
    await put("bad.md", "---\nid: a\n  title: x\n---\n");
    await put("conflict.md", "---\nid: a\n<<<<<<< HEAD\nx: 1\n=======\nx: 2\n>>>>>>> b\n---\n");
    await put("warning.md", "---\nid: a\nx: !unknown 1\n---\n");
    await put("latin1.md", new Uint8Array([0x2d, 0x2d, 0x2d, 0x0a, 0xe4, 0x0a, 0x2d, 0x2d, 0x2d, 0x0a]));
    await fs.mkdir(path.join(root, "folder.md"));
    await fs.symlink(path.join(root, "req/a.md"), path.join(root, "link.md"), "file");
    await put("real/b.md", good("b"));
    await fs.symlink(path.join(root, "real"), path.join(root, "alias"), "junction");
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "logreq-outside-"));
    try {
      await fs.writeFile(path.join(outside, "c.md"), good("c"));
      await fs.symlink(outside, path.join(root, "linked"), "junction");
      const files = [
        "req/a.md",
        "./req/../req/a.md",
        "bom.md",
        "crlf.md",
        "plain.md",
        "bad.md",
        "conflict.md",
        "warning.md",
        "latin1.md",
        "folder.md",
        "link.md",
        "alias/b.md",
        "linked/c.md",
        "missing.md",
      ];
      // A YAML `Document` holds state of its parse; its text and data stand for it.
      const comparable = (r: FileReadResult): unknown =>
        r.kind === "parsed" ? { ...r, file: { ...r.file, document: r.file.document.toString() } } : r;
      for (const file of files) {
        expect(comparable(readElementFileSync(root, file)), file).toEqual(
          comparable(await readElementFile(root, file)),
        );
      }
      expect(problemOf(readElementFileSync(root, "linked/c.md")).message).toMatch(/outside the workspace/);
      expect(problemOf(readElementFileSync(root, "missing.md")).message).toMatch(/ENOENT/);
      const parsed = readElementFileSync(root, "req/a.md");
      expect(parsed.kind === "parsed" && Object.isFrozen(parsed.file.snapshot)).toBe(true);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses paths outside the root like readElementFile", () => {
    expect(() => readElementFileSync(root, "../x.md")).toThrow(/not inside the workspace/);
  });
});

describe("readFileSha256", () => {
  it("gives the SHA-256 of a regular file as lower-case hex, with size and mtime", async () => {
    await put("img/a.png", new Uint8Array([1, 2, 3]));
    const stat = await fs.lstat(path.join(root, "img", "a.png"));
    expect(await readFileSha256(root, "img/a.png")).toEqual({
      sha256: "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
      size: 3,
      mtimeMs: stat.mtimeMs,
    });
  });

  it("hashes a large file as a stream", async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024).map((_, i) => i % 251);
    await put("big.png", bytes);
    expect((await readFileSha256(root, "big.png"))?.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
  });

  it("hashes a symbolic link as its link text, without following it", async () => {
    await put("a.png", "A");
    await fs.symlink("a.png", path.join(root, "link.png"), "file");
    await fs.symlink("gone.png", path.join(root, "dangling.png"), "file");
    const hash = createHash("sha256").update("a.png").digest("hex");
    expect((await readFileSha256(root, "link.png"))?.sha256).toBe(hash);
    expect(await readFileSha256(root, "dangling.png")).toMatchObject({ size: "gone.png".length });
  });

  it("reads a link text with `/` as separator, also on Windows, where it holds `\\`", () => {
    const windows = Buffer.from("img\\a b\\é.png", "utf8");
    expect(linkText(windows, "win32").toString("utf8")).toBe("img/a b/é.png");
    expect(linkText(windows, "linux")).toBe(windows);
    expect(linkText(Buffer.from("a/b.png"))).toEqual(Buffer.from("a/b.png"));
  });

  it("gives null for a missing file, a name below a file and a folder", async () => {
    await put("img/a.png", "A");
    expect(await readFileSha256(root, "img/gone.png")).toBeNull();
    expect(await readFileSha256(root, "img/a.png/x.png")).toBeNull();
    expect(await readFileSha256(root, "img")).toBeNull();
  });

  it("refuses a path outside the root, and other read errors with file.faulty", async () => {
    await expect(readFileSha256(root, "../outside.png")).rejects.toMatchObject({ code: "input.invalid" });
    await put("a.png", "A");
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    vi.spyOn(fs, "lstat").mockRejectedValueOnce(denied);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    await expect(readFileSha256(root, "a.png")).rejects.toMatchObject({
      code: "file.faulty",
      details: { file: "a.png", reason: "EACCES" },
    });
  });
});

describe("readFileStat (checking an image kept with a version, ADR-0008)", () => {
  it("gives the size and mtime readFileSha256 gives, without hashing", async () => {
    await put("img/a.png", new Uint8Array([1, 2, 3]));
    await fs.symlink("a.png", path.join(root, "img", "link.png"), "file");
    for (const file of ["img/a.png", "img/link.png"]) {
      const hashed = await readFileSha256(root, file);
      expect(await readFileStat(root, file)).toEqual({ size: hashed?.size, mtimeMs: hashed?.mtimeMs });
    }
  });

  it("gives null for a missing file, a name below a file and a folder", async () => {
    await put("img/a.png", "A");
    expect(await readFileStat(root, "img/gone.png")).toBeNull();
    expect(await readFileStat(root, "img/a.png/x.png")).toBeNull();
    expect(await readFileStat(root, "img")).toBeNull();
  });

  it("refuses other errors with file.faulty", async () => {
    await put("a.png", "A");
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    vi.spyOn(fs, "lstat").mockRejectedValueOnce(denied);
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    await expect(readFileStat(root, "a.png")).rejects.toMatchObject({
      code: "file.faulty",
      details: { file: "a.png", reason: "EACCES" },
    });
  });
});

describe("readElementBodySync (the text of a file read again, ADR-0008)", () => {
  const ELEMENT = "﻿---\r\nid: x\r\n---\r\n\r\nText ![](a.png)\r\n";
  const hashOf = (bytes: string | Uint8Array): { sha256: string } => ({
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });

  it("takes the text after the frontmatter of the bytes the snapshot has, as readElementFile does", async () => {
    await put("a.md", ELEMENT);
    const read = await readElementFile(root, "a.md");
    if (read.kind !== "parsed") {
      throw new Error("expected a parsed file");
    }
    expect(readElementBodySync(root, "a.md", read.file.snapshot)).toEqual({
      kind: "same",
      body: read.file.body,
    });
  });

  it("reads a file whose bytes changed, or that is gone, as readElementFileSync does", async () => {
    await put("a.md", ELEMENT);
    const before = hashOf(ELEMENT);
    await put("a.md", "---\nid: y\n---\nNew.\n");
    expect(readElementBodySync(root, "a.md", before)).toMatchObject({
      kind: "changed",
      read: { kind: "parsed", file: { body: "New.\n" } },
    });
    await fs.rm(path.join(root, "a.md"));
    expect(readElementBodySync(root, "a.md", before)).toEqual({
      kind: "changed",
      read: readElementFileSync(root, "a.md"),
    });
  });

  it("reads bytes with the snapshot's hash that give no text after a frontmatter as readElementFileSync does", async () => {
    const invalid = Uint8Array.of(0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0x0a, 0x2d, 0x2d, 0x2d, 0x0a);
    for (const bytes of ["No frontmatter.\n", "---\nid: x\nno closing line\n", "<<<<<<< HEAD\n", invalid]) {
      await put("a.md", bytes);
      expect(readElementBodySync(root, "a.md", hashOf(bytes))).toEqual({
        kind: "changed",
        read: readElementFileSync(root, "a.md"),
      });
    }
  });
});
