// The rules of the state files and the dirty check of a repository (SR-062 K2, model/uncommitted.ts):
// each rule without files, Git's blob hash against `git hash-object` (SHA-1 and SHA-256), and the
// branches of `repositoryState` and of `uncommittedFiles` (the check on a given set of files, as
// `baseline.create` asks it, SR-050 AK2) through its reader seam. The command: commands/data/store.test.ts.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { createFixtureWorkspace } from "@reqseq/testkit";
import type { FixtureWorkspace } from "@reqseq/testkit";
import { describe, expect, it, onTestFinished } from "vitest";
import type { WorkspaceLayout } from "../workspace/index.js";
import type { StateReader, StateRules } from "./uncommitted.js";
import {
  DEFAULT_STATE_READER,
  gitBlobId,
  isStateFile,
  repositoryState,
  stateFiles,
  stateRules,
  uncommittedFiles,
  uncommittedStateFiles,
  workingBlobId,
} from "./uncommitted.js";

const fixture = async (options: Parameters<typeof createFixtureWorkspace>[0]): Promise<FixtureWorkspace> => {
  const created = await createFixtureWorkspace(options);
  onTestFinished(() => created.cleanup());
  return created;
};

// Absolute folders as the layout gives them, in the spelling of the system (`D:\w\system` on Windows).
const repository = (name: string, main: boolean, excludes: readonly string[] = []) => ({
  name,
  folder: path.resolve("/w", name),
  main,
  excludes,
});

/** A layout with the metamodel in `model`, filters in `system`, baselines by default, evidence in both. */
const layout = {
  main: "system",
  metamodel: { repository: "model", path: "meta/" },
  file: {
    "reqseq-workspace": 1,
    name: "W",
    repositories: [{ name: "system", url: "u", main: true }],
    filters: { repository: "system", path: "./saved" },
    evidence: [
      { repository: "system", path: "evidence" },
      { repository: "model", path: "." },
      { repository: "system", path: "../outside" },
    ],
    ignore: ["build/**"],
  },
} as unknown as Pick<WorkspaceLayout, "file" | "main" | "metamodel">;

describe("stateRules and isStateFile (K2)", () => {
  const system = stateRules(
    layout,
    repository("system", true, [path.resolve("/w/system/sensor")]),
    new Set(["img/Ä.png"]),
  );
  const model = stateRules(layout, repository("model", false), new Set());

  it("finds the YAML and evidence folders of each repository; a location that leaves it does not count", () => {
    expect([system.yamlFolders, system.evidenceFolders]).toEqual([["saved", "baselines"], ["evidence"]]);
    expect([model.yamlFolders, model.evidenceFolders]).toEqual([["meta"], [""]]);
  });

  it("counts the workspace file of the main repository only", () => {
    expect(isStateFile(system, "reqseq-workspace.yaml")).toBe(true);
    expect(isStateFile(model, "reqseq-workspace.yaml")).toBe(false);
  });

  it("counts YAML files directly in the YAML folders, nothing else there", () => {
    expect(
      ["saved/a.yaml", "baselines/b.YML", "saved/sub/c.yaml", "saved/d.json"].map((f) =>
        isStateFile(system, f),
      ),
    ).toEqual([true, true, false, false]);
    expect(isStateFile(model, "meta/m.yaml")).toBe(true);
    expect(isStateFile(system, "meta/m.yaml")).toBe(false);
  });

  it("counts embedded files in NFC and Markdown files the walk reads outside evidence folders", () => {
    expect(isStateFile(system, "img/Ä.png".normalize("NFD"))).toBe(true);
    expect(isStateFile(system, "img/other.png")).toBe(false);
    expect(
      [
        "README.md",
        "a/b.md",
        "evidence/r.md",
        "build/x.md",
        "a/node_modules/x.md",
        ".git/x.md",
        "sensor/x.md",
        "a/sensor/x.md",
        "x.MD",
      ].map((f) => isStateFile(system, f)),
    ).toEqual([true, true, false, false, false, false, false, true, false]);
    expect(isStateFile(model, "any.md")).toBe(false);
  });

  it("lists the state files ReqSeq knows of, each once", () => {
    expect(stateFiles(system, ["a/b.md", "a/b.md"], ["saved/a.yaml", "saved/notes.txt"])).toEqual([
      "reqseq-workspace.yaml",
      "saved/a.yaml",
      "a/b.md",
      "img/Ä.png",
    ]);
    expect(stateFiles(model, [], [])).toEqual([]);
    expect(uncommittedStateFiles(system, ["src/a.ts", "a/b.md", "evidence/r.md"])).toEqual(["a/b.md"]);
  });
});

