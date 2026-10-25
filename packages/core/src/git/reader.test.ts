import { createFixtureWorkspace } from "@logreq/testkit";
import type { FixtureWorkspace, MadeCommit } from "@logreq/testkit";
import type * as ChildProcess from "node:child_process";
import type { ExecFileOptions, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import * as reader from "./reader.js";
import type { ObjectInfos, ObjectReader } from "./reader.js";
import {
  changedPaths,
  fileHistory,
  headCommit,
  headFiles,
  openObjectReader,
  resolveCommit,
} from "./reader.js";

interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: ExecFileOptions | SpawnOptions;
}

type Callback = (error: Error | null, stdout: string | Buffer, stderr: string | Buffer) => void;

/** A canned answer instead of running git: an error or stdout. */
type Fake = { readonly error: Error } | { readonly stdout: string };

/** A canned `cat-file` process: what it prints once it read its first input, and how it ends. */
interface FakeProcess {
  readonly output?: readonly (string | Buffer)[];
  readonly errors?: string;
  /** Exit code after the output; left out, it runs until it is killed. */
  readonly code?: number;
  /** An error instead of a start (a missing program). */
  readonly error?: Error;
}

// Records the calls of the reader (not those of the testkit) and passes them on to the real
// execFile and spawn, unless a test sets a fake answer (fake git output, timeouts, a missing
// program, an old git).
const mock = vi.hoisted(() => ({
  calls: [] as Call[],
  fake: undefined as Fake | ((args: readonly string[]) => Fake | undefined) | undefined,
  process: undefined as ((args: readonly string[]) => FakeProcess | undefined) | undefined,
  dropped: [] as string[],
}));

/** A child process that plays `run`. */
const fakeChild = (run: FakeProcess): EventEmitter => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let closed = false;
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr,
    kill: (): boolean => {
      close(null);
      return true;
    },
  });
  const close = (code: number | null): void => {
    if (!closed) {
      closed = true;
      stdout.end();
      stderr.end();
      // After the output is read.
      setImmediate(() => child.emit("close", code));
    }
  };
  if (run.error !== undefined) {
    const error = run.error;
    setImmediate(() => {
      child.emit("error", error);
      close(-2);
    });
    return child;
  }
  stdin.once("data", () => {
    // The reader may stop it after any piece it read.
    for (const chunk of run.output ?? []) {
      if (!closed) {
        stdout.write(chunk);
      }
    }
    if (!closed) {
      stderr.write(run.errors ?? "");
    }
    if (run.code !== undefined) {
      close(run.code);
    }
  });
  return child;
};

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof ChildProcess>();
  const { promisify } = await import("node:util");
  const execFile = (
    file: string,
    args: readonly string[],
    options: ExecFileOptions,
    callback: Callback,
  ): unknown => {
    if (args[0] !== "--no-pager") {
      return original.execFile(file, args, options, callback);
    }
    mock.calls.push({ file, args, options });
    const fake = typeof mock.fake === "function" ? mock.fake(args) : mock.fake;
    if (fake === undefined) {
      return original.execFile(file, args, options, callback);
    }
    queueMicrotask(() => {
      if ("error" in fake) {
        callback(fake.error, Buffer.alloc(0), "");
      } else {
        callback(null, Buffer.from(fake.stdout), "");
      }
    });
    // No standard input: the reader writes to it only when there is one.
    return { stdin: null };
  };
  const spawn = (file: string, args: readonly string[], options: SpawnOptions): unknown => {
    if (args[0] !== "--no-pager") {
      return original.spawn(file, args, options);
    }
    mock.calls.push({ file, args, options });
    const fake = mock.process?.(args);
    if (fake !== undefined) {
      return fakeChild(fake);
    }
    // A test can take a variable away that the reader sets, to check what the rest still holds off.
    const env = Object.fromEntries(
      Object.entries(options.env ?? {}).filter(([k]) => !mock.dropped.includes(k)),
    );
    return original.spawn(file, args, { ...options, env });
  };
  // The testkit uses promisify(execFile): keep the real promisified form for it.
  return {
    ...original,
    execFile: Object.assign(execFile, { [promisify.custom]: promisify(original.execFile) }),
    spawn,
  };
});

const fixture = async (git?: readonly string[]): Promise<FixtureWorkspace> => {
  const ws = await createFixtureWorkspace({
    files: { "repo/a.md": "a\n", "plain/b.md": "b\n" },
    ...(git ? { git } : {}),
  });
  onTestFinished(() => ws.cleanup());
  return ws;
};

const execError = (message: string, props: Record<string, unknown>): Error =>
  Object.assign(new Error(message), props);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  mock.calls.length = 0;
  mock.fake = undefined;
  mock.process = undefined;
  mock.dropped = [];
});

/** The options before every command (ADR-0006). */
const FIXED = ["--no-pager", "-c", "core.fsmonitor=false", "-c", "protocol.allow=never"];

