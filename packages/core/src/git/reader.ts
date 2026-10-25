// The git reader (ADR-0006): the only module of LogReq that spawns processes. It runs the installed
// `git` program with a fixed set of read-only commands, so nothing here can change a repository
// (D-036, SR-083). When git is missing or a folder is not a repository, Git-based information is
// unknown; everything else keeps working.
//
// Only typed functions are exported. Each one runs exactly one command line of `COMMANDS`, at most
// with a checked commit ID after it; paths and object names go to git's standard input, one per
// line. There is no way to pass another subcommand or argument. Add commands from ADR-0006's list
// as SRs need them. `headFiles` reads the few small files of the Git folder that name HEAD itself,
// so that opening an element needs no `rev-parse` (ADR-0006).
import type { ChildProcessByStdio } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

/** Every command line LogReq runs, after the fixed options of `run`. Read-only, no network. */
const COMMANDS = {
  /** Top level of the repository, whether it is a shallow clone, and its HEAD commit. */
  head: ["rev-parse", "--show-toplevel", "--is-shallow-repository", "--verify", "HEAD"],
  /**
   * The commits from a given commit that changed one of the paths on standard input, and every
   * merge (`--full-history`: no history simplification, so the list of one path never depends on
   * the other paths), newest first, each with its committer date, its parents among these commits
   * (`--parents` rewrites them past the commits left out) and the paths it changed (`-z`: NUL after
   * every name). Renames are neither followed nor detected, a merge names the paths that differ
   * from every parent (`--cc`), the root commit names its paths (`--root`), and no signature is
   * checked.
   */
  history: [
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
  ],
  /**
   * Commands on standard input (git 2.36 and newer): `info <name>` prints ID, type and size of an
   * object, `contents <name>` also its bytes as Git stores them (no checkout filters); `flush`
   * prints what was asked so far. One process answers many rounds.
   */
  objects: ["cat-file", "--batch-command", "--buffer"],
  /** What `info` answers, for every object named on standard input (git before 2.36). */
  objectInfo: ["cat-file", "--batch-check", "--buffer"],
  /** What `contents` answers, for every object named on standard input (git before 2.36). */
  objectContents: ["cat-file", "--batch", "--buffer"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

type GitCommand = keyof typeof COMMANDS;

/** Does nothing: for errors already handled elsewhere and for objects nobody reads. */
const ignore = (): undefined => undefined;

/**
 * Options before every command (ADR-0006): no pager, no file system monitor (a hook program), and
 * no transport at all, so a partial clone cannot fetch a missing object even where git does not
 * know `GIT_NO_LAZY_FETCH` (before 2.44).
 */
const FIXED_OPTIONS = ["--no-pager", "-c", "core.fsmonitor=false", "-c", "protocol.allow=never"] as const;

/**
 * Variables that point git at another repository; inherited ones (for example in a Git hook) would
 * redirect it.
 */
const LOCATION_VARIABLES: ReadonlySet<string> = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
]);

/**
 * ADR-0006: no optional locks (a `status` must not refresh the index), never ask for credentials,
 * paths are literal (no glob or `:(magic)`), and a partial clone never fetches a missing object
 * (git 2.44 and newer; `protocol.allow=never` covers older versions).
 */
const gitEnv = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !LOCATION_VARIABLES.has(key.toUpperCase())),
  ),
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  GIT_LITERAL_PATHSPECS: "1",
  GIT_NO_LAZY_FETCH: "1",
});

/** Most bytes a `rev-parse` or `log` may print; more is a failure (the reader streams object contents). */
const MAX_OUTPUT = 64 * 1024 * 1024;

/** A git call that hangs (network file system, a lock) is stopped; the information is then unknown. */
const TIMEOUT_MS = 10_000;

/** A history or object read over a large repository may take longer than a `rev-parse`. */
const READ_TIMEOUT_MS = 60_000;

/** Why Git information is unknown. */
export type GitUnknownReason =
  /** The `git` program is not installed or not on `PATH`. */
  | "no-git"
  /** git refuses the repository because another user owns it (`safe.directory`). */
  | "refused"
  /** git did not answer within the time limit, or the caller stopped it. */
  | "timeout"
  /** Not the top level of a repository, no commit yet, or another failure. */
  | "not-a-repository";

