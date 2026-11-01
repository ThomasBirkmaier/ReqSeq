// The model cache (ADR-0008, SR-082): a start reuses what each unchanged file contributed and reads
// only new and changed files; anything it cannot trust is read again. The times of SR-082 are
// measured by the perf suite (packages/cli/test/perf/start.test.ts); these tests check that a load
// through the cache gives exactly what a full read gives.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { createFixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import { Workspace } from "../runtime/workspace.js";
import { canonicalRoot, workspaceLayoutState } from "../workspace/index.js";
import type { Contribution } from "./contribution.js";
import type { ModelCache, Reuse } from "./model-cache.js";
import {
  FINGERPRINT_FILE,
  MODEL_CACHE_FILE,
  MODEL_CACHE_FORMAT,
  RACY_MS,
  changeStamp,
  codeFingerprint,
  computeCodeFingerprint,
  fingerprintFile,
  inoKey,
  loadThroughCache,
  parseModelCache,
  readModelCache,
  serializeModelCache,
  statKeys,
} from "./model-cache.js";
import { incomingState } from "./incoming.js";
import { shortIdState } from "./short-id.js";
import type { LoadedStore } from "./store.js";
import { elementStoreState, loadElements } from "./store.js";
import { warmModel } from "./warm.js";

const WORKSPACE =
  "reqseq-workspace: 1\nname: W\nrepositories:\n  - { name: system, url: x }\nmetamodel: { repository: system, path: metamodel }\n";
const ID_A = "0b0e6f6c-3c1f-4c55-9d0e-0c1d2e3f4a5b";
const ID_B = "5f1c2a0e-8d4b-4b8e-a6f1-2b3c4d5e6f70";
const ID_C = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const ID_D = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

const element = (id: string, title: string, extra = ""): string =>
  `---\nid: ${id}\ntype: system-requirement\nstatus: draft\ntitle: ${title}\n${extra}---\nText of ${title}.\n`;

/** Files of every kind a store holds: elements, a file that is not one, a faulty one, one without frontmatter. */
const FILES: Readonly<Record<string, string>> = {
  "reqseq-workspace.yaml": WORKSPACE,
  "requirements/a.md": element(ID_A, "Alpha"),
  "requirements/b.md": element(ID_B, "Bravo"),
  "requirements/c.md": element(ID_C, "Charlie"),
  "notes/plain.md": "---\nauthor: someone\n---\nNot an element.\n",
  "notes/invalid.md": "---\nid: not-a-uuid\ntype: system-requirement\n---\n",
  "notes/broken.md": "---\nid: [\n---\n",
  "README.md": "# No frontmatter\n",
};

/** The files of FILES without a snapshot (faulty, no frontmatter): every load reads them. */
const ALWAYS_READ = ["README.md", "notes/broken.md"];

const fixture = async (files: Readonly<Record<string, string>> = FILES): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace({ files });
  onTestFinished(() => created.cleanup());
  return created;
};

const tempFolder = async (): Promise<string> => {
  const folder = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "reqseq-model-cache-")));
  onTestFinished(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
};

/** Sets the modification time of every file back by `seconds` (a minute): the cache trusts it (`RACY_MS`). */
const age = async (ws: FixtureWorkspace, seconds = 60): Promise<void> => {
  const when = new Date(Date.now() - seconds * 1000);
  for (const entry of await fs.readdir(ws.root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      await fs.utimes(path.join(entry.parentPath, entry.name), when, when);
    }
  }
};

/**
 * A clock for a load that starts once the files of the test have settled: `age` cannot set back the
 * change time of a file (it sets it to now), and a file whose change time lies within `RACY_MS` of
 * the start of the load is not written to the cache.
 */
const settled = (): number => Date.now() + RACY_MS + 200;

/**
 * Waits until the change time of every Markdown file of the workspace lies more than `RACY_MS`
 * (and 200 ms) before `Date.now()`, the clock a load with the real clock compares it with. A fixed
 * sleep of `RACY_MS` plus 100 ms assumed that the wall clock runs on evenly; on the self-hosted Linux
 * runner (a VM on a Mac, whose clock is stepped back when it is synchronised) it did not, and files
 * that had settled by the elapsed time still looked racy and were left out of the cache (#273).
 * Comparing the change times the load will compare, with the clock it will read, does not depend on
 * how much time passed.
 */