describe("git reader", () => {
  it("exports only typed functions and checks, no way to run another subcommand or argument", () => {
    expect(Object.keys(reader).sort()).toEqual([
      "changedPaths",
      "fileHistory",
      "headCommit",
      "headFiles",
      "isGitPath",
      "isRevision",
      "openObjectReader",
      "resolveCommit",
    ]);
  });

  it("reads the HEAD commit of a repository", async () => {
    const ws = await fixture(["repo"]);
    expect(await headCommit(ws.path("repo"))).toEqual({
      known: true,
      commit: await ws.head("repo"),
      shallow: false,
    });
  });

  it("tells a shallow clone", async () => {
    const ws = await fixture(["repo"]);
    await ws.git(["clone", "--quiet", "--depth", "1", pathToFileURL(ws.path("repo")).href, "shallow"]);
    expect(await headCommit(ws.path("shallow"))).toEqual({
      known: true,
      commit: await ws.head("repo"),
      shallow: true,
    });
    expect(await headFiles(ws.path("shallow"))).toMatchObject({
      commit: await ws.head("repo"),
      shallow: true,
    });
  });

  it("knows no commit for a folder that is not a repository", async () => {
    const ws = await fixture(["repo"]);
    expect(await headCommit(ws.path("plain"))).toMatchObject({ known: false, reason: "not-a-repository" });
  });

  it("knows no commit for a subfolder of a repository", async () => {
    const ws = await fixture(["."]);
    expect(await headCommit(ws.path("repo"))).toEqual({
      known: false,
      reason: "not-a-repository",
      detail: "not the top level of a repository",
    });
    expect(await headCommit(ws.root)).toEqual({ known: true, commit: await ws.head(), shallow: false });
  });

  it("knows no commit for a repository without commits", async () => {
    const ws = await fixture();
    await ws.git(["init", "--quiet"], "plain");
    expect(await headCommit(ws.path("plain"))).toMatchObject({ known: false, reason: "not-a-repository" });
  });

  it("knows no commit when git prints a top level that does not exist", async () => {
    const ws = await fixture(["repo"]);
    mock.fake = { stdout: `${ws.path("gone")}\n${"a".repeat(40)}\n` };
    expect(await headCommit(ws.path("repo"))).toMatchObject({ known: false, reason: "not-a-repository" });
  });

  it("knows no commit when the git program is missing", async () => {
    const ws = await fixture();
    mock.fake = { error: execError("spawn git ENOENT", { code: "ENOENT" }) };
    expect(await headCommit(ws.path("repo"))).toEqual({
      known: false,
      reason: "no-git",
      detail: "spawn git ENOENT",
    });
  });

  it("knows no commit when git times out or is stopped, and tells too much output apart", async () => {
    const ws = await fixture(["repo"]);
    mock.fake = { error: execError("Command failed", { killed: true, signal: "SIGKILL" }) };
    expect(await headCommit(ws.path("repo"))).toMatchObject({ known: false, reason: "timeout" });
    mock.fake = {
      error: execError("stdout maxBuffer length exceeded", {
        killed: true,
        code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      }),
    };
    expect(await headCommit(ws.path("repo"))).toMatchObject({ known: false, reason: "not-a-repository" });
    mock.fake = undefined;
    expect(await headCommit(ws.path("repo"), { signal: AbortSignal.abort() })).toMatchObject({
      known: false,
      reason: "timeout",
    });
  });

  it("tells when git refuses a repository owned by someone else", async () => {
    const ws = await fixture();
    mock.fake = {
      error: execError("fatal: detected dubious ownership in repository at '/x'", { code: 128 }),
    };
    expect(await headCommit(ws.path("repo"))).toMatchObject({ known: false, reason: "refused" });
  });

  it("is not redirected by inherited repository variables", async () => {
    const ws = await fixture(["repo", "plain"]);
    vi.stubEnv("GIT_DIR", ws.path("plain/.git"));
    expect(await headCommit(ws.path("repo"))).toMatchObject({ known: true, commit: await ws.head("repo") });
  });

  it("runs git with the fixed command line, environment and time limit of ADR-0006", async () => {
    const ws = await fixture(["repo"]);
    vi.stubEnv("GIT_OPTIONAL_LOCKS", "1");
    vi.stubEnv("GIT_TERMINAL_PROMPT", "1");
    await headCommit(ws.path("repo"));
    expect(mock.calls).toHaveLength(1);
    const [call] = mock.calls;
    expect(call?.file).toBe("git");
    expect(call?.args).toEqual([
      ...FIXED,
      "rev-parse",
      "--show-toplevel",
      "--is-shallow-repository",
      "--verify",
      "HEAD",
    ]);
    expect(call?.options).toMatchObject({ timeout: 10_000, killSignal: "SIGKILL", cwd: ws.path("repo") });
    expect(call?.options.env).toMatchObject({
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_LITERAL_PATHSPECS: "1",
      GIT_NO_LAZY_FETCH: "1",
    });
  });
});

