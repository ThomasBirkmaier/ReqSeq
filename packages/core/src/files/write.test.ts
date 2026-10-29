import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedFile } from "./read.js";
import { readElementFile, readYamlFile } from "./read.js";
import { retry } from "./retry.js";
import type { FileSnapshot } from "./snapshot.js";
import { isTempFile, writeFileAtomic } from "./write.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-write-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

const abs = (rel: string): string => path.join(root, rel);
const put = (rel: string, content: string): Promise<void> => fs.writeFile(abs(rel), content);
const text = (rel: string): Promise<string> => fs.readFile(abs(rel), "utf8");
const parsed = async (rel: string): Promise<ParsedFile> => {
  const r = await readElementFile(root, rel);
  if (r.kind !== "parsed") {
    throw new Error(`expected parsed, got ${r.kind}`);
  }
  return r.file;
};
const forge = async (rel: string): Promise<FileSnapshot> => {
  const bytes = await fs.readFile(abs(rel));
  const st = await fs.stat(abs(rel));
  return {
    path: rel,
    size: st.size,
    mtimeMs: st.mtimeMs,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
};
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });
const A = "---\nid: a\n---\n";

describe("writeFileAtomic: replace", () => {
  it("replaces an unchanged file, returns the new snapshot and leaves no temp file", async () => {
    await put("a.md", `${A}old\n`);
    const file = await parsed("a.md");
    const next = await writeFileAtomic(root, "a.md", "---\nid: a\ntitle: New\n---\nold\n", file.snapshot);
    expect(await text("a.md")).toBe("---\nid: a\ntitle: New\n---\nold\n");
    expect(await fs.readdir(root)).toEqual(["a.md"]);
    const reread = await parsed("a.md");
    expect(next).toEqual(reread.snapshot);
    expect(Object.isFrozen(next)).toBe(true);
    await writeFileAtomic(root, "a.md", `${A}again\n`, next);
    expect(await text("a.md")).toBe(`${A}again\n`);
  });

  it("writes when only the modification time changed (the hash decides)", async () => {
    await put("a.md", A);
    const file = await parsed("a.md");
    const t = new Date(Date.now() + 60_000);
    await fs.utimes(abs("a.md"), t, t);
    await writeFileAtomic(root, "a.md", `${A}x\n`, file.snapshot);
    expect(await text("a.md")).toBe(`${A}x\n`);
  });

  it("refuses when the content changed, even with the same size and time", async () => {
    await put("a.md", A);
    const file = await parsed("a.md");
    const st = await fs.stat(abs("a.md"));
    await put("a.md", "---\nid: b\n---\n");
    await fs.utimes(abs("a.md"), st.atime, st.mtime);
    await expect(writeFileAtomic(root, "a.md", "x", file.snapshot)).rejects.toMatchObject({
      code: "file.changed-on-disk",
    });
    expect(await text("a.md")).toBe("---\nid: b\n---\n");
    expect(await fs.readdir(root)).toEqual(["a.md"]);
  });

  it("refuses when the file was removed since it was read", async () => {
    await put("a.md", A);
    const file = await parsed("a.md");
    await fs.rm(abs("a.md"));
    await expect(writeFileAtomic(root, "a.md", "x", file.snapshot)).rejects.toMatchObject({
      code: "file.changed-on-disk",
    });
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("refuses when the file is removed between the checks", async () => {
    await put("a.md", A);
    const file = await parsed("a.md");
    const readFile = fs.readFile.bind(fs);
    vi.spyOn(fs, "readFile").mockImplementationOnce(async () => {
      await fs.rm(abs("a.md"));
      return readFile(abs("a.md"));
    });
    await expect(writeFileAtomic(root, "a.md", "x", file.snapshot)).rejects.toMatchObject({
      code: "file.changed-on-disk",
    });
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("refuses a target that became a folder", async () => {
    await put("a.md", A);
    const file = await parsed("a.md");
    await fs.rm(abs("a.md"));
    await fs.mkdir(abs("a.md"));
    await expect(writeFileAtomic(root, "a.md", "x", file.snapshot)).rejects.toMatchObject({
      code: "file.not-regular",
    });
  });

  it("refuses a symbolic link as target", async () => {
    await put("t.md", A);
    const file = await parsed("t.md");
    await fs.symlink(abs("t.md"), abs("l.md"), "file");
    const forged = { ...file.snapshot, path: "l.md" };
    await expect(writeFileAtomic(root, "l.md", "x", forged)).rejects.toMatchObject({
      code: "file.not-regular",
    });
    expect(await text("t.md")).toBe(A);
  });

  it("refuses a read-only file", async () => {
    await put("a.md", A);
    const file = await parsed("a.md");
    await fs.chmod(abs("a.md"), 0o444);
    await expect(writeFileAtomic(root, "a.md", "x", file.snapshot)).rejects.toMatchObject({
      code: "file.read-only",
    });
    await fs.chmod(abs("a.md"), 0o644);
    expect(await text("a.md")).toBe(A);
  });

  it("refuses a snapshot of another file", async () => {
    await put("a.md", A);
    await put("b.md", A);
    const file = await parsed("a.md");
    await expect(writeFileAtomic(root, "b.md", "x", file.snapshot)).rejects.toMatchObject({
      code: "internal",
    });
    expect(await text("b.md")).toBe(A);
  });

  it("keeps the permission bits of a replaced file", async () => {
    await put("a.md", A);
    await fs.chmod(abs("a.md"), 0o664);
    const before = (await fs.stat(abs("a.md"))).mode & 0o777;
    const file = await parsed("a.md");
    await writeFileAtomic(root, "a.md", `${A}t\n`, file.snapshot);
    expect((await fs.stat(abs("a.md"))).mode & 0o777).toBe(before);
  });

  it("retries a rename that fails transiently", async () => {
    await put("a.md", A);
    const file = await parsed("a.md");
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename")
      .mockRejectedValueOnce(errno("EBUSY"))
      .mockRejectedValueOnce(errno("EPERM"))
      .mockImplementation(rename);
    await writeFileAtomic(root, "a.md", `${A}x\n`, file.snapshot);
    expect(await text("a.md")).toBe(`${A}x\n`);
  });

  it("maps a lasting rename failure to an error code and removes the temp file", async () => {
    await put("a.md", A);
    const file = await parsed("a.md");
    vi.spyOn(fs, "rename").mockRejectedValue(errno("EIO"));
    const error = await writeFileAtomic(root, "a.md", "x", file.snapshot).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "internal", message: "Not written: a.md (EIO)" });
    expect(await text("a.md")).toBe(A);
    expect(await fs.readdir(root)).toEqual(["a.md"]);
  });

  it("never masks a successful write when the temp file cannot be cleaned up", async () => {
    await put("a.md", A);
    const file = await parsed("a.md");
    vi.spyOn(fs, "rm").mockRejectedValue(errno("EIO"));
    await writeFileAtomic(root, "a.md", `${A}x\n`, file.snapshot);
    expect(await text("a.md")).toBe(`${A}x\n`);
  });

  it("refuses paths outside the root", async () => {
    for (const p of ["../x.md", "", "..", "a/../../x.md", path.join(root, "a.md")]) {
      await expect(writeFileAtomic(root, p, "x", null)).rejects.toMatchObject({ code: "input.invalid" });
    }
  });

  it("refuses a folder linked outside the root", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-outside-"));
    try {
      await fs.symlink(outside, abs("linked"), "junction");
      await expect(writeFileAtomic(root, "linked/n.md", A, null)).rejects.toMatchObject({
        code: "input.invalid",
      });
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("reports a missing folder", async () => {
    const error = await writeFileAtomic(root, "missing/a.md", A, null).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "file.folder-missing",
      message: expect.not.stringContaining(root) as string,
    });
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("names temp files with the documented pattern", async () => {
    await put("a.md", A);
    const file = await parsed("a.md");
    let seen = "";
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename").mockImplementation((from, to) => {
      seen = path.basename(String(from));
      return rename(from, to);
    });
    await writeFileAtomic(root, "a.md", A, file.snapshot);
    expect(isTempFile(seen)).toBe(true);
    expect(seen).toMatch(/^\.a\.md\.[0-9a-f]{8}\.reqseq-tmp$/);
    expect(isTempFile("a.md")).toBe(false);
  });
});

describe("writeFileAtomic: create", () => {
  it("creates a new file and returns its snapshot", async () => {
    await fs.mkdir(abs("req"));
    const snap = await writeFileAtomic(root, "req/n.md", A, null);
    expect(await text("req/n.md")).toBe(A);
    expect(await fs.readdir(abs("req"))).toEqual(["n.md"]);
    expect(snap).toEqual((await parsed("req/n.md")).snapshot);
  });

  it("refuses to create a file that already exists and keeps it", async () => {
    await put("a.md", "keep\n");
    await expect(writeFileAtomic(root, "a.md", "new\n", null)).rejects.toMatchObject({
      code: "file.changed-on-disk",
    });
    expect(await text("a.md")).toBe("keep\n");
    expect(await fs.readdir(root)).toEqual(["a.md"]);
  });

  it("refuses when the file appears while it is being created", async () => {
    const link = fs.link.bind(fs);
    vi.spyOn(fs, "link").mockImplementationOnce(async (from, to) => {
      await put("a.md", "other\n");
      return link(from, to);
    });
    await expect(writeFileAtomic(root, "a.md", A, null)).rejects.toMatchObject({
      code: "file.changed-on-disk",
    });
    expect(await text("a.md")).toBe("other\n");
    expect(await fs.readdir(root)).toEqual(["a.md"]);
  });

  it("falls back to an exclusive create where hard links are not supported", async () => {
    vi.spyOn(fs, "link").mockRejectedValue(errno("ENOTSUP"));
    const snap = await writeFileAtomic(root, "a.md", A, null);
    expect(await text("a.md")).toBe(A);
    expect(await fs.readdir(root)).toEqual(["a.md"]);
    expect(snap).toEqual((await parsed("a.md")).snapshot);
  });

  it("refuses in the fallback when the file appears meanwhile", async () => {
    vi.spyOn(fs, "link").mockImplementationOnce(async () => {
      await put("a.md", "other\n");
      throw errno("EPERM");
    });
    await expect(writeFileAtomic(root, "a.md", A, null)).rejects.toMatchObject({
      code: "file.changed-on-disk",
    });
    expect(await text("a.md")).toBe("other\n");
  });

  it("maps other link and stat failures to error codes", async () => {
    vi.spyOn(fs, "link").mockRejectedValueOnce(errno("EIO"));
    await expect(writeFileAtomic(root, "a.md", A, null)).rejects.toMatchObject({ code: "internal" });
    vi.spyOn(fs, "lstat").mockRejectedValueOnce(errno("EACCES"));
    await expect(writeFileAtomic(root, "b.md", A, null)).rejects.toMatchObject({ code: "internal" });
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("removes a partial file the fallback created when writing it fails", async () => {
    vi.spyOn(fs, "link").mockRejectedValue(errno("ENOTSUP"));
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (target, flags, mode) => {
      const handle = await open(target, flags, mode);
      if (target === abs("a.md")) {
        vi.spyOn(handle, "writeFile").mockRejectedValue(errno("ENOSPC"));
      }
      return handle;
    });
    await expect(writeFileAtomic(root, "a.md", A, null)).rejects.toMatchObject({ code: "internal" });
    expect(await fs.readdir(root)).toEqual([]);
  });
});

describe("writeFileAtomic: review findings", () => {
  it("never overwrites a save made while a transient rename error is retried", async () => {
    await put("a.md", A);
    const file = await parsed("a.md");
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, "rename")
      .mockImplementationOnce(async () => {
        await put("a.md", "---\nid: a\ntitle: saved by an editor\n---\n");
        throw errno("EBUSY");
      })
      .mockImplementation(rename);
    await expect(writeFileAtomic(root, "a.md", `${A}mine\n`, file.snapshot)).rejects.toMatchObject({
      code: "file.changed-on-disk",
    });
    expect(await text("a.md")).toBe("---\nid: a\ntitle: saved by an editor\n---\n");
    expect(await fs.readdir(root)).toEqual(["a.md"]);
  });

  it("uses the canonical path for snapshots", async () => {
    await fs.mkdir(abs("d"));
    const snap = await writeFileAtomic(root, "./d/../d/a.md", A, null);
    expect(snap.path).toBe("d/a.md");
    const next = await writeFileAtomic(root, "d/a.md", `${A}x\n`, snap);
    expect(next.path).toBe("d/a.md");
    expect(await text("d/a.md")).toBe(`${A}x\n`);
  });

  it("does not echo an absolute path in the error", async () => {
    const error = await writeFileAtomic(root, abs("a.md"), A, null).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "input.invalid" });
    expect((error as Error).message).not.toContain(root);
  });

  it("reports a file whose folder vanished during a replace as changed on disk", async () => {
    await put("a.md", A);
    const file = await parsed("a.md");
    vi.spyOn(fs, "open").mockRejectedValueOnce(errno("ENOENT"));
    await expect(writeFileAtomic(root, "a.md", "x", file.snapshot)).rejects.toMatchObject({
      code: "file.changed-on-disk",
    });
  });

  it("reports a folder that is not writable", async () => {
    vi.spyOn(fs, "open").mockRejectedValueOnce(errno("EACCES"));
    const error = await writeFileAtomic(root, "a.md", A, null).catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "file.read-only",
      message: expect.stringMatching(/not writable/) as string,
    });
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("ignores a folder that cannot be fsynced", async () => {
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation((target, flags, mode) =>
      flags === "r" ? Promise.reject(errno("EISDIR")) : open(target, flags, mode),
    );
    await writeFileAtomic(root, "a.md", A, null);
    expect(await text("a.md")).toBe(A);
  });

  it("replaces a YAML file that still parses as YAML", async () => {
    await put("w.yaml", "name: demo\n");
    const r = await readYamlFile(root, "w.yaml");
    if (r.kind !== "parsed") {
      throw new Error("expected parsed");
    }
    await writeFileAtomic(root, "w.yaml", "name: other\n", r.file.snapshot, { kind: "yaml" });
    expect(await text("w.yaml")).toBe("name: other\n");
  });

  it("replaces an XML file that the scanner still reads, and refuses one it does not (SR-029)", async () => {
    await put("r.xml", "<testsuites/>");
    await writeFileAtomic(root, "r.xml", "<testsuites></testsuites>", await forge("r.xml"), { kind: "xml" });
    expect(await text("r.xml")).toBe("<testsuites></testsuites>");
    await put("bad.xml", "<testsuites>");
    await expect(
      writeFileAtomic(root, "bad.xml", "<testsuites/>", await forge("bad.xml"), { kind: "xml" }),
    ).rejects.toMatchObject({
      code: "file.faulty",
      message: expect.stringContaining("is no readable XML (line 1)") as string,
    });
    expect(await text("bad.xml")).toBe("<testsuites>");
  });

  it("replaces a ReqSeq data file in JSON Lines, also a cut one, and refuses any other (SR-062, #319)", async () => {
    const line = '{"reqseq-data":2,"dirty":false,"id":"a"}\n';
    await put("d.jsonl", `${line}{"reqseq-data":2,"id":"b","t":"Grö`);
    await writeFileAtomic(root, "d.jsonl", () => [line, line], await forge("d.jsonl"), { kind: "jsonl" });
    expect(await text("d.jsonl")).toBe(line + line);
    for (const [name, content] of [
      ["old.jsonl", '{"reqseq-data":1}\n'],
      ["other.jsonl", '{"a":1}\n'],
    ] as const) {
      await put(name, content);
      await expect(
        writeFileAtomic(root, name, line, await forge(name), { kind: "jsonl" }),
      ).rejects.toMatchObject({
        code: "file.faulty",
        message: expect.stringContaining("is not a ReqSeq data file") as string,
      });
      expect(await text(name)).toBe(content);
    }
    await fs.writeFile(
      abs("latin.jsonl"),
      Buffer.concat([Buffer.from(line), Buffer.from([0x22, 0xe4, 0x22, 0x0a])]),
    );
    await expect(
      writeFileAtomic(root, "latin.jsonl", line, await forge("latin.jsonl"), { kind: "jsonl" }),
    ).rejects.toMatchObject({ code: "file.faulty" });
    // The hash is that of the whole file, read in pieces: a change after the snapshot is seen.
    await put("e.jsonl", line);
    const snapshot = await forge("e.jsonl");
    await put("e.jsonl", line + line);
    await expect(writeFileAtomic(root, "e.jsonl", line, snapshot, { kind: "jsonl" })).rejects.toMatchObject({
      code: "file.changed-on-disk",
    });
    await fs.rm(abs("e.jsonl"));
    await expect(writeFileAtomic(root, "e.jsonl", line, snapshot, { kind: "jsonl" })).rejects.toMatchObject({
      code: "file.changed-on-disk",
    });
  });

  it("[SR-008/AK3] refuses to replace a faulty YAML file", async () => {
    await put("w.yaml", "name: [\n");
    await expect(
      writeFileAtomic(root, "w.yaml", "name: x\n", await forge("w.yaml"), { kind: "yaml" }),
    ).rejects.toMatchObject({ code: "file.faulty" });
    expect(await text("w.yaml")).toBe("name: [\n");
  });
});