describe("gitBlobId", () => {
  it("is the ID git hash-object gives, for SHA-1 and from a stream", async () => {
    const ws = await fixture({ files: { "a.txt": "hello\n" }, git: true });
    const expected = (await ws.git(["hash-object", "a.txt"])).trim();
    const bytes = Buffer.from("hello\n");
    expect(await gitBlobId(bytes, bytes.length, 40)).toBe(expected);
    expect(await gitBlobId(Readable.from([bytes.subarray(0, 2), bytes.subarray(2)]), bytes.length, 40)).toBe(
      expected,
    );
    expect(await DEFAULT_STATE_READER.blobId(ws.path("a.txt"), 40)).toBe(expected);
    expect(await DEFAULT_STATE_READER.blobId(ws.path("missing.txt"), 40)).toBeUndefined();
    expect(await DEFAULT_STATE_READER.blobId(ws.path("."), 40)).toBeUndefined();
  });

  it("is the ID git gives in a SHA-256 repository", async (context) => {
    const ws = await fixture({ files: { "a.txt": "hello\n" } });
    try {
      await ws.git(["init", "-q", "--object-format=sha256"]);
    } catch {
      // A git before 2.29 has no SHA-256 repositories.
      context.skip();
    }
    const expected = (await ws.git(["hash-object", "a.txt"])).trim();
    expect(expected).toHaveLength(64);
    expect(await DEFAULT_STATE_READER.blobId(ws.path("a.txt"), 64)).toBe(expected);
    const commit = await ws.commit();
    const rules = stateRules(
      { main: "w", metamodel: { repository: "w", path: "m" }, file: { ignore: [] } } as unknown as Pick<
        WorkspaceLayout,
        "file" | "main" | "metamodel"
      >,
      { name: "w", folder: ws.root, main: false, excludes: [] },
      new Set(["a.txt"]),
    );
    expect(await repositoryState(rules, [])).toEqual({ commit, dirty: false });
    await ws.write("a.txt", "changed\n");
    expect(await repositoryState(rules, [])).toEqual({ commit, dirty: true });
  });
});

/** Permissions do not stop root, and Windows has none of this kind. */
const NO_PERMISSIONS = process.platform === "win32" || process.getuid?.() === 0;

describe("the working blob ID of a file that cannot be read", () => {
  it.skipIf(NO_PERMISSIONS)("is none: the file counts as changed", async () => {
    const ws = await fixture({ files: { "a.txt": "hello\n" } });
    fs.chmodSync(ws.path("a.txt"), 0o000);
    expect(await DEFAULT_STATE_READER.blobId(ws.path("a.txt"), 40)).toBeUndefined();
  });

  it("is none when reading fails after lstat, also as root", async () => {
    const ws = await fixture({ files: { "a.txt": "hello\n" } });
    const failing = workingBlobId(
      () =>
        new Readable({
          read() {
            this.destroy(new Error("EIO"));
          },
        }),
    );
    expect(await failing(ws.path("a.txt"), 40)).toBeUndefined();
  });
});