describe("HEAD from the files of the Git folder", () => {
  /** A repository `repo` with two commits on `main`, checked out, and `side` at the first. */
  const repository = async (): Promise<{ ws: FixtureWorkspace; first: string; second: string }> => {
    const ws = await fixture(["repo"]);
    const made = await ws.commitHistory(
      [
        { name: "first", parents: [await ws.head("repo")], files: { "a.md": "1\n" } },
        { name: "second", files: { "a.md": "2\n" } },
      ],
      { repository: "repo", branch: "main" },
    );
    await ws.git(["branch", "side", String(made["first"]?.id)], "repo");
    return { ws, first: String(made["first"]?.id), second: String(made["second"]?.id) };
  };
  const git = (ws: FixtureWorkspace, file: string): string => ws.path(`repo/.git/${file}`);

  it("names the commit of the branch file, then of packed-refs, and of a detached HEAD", async () => {
    const { ws, first, second } = await repository();
    const loose = await headFiles(ws.path("repo"));
    expect(loose).toMatchObject({ commit: second, shallow: false });
    expect(await headFiles(ws.path("repo"))).toEqual(loose);
    await ws.git(["pack-refs", "--all"], "repo");
    const packed = await headFiles(ws.path("repo"));
    expect(packed).toMatchObject({ commit: second, shallow: false });
    expect(packed?.stamp).not.toBe(loose?.stamp);
    // A new commit on the branch changes the stamp.
    await fs.writeFile(git(ws, "refs/heads/main"), `${first}\n`);
    expect(await headFiles(ws.path("repo"))).toMatchObject({ commit: first });
    await fs.writeFile(git(ws, "HEAD"), `${second}\n`);
    expect(await headFiles(ws.path("repo"))).toMatchObject({ commit: second });
    // No commit yet on the branch HEAD names.
    await fs.writeFile(git(ws, "HEAD"), "ref: refs/heads/unborn\n");
    const unborn = await headFiles(ws.path("repo"));
    expect(unborn).toEqual({ stamp: expect.any(String) as string, shallow: false });
  });

  it("follows the .git file of a linked worktree to the branches of the main one", async () => {
    const { ws, first } = await repository();
    await ws.git(["worktree", "add", "--quiet", "../linked", "side"], "repo");
    expect(await headFiles(ws.path("linked"))).toMatchObject({ commit: first, shallow: false });
  });

  it("cannot tell without a Git folder, for a reftable repository, an odd HEAD or a symbolic branch", async () => {
    const { ws } = await repository();
    expect(await headFiles(ws.path("plain"))).toBeUndefined();
    await fs.writeFile(ws.path("plain/.git"), "not a gitdir line\n");
    expect(await headFiles(ws.path("plain"))).toBeUndefined();
    await fs.writeFile(git(ws, "refs/heads/alias"), "ref: refs/heads/main\n");
    await fs.writeFile(git(ws, "HEAD"), "ref: refs/heads/alias\n");
    expect(await headFiles(ws.path("repo"))).toBeUndefined();
    for (const odd of ["nonsense\n", "ref: refs/heads/../../HEAD\n", "ref: refs/tags/v1\n"]) {
      await fs.writeFile(git(ws, "HEAD"), odd);
      expect(await headFiles(ws.path("repo"))).toBeUndefined();
    }
    await fs.writeFile(git(ws, "HEAD"), "ref: refs/heads/main\n");
    expect(await headFiles(ws.path("repo"))).toBeDefined();
    await fs.mkdir(git(ws, "reftable"));
    expect(await headFiles(ws.path("repo"))).toBeUndefined();
  });

  it("reads no file outside the repository's Git folders and writes none", async () => {
    const { ws } = await repository();
    const before = await fs.readdir(ws.path("repo/.git"), { recursive: true });
    await headFiles(ws.path("repo"));
    expect(await fs.readdir(ws.path("repo/.git"), { recursive: true })).toEqual(before);
    expect(mock.calls).toEqual([]);
  });
});

/** Text, binary bytes with a NUL and line breaks, and a name that is a glob in pathspec syntax. */
const BINARY = Uint8Array.of(0, 10, 13, 10, 255, 0);
const NFD = "Müller.md";
/** More than a pipe passes at once, so its bytes come in several pieces. */
const LARGE = Buffer.alloc(300_000, "x");

/**
 * One history for the history and object tests, made with one `git fast-import` (few git processes,
 * #206): `a.md` changed on main and on a side branch, a merge that resolves it, `[x].md` (a glob in
 * pathspec syntax) deleted later, `x.md` that the glob would match, a name in NFD, a symbolic link,
 * a large file and a submodule entry.
 */
interface History {
  readonly ws: FixtureWorkspace;
  readonly folder: string;
  readonly made: Readonly<Record<string, MadeCommit>>;
}

let history: History | undefined;