describe("writeFileAtomic: chunk content (#277)", () => {
  const CHUNKS = ["---\nid: a\n", Buffer.from("title: Grüße 😀\n", "utf8"), "---\n", "", "text\n"];
  const WHOLE = "---\nid: a\ntitle: Grüße 😀\n---\ntext\n";

  /** Counts the writes of the handles opened for `target`. */
  const countWrites = (target: string): { count: number } => {
    const counter = { count: 0 };
    const open = fs.open.bind(fs);
    vi.spyOn(fs, "open").mockImplementation(async (file, flags, mode) => {
      const handle = await open(file, flags, mode);
      if (path.basename(String(file)).includes(target)) {
        const writeFile = handle.writeFile.bind(handle);
        vi.spyOn(handle, "writeFile").mockImplementation((data, options) => {
          counter.count += 1;
          return writeFile(data, options);
        });
      }
      return handle;
    });
    return counter;
  };

  it("replaces and creates with the same bytes and snapshot as a string, one write per chunk", async () => {
    await put("a.md", A);
    const file = await parsed("a.md");
    const writes = countWrites("a.md");
    const snap = await writeFileAtomic(root, "a.md", () => CHUNKS, file.snapshot);
    expect(await text("a.md")).toBe(WHOLE);
    expect(snap).toEqual((await parsed("a.md")).snapshot);
    expect(snap.size).toBe(Buffer.byteLength(WHOLE));
    expect(writes.count).toBe(CHUNKS.length);
    const created = await writeFileAtomic(root, "b.md", () => CHUNKS, null);
    expect(created).toEqual({ ...(await parsed("b.md")).snapshot });
    expect(await text("b.md")).toBe(WHOLE);
    expect(await fs.readdir(root)).toEqual(["a.md", "b.md"]);
  });

  it("writes a string in one piece, never character by character (review N2)", async () => {
    const writes = countWrites("a.md");
    await writeFileAtomic(root, "a.md", WHOLE, null);
    expect(writes.count).toBe(1);
    expect(await text("a.md")).toBe(WHOLE);
  });

  it("writes the chunks again where hard links are not supported (review B2)", async () => {
    vi.spyOn(fs, "link").mockRejectedValue(errno("ENOTSUP"));
    let passes = 0;
    const content = function* (): Generator<string> {
      passes += 1;
      yield* ["---\n", "id: a\n", "---\n"];
    };
    const snap = await writeFileAtomic(root, "a.md", content, null);
    expect(passes).toBe(2);
    expect(await text("a.md")).toBe(A);
    expect(await fs.readdir(root)).toEqual(["a.md"]);
    expect(snap).toEqual((await parsed("a.md")).snapshot);
  });

  it("refuses a changed file as with a string, and leaves nothing when the chunks fail", async () => {
    await put("a.md", A);
    const file = await parsed("a.md");
    await put("a.md", "---\nid: b\n---\n");
    await expect(writeFileAtomic(root, "a.md", () => CHUNKS, file.snapshot)).rejects.toMatchObject({
      code: "file.changed-on-disk",
    });
    const failing = function* (): Generator<string> {
      yield "---\n";
      throw new Error("no more");
    };
    await expect(writeFileAtomic(root, "n.md", failing, null)).rejects.toMatchObject({
      code: "internal",
      message: "Not written: n.md (its content could not be produced)",
      cause: expect.objectContaining({ message: "no more" }) as unknown,
    });
    expect(await fs.readdir(root)).toEqual(["a.md"]);
  });
});