describe("repositoryState", () => {
  /** One Git repository with one embedded file and one element file. */
  const repo = async (): Promise<{ ws: FixtureWorkspace; rules: StateRules; commit: string }> => {
    const ws = await fixture({ files: { "a.md": "# A\n", "img.png": "png" }, git: true });
    const rules = stateRules(
      { main: "w", metamodel: { repository: "w", path: "m" }, file: { ignore: [] } } as unknown as Pick<
        WorkspaceLayout,
        "file" | "main" | "metamodel"
      >,
      { name: "w", folder: ws.root, main: false, excludes: [] },
      new Set(["img.png"]),
    );
    return { ws, rules, commit: await ws.head() };
  };

  it("is clean for an embedded file that is neither in the commit nor on disk, and dirty once it is on disk", async () => {
    const { ws, commit } = await repo();
    const rules = stateRules(
      { main: "w", metamodel: { repository: "w", path: "m" }, file: { ignore: [] } } as unknown as Pick<
        WorkspaceLayout,
        "file" | "main" | "metamodel"
      >,
      { name: "w", folder: ws.root, main: false, excludes: [] },
      new Set(["img.png", "gone.png"]),
    );
    expect(await repositoryState(rules, ["a.md"])).toEqual({ commit, dirty: false });
    const asked: string[] = [];
    const seen: StateReader = {
      ...DEFAULT_STATE_READER,
      exists: (absolute) => {
        asked.push(absolute);
        return Promise.resolve(false);
      },
    };
    expect(await repositoryState(rules, ["a.md"], seen)).toEqual({ commit, dirty: false });
    expect(asked).toEqual([ws.path("gone.png")]);
    await ws.write("gone.png", "png");
    expect(await repositoryState(rules, ["a.md"])).toEqual({ commit, dirty: true });
  });

  it("is clean, and dirty for a path git cannot take or a working file in no spelling", async () => {
    const { ws, rules, commit } = await repo();
    expect(await repositoryState(rules, ["a.md"])).toEqual({ commit, dirty: false });
    expect(await repositoryState(rules, ["a.md", " b.md"])).toEqual({ commit, dirty: true });
    const missing: StateReader = {
      ...DEFAULT_STATE_READER,
      changedPaths: () => Promise.resolve({ known: true, paths: ["a.md"] }),
      blobId: () => Promise.resolve(undefined),
    };
    expect(await repositoryState(rules, ["a.md"], missing)).toEqual({ commit, dirty: true });
    await ws.write("new.md", "# New\n");
    expect(await repositoryState(rules, ["a.md"])).toEqual({ commit, dirty: true });
  });

  it("counts a new YAML file of a metamodel in the repository folder itself", async () => {
    const ws = await fixture({ files: { "model.yaml": "reqseq-metamodel: 1\n" }, git: true });
    const rules = stateRules(
      { main: "w", metamodel: { repository: "w", path: "." }, file: {} } as unknown as Pick<
        WorkspaceLayout,
        "file" | "main" | "metamodel"
      >,
      { name: "w", folder: ws.root, main: false, excludes: [] },
      new Set(),
    );
    const commit = await ws.head();
    expect(await repositoryState(rules, [])).toEqual({ commit, dirty: false });
    await ws.write("more.yml", "x: 1\n");
    await ws.git(["init", "-q"]);
    await ws.write(".gitignore", "more.yml\n");
    expect(await repositoryState(rules, [])).toEqual({ commit, dirty: true });
  });

  it("has no commit outside a repository and leaves dirty out where Git cannot tell", async () => {
    const plain = await fixture({ files: { "a.md": "# A\n" } });
    const rules = stateRules(
      { main: "w", metamodel: { repository: "w", path: "m" }, file: {} } as unknown as Pick<
        WorkspaceLayout,
        "file" | "main" | "metamodel"
      >,
      { name: "w", folder: plain.root, main: false, excludes: [] },
      new Set(),
    );
    expect(await repositoryState(rules, ["a.md"])).toEqual({ unknown: "not-a-repository" });
    const { rules: inRepo, commit } = await repo();
    const unknownObjects: StateReader = {
      ...DEFAULT_STATE_READER,
      objects: () => Promise.resolve({ known: false, reason: "timeout", detail: "slow" }),
    };
    expect(await repositoryState(inRepo, ["a.md"], unknownObjects)).toEqual({
      commit,
      dirtyUnknown: "timeout",
    });
  });
});

describe("uncommittedFiles", () => {
  it("names the changed files of a given set: edited, never committed, embedded; not a touched but equal file or one outside the set", async () => {
    const ws = await fixture({
      files: { "a.md": "# A\n", "b.md": "# B\n", "img.png": "png", "m/model.yaml": "x: 1\n" },
      git: true,
    });
    const commit = await ws.head();
    const files = ["a.md", "img.png", "new.md", "m/model.yaml"];
    const counts = (file: string): boolean => files.includes(file) || file.startsWith("m/");
    expect(await uncommittedFiles(ws.root, commit, files, counts)).toEqual({ known: true, files: [] });
    await ws.write("a.md", "# A\n");
    await ws.write("b.md", "# B changed\n");
    expect(await uncommittedFiles(ws.root, commit, files, counts)).toEqual({ known: true, files: [] });
    await ws.write("img.png", "changed");
    await ws.write("new.md", "# New\n");
    await fs.promises.rm(ws.path("m/model.yaml"));
    await ws.write("m/more.yaml", "y: 2\n");
    const found = await uncommittedFiles(ws.root, commit, [...files, " odd.md"], counts);
    expect(found.known && [...found.files].sort()).toEqual([
      " odd.md",
      "img.png",
      "m/model.yaml",
      "m/more.yaml",
      "new.md",
    ]);
  });

  it("says when Git cannot tell", async () => {
    const ws = await fixture({ files: { "a.md": "# A\n" }, git: true });
    const commit = await ws.head();
    const none = (): boolean => false;
    const unknownPaths: StateReader = {
      ...DEFAULT_STATE_READER,
      changedPaths: () => Promise.resolve({ known: false, reason: "no-git", detail: "x" }),
    };
    expect(await uncommittedFiles(ws.root, commit, ["a.md"], none, unknownPaths)).toEqual({
      known: false,
      reason: "no-git",
    });
  });
});