const madeHistory = async (): Promise<History> => {
  if (history !== undefined) {
    return history;
  }
  const ws = await createFixtureWorkspace();
  await ws.git(["init", "--quiet", "--initial-branch=main"]);
  const made = await ws.commitHistory(
    [
      {
        name: "first",
        files: { "a.md": "a1\n", "[x].md": "g\n", "x.md": "x1\n", [NFD]: "n\n", "img/b.bin": BINARY },
      },
      {
        name: "second",
        files: { "a.md": "a2\n", "x.md": "x2\n", "img/l.png": { link: "../a.md" }, "large.bin": LARGE },
      },
      { name: "side", files: { "a.md": "side\n" } },
      { name: "main", parents: ["second"], files: { "a.md": "main\n" } },
      { name: "merge", parents: ["main", "side"], files: { "a.md": "resolved\n" } },
      { name: "left", parents: ["merge"], files: { "a.md": "left\n" } },
      { name: "right", parents: ["merge"], files: { "[x].md": "g2\n" } },
      { name: "together", parents: ["left", "right"], files: { "[x].md": "g2\n" } },
      { name: "deleted", deleted: ["[x].md"], files: { sub: { submodule: "0".repeat(40) } } },
      { name: "other", files: { "c.md": "c\n" } },
    ],
    { branch: "main" },
  );
  history = { ws, folder: ws.root, made };
  return history;
};

afterAll(async () => {
  await history?.ws.cleanup();
});

const id = (h: History, name: string): string => String(h.made[name]?.id);
/** ADR-0005: in UTC with `Z`, whole seconds. */
const utc = (h: History, name: string): string =>
  String(h.made[name]?.date.toISOString().replace(".000Z", "Z"));

describe("file history", () => {
  it("lists the commits that changed the paths, newest first, with dates, parents and the paths they changed", async () => {
    const h = await madeHistory();
    const result = await fileHistory(h.folder, id(h, "other"), ["a.md", "[x].md", NFD, "img/l.png"]);
    const commit = (name: string, parents: readonly string[], paths: readonly string[]): unknown => ({
      commit: id(h, name),
      date: utc(h, name),
      parents: parents.map((p) => id(h, p)),
      paths,
    });
    expect(result).toEqual({
      known: true,
      commits: [
        commit("deleted", ["together"], ["[x].md"]),
        // A merge that took each path from one side changed none of them (`--cc`).
        commit("together", ["left", "right"], []),
        commit("right", ["merge"], ["[x].md"]),
        commit("left", ["merge"], ["a.md"]),
        // A merge names a path it changed against every parent.
        commit("merge", ["main", "side"], ["a.md"]),
        commit("main", ["second"], ["a.md"]),
        commit("side", ["second"], ["a.md"]),
        commit("second", ["first"], ["a.md", "img/l.png"]),
        commit("first", [], [NFD, "[x].md", "a.md"]),
      ],
    });
  });

  it("lists every merge, with the parents among the listed commits, past those it leaves out", async () => {
    const h = await madeHistory();
    // No history simplification (`--full-history`): `together` took `[x].md` from `right` and is
    // listed anyway, so the answer never depends on the other paths of the call. The parents of
    // `merge` both lead to `first`, which git names once.
    expect(await fileHistory(h.folder, id(h, "other"), ["[x].md"])).toMatchObject({
      known: true,
      commits: [
        { commit: id(h, "deleted"), parents: [id(h, "together")], paths: ["[x].md"] },
        { commit: id(h, "together"), parents: [id(h, "merge"), id(h, "right")], paths: [] },
        { commit: id(h, "right"), parents: [id(h, "merge")], paths: ["[x].md"] },
        { commit: id(h, "merge"), parents: [id(h, "first")], paths: [] },
        { commit: id(h, "first"), parents: [], paths: ["[x].md"] },
      ],
    });
  });

  it("takes paths literally and from the given commit", async () => {
    const h = await madeHistory();
    // `[x].md` would match `x.md` as a glob.
    expect(await fileHistory(h.folder, id(h, "second"), ["[x].md"])).toEqual({
      known: true,
      commits: [{ commit: id(h, "first"), date: utc(h, "first"), parents: [], paths: ["[x].md"] }],
    });
  });

  it("runs no git for no paths, and refuses a commit or path git cannot take", async () => {
    const h = await madeHistory();
    expect(await fileHistory(h.folder, id(h, "other"), [])).toEqual({ known: true, commits: [] });
    expect(mock.calls).toEqual([]);
    await expect(fileHistory(h.folder, "HEAD", ["a.md"])).rejects.toThrow(/commit ID/);
    for (const bad of ["a\nb.md", "/a.md", " a.md", "a.md\r", ""]) {
      await expect(fileHistory(h.folder, id(h, "other"), [bad])).rejects.toThrow(/cannot pass/);
    }
  });

  it("runs log with the fixed command line and the paths on standard input", async () => {
    const h = await madeHistory();
    await fileHistory(h.folder, id(h, "other"), ["a.md"]);
    expect(mock.calls.map((c) => [c.args, (c.options as ExecFileOptions).timeout])).toEqual([
      [
        [
          ...FIXED,
          "log",
          "--no-show-signature",
          "--no-follow",
          "--no-renames",
          "--root",
          "--full-history",
          "--cc",
          "--name-only",
          "-z",
          "--parents",
          "--format=%H %cI %P%x00",
          "--stdin",
          id(h, "other"),
        ],
        60_000,
      ],
    ]);
  });

  it("is unknown when git fails or prints something else", async () => {
    const ws = await fixture();
    const commit = "a".repeat(40);
    expect(await fileHistory(ws.path("plain"), commit, ["b.md"])).toMatchObject({
      known: false,
      reason: "not-a-repository",
    });
    // More paths than a pipe holds: git exits before it read them (EPIPE), and that is all.
    expect(
      await fileHistory(
        ws.path("plain"),
        commit,
        Array.from({ length: 200_000 }, () => "b.md"),
      ),
    ).toMatchObject({ known: false, reason: "not-a-repository" });
    mock.fake = { stdout: "b.md\0" };
    expect(await fileHistory(ws.path("plain"), commit, ["b.md"])).toEqual({
      known: false,
      reason: "not-a-repository",
      detail: "unexpected output of git log: b.md",
    });
    mock.fake = { stdout: `${commit} yesterday \0\0` };
    expect(await fileHistory(ws.path("plain"), commit, ["b.md"])).toMatchObject({
      known: false,
      reason: "not-a-repository",
    });
  });
});