const settle = async (ws: FixtureWorkspace): Promise<void> => {
  for (;;) {
    let latest = 0;
    for (const entry of await fs.readdir(ws.root, { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        const { ctimeMs } = await fs.lstat(path.join(entry.parentPath, entry.name));
        latest = Math.max(latest, ctimeMs);
      }
    }
    const wait = latest + RACY_MS + 200 - Date.now();
    if (wait <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
};

/**
 * Opens the workspace with the cache folder, reads its store through the cache and closes it
 * (waiting for the save). `read` lists the files the load read instead of taking them from the cache.
 * `now` is the clock of the load (`settled` unless a test checks the racy rules with the real one).
 */
const loadOnce = async (
  root: string,
  cache: string,
  now: () => number = settled,
): Promise<{ readonly store: LoadedStore; readonly read: readonly string[] }> => {
  const workspace = new Workspace(root, { cacheFolder: cache });
  const read: string[] = [];
  try {
    const layout = await workspace.get(workspaceLayoutState);
    const store = await loadThroughCache(
      workspace,
      cache,
      layout,
      (reuse) => {
        const observed: Reuse | undefined =
          reuse === undefined
            ? undefined
            : async (repository, files) => {
                const split = await reuse(repository, files);
                read.push(...split.read);
                return split;
              };
        return loadElements(layout, undefined, observed === undefined ? {} : { reuse: observed });
      },
      now,
    );
    return { store, read };
  } finally {
    await workspace.close();
  }
};

/** The store a full read gives now, without any cache. */
const fullRead = async (root: string): Promise<LoadedStore> => {
  const workspace = new Workspace(root);
  try {
    return await loadElements(await workspace.get(workspaceLayoutState));
  } finally {
    await workspace.close();
  }
};

/** Replaces the bytes of a file with others of the same length, and puts its modification time back. */
const tamper = async (file: string, from: string, to: string): Promise<void> => {
  expect(to).toHaveLength(from.length);
  const stat = await fs.stat(file);
  const text = await fs.readFile(file, "utf8");
  await fs.writeFile(file, text.replace(from, to));
  await fs.utimes(file, stat.atime, stat.mtime);
};

const cacheFile = (cache: string): string => path.join(cache, MODEL_CACHE_FILE);
const cacheText = (cache: string): Promise<string> => fs.readFile(cacheFile(cache), "utf8");

const titles = (store: LoadedStore): unknown[] => store.elements.map((e) => e.data["title"]);

describe("model cache of the element store (ADR-0008, SR-082)", () => {
  it("writes the cache after a load without one and gives exactly what a full read gives", async () => {
    const ws = await fixture();
    await age(ws);
    const cache = await tempFolder();
    const { store, read } = await loadOnce(ws.root, cache);
    expect(store).toStrictEqual(await fullRead(ws.root));
    expect([...read].sort()).toEqual(
      Object.keys(FILES)
        .filter((f) => f.endsWith(".md"))
        .sort(),
    );
    const written = JSON.parse(await cacheText(cache)) as Record<string, unknown>;
    expect(written).toMatchObject({ format: MODEL_CACHE_FORMAT, root: canonicalRoot(ws.root) });
    // Files that did not parse or have no frontmatter have no snapshot, so they are always read.
    expect(
      (written["repositories"] as { files: [string][] }[]).map((r) => r.files.map(([file]) => file)),
    ).toEqual([
      ["notes/invalid.md", "notes/plain.md", "requirements/a.md", "requirements/b.md", "requirements/c.md"],
    ]);
    if (process.platform !== "win32") {
      expect((await fs.stat(cacheFile(cache))).mode & 0o777).toBe(0o600);
    }
  });

  it("reuses the entries of unchanged files without reading them, and does not write the cache again", async () => {
    const ws = await fixture();
    await age(ws);
    const cache = await tempFolder();
    const first = await loadOnce(ws.root, cache);
    const before = await fs.stat(cacheFile(cache));
    const text = await cacheText(cache);
    const second = await loadOnce(ws.root, cache);
    expect([...second.read].sort()).toEqual(ALWAYS_READ);
    expect(second.store).toStrictEqual(first.store);
    expect(second.store).toStrictEqual(await fullRead(ws.root));
    const [a] = second.store.elements;
    expect(Object.isFrozen(a?.snapshot)).toBe(true);
    expect(a?.snapshot).toBe(second.store.repositories[0]?.files.get("requirements/a.md")?.snapshot);
    expect(await cacheText(cache)).toBe(text);
    expect((await fs.stat(cacheFile(cache))).mtimeMs).toBe(before.mtimeMs);
  });

  it("reads a file again that was rewritten with the same size and modification time (change time)", async () => {
    const ws = await fixture();
    await age(ws);
    const cache = await tempFolder();
    await loadOnce(ws.root, cache);
    // As `cp -p` or a restore that keeps times: only the inode or the change time tell.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await tamper(ws.path("requirements/a.md"), "Alpha", "Alphx");
    const { store, read } = await loadOnce(ws.root, cache);
    expect(read).toContain("requirements/a.md");
    expect(titles(store)).toEqual(["Alphx", "Bravo", "Charlie"]);
    expect(store).toStrictEqual(await fullRead(ws.root));
  });

  it("reads changed, new and racy files again, drops gone ones and writes the cache again", async () => {
    const ws = await fixture();
    await age(ws);
    const cache = await tempFolder();
    await loadOnce(ws.root, cache);
    // The other files settle, so that the load with the real clock below writes them to the cache.
    await settle(ws);
    // b: another size; c: gone; d: new.
    await ws.write("requirements/b.md", element(ID_B, "Bravo two"));
    await fs.rm(ws.path("requirements/c.md"));
    await ws.write("requirements/d.md", element(ID_D, "Delta"));
    const second = await loadOnce(ws.root, cache, Date.now);
    expect(second.store).toStrictEqual(await fullRead(ws.root));
    expect(titles(second.store)).toEqual(["Alpha", "Bravo two", "Delta"]);
    // b and d were changed just now (racy): the next load reads them again and sees the change.
    await tamper(ws.path("requirements/d.md"), "Delta", "Delty");
    const third = await loadOnce(ws.root, cache);
    expect([...third.read].sort()).toEqual([...ALWAYS_READ, "requirements/b.md", "requirements/d.md"].sort());
    expect(titles(third.store)).toEqual(["Alpha", "Bravo two", "Delty"]);
    expect(third.store).toStrictEqual(await fullRead(ws.root));
  });

  it("does not trust entries changed shortly before the load that wrote the cache", async () => {
    const ws = await fixture();
    // Modification times a second after the change times (now), as from a clock that runs ahead.
    await age(ws, -1);
    const cache = await tempFolder();
    // The change times lie more than RACY_MS before this load, the modification times not.
    const soon = (): number => Date.now() + RACY_MS + 500;
    await loadOnce(ws.root, cache, soon);
    const cached = JSON.parse(await cacheText(cache)) as { repositories: { files: unknown[][] }[] };
    expect((cached.repositories[0]?.files ?? []).map(([file]) => file)).toContain("requirements/a.md");
    const { read } = await loadOnce(ws.root, cache, soon);
    expect(read).toContain("requirements/a.md");
  });

  it("does not write a file whose change time lies shortly before the load", async () => {
    const ws = await fixture();
    await age(ws);
    const cache = await tempFolder();
    await new Promise((resolve) => setTimeout(resolve, 300));
    // As `cp -p` just before or during the load: the modification time is old, the change time new.
    // (File times may lag `Date.now()` by a tick of the kernel clock, hence the 100 ms.)
    const changed = Date.now();
    await tamper(ws.path("requirements/a.md"), "Alpha", "Alphx");
    const clock = (): number => changed + RACY_MS - 100;
    const first = await loadOnce(ws.root, cache, clock);
    expect(first.read).toContain("requirements/a.md");
    const cached = JSON.parse(await cacheText(cache)) as { repositories: { files: unknown[][] }[] };
    const files = (cached.repositories[0]?.files ?? []).map(([file]) => file);
    expect(files).toContain("requirements/b.md");
    expect(files).not.toContain("requirements/a.md");
    const second = await loadOnce(ws.root, cache, clock);
    expect(second.read).toContain("requirements/a.md");
    expect(second.read).not.toContain("requirements/b.md");
    expect(titles(second.store)).toEqual(["Alphx", "Bravo", "Charlie"]);
  });

  it("keeps the cache while few files are out of date, and reads those again", async () => {
    const files: Record<string, string> = { "reqseq-workspace.yaml": WORKSPACE };
    for (let i = 0; i < 150; i += 1) {
      files[`many/${String(i).padStart(3, "0")}.md`] = `---\nn: ${String(i)}\n---\n`;
    }
    const ws = await fixture(files);
    await age(ws);
    const cache = await tempFolder();
    await loadOnce(ws.root, cache);
    const text = await cacheText(cache);
    // One file of 150 is under 1 %: it is read again, the cache is not written.
    await ws.write("many/000.md", "---\nn: changed\n---\n");
    const second = await loadOnce(ws.root, cache);
    expect(second.read).toEqual(["many/000.md"]);
    expect(await cacheText(cache)).toBe(text);
    // Two are over 1 %: written again.
    await ws.write("many/001.md", "---\nn: changed too\n---\n");
    const third = await loadOnce(ws.root, cache);
    expect([...third.read].sort()).toEqual(["many/000.md", "many/001.md"]);
    expect(await cacheText(cache)).not.toBe(text);
    expect(third.store).toStrictEqual(await fullRead(ws.root));
  });

  it("reads every file of a repository that moved or was renamed, and writes the cache again", async () => {
    const ws = await fixture();
    await age(ws);
    const cache = await tempFolder();
    await loadOnce(ws.root, cache);
    await ws.write("reqseq-workspace.yaml", WORKSPACE.replace("name: system", "name: main"));
    const renamed = await loadOnce(ws.root, cache);
    expect(renamed.read).toHaveLength(7);
    expect(renamed.store).toStrictEqual(await fullRead(ws.root));
    expect(JSON.parse(await cacheText(cache))).toMatchObject({ repositories: [{ name: "main" }] });
  });

  it.each([
    ["!!timestamp", "when: !!timestamp 2026-10-24\n"],
    ["!!binary", "blob: !!binary aGVsbG8=\n"],
    ["!!set", "tags: !!set { a: null, b: null }\n"],
    ["!!omap", "order: !!omap [ { a: 1 }, { b: 2 } ]\n"],
    [".inf", "weight: .inf\n"],
    [".nan", "ratio: .nan\n"],
    ["-0", "offset: -0\n"],
    ["an alias that contains itself", "loop: &x [*x]\n"],
  ])(
    "leaves out an entry with %s and reads that file each time, exactly as a full read",
    async (_tag, extra) => {
      const ws = await fixture({
        "reqseq-workspace.yaml": WORKSPACE,
        "requirements/a.md": element(ID_A, "Alpha", extra),
        "requirements/b.md": element(ID_B, "Bravo"),
      });
      await age(ws);
      const cache = await tempFolder();
      const first = await loadOnce(ws.root, cache);
      const text = await cacheText(cache);
      expect(text).not.toContain(ID_A);
      expect(text).toContain(ID_B);
      const second = await loadOnce(ws.root, cache);
      expect(second.read).toEqual(["requirements/a.md"]);
      expect(second.store).toStrictEqual(first.store);
      expect(second.store).toStrictEqual(await fullRead(ws.root));
    },
  );

  it("caches an alias used twice: both copies come back equal", async () => {
    const ws = await fixture({
      "reqseq-workspace.yaml": WORKSPACE,
      "requirements/a.md": element(ID_A, "Alpha", "first: &x [1, 2]\nsecond: *x\n"),
    });
    await age(ws);
    const cache = await tempFolder();
    await loadOnce(ws.root, cache);
    expect(await cacheText(cache)).toContain(ID_A);
    const second = await loadOnce(ws.root, cache);
    expect(second.read).toEqual([]);
    expect(second.store).toStrictEqual(await fullRead(ws.root));
  });

  it("discards a cache that is not JSON, not a file, or was written for other code, another root or format", async () => {
    const ws = await fixture();
    await age(ws);
    const cache = await tempFolder();
    await loadOnce(ws.root, cache);
    const good = await cacheText(cache);
    const header = JSON.parse(good) as Record<string, unknown>;
    const variants = [
      "{ not json",
      JSON.stringify({ ...header, format: MODEL_CACHE_FORMAT + 1 }),
      JSON.stringify({ ...header, code: "other code" }),
      JSON.stringify({ ...header, root: "/somewhere/else" }),
    ];
    for (const variant of variants) {
      await fs.writeFile(cacheFile(cache), variant);
      expect((await loadOnce(ws.root, cache)).read).toHaveLength(7);
      // Written again from the files, so the next load can use it.
      expect(await readModelCache(cache, canonicalRoot(ws.root))).toBeDefined();
    }
    await fs.rm(cacheFile(cache));
    await fs.mkdir(cacheFile(cache));
    expect(await readModelCache(cache, canonicalRoot(ws.root))).toBeUndefined();
    expect((await loadOnce(ws.root, cache)).store).toStrictEqual(await fullRead(ws.root));
  });

  it("loads the files when the cache cannot be written", async () => {
    const ws = await fixture();
    const folder = await tempFolder();
    const cache = path.join(folder, "a-file");
    await fs.writeFile(cache, "");
    expect((await loadOnce(ws.root, cache)).store).toStrictEqual(await fullRead(ws.root));
  });

  it("never uses a cache folder inside a repository of the workspace", async () => {
    const ws = await fixture();
    await age(ws);
    // A folder outside that links into the repository, with a cache folder below it that does not
    // exist yet (as on the first run).
    const link = path.join(await tempFolder(), "link");
    await fs.symlink(ws.root, link, "junction");
    for (const cache of [ws.root, ws.path("cache/inside"), path.join(link, "not", "yet")]) {
      const { store, read } = await loadOnce(ws.root, cache);
      expect(read).toEqual([]);
      expect(store).toStrictEqual(await fullRead(ws.root));
      await expect(fs.stat(cacheFile(cache))).rejects.toThrow();
    }
  });

  it("reads every file through the workspace when its cache folder lies inside a repository", async () => {
    const ws = await fixture();
    await age(ws);
    const cache = ws.path("cache/inside");
    const workspace = new Workspace(ws.root, { cacheFolder: cache });
    onTestFinished(() => workspace.close());
    expect(await workspace.get(elementStoreState)).toStrictEqual(await fullRead(ws.root));
    await workspace.close();
    await expect(fs.stat(cacheFile(cache))).rejects.toThrow();
  });

  it("writes nothing when the workspace closes while it loads", async () => {
    const ws = await fixture();
    const cache = await tempFolder();
    const workspace = new Workspace(ws.root, { cacheFolder: cache });
    const loading = workspace.get(elementStoreState);
    await workspace.close();
    expect((await loading).elements).toHaveLength(3);
    await expect(fs.readdir(cache)).resolves.toEqual([]);
  });

  it("takes a cache entry only for a regular file with the same size, times and inode", async () => {
    const ws = await fixture({
      ...FILES,
      "x.md": "# a file where a folder was\n",
      "folder.md/inside.md": "# a folder where a file was\n",
    });
    await age(ws);
    const cache = await tempFolder();
    const { store } = await loadOnce(ws.root, cache);
    const workspace = new Workspace(ws.root, { cacheFolder: cache });
    onTestFinished(() => workspace.close());
    const layout = await workspace.get(workspaceLayoutState);
    const [repository] = layout.repositories;
    if (repository?.available !== true) {
      throw new Error("the repository is not available");
    }
    // Hand-made entries for paths the walk does not list: gone, below a file, a folder, a name
    // `lstat` refuses on every OS; and one with another inode.
    const cached = JSON.parse(await cacheText(cache)) as { repositories: { files: unknown[][] }[] };
    const files = cached.repositories[0]?.files ?? [];
    const plain = files.find(([file]) => file === "notes/plain.md") ?? [];
    for (const file of ["gone.md", "x.md/below.md", "folder.md", "nul\u0000.md"]) {
      const copy = JSON.parse(JSON.stringify(plain[1])) as {
        file: string;
        snapshot: Record<string, unknown>;
      };
      copy.file = file;
      copy.snapshot["path"] = file;
      files.push([file, copy, plain[2], plain[3]]);
    }
    // Another inode, as the decimal string the cache keeps (a 64-bit file ID on Windows keeps its
    // low bits): one more than the real one.
    expect(plain[2]).toMatch(/^\d+$/);
    plain[2] = String(BigInt(String(plain[2])) + 1n);
    await fs.writeFile(cacheFile(cache), JSON.stringify(cached));
    const result = await loadThroughCache(workspace, cache, layout, async (reuse) => {
      const split = await reuse?.(repository, [
        "requirements/a.md",
        "notes/plain.md",
        "gone.md",
        "x.md/below.md",
        "folder.md",
        "nul\u0000.md",
      ]);
      expect([...(split?.reused.keys() ?? [])]).toEqual(["requirements/a.md"]);
      expect(split?.read).toEqual([
        "notes/plain.md",
        "gone.md",
        "x.md/below.md",
        "folder.md",
        "nul\u0000.md",
      ]);
      return store;
    });
    expect(result).toBe(store);
  });

  it("checks the files of a large repository in chunks", async () => {
    const files: Record<string, string> = { "reqseq-workspace.yaml": WORKSPACE };
    for (let i = 0; i < 2_001; i += 1) {
      files[`many/${String(i).padStart(4, "0")}.md`] = `---\nn: ${String(i)}\n---\n`;
    }
    const ws = await fixture(files);
    await age(ws);
    const cache = await tempFolder();
    const first = await loadOnce(ws.root, cache);
    const second = await loadOnce(ws.root, cache);
    expect(second.read).toEqual([]);
    expect(second.store.nonElements).toHaveLength(2_001);
    expect(second.store).toStrictEqual(first.store);
  });
});

describe("parseModelCache", () => {
  const ROOT = "/work/copy";
  const CODE = "c0de";
  const snapshot = { path: "a.md", size: 10, mtimeMs: 1000, sha256: "ab" };
  const record = {
    id: ID_A,
    type: "t",
    repository: "system",
    file: "a.md",
    data: {},
    eol: "\n",
    closingEol: "",
    bom: false,
    snapshot,
  };
  const warning = { code: "file.yaml-warning", severity: "warning", message: "w" };
  const elementEntry = { kind: "element", element: record, warnings: [warning], snapshot };
  const valid = {
    format: MODEL_CACHE_FORMAT,
    code: CODE,
    root: ROOT,
    startedAt: 5000,
    repositories: [
      { name: "system", folder: "/work/copy", files: [["a.md", elementEntry, "7", "900000000"]] },
    ],
  };
  const parse = (value: unknown): ModelCache | undefined =>
    parseModelCache(JSON.stringify(value), ROOT, CODE);

  it("revives a valid cache with frozen snapshots shared with the element", () => {
    const cache = parse(valid);
    const entry = cache?.repositories.get("system")?.files.get("a.md");
    expect(cache?.startedAt).toBe(5000);
    expect(entry).toMatchObject({ ino: "7", ctimeNs: "900000000" });
    const contribution = entry?.contribution;
    expect(contribution?.snapshot).toEqual(snapshot);
    expect(Object.isFrozen(contribution?.snapshot)).toBe(true);
    expect(contribution?.kind === "element" ? contribution.element.snapshot : undefined).toBe(
      contribution?.snapshot,
    );
  });

  const withEntry = (entry: unknown): unknown => ({
    ...valid,
    repositories: [{ name: "system", folder: "/work/copy", files: [entry] }],
  });
  const withContribution = (change: Record<string, unknown>): unknown =>
    withEntry(["a.md", { ...elementEntry, ...change }, "7", "900000000"]);
  const withRecord = (change: Record<string, unknown>): unknown =>
    withContribution({ element: { ...record, ...change } });

  it.each([
    ["not an object", []],
    ["no format", { ...valid, format: undefined }],
    ["a start that is no number", { ...valid, startedAt: "now" }],
    ["repositories that are no list", { ...valid, repositories: {} }],
    ["a repository that is no object", { ...valid, repositories: [1] }],
    ["a repository without a name", { ...valid, repositories: [{ folder: "/f", files: [] }] }],
    ["a repository without a folder", { ...valid, repositories: [{ name: "system", files: [] }] }],
    ["a repository without files", { ...valid, repositories: [{ name: "system", folder: "/f" }] }],
    ["an entry of the old format", withEntry(["a.md", elementEntry])],
    ["an entry that is no list", withEntry({ file: "a.md" })],
    ["an entry without a file name", withEntry([1, elementEntry, "7", "900000000"])],
    ["an inode that is a number (format 2)", withEntry(["a.md", elementEntry, 7, "900000000"])],
    ["an inode that is no decimal", withEntry(["a.md", elementEntry, "0x7", "900000000"])],
    ["an inode with a sign", withEntry(["a.md", elementEntry, "-7", "900000000"])],
    ["an inode with a leading zero", withEntry(["a.md", elementEntry, "07", "900000000"])],
    ["a change time that is a number (format 2)", withEntry(["a.md", elementEntry, "7", 900])],
    ["a change time that is no whole number", withEntry(["a.md", elementEntry, "7", "900.5"])],
    ["a contribution that is no object", withEntry(["a.md", "element", "7", "900000000"])],
    ["an unknown kind", withContribution({ kind: "other" })],
    ["no snapshot", withContribution({ snapshot: undefined })],
    ["a snapshot of another file", withContribution({ snapshot: { ...snapshot, path: "b.md" } })],
    ["a size that is no number", withContribution({ snapshot: { ...snapshot, size: "10" } })],
    ["a time that is no number", withContribution({ snapshot: { ...snapshot, mtimeMs: null } })],
    ["a hash that is no text", withContribution({ snapshot: { ...snapshot, sha256: 1 } })],
    ["warnings that are no list", withContribution({ warnings: {} })],
    ["a warning that is no problem", withContribution({ warnings: [{ code: "x" }] })],
    ["an element that is no object", withContribution({ element: null })],
    ["an element of another file", withRecord({ file: "b.md" })],
    ["an element of another repository", withRecord({ repository: "other" })],
    ["an element without an id", withRecord({ id: 1 })],
    ["an element without a type", withRecord({ type: undefined })],
    ["an element without data", withRecord({ data: [] })],
    ["an element with an unknown line ending", withRecord({ eol: "\r" })],
    ["an element with an unknown closing line ending", withRecord({ closingEol: "\r" })],
    ["an element without a byte order mark flag", withRecord({ bom: "no" })],
    ["references that are no list", withRecord({ references: {} })],
    ["an empty list of references", withRecord({ references: [] })],
    ["a reference that is no object", withRecord({ references: [null] })],
    ["a reference without an id", withRecord({ references: [{ line: 3 }] })],
    ["a reference whose id is no UUID", withRecord({ references: [{ id: "SR-1", line: 3 }] })],
    ["a reference on line 0", withRecord({ references: [{ id: ID_A, line: 0 }] })],
    ["a reference on a line that is no whole number", withRecord({ references: [{ id: ID_A, line: 2.5 }] })],
    ["a reference without a line", withRecord({ references: [{ id: ID_A }] })],
    [
      "a reference with a version that is no text",
      withRecord({ references: [{ id: ID_A, line: 3, version: 1 }] }),
    ],
    [
      "a reference with a repository that is no text",
      withRecord({ references: [{ id: ID_A, line: 3, repository: null }] }),
    ],
    ["references of the text with a key", withRecord({ references: [{ id: ID_A, line: 3, key: "notes" }] })],
    ["property references that are no list", withRecord({ propertyReferences: {} })],
    ["an empty list of property references", withRecord({ propertyReferences: [] })],
    ["a property reference without a key", withRecord({ propertyReferences: [{ id: ID_A, line: 3 }] })],
    [
      "a property reference with an item that is no whole number",
      withRecord({ propertyReferences: [{ id: ID_A, line: 3, key: "notes", item: "1" }] }),
    ],
    [
      "a property reference with an item below 0",
      withRecord({ propertyReferences: [{ id: ID_A, line: 3, key: "notes", item: -1 }] }),
    ],
    ["unresolved links that are no list", withRecord({ unresolvedLinks: {} })],
    ["an empty list of unresolved links", withRecord({ unresolvedLinks: [] })],
    ["an unresolved link that is no object", withRecord({ unresolvedLinks: ["D-1"] })],
    ["an unresolved link with an empty target", withRecord({ unresolvedLinks: [{ target: "", line: 3 }] })],
    ["an unresolved link on line 0", withRecord({ unresolvedLinks: [{ target: "D-1", line: 0 }] })],
    [
      "an unresolved link on a line that is no whole number",
      withRecord({ unresolvedLinks: [{ target: "D-1", line: 1.5 }] }),
    ],
    ["an unresolved link without a line", withRecord({ unresolvedLinks: [{ target: "D-1" }] })],
    [
      "an unresolved link with a repository that is no text",
      withRecord({ unresolvedLinks: [{ target: "D-1", line: 3, repository: 1 }] }),
    ],
    [
      "an unresolved link with a key that is no text",
      withRecord({ unresolvedLinks: [{ target: "D-1", line: 3, key: 1 }] }),
    ],
    [
      "an unresolved link with an item but no key",
      withRecord({ unresolvedLinks: [{ target: "D-1", line: 3, item: 0 }] }),
    ],
    [
      "an unresolved link with an item below 0",
      withRecord({ unresolvedLinks: [{ target: "D-1", line: 3, key: "notes", item: -1 }] }),
    ],
    [
      "an unresolved link with an item that is no whole number",
      withRecord({ unresolvedLinks: [{ target: "D-1", line: 3, key: "notes", item: "1" }] }),
    ],
    ["bare references that are no list", withRecord({ bareReferences: {} })],
    ["an empty list of bare references", withRecord({ bareReferences: [] })],
    ["a bare reference that is no object", withRecord({ bareReferences: ["N-1"] })],
    ["a bare reference with an empty target", withRecord({ bareReferences: [{ target: "", line: 3 }] })],
    ["a bare reference on line 0", withRecord({ bareReferences: [{ target: "N-1", line: 0 }] })],
    [
      "a bare reference on a line that is no whole number",
      withRecord({ bareReferences: [{ target: "N-1", line: 1.5 }] }),
    ],
    ["a bare reference without a line", withRecord({ bareReferences: [{ target: "N-1" }] })],
    ["a file that is no element, of another file", withContribution({ kind: "not-element", file: "b.md" })],
    ["a problem that is none", withContribution({ kind: "problem", problem: { message: "m" } })],
  ])("discards a cache with %s", (_case, value) => {
    expect(parse(value)).toBeUndefined();
  });

  it.each([
    ["a file that is no element", { kind: "not-element", file: "a.md", warnings: [], snapshot }],
    ["a problem", { kind: "problem", problem: { ...warning, severity: "error" }, warnings: [], snapshot }],
    ["an element with CRLF", { ...elementEntry, element: { ...record, eol: "\r\n", closingEol: "\r\n" } }],
    [
      "an element with inline references (#240)",
      {
        ...elementEntry,
        element: {
          ...record,
          references: [
            { id: ID_A, line: 4 },
            { id: ID_A, version: "n1:0000000000000000", repository: "sensor", line: 5 },
          ],
        },
      },
    ],
    [
      "an element with references in Markdown properties (SR-127)",
      {
        ...elementEntry,
        element: {
          ...record,
          propertyReferences: [
            { id: ID_A, line: 4, key: "rationale" },
            {
              id: ID_A,
              version: "n1:0000000000000000",
              repository: "sensor",
              line: 6,
              key: "acceptance-criteria",
              item: 1,
            },
          ],
        },
      },
    ],
    [
      "an element with links whose target is no UUID (#176)",
      {
        ...elementEntry,
        element: {
          ...record,
          unresolvedLinks: [
            { target: "D-031", repository: "sensor", line: 4, key: "rationale" },
            { target: "D-030", line: 5, key: "acceptance-criteria", item: 0 },
            { target: "SR-1", line: 9 },
          ],
        },
      },
    ],
    [
      "an element with references outside links (#633)",
      { ...elementEntry, element: { ...record, bareReferences: [{ target: "N-6010df", line: 7 }] } },
    ],
  ])("takes %s as it is", (_case, contribution) => {
    expect(
      parse(withEntry(["a.md", contribution, "7", "900000000"]))
        ?.repositories.get("system")
        ?.files.get("a.md"),
    ).toEqual({
      contribution,
      ino: "7",
      ctimeNs: "900000000",
    });
  });

  it("keeps an inode as unsigned and leaves out a change time before 1970", () => {
    // Node gives an inode of 2 ** 63 or more as a negative bigint.
    expect(inoKey(-1n)).toBe("18446744073709551615");
    expect(inoKey(-(2n ** 63n))).toBe("9223372036854775808");
    expect(inoKey(7n)).toBe("7");
    expect(statKeys({ ino: -1n, ctimeNs: 5n })).toEqual(["18446744073709551615", "5"]);
    expect(statKeys({ ino: 7n, ctimeNs: 0n })).toEqual(["7", "0"]);
    expect(statKeys({ ino: 7n, ctimeNs: -1n })).toBeUndefined();
  });

  it("stamps a file for a reader that keeps it, and not while a change could go unseen", () => {
    const ns = (ms: number): bigint => BigInt(ms) * 1_000_000n;
    const readAt = 1_761_400_000_000;
    const old = { size: 10n, mtimeNs: ns(readAt - 5_000), ino: -1n, ctimeNs: ns(readAt - 4_000) };
    expect(changeStamp(old, readAt)).toBe(
      `10:${String(ns(readAt - 5_000))}:18446744073709551615:${String(ns(readAt - 4_000))}`,
    );
    // The later of modification and change time counts; a change time before 1970 is never stamped.
    expect(changeStamp({ ...old, ctimeNs: ns(readAt - RACY_MS) }, readAt)).toBeUndefined();
    expect(changeStamp({ ...old, mtimeNs: ns(readAt + 60_000) }, readAt)).toBeUndefined();
    expect(changeStamp({ ...old, ctimeNs: -1n }, readAt)).toBeUndefined();
  });

  it("keeps a 64-bit file ID and a change time in nanoseconds exactly", () => {
    // Both differ from their neighbours only in bits a JS number above 2 ** 53 loses.
    const [ino, ctimeNs] = statKeys({ ino: -1n, ctimeNs: 1761400000123456789n }) ?? [];
    expect(Number(ino)).toBe(Number("18446744073709551614"));
    const entry = parse(withEntry(["a.md", elementEntry, ino, ctimeNs]))
      ?.repositories.get("system")
      ?.files.get("a.md");
    expect(entry).toMatchObject({ ino, ctimeNs });
    expect(parse(withEntry(["a.md", elementEntry, "0", "0"]))?.repositories.get("system")?.files.size).toBe(
      1,
    );
  });

  it("[SR-127/AK3] discards a cache of format 4, whose records know no references in properties", () => {
    expect(MODEL_CACHE_FORMAT).toBeGreaterThan(4);
    expect(parse({ ...valid, format: 4 })).toBeUndefined();
  });

  it("discards a cache of format 5, whose records know no links whose target is no UUID (#176)", () => {
    expect(MODEL_CACHE_FORMAT).toBeGreaterThan(5);
    expect(parse({ ...valid, format: 5 })).toBeUndefined();
  });

  it("discards a cache of format 6, whose records know no references outside links (#633)", () => {
    expect(MODEL_CACHE_FORMAT).toBe(7);
    expect(parse({ ...valid, format: 6 })).toBeUndefined();
  });

  it("discards a cache of format 2, with inodes and change times as numbers", () => {
    expect(
      parse({
        ...valid,
        format: 2,
        repositories: [{ name: "system", folder: "/work/copy", files: [["a.md", elementEntry, 7, 900]] }],
      }),
    ).toBeUndefined();
  });
});

describe("serializeModelCache", () => {
  it("writes what parseModelCache reads back, leaving out files changed or gone since the read", async () => {
    const ws = await fixture();
    const store = await fullRead(ws.root);
    const startedAt = settled();
    const text = serializeModelCache("/r", store, startedAt, "code");
    const cache = parseModelCache(text, "/r", "code");
    expect(cache?.startedAt).toBe(startedAt);
    expect([...(cache?.repositories.get("system")?.files.values() ?? [])].map((e) => e.contribution)).toEqual(
      [...(store.repositories[0]?.files.values() ?? [])].filter((c) => c.snapshot !== undefined),
    );
    expect(parseModelCache(serializeModelCache("/r", store, startedAt), "/r")).toBeDefined();
    // The inode (unsigned) and the change time as decimal strings of `lstat` with `bigint`.
    const stat = await fs.lstat(ws.path("requirements/a.md"), { bigint: true });
    expect(cache?.repositories.get("system")?.files.get("requirements/a.md")).toMatchObject({
      ino: inoKey(stat.ino),
      ctimeNs: String(stat.ctimeNs),
    });
    await ws.write("requirements/a.md", element(ID_A, "Alpha changed"));
    await fs.rm(ws.path("requirements/b.md"));
    const later = parseModelCache(serializeModelCache("/r", store, startedAt, "code"), "/r", "code");
    expect([...(later?.repositories.get("system")?.files.keys() ?? [])]).toEqual([
      "notes/invalid.md",
      "notes/plain.md",
      "requirements/c.md",
    ]);
  });

  it("leaves out entries whose values are not plain JSON or throw while they are checked", async () => {
    const ws = await fixture();
    const store = await fullRead(ws.root);
    // A test may change the map of a store it read itself.
    const files = store.repositories[0]?.files as Map<string, Contribution> | undefined;
    const plain = files?.get("notes/plain.md");
    if (files === undefined || plain === undefined) {
      throw new Error("the fixture has no notes/plain.md");
    }
    class Items extends Array<number> {}
    const throwing = {};
    Object.defineProperty(throwing, "value", {
      enumerable: true,
      get: () => {
        throw new Error("no value");
      },
    });
    const kept = (extra: unknown): boolean => {
      files.set("notes/plain.md", Object.assign({}, plain, { extra }));
      const cache = parseModelCache(serializeModelCache("/r", store, settled(), "code"), "/r", "code");
      return cache?.repositories.get("system")?.files.has("notes/plain.md") === true;
    };
    expect(kept({ items: [1, 2] })).toBe(true);
    const sparse = [1];
    sparse[2] = 3;
    expect(kept(sparse)).toBe(false);
    expect(kept(Items.from([1, 2]))).toBe(false);
    expect(kept(throwing)).toBe(false);
  });
});

describe("codeFingerprint", () => {
  /** A folder `<temp>/code` with a module, a test, a declaration, an installed package and other files. */
  const codeFolder = async (): Promise<string> => {
    const folder = path.join(await tempFolder(), "code");
    await fs.mkdir(path.join(folder, "model"), { recursive: true });
    await fs.writeFile(path.join(folder, "model", "a.js"), "export const a = 1;\n");
    await fs.writeFile(path.join(folder, "model", "a.test.js"), "test\n");
    await fs.writeFile(path.join(folder, "model", "a.d.ts"), "export declare const a: number;\n");
    await fs.writeFile(path.join(folder, "notes.txt"), "not code\n");
    await fs.mkdir(path.join(folder, "node_modules", "x"), { recursive: true });
    await fs.writeFile(path.join(folder, "node_modules", "x", "index.js"), "installed\n");
    await fs.mkdir(path.join(folder, "folder.json"));
    return folder;
  };

  it("hashes the code files, the dependencies of the package and nothing else", async () => {
    const folder = await codeFolder();
    const fingerprint = computeCodeFingerprint(folder);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    for (const [file, text] of [
      ["model/a.test.js", "other\n"],
      ["model/a.d.ts", "other\n"],
      ["notes.txt", "other\n"],
      ["node_modules/x/index.js", "other\n"],
      [FINGERPRINT_FILE, "{}\n"],
      [".tsbuildinfo", "other\n"],
    ] as const) {
      await fs.writeFile(path.join(folder, file), text);
      expect(computeCodeFingerprint(folder), file).toBe(fingerprint);
    }
    await fs.writeFile(path.join(folder, "model", "a.js"), "export const a = 2;\n");
    const changed = computeCodeFingerprint(folder);
    expect(changed).not.toBe(fingerprint);
    await fs.writeFile(path.join(folder, "..", "package.json"), JSON.stringify({ name: "p" }));
    expect(computeCodeFingerprint(folder)).toBe(changed);
    await fs.writeFile(
      path.join(folder, "..", "package.json"),
      JSON.stringify({ dependencies: { yaml: "9" } }),
    );
    expect(computeCodeFingerprint(folder)).not.toBe(changed);
  });

  it("takes the fingerprint the build wrote while the build information is the one it names", async () => {
    const built = await codeFolder();
    await fs.writeFile(path.join(built, ".tsbuildinfo"), "build 1\n");
    await fs.writeFile(path.join(built, FINGERPRINT_FILE), fingerprintFile(built));
    expect(codeFingerprint(built)).toBe(computeCodeFingerprint(built));
    const packaged = await codeFolder();
    await fs.writeFile(
      path.join(packaged, FINGERPRINT_FILE),
      JSON.stringify({ fingerprint: "from the build" }),
    );
    expect(codeFingerprint(packaged)).toBe("from the build");
    // Kept for the process: a change of the code needs a new process anyway.
    await fs.writeFile(path.join(packaged, FINGERPRINT_FILE), JSON.stringify({ fingerprint: "other" }));
    expect(codeFingerprint(packaged)).toBe("from the build");
    expect(codeFingerprint()).toBe(codeFingerprint());
  });

  it.each([
    ["the build information changed since", { fingerprint: "old", buildInfo: "0" }],
    ["no fingerprint text", { fingerprint: 1 }],
    ["no JSON", "{ no"],
  ])("computes the fingerprint when the build's file has %s", async (_case, content) => {
    const folder = await codeFolder();
    await fs.writeFile(path.join(folder, ".tsbuildinfo"), "build 2\n");
    await fs.writeFile(
      path.join(folder, FINGERPRINT_FILE),
      typeof content === "string" ? content : JSON.stringify(content),
    );
    expect(codeFingerprint(folder)).toBe(computeCodeFingerprint(folder));
  });
});

describe("warmModel", () => {
  it("loads the store and the short IDs and builds the incoming index ahead of the first command", async () => {
    const ws = await fixture();
    const workspace = new Workspace(ws.root);
    onTestFinished(() => workspace.close());
    await warmModel(workspace);
    const store = await workspace.peek(elementStoreState);
    if (store === undefined) {
      throw new Error("warmModel did not load the store");
    }
    expect((await workspace.peek(shortIdState))?.tail(ID_A)).toBe("3f4a5b");
    // The first chain after a start finds the index ready (SR-082 AK4, #227).
    expect(workspace.peek(incomingState)?.get(store)?.store).toBe(store);
  });

  it("never rejects, also for a workspace that is closed or cannot be read", async () => {
    const empty = await tempFolder();
    const broken = new Workspace(empty);
    onTestFinished(() => broken.close());
    await expect(warmModel(broken)).resolves.toBeUndefined();
    const closed = new Workspace(empty);
    await closed.close();
    await expect(warmModel(closed)).resolves.toBeUndefined();
  });
});