/** Git information that is not there; `detail` is git's own message, for logs only (it may contain paths). */
export interface GitUnknown {
  readonly known: false;
  readonly reason: GitUnknownReason;
  readonly detail: string;
}

/** Options of every function that runs git. */
export interface ReadOptions {
  /** Stops the running git process; the information is then unknown (`timeout`). */
  readonly signal?: AbortSignal;
}

type RunResult =
  { readonly ok: true; readonly stdout: Buffer } | ({ readonly ok: false } & Omit<GitUnknown, "known">);

const reasonOf = (message: string): GitUnknownReason =>
  /dubious ownership|safe\.directory/.test(message) ? "refused" : "not-a-repository";

interface ExecError extends Error {
  readonly code?: unknown;
  readonly killed?: boolean;
}

const unknownReason = (error: ExecError): GitUnknownReason => {
  if (error.code === "ENOENT") {
    return "no-git";
  }
  // A stopped (`signal`) or timed-out process is a reason to ask again; too much output is not.
  if (
    error.code === "ABORT_ERR" ||
    (error.killed === true && error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
  ) {
    return "timeout";
  }
  return reasonOf(error.message);
};

interface RunOptions extends ReadOptions {
  /** A commit ID after the command line (checked by the caller with `isObjectId`). */
  readonly revision?: string;
  /** Lines for standard input. */
  readonly input?: string;
}

/** Runs one command of `COMMANDS` in `cwd` with the fixed options of ADR-0006. Never rejects. */
const run = async (cwd: string, command: GitCommand, options: RunOptions = {}): Promise<RunResult> =>
  new Promise((resolve) => {
    const child = execFile(
      "git",
      [...FIXED_OPTIONS, ...COMMANDS[command], ...(options.revision === undefined ? [] : [options.revision])],
      {
        cwd,
        env: gitEnv(),
        encoding: "buffer",
        maxBuffer: MAX_OUTPUT,
        timeout: command === "head" ? TIMEOUT_MS : READ_TIMEOUT_MS,
        killSignal: "SIGKILL",
        windowsHide: true,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      },
      (error, stdout) => {
        resolve(
          error === null
            ? { ok: true, stdout }
            : { ok: false, reason: unknownReason(error), detail: error.message },
        );
      },
    );
    // A git that exits before it read all of its input (EPIPE) ends with its own error above.
    child.stdin?.on("error", ignore);
    child.stdin?.end(options.input);
  });

const unknown = (result: { readonly reason: GitUnknownReason; readonly detail: string }): GitUnknown => ({
  known: false,
  reason: result.reason,
  detail: result.detail,
});

/** True when both name the same folder after following links (git prints `C:/...` on Windows). */
const sameFolder = async (a: string, b: string): Promise<boolean> =>
  Promise.all([fs.realpath(path.resolve(a)), fs.realpath(path.resolve(b))]).then(
    ([realA, realB]) => path.relative(realA, realB) === "",
    () => false,
  );

/** A full object ID: SHA-1 (40 hex digits) or SHA-256 (64). */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Whether `text` is a full object ID, as `headCommit` and `fileHistory` give them. */
const isObjectId = (text: string): boolean => OBJECT_ID.test(text);

/**
 * Whether git can take `name` as one line of standard input: not empty, no line break, and no
 * white space at either end (git would drop a trailing carriage return).
 */
const isLine = (name: string): boolean => name !== "" && !/[\n\r]/.test(name) && name.trim() === name;

/**
 * Whether `file` (relative to the top level, `/` as separator) can be passed to `fileHistory`, or
 * after `<commit ID>:` to an object reader.
 */
export const isGitPath = (file: string): boolean => isLine(file) && !file.startsWith("/");

/** An object name for an object reader: an object ID, or `<commit ID>:<path>`. */
const isObjectName = (name: string): boolean => {
  const colon = name.indexOf(":");
  return colon === -1
    ? isObjectId(name)
    : isObjectId(name.slice(0, colon)) && isGitPath(name.slice(colon + 1));
};

export type HeadCommit =
  { readonly known: true; readonly commit: string; readonly shallow: boolean } | GitUnknown;

/**
 * The HEAD commit of the repository whose top level is `folder`, and whether the repository is a
 * shallow clone (its history then ends early). Unknown when git is missing, refuses the
 * repository, times out, or `folder` is not a repository (or only a subfolder of one) or has no
 * commit yet.
 */
export const headCommit = async (folder: string, options: ReadOptions = {}): Promise<HeadCommit> => {
  const result = await run(folder, "head", options);
  if (!result.ok) {
    return unknown(result);
  }
  const [topLevel = "", shallow = "", commit = ""] = result.stdout.toString("utf8").trim().split(/\r?\n/);
  if (!(await sameFolder(topLevel, folder))) {
    return { known: false, reason: "not-a-repository", detail: "not the top level of a repository" };
  }
  return { known: true, commit, shallow: shallow === "true" };
};

/** The text of a small file, or undefined when it cannot be read (missing, a folder). */
const readSmall = async (file: string): Promise<string | undefined> =>
  fs.readFile(file, "utf8").then(
    (text) => text,
    () => undefined,
  );

/** Identity, size and change time of a file, or `-` when it is not there. */
const statKey = async (file: string): Promise<string> =>
  fs.stat(file, { bigint: true }).then(
    (s) => `${String(s.ino)}:${String(s.size)}:${String(s.mtimeNs)}`,
    () => "-",
  );

/** What the files of a repository's Git folder say about its HEAD (`headFiles`). */
export interface HeadFiles {
  /** Changes whenever HEAD may have moved: while it stays the same, so does HEAD. */
  readonly stamp: string;
  /** The commit HEAD names; undefined where no file names one (a branch without commits). */
  readonly commit?: string;
  /** Whether the repository is a shallow clone (its `shallow` file lists commits). */
  readonly shallow: boolean;
}

/** The commit of `ref` in the text of `packed-refs`, if it has a line for it. */
const packedRef = (packed: string | undefined, ref: string): string | undefined =>
  packed
    ?.split(/\r?\n/)
    .map((line) => line.split(" "))
    .find(([id, name]) => name === ref && isObjectId(String(id)))?.[0];

/**
 * HEAD of the repository whose top level is `folder` as the files of its Git folder name it,
 * without starting git (ADR-0006): `HEAD` names a commit or a branch, whose commit is in the branch
 * file or else in `packed-refs` (of the main worktree's Git folder for a linked worktree), and
 * `shallow` lists the commits a shallow clone ends at. The stamp covers each of these files by
 * content or by identity, size and change time. Undefined where only git can tell (no Git folder,
 * a reftable repository, a HEAD that names no branch or commit, a symbolic branch): ask
 * `headCommit` then.
 */
export const headFiles = async (folder: string): Promise<HeadFiles | undefined> => {
  const git = await gitFolders(folder);
  if (git === undefined) {
    return undefined;
  }
  const { gitDir, commonDir, head, branch } = git;
  const branchFile = path.join(commonDir, ...(branch ?? "").split("/"));
  const loose = branch === undefined ? undefined : await readSmall(branchFile);
  if (loose !== undefined && !isObjectId(loose.trim())) {
    return undefined;
  }
  const packedFile = path.join(commonDir, "packed-refs");
  const shallowFile = path.join(commonDir, "shallow");
  const commit =
    branch === undefined ? head.trim() : (loose?.trim() ?? packedRef(await readSmall(packedFile), branch));
  const shallow = (await readSmall(shallowFile))?.trim() ?? "";
  const files = [
    path.join(gitDir, "HEAD"),
    shallowFile,
    ...(branch === undefined ? [] : [branchFile, packedFile]),
  ];
  return {
    stamp: JSON.stringify([gitDir, head, loose ?? null, ...(await Promise.all(files.map(statKey)))]),
    shallow: shallow !== "",
    ...(commit === undefined ? {} : { commit }),
  };
};

/**
 * The Git folder of the repository in `folder`, its common folder (of the main worktree), the text
 * of HEAD and the branch it names; undefined where `headFiles` cannot tell.
 */
const gitFolders = async (
  folder: string,
): Promise<
  | { readonly gitDir: string; readonly commonDir: string; readonly head: string; readonly branch?: string }
  | undefined
> => {
  const entry = path.join(folder, ".git");
  // A linked worktree or a submodule has a `.git` file that names its Git folder.
  const link = await readSmall(entry);
  const linked = link === undefined ? entry : /^gitdir: (.+?)\r?\n?$/.exec(link)?.[1];
  if (linked === undefined) {
    return undefined;
  }
  const gitDir = path.resolve(folder, linked);
  const head = await readSmall(path.join(gitDir, "HEAD"));
  // A branch name never holds `..` (git check-ref-format), so the branch file is inside the folder.
  const branch =
    head === undefined ? undefined : /^ref: (refs\/heads\/(?:(?!\.\.)\S)+)\r?\n?$/.exec(head)?.[1];
  if (head === undefined || (branch === undefined && !isObjectId(head.trim()))) {
    return undefined;
  }
  // A linked worktree keeps its own HEAD; the branches are in the common folder.
  const common = await readSmall(path.join(gitDir, "commondir"));
  const commonDir = common === undefined ? gitDir : path.resolve(gitDir, common.trim());
  // The reftable format keeps no branch files; only git can read it.
  if ((await statKey(path.join(commonDir, "reftable"))) !== "-") {
    return undefined;
  }
  return { gitDir, commonDir, head, ...(branch === undefined ? {} : { branch }) };
};

/** One commit of `fileHistory`. */
export interface HistoryCommit {
  readonly commit: string;
  /** Committer date in UTC, `YYYY-MM-DDTHH:MM:SSZ` (ADR-0005 "Version date"). */
  readonly date: string;
  /** Its parents among the commits of the history (rewritten past the others); none for a first commit. */
  readonly parents: readonly string[];
  /** The paths of the request this commit changed, as Git stores them (also in another Unicode form). */
  readonly paths: readonly string[];
}

export type FileHistory = { readonly known: true; readonly commits: readonly HistoryCommit[] } | GitUnknown;

/** `<commit ID> <date> <parent IDs>`: the header of a commit in the output of `history`. */
const HEADER = /^([0-9a-f]{40}|[0-9a-f]{64}) (\S+) ((?:[0-9a-f]{40}|[0-9a-f]{64}| )*)$/;

/** A date of `%cI` (strict ISO 8601 with the committer's offset) in UTC with `Z`, whole seconds. */
const utcDate = (date: string): string => new Date(date).toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * The commits of `history`: each header ends with two NULs (one of the format, one of `-z`); a
 * merge has one more before its names; the first name of a commit starts with a line break.
 */
const parseHistory = (output: string): HistoryCommit[] => {
  // Every token ends with a NUL, so the last piece is empty.
  const tokens = output.split("\0").slice(0, -1);
  const commits: { commit: string; date: string; parents: string[]; paths: string[] }[] = [];
  for (const [i, token] of tokens.entries()) {
    if (token === "") {
      continue;
    }
    const header = tokens[i + 1] === "" ? HEADER.exec(token) : null;
    if (header !== null) {
      const [, commit = "", date = "", parents = ""] = header;
      commits.push({
        commit,
        date: utcDate(date),
        parents: parents.split(" ").filter(isObjectId),
        paths: [],
      });
      continue;
    }
    const current = commits.at(-1);
    if (current === undefined) {
      throw new Error(`unexpected output of git log: ${token}`);
    }
    current.paths.push(token.startsWith("\n") ? token.slice(1) : token);
  }
  return commits;
};

/**
 * The commits reachable from `head` that changed one of `files` (paths relative to the top level
 * of the repository in `folder`, as `isGitPath` allows; literal, no globs; a folder ending in `/`
 * takes every file below it), and every merge reachable from `head`, newest first, with their
 * committer dates, their parents among them (one parent where all lead to the same commit) and the
 * paths below `files` each one changed. No history simplification (`--full-history`): both sides
 * of every merge are listed, so what is listed for one path does not depend on the other paths of
 * the call. Unknown when git fails. A programming error when `head` is not an object ID or a path
 * cannot be passed.
 */
export const fileHistory = async (
  folder: string,
  head: string,
  files: readonly string[],
  options: ReadOptions = {},
): Promise<FileHistory> => {
  if (!isObjectId(head)) {
    throw new Error(`fileHistory needs a commit ID, not ${head}`);
  }
  const bad = files.find((f) => !isGitPath(f));
  if (bad !== undefined) {
    throw new Error(`fileHistory cannot pass the path ${JSON.stringify(bad)}`);
  }
  if (files.length === 0) {
    // `log` without paths would list every commit.
    return { known: true, commits: [] };
  }
  const result = await run(folder, "history", {
    ...options,
    revision: head,
    input: `--\n${files.join("\n")}\n`,
  });
  if (!result.ok) {
    return unknown(result);
  }
  try {
    return { known: true, commits: parseHistory(result.stdout.toString("utf8")) };
  } catch (error) {
    return { known: false, reason: "not-a-repository", detail: (error as Error).message };
  }
};

/** An object as Git stores it. */
export interface ObjectInfo {
  readonly id: string;
  /** `blob` (a file or a symbolic link), `tree`, `commit` or `tag`. */
  readonly type: string;
  readonly size: number;
}

export type ObjectInfos =
  { readonly known: true; readonly objects: readonly (ObjectInfo | null)[] } | GitUnknown;

/** Takes the bytes of one object as they arrive, in order. */
export type ObjectSink = (chunk: Buffer) => void;

/**
 * Reads objects of one repository in rounds, with one git process for all of them where git
 * allows (2.36 and newer; before, one process per round). Names are object IDs or
 * `<commit ID>:<path>` with the path relative to the top level as Git stores it (exactly, no other
 * Unicode form); another kind of name is a programming error. An object Git does not have (no such
 * path in that commit, a path below a submodule, an unknown ID) is null. Unknown when git fails;
 * the reader then answers nothing more. `close` ends the process; call it when done.
 */
export interface ObjectReader {
  /** ID, type and size of each object, in the order of `names`. */
  info(names: readonly string[]): Promise<ObjectInfos>;
  /**
   * The same, and the bytes of each object as Git stores them (no line-ending conversion or other
   * checkout filter, a symbolic link as its link text): `open` gets each object's info before its
   * bytes and returns where they go. Nothing holds all the output at once.
   */
  read(names: readonly string[], open: (info: ObjectInfo, index: number) => ObjectSink): Promise<ObjectInfos>;
  close(): void;
}

/** One object a cat-file process is asked for. */
interface Asked {
  readonly name: string;
  readonly open: ((info: ObjectInfo) => ObjectSink) | undefined;
}

/**
 * What `cat-file` prints instead of a header for an object it does not give (git-cat-file(1),
 * "Batch output"): not there (`missing`, also a missing object of a partial clone that git does
 * not fetch, git 2.44 and newer), a name that fits several objects (`ambiguous`), an object a
 * filter leaves out (`excluded`).
 */
const NO_OBJECT = ["missing", "ambiguous", "excluded"];

/**
 * The header line of `cat-file` for `name`: its info, or null when git gives no object for it,
 * also for a submodule entry whose commit this repository does not have, which newer git prints
 * as `<object ID of the entry> submodule` (seen with git 2.56) and older git as `missing`.
 */
const parseHeader = (name: string, line: string): ObjectInfo | null => {
  if (
    NO_OBJECT.some((word) => line === `${name} ${word}`) ||
    /^([0-9a-f]{40}|[0-9a-f]{64}) submodule$/.test(line)
  ) {
    return null;
  }
  const match = /^([0-9a-f]{40}|[0-9a-f]{64}) (\S+) (\d+)$/.exec(line);
  if (match === null) {
    throw new Error(`unexpected output of git cat-file for ${name}: ${line}`);
  }
  const [, id = "", type = "", size = ""] = match;
  return { id, type, size: Number(size) };
};

/**
 * Reads the output of `cat-file` as it arrives: for each asked object a header line, and where it
 * is read, its bytes and a line break. `push` throws on output that does not fit.
 */
class CatFileOutput {
  readonly #asked: Asked[] = [];
  #infos: (ObjectInfo | null)[] = [];
  #line: Buffer[] = [];
  /** Bytes of the current object still to come, with its closing line break; 0 between objects. */
  #left = 0;
  #sink: ObjectSink = ignore;

  ask(asked: readonly Asked[]): void {
    // One by one: a spread of many names exceeds the call stack.
    for (const one of asked) {
      this.#asked.push(one);
    }
  }

  /** Whether every asked object was answered. */
  get done(): boolean {
    return this.#asked.length === 0 && this.#left === 0;
  }

  /** The answers since the last call. */
  take(): (ObjectInfo | null)[] {
    const infos = this.#infos;
    this.#infos = [];
    return infos;
  }

  push(chunk: Buffer): void {
    let position = 0;
    while (position < chunk.length) {
      if (this.#left > 0) {
        const take = Math.min(this.#left, chunk.length - position);
        // The last byte of an object's part is its closing line break.
        const bytes = Math.min(take, this.#left - 1);
        if (bytes > 0) {
          this.#sink(chunk.subarray(position, position + bytes));
        }
        if (take > bytes && chunk[position + bytes] !== 0x0a) {
          throw new Error("git cat-file printed no line break after an object");
        }
        this.#left -= take;
        position += take;
        continue;
      }
      const end = chunk.indexOf(0x0a, position);
      if (end === -1) {
        this.#line.push(chunk.subarray(position));
        return;
      }
      const line = Buffer.concat([...this.#line, chunk.subarray(position, end)]).toString("utf8");
      this.#line = [];
      position = end + 1;
      this.#header(line);
    }
  }

  #header(line: string): void {
    const asked = this.#asked.shift();
    if (asked === undefined) {
      throw new Error(`unexpected output of git cat-file: ${line}`);
    }
    const info = parseHeader(asked.name, line);
    this.#infos.push(info);
    if (info !== null && asked.open !== undefined) {
      this.#sink = asked.open(info);
      this.#left = info.size + 1;
    }
  }
}

/** Whether git knows `cat-file --batch-command`; false after a git that did not (before 2.36). */
let batchCommand = true;

/** A running `cat-file` with its output reader; `failed` is set once it cannot answer any more. */
interface CatFile {
  readonly child: ChildProcessByStdio<Writable, Readable, Readable>;
  readonly output: CatFileOutput;
  /** Called after each piece of output and when the process ends. */
  wake: () => void;
  failed?: Omit<GitUnknown, "known">;
  /** Exit code, once the process ended. */
  exit?: number | null;
  /** Whether it printed anything. */
  printed: boolean;
}

/** Most bytes of git's error output kept for the detail. */
const MAX_ERROR_OUTPUT = 4096;

/** Starts `command` in `cwd`; its output goes to a `CatFileOutput`. */
const startCatFile = (cwd: string, command: GitCommand, signal: AbortSignal | undefined): CatFile => {
  const child = spawn("git", [...FIXED_OPTIONS, ...COMMANDS[command]], {
    cwd,
    env: gitEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    ...(signal === undefined ? {} : { signal, killSignal: "SIGKILL" }),
  });
  const catFile: CatFile = { child, output: new CatFileOutput(), wake: ignore, printed: false };
  let errors = "";
  const fail = (failure: Omit<GitUnknown, "known">): void => {
    catFile.failed ??= failure;
    child.kill("SIGKILL");
    catFile.wake();
  };
  child.stdout.on("data", (chunk: Buffer) => {
    catFile.printed = true;
    try {
      catFile.output.push(chunk);
    } catch (error) {
      fail({ reason: "not-a-repository", detail: (error as Error).message });
    }
    catFile.wake();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    errors = `${errors}${chunk.toString("utf8")}`.slice(0, MAX_ERROR_OUTPUT);
  });
  // A git that exits before it read all of its input (EPIPE) ends with its exit code below.
  child.stdin.on("error", ignore);
  child.on("error", (error: ExecError) => {
    fail({ reason: error.code === "ENOENT" ? "no-git" : "timeout", detail: error.message });
  });
  child.on("close", (code) => {
    catFile.exit = code;
    if (!catFile.output.done) {
      fail({
        reason: reasonOf(errors),
        detail: errors === "" ? `git cat-file ended (${String(code)})` : errors,
      });
    }
    catFile.wake();
  });
  return catFile;
};

/** Waits until `catFile` answered every asked object, failed, or took longer than the time limit. */
const answers = async (catFile: CatFile): Promise<ObjectInfos> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => {
      catFile.failed ??= { reason: "timeout", detail: "git cat-file did not answer in time" };
      catFile.child.kill("SIGKILL");
      catFile.wake();
    }, READ_TIMEOUT_MS);
    catFile.wake = () => {
      if (catFile.failed !== undefined || catFile.output.done) {
        clearTimeout(timer);
        catFile.wake = ignore;
        resolve(
          catFile.failed === undefined
            ? { known: true, objects: catFile.output.take() }
            : unknown(catFile.failed),
        );
      }
    };
    catFile.wake();
  });

/** Checks the object names; a name git cannot take is a programming error. */
const checkNames = (names: readonly string[]): void => {
  const bad = names.find((n) => !isObjectName(n));
  if (bad !== undefined) {
    throw new Error(`git cat-file cannot read the object name ${JSON.stringify(bad)}`);
  }
};

/**
 * An `ObjectReader` for the repository whose top level is `folder` (see there). Starts no process
 * before the first round.
 */
export const openObjectReader = (folder: string, options: ReadOptions = {}): ObjectReader => {
  let session: CatFile | undefined;
  let failure: GitUnknown | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  /** One round in its own process (git before 2.36). */
  const once = async (asked: readonly Asked[], contents: boolean): Promise<ObjectInfos> => {
    const catFile = startCatFile(folder, contents ? "objectContents" : "objectInfo", options.signal);
    catFile.output.ask(asked);
    catFile.child.stdin.end(asked.map((a) => `${a.name}\n`).join(""));
    return answers(catFile);
  };

  /** One round in the process of the reader, started at the first one (git 2.36 and newer). */
  const inSession = async (asked: readonly Asked[], contents: boolean): Promise<ObjectInfos | undefined> => {
    session ??= startCatFile(folder, "objects", options.signal);
    const current = session;
    current.output.ask(asked);
    const verb = contents ? "contents" : "info";
    current.child.stdin.write(`${asked.map((a) => `${verb} ${a.name}\n`).join("")}flush\n`);
    const result = await answers(current);
    // A git before 2.36 refuses the option (usage, exit code 129) before it prints anything.
    if (!result.known && current.exit === 129 && !current.printed) {
      batchCommand = false;
      session = undefined;
      return undefined;
    }
    return result;
  };

  const round = async (asked: readonly Asked[], contents: boolean): Promise<ObjectInfos> => {
    if (failure !== undefined) {
      return failure;
    }
    if (asked.length === 0) {
      return { known: true, objects: [] };
    }
    const inOne = batchCommand ? await inSession(asked, contents) : undefined;
    return settled(inOne ?? (await once(asked, contents)));
  };

  /** Keeps a failure: every later round answers with it. */
  const settled = (result: ObjectInfos): ObjectInfos => {
    if (!result.known) {
      failure = result;
      session?.child.kill("SIGKILL");
    }
    return result;
  };

  /** Rounds run one after the other. */
  const queued = async (asked: readonly Asked[], contents: boolean): Promise<ObjectInfos> => {
    const next = queue.then(async () => round(asked, contents));
    queue = next;
    return next;
  };

  return {
    info: async (names) => {
      checkNames(names);
      return queued(
        names.map((name) => ({ name, open: undefined })),
        false,
      );
    },
    read: async (names, open) => {
      checkNames(names);
      return queued(
        names.map((name, index) => ({ name, open: (info: ObjectInfo) => open(info, index) })),
        true,
      );
    },
    close: () => {
      session?.child.stdin.end();
      session = undefined;
    },
  };
};