/** Opens a reader on `folder` that is closed when the test ends. */
const open = (folder: string, signal?: AbortSignal): ObjectReader => {
  const objects = openObjectReader(folder, signal === undefined ? {} : { signal });
  onTestFinished(() => {
    objects.close();
  });
  return objects;
};

/** Reads `names` with `objects` and gives each object's bytes (null where Git has none). */
const contents = async (
  objects: ObjectReader,
  names: readonly string[],
): Promise<{ result: ObjectInfos; bytes: (Buffer | null)[] }> => {
  const chunks = names.map((): Buffer[] => []);
  const result = await objects.read(names, (_, i) => (chunk) => {
    chunks[i]?.push(chunk);
  });
  return {
    result,
    bytes: chunks.map((c, i) => (result.known && result.objects[i] !== null ? Buffer.concat(c) : null)),
  };
};

const OBJECT_ID = expect.stringMatching(/^[0-9a-f]{40}$/) as string;

describe("object reader", () => {
  it("tells ID, type and size of objects by commit and path or by ID; null for what is not there", async () => {
    const h = await madeHistory();
    const at = (name: string, file: string): string => `${id(h, name)}:${file}`;
    const blob = (await h.ws.git(["rev-parse", at("first", "img/b.bin")])).trim();
    const objects = open(h.folder);
    expect(
      await objects.info([
        at("first", "img/b.bin"),
        at("second", "img/l.png"),
        at("first", "img"),
        at("first", "nope.md"),
        at("deleted", "[x].md"),
        at("deleted", "sub"),
        at("deleted", "sub/inside.png"),
        at("first", NFD),
        at("first", NFD.normalize("NFC")),
        blob,
      ]),
    ).toEqual({
      known: true,
      objects: [
        { id: blob, type: "blob", size: BINARY.length },
        { id: OBJECT_ID, type: "blob", size: "../a.md".length },
        { id: OBJECT_ID, type: "tree", size: expect.any(Number) as number },
        null,
        null,
        // A submodule entry has no object in this repository, nor anything below it.
        null,
        null,
        { id: OBJECT_ID, type: "blob", size: 2 },
        // Paths are compared exactly: the NFC spelling of an NFD name is not there.
        null,
        { id: blob, type: "blob", size: BINARY.length },
      ],
    });
  });

  it("reads objects as Git stores them, in rounds of one git process", async () => {
    const h = await madeHistory();
    const at = (name: string, file: string): string => `${id(h, name)}:${file}`;
    const objects = open(h.folder);
    const { result, bytes } = await contents(objects, [
      at("first", "img/b.bin"),
      at("first", "nope.md"),
      at("second", "img/l.png"),
      at("second", "large.bin"),
      at("first", "a.md"),
    ]);
    expect(result).toMatchObject({ known: true, objects: [{ type: "blob" }, null, {}, {}, {}] });
    expect(bytes).toEqual([
      Buffer.from(BINARY),
      null,
      // A symbolic link is its link text.
      Buffer.from("../a.md"),
      LARGE,
      Buffer.from("a1\n"),
    ]);
    // More rounds, also with nothing to ask, in the same process.
    expect(await objects.info([at("other", "c.md")])).toMatchObject({ known: true, objects: [{ size: 2 }] });
    expect(await objects.info([])).toEqual({ known: true, objects: [] });
    expect((await contents(objects, [at("first", "x.md")])).bytes).toEqual([Buffer.from("x1\n")]);
    expect(mock.calls.map((c) => c.args.slice(FIXED.length))).toEqual([
      ["cat-file", "--batch-command", "--buffer"],
    ]);
    // After `close`, a round starts a new process.
    objects.close();
    objects.close();
    expect(await objects.info([at("first", "x.md")])).toMatchObject({ known: true });
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0]?.options).toMatchObject({ cwd: h.folder, windowsHide: true });
    expect(mock.calls[0]?.options.env).toMatchObject({ GIT_NO_LAZY_FETCH: "1", GIT_LITERAL_PATHSPECS: "1" });
  });

  it("starts no git for no names, and refuses names git cannot take", async () => {
    const h = await madeHistory();
    const objects = open(h.folder);
    expect(await objects.info([])).toEqual({ known: true, objects: [] });
    expect(await objects.read([], () => () => undefined)).toEqual({ known: true, objects: [] });
    expect(mock.calls).toEqual([]);
    for (const bad of [
      "HEAD:a.md",
      `${id(h, "first")}:`,
      `${id(h, "first")}:/a.md`,
      "abc",
      `${id(h, "first")}:a\nb`,
    ]) {
      await expect(objects.info([bad])).rejects.toThrow(/object name/);
      await expect(objects.read([bad], () => () => undefined)).rejects.toThrow(/object name/);
    }
  });

  it("is unknown when git fails, and then answers nothing more", async () => {
    const ws = await fixture();
    const name = "a".repeat(40);
    const objects = open(ws.path("plain"));
    // More names than a pipe holds: git exits before it read them (EPIPE), and that is all.
    const failed = await objects.info(Array.from({ length: 200_000 }, () => name));
    expect(failed).toMatchObject({ known: false, reason: "not-a-repository" });
    expect(await objects.info([name])).toBe(failed);
    expect(mock.calls).toHaveLength(1);
  });

  it("gives null for every answer of git that names no object (git-cat-file(1) batch output)", async () => {
    const ws = await fixture();
    const names = ["a", "b", "c", "d", "e"].map((c) => c.repeat(40));
    const [a = "", b = "", c = "", d = "", e = ""] = names;
    mock.process = () => ({
      output: [
        `${a} missing\n${b} ambiguous\n${c} excluded\n`,
        // A submodule entry whose commit is not in the repository (newer git): by the entry's ID.
        `${"0".repeat(40)} submodule\n${"f".repeat(64)} submodule\n`,
      ],
    });
    expect(
      await open(ws.path("plain")).read([a, b, c, `${d}:sub`, `${e}:lib/sub`], () => () => undefined),
    ).toEqual({
      known: true,
      objects: [null, null, null, null, null],
    });
    // Another word, or one for another name, is not such an answer.
    mock.process = () => ({ output: [`${b} missing\n`] });
    expect(await open(ws.path("plain")).info([a])).toMatchObject({
      known: false,
      reason: "not-a-repository",
    });
    mock.process = () => ({ output: [`${a} dangling\n`] });
    expect(await open(ws.path("plain")).info([a])).toMatchObject({
      known: false,
      reason: "not-a-repository",
    });
  });

  it("is unknown when git prints something else or ends early, read in any pieces", async () => {
    const ws = await fixture();
    const name = "a".repeat(40);
    const unknownFor = async (run: FakeProcess): Promise<ObjectInfos> => {
      mock.process = () => run;
      return open(ws.path("plain")).read([name], () => () => undefined);
    };
    expect(await unknownFor({ output: ["fatal: something\n"], code: 0 })).toEqual({
      known: false,
      reason: "not-a-repository",
      detail: `unexpected output of git cat-file for ${name}: fatal: something`,
    });
    expect(await unknownFor({ output: [`${name} blob 2\n`, "abX"], code: 0 })).toEqual({
      known: false,
      reason: "not-a-repository",
      detail: "git cat-file printed no line break after an object",
    });
    expect(await unknownFor({ output: [`${name} blob 1\nx\n`, "more\n"], code: 0 })).toEqual({
      known: false,
      reason: "not-a-repository",
      detail: "unexpected output of git cat-file: more",
    });
    expect(await unknownFor({ output: [`${name} blob 5\nab`], code: 0 })).toEqual({
      known: false,
      reason: "not-a-repository",
      detail: "git cat-file ended (0)",
    });
    expect(
      await unknownFor({ errors: "fatal: detected dubious ownership in repository", code: 128 }),
    ).toEqual({
      known: false,
      reason: "refused",
      detail: "fatal: detected dubious ownership in repository",
    });
    expect(await unknownFor({ error: execError("spawn git ENOENT", { code: "ENOENT" }) })).toEqual({
      known: false,
      reason: "no-git",
      detail: "spawn git ENOENT",
    });
    // A header and an object in pieces of one byte.
    mock.process = () => ({
      output: [...Buffer.from(`${name} blob 3\nabc\n`)].map((b) => Buffer.of(b)),
      code: 0,
    });
    const { bytes } = await contents(open(ws.path("plain")), [name]);
    expect(bytes).toEqual([Buffer.from("abc")]);
  });

  it("stops a git that does not answer in time or that the caller stops", async () => {
    const h = await madeHistory();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mock.process = () => ({});
    const pending = open(h.folder).info([id(h, "first")]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toEqual({
      known: false,
      reason: "timeout",
      detail: "git cat-file did not answer in time",
    });
    vi.useRealTimers();
    mock.process = undefined;
    expect(await open(h.folder, AbortSignal.abort()).info([id(h, "first")])).toMatchObject({
      known: false,
      reason: "timeout",
    });
  });

  it("never fetches a missing object of a partial clone (git before 2.44 too)", async () => {
    const ws = await fixture(["repo"]);
    await ws.git(["config", "uploadpack.allowFilter", "true"], "repo");
    await ws.git([
      "clone",
      "--quiet",
      "--filter=blob:none",
      "--no-checkout",
      pathToFileURL(ws.path("repo")).href,
      "partial",
    ]);
    const objectsOf = async (): Promise<string[]> =>
      (await fs.readdir(ws.path("partial/.git/objects"), { recursive: true })).sort();
    const before = await objectsOf();
    const commit = (await ws.git(["rev-parse", "HEAD"], "partial")).trim();
    /**
     * The blob is never read: git 2.44 and newer answer `missing` (null), an older git, or one
     * whose fetch `protocol.allow=never` refuses, fails (unknown). Both are documented answers.
     */
    const notRead = async (): Promise<unknown> => {
      const result = await open(ws.path("partial")).read([`${commit}:a.md`], () => () => undefined);
      return result.known ? result.objects : result.reason;
    };
    const answers = [[null], "not-a-repository"];
    expect(answers).toContainEqual(await notRead());
    // Without GIT_NO_LAZY_FETCH (git before 2.44 ignores it), `protocol.allow=never` still holds.
    mock.dropped = ["GIT_NO_LAZY_FETCH"];
    expect(answers).toContainEqual(await notRead());
    // Nothing was fetched: no new pack, no new loose object.
    expect(await objectsOf()).toEqual(before);
  });

  it("reads with one process per round from a git before 2.36", async () => {
    // Last in this file: the reader keeps the answer for the module (another module instance would
    // split its coverage).
    const h = await madeHistory();
    // Such a git refuses `--batch-command` with its usage.
    mock.process = (args) =>
      args.includes("--batch-command") ? { errors: "usage: git cat-file", code: 129 } : undefined;
    const objects = openObjectReader(h.folder);
    onTestFinished(() => {
      objects.close();
    });
    const at = (name: string, file: string): string => `${id(h, name)}:${file}`;
    expect(await objects.info([at("first", "a.md"), at("first", "nope")])).toMatchObject({
      known: true,
      objects: [{ type: "blob", size: 3 }, null],
    });
    expect((await contents(objects, [at("first", "a.md"), at("second", "large.bin")])).bytes).toEqual([
      Buffer.from("a1\n"),
      LARGE,
    ]);
    // Asked once; afterwards every round runs alone.
    const another = openObjectReader(h.folder);
    onTestFinished(() => {
      another.close();
    });
    expect(await another.info([at("first", "x.md")])).toMatchObject({ known: true });
    expect(mock.calls.map((c) => c.args.slice(FIXED.length))).toEqual([
      ["cat-file", "--batch-command", "--buffer"],
      ["cat-file", "--batch-check", "--buffer"],
      ["cat-file", "--batch", "--buffer"],
      ["cat-file", "--batch-check", "--buffer"],
    ]);
    // A failing round there is final too.
    mock.process = () => ({ errors: "fatal: not a git repository", code: 128 });
    const failing = openObjectReader(h.folder);
    const failed = await failing.info([at("first", "x.md")]);
    expect(failed).toMatchObject({ known: false, reason: "not-a-repository" });
    expect(await failing.info([at("first", "a.md")])).toBe(failed);
  });
});