describe("retry", () => {
  it("passes on errors without a code or with another code at once", async () => {
    const plain = vi.fn().mockRejectedValue(new Error("plain"));
    await expect(retry(plain, ["EBUSY"])).rejects.toThrow("plain");
    const other = vi.fn().mockRejectedValue(errno("EIO"));
    await expect(retry(other, ["EBUSY"])).rejects.toThrow("EIO");
    expect(plain).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it("gives up after the given number of attempts", async () => {
    const busy = vi.fn().mockRejectedValue(errno("EBUSY"));
    await expect(retry(busy, ["EBUSY"], { attempts: 3, delayMs: 1 })).rejects.toThrow("EBUSY");
    expect(busy).toHaveBeenCalledTimes(3);
  });
});

describe("SR-008 AK3: a faulty file is never written by ReqSeq", () => {
  it("[SR-008/AK3] refuses a snapshot of a faulty file and leaves it unchanged", async () => {
    const content = "---\nid: a\n  bad: [\n---\n";
    await put("a.md", content);
    await expect(writeFileAtomic(root, "a.md", A, await forge("a.md"))).rejects.toMatchObject({
      code: "file.faulty",
    });
    expect(await text("a.md")).toBe(content);
    expect(await fs.readdir(root)).toEqual(["a.md"]);
  });

  it("[SR-008/AK3] refuses a file with conflict markers and a file without frontmatter", async () => {
    const conflicted = "---\nid: a\n<<<<<<< HEAD\nt: 1\n=======\nt: 2\n>>>>>>> b\n---\n";
    await put("c.md", conflicted);
    await expect(writeFileAtomic(root, "c.md", A, await forge("c.md"))).rejects.toMatchObject({
      code: "file.faulty",
    });
    expect(await text("c.md")).toBe(conflicted);
    await put("README.md", "# Readme\n");
    const error = await writeFileAtomic(root, "README.md", A, await forge("README.md")).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({
      code: "file.faulty",
      message: expect.stringMatching(/no frontmatter/) as string,
    });
    expect(await text("README.md")).toBe("# Readme\n");
  });

  it("[SR-008/AK3] refuses to overwrite a file that became faulty after it was read", async () => {
    await put("a.md", `${A}Text\n`);
    const file = await parsed("a.md");
    const broken = "---\nid: a\n<<<<<<< HEAD\nt: 1\n=======\nt: 2\n>>>>>>> b\n---\nText\n";
    await put("a.md", broken);
    await expect(writeFileAtomic(root, "a.md", `${A}New\n`, file.snapshot)).rejects.toMatchObject({
      code: "file.changed-on-disk",
    });
    expect(await text("a.md")).toBe(broken);
  });
});