describe("commits and changes since a commit (SR-092)", () => {
  /** `repo` with `a.md` in its first commit (with the annotated tag `v1`) and `b.md` added in a second. */
  const changes = async (): Promise<{
    ws: FixtureWorkspace;
    folder: string;
    first: string;
    second: string;
  }> => {
    const ws = await fixture(["repo"]);
    const first = await ws.head("repo");
    await ws.git(["tag", "-a", "-m", "v1", "v1"], "repo");
    await ws.write("repo/b.md", "b\n");
    const second = await ws.commit("repo");
    return { ws, folder: ws.path("repo"), first, second };
  };

  /** Every file below `folder` with its bytes. */
  const snapshot = async (folder: string): Promise<Record<string, string>> => {
    const out: Record<string, string> = {};
    for (const entry of await fs.readdir(folder, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) {
        const file = `${entry.parentPath}/${entry.name}`;
        out[file] = (await fs.readFile(file)).toString("base64");
      }
    }
    return out;
  };

  it("names the commit of a revision, peeled; none for a name that is no commit here", async () => {
    const { ws, folder, first, second } = await changes();
    expect(await resolveCommit(folder, "HEAD")).toEqual({ known: true, commit: second });
    expect(await resolveCommit(folder, "v1")).toEqual({ known: true, commit: first });
    expect(await resolveCommit(folder, "HEAD~1")).toEqual({ known: true, commit: first });
    expect(await resolveCommit(folder, first.slice(0, 12))).toEqual({ known: true, commit: first });
    const tree = (await ws.git(["rev-parse", "HEAD^{tree}"], "repo")).trim();
    for (const none of [
      "no-such-branch",
      "0".repeat(40),
      tree,
      "HEAD:a.md",
      "--output=out.txt",
      "my branch",
    ]) {
      expect(await resolveCommit(folder, none)).toEqual({ known: true, commit: undefined });
    }
    // The revision goes to standard input: the name that looks like an option wrote no file.
    await expect(fs.stat(ws.path("repo/out.txt"))).rejects.toThrow();
    expect(mock.calls.at(-1)?.args).toEqual([...FIXED, "cat-file", "--batch-check", "--buffer"]);
  });

  it("is unknown where git fails or prints something else, and refuses a revision git cannot take", async () => {
    const ws = await fixture();
    expect(await resolveCommit(ws.path("plain"), "HEAD")).toMatchObject({
      known: false,
      reason: "not-a-repository",
    });
    for (const bad of ["", " HEAD", "HEAD\n", "a\nb"]) {
      await expect(resolveCommit(ws.path("plain"), bad)).rejects.toThrow(/cannot pass the revision/);
    }
    mock.fake = { stdout: "what\n" };
    expect(await resolveCommit(ws.path("plain"), "HEAD")).toEqual({
      known: false,
      reason: "not-a-repository",
      detail: "unexpected output of git cat-file for HEAD^{commit}: what",
    });
  });

  it("lists the files of the working copy that differ from a commit, and the untracked ones, relative to the folder", async () => {
    const { ws, folder, first, second } = await changes();
    await ws.write("repo/a.md", "a2\n");
    await ws.git(["add", "a.md"], "repo");
    await ws.write("repo/sub/d.md", "d\n");
    await ws.write("repo/.gitignore", "*.log\n");
    await ws.write("repo/x.log", "ignored\n");
    // A file named like the commit: `--` keeps it from being read as the revision.
    await ws.write(`repo/${first}`, "named like the commit\n");
    const since = await changedPaths(folder, first);
    expect(since.known ? [...since.paths].sort() : since).toEqual(
      [".gitignore", "a.md", "b.md", first, "sub/d.md"].sort(),
    );
    // Below a subfolder only, relative to it.
    expect(await changedPaths(ws.path("repo/sub"), first)).toEqual({ known: true, paths: ["d.md"] });
    // A rename is a deletion and an addition.
    await ws.git(["mv", "b.md", "moved.md"], "repo");
    const renamed = await changedPaths(folder, second);
    expect(renamed.known ? [...renamed.paths].sort() : renamed).toEqual(
      [".gitignore", "a.md", "b.md", first, "moved.md", "sub/d.md"].sort(),
    );
  });

  it("runs diff and ls-files with the fixed command lines, `--` after the commit, and writes nothing", async () => {
    const { ws, folder, first, second } = await changes();
    // Changed after the index was written: git must not refresh the index (D-036). A file with only
    // new stat data (same bytes, later time) is what `diff` would otherwise write into the index.
    await ws.write("repo/a.md", "a3\n");
    const later = new Date(Date.now() + 60_000);
    await fs.utimes(ws.path("repo/b.md"), later, later);
    const before = await snapshot(ws.path("repo/.git"));
    mock.calls.length = 0;
    await changedPaths(folder, first);
    expect(mock.calls.map((c) => [c.args, (c.options as ExecFileOptions).timeout])).toEqual(
      expect.arrayContaining([
        [
          [
            ...FIXED,
            "-c",
            "diff.autoRefreshIndex=false",
            "diff",
            "--no-ext-diff",
            "--no-renames",
            "--relative",
            "--name-only",
            "-z",
            first,
            "--",
          ],
          60_000,
        ],
        [
          [...FIXED, "-c", "core.untrackedCache=false", "ls-files", "--others", "--exclude-standard", "-z"],
          60_000,
        ],
      ]),
    );
    expect(mock.calls).toHaveLength(2);
    // The file with only new stat data counts as changed: more, never less.
    expect(await changedPaths(folder, second)).toEqual({ known: true, paths: ["a.md", "b.md"] });
    await resolveCommit(folder, "HEAD");
    expect(await snapshot(ws.path("repo/.git"))).toEqual(before);
  });

  it("is unknown when git fails, and refuses what is no commit ID", async () => {
    const ws = await fixture();
    expect(await changedPaths(ws.path("plain"), "a".repeat(40))).toMatchObject({
      known: false,
      reason: "not-a-repository",
    });
    const { folder, first } = await changes();
    mock.fake = (args) =>
      args.includes("ls-files")
        ? { error: execError("Command failed", { killed: true, signal: "SIGKILL" }) }
        : undefined;
    expect(await changedPaths(folder, first)).toMatchObject({ known: false, reason: "timeout" });
    await expect(changedPaths(folder, "HEAD")).rejects.toThrow(/needs a commit ID/);
  });
});
