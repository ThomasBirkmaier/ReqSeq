// Temporary fixture workspaces for tests (ADR-0011, fixtures/README.md).
// This package is test tooling and never shipped. It spawns `git` to build repositories;
// product code never does that outside `core/src/git` (architecture rule, ADR-0006).
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** `fixtures/` at the repository root (same depth from `src/` and `dist/`). */
export const defaultFixturesDir: string = fileURLToPath(new URL("../../../fixtures/", import.meta.url));

/** Base of the fixed commit dates; each commit adds one second, so commit IDs are deterministic. */
const BASE_DATE = Date.UTC(2026, 0, 1);

export type FileContent = string | Uint8Array;

export interface FixtureOptions {
  /** Case folder to copy first, relative to `fixturesDir`, e.g. `SR-004/two-repositories`. */
  readonly fixture?: string;
  /** Where `fixture` is looked up. Default: `fixtures/` of this repository. */
  readonly fixturesDir?: string;
  /** Files to write after the copy, `relative/path` (forward slashes) to content. Overrides copied files. */
  readonly files?: Readonly<Record<string, FileContent>>;
  /**
   * Folders to turn into Git repositories with one commit of everything in them:
   * `true` for the workspace root, or relative folders such as `["product", "system"]` (`"."` is the root).
   * Do not nest repositories.
   */
  readonly git?: true | readonly string[];
  /** Parent of the temporary folder. Default: the OS temp folder. */
  readonly tempDir?: string;
}

export interface FixtureWorkspace {
  /** Absolute, symlink-free path of the workspace root (pass it to `new Workspace(root)`). */
  readonly root: string;
  /** Absolute path of a file or folder in the workspace. */
  path(relativePath: string): string;
  /** Write a file (creates folders). */
  write(relativePath: string, content: FileContent): Promise<void>;
  /** Run `git <args>` in a repository of the fixture (default the root) and return stdout; `input` goes to stdin. */
  git(args: readonly string[], repository?: string, input?: Uint8Array): Promise<string>;
  /** Commit everything in a repository (default the root) and return the new HEAD commit ID. */
  commit(repository?: string, message?: string): Promise<string>;
  /**
   * Make a commit with `files` (added or replaced) on top of `parent` (default HEAD) without
   * touching the working tree, the index or any branch, and return its ID: one `git fast-import`
   * instead of writing and adding the files. For fixtures with hundreds of files, which took
   * several seconds per `git add` on a loaded windows-2025 runner (#226); check one out with
   * `git reset --hard <commit>` or merge it.
   */
  commitFiles(
    files: Readonly<Record<string, FileContent>>,
    options?: { readonly repository?: string; readonly parent?: string; readonly message?: string },
  ): Promise<string>;
  /**
   * Make a history of commits in one `git fast-import` (for Git history tests on slow Windows
   * runners, #206, #226), without touching the working tree, the index or HEAD, and return each
   * commit's ID and committer date by name. Commits get the fixture's next dates in list order.
   * With `branch`, that branch points at the last commit afterwards (`git reset --hard` then checks
   * it out); otherwise no ref is left.
   */
  commitHistory(
    commits: readonly HistoryCommitSpec[],
    options?: { readonly repository?: string; readonly branch?: string },
  ): Promise<Readonly<Record<string, MadeCommit>>>;
  /** Current HEAD commit ID of a repository (default the root). */
  head(repository?: string): Promise<string>;
  /**
   * Remove the temporary folder. Call it in `afterEach` or `onTestFinished`. A function, not a
   * method: it may be taken out of the object, so a test can let the rest go (E4 perf tests).
   */
  readonly cleanup: () => Promise<void>;
}

/** The content of a file in `commitHistory`: bytes, a symbolic link, or a submodule entry (gitlink). */
export type HistoryFile = FileContent | { readonly link: string } | { readonly submodule: string };

/** One commit of `commitHistory`. */
export interface HistoryCommitSpec {
  /** How the result and later commits (`parents`) name it. */
  readonly name: string;
  /**
   * Names of earlier commits, or commit IDs; default the commit before it in the list (none for the
   * first). The files start from the tree of the first parent, also for a merge.
   */
  readonly parents?: readonly string[];
  /** Files added or replaced, by path relative to the repository (forward slashes). */
  readonly files?: Readonly<Record<string, HistoryFile>>;
  /** Files removed. */
  readonly deleted?: readonly string[];
  readonly message?: string;
}

export interface MadeCommit {
  readonly id: string;
  /** Its committer (and author) date, whole seconds. */
  readonly date: Date;
}

/** Resolve a relative fixture path; rejects absolute paths and `..` so tests never write outside. */
const resolveInside = (root: string, relativePath: string): string => {
  const parts = relativePath.split("/");
  if (path.isAbsolute(relativePath) || relativePath.includes("\\") || parts.includes("..")) {
    throw new Error(`fixture path must be relative with forward slashes and no "..": ${relativePath}`);
  }
  return path.join(root, ...parts);
};

/** Inherited GIT_* variables (for example GIT_DIR inside a Git hook) would redirect the commands. */
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));

/**
 * Build a temporary workspace: copy a fixture case, write extra files, optionally make Git repositories.
 * Every call gets its own folder; nothing is shared between tests.
 */
export async function createFixtureWorkspace(options: FixtureOptions = {}): Promise<FixtureWorkspace> {
  const base = await fs.realpath(
    await fs.mkdtemp(path.join(options.tempDir ?? os.tmpdir(), "logreq-fixture-")),
  );
  const root = path.join(base, "workspace");
  // An empty global config: user settings (signing, autocrlf, hooks, templates) must not leak in.
  const gitconfig = path.join(base, "gitconfig");
  await fs.writeFile(gitconfig, "");
  await fs.mkdir(root);
  let commitCount = 0;
  let historyCount = 0;

  /** The `data` command of fast-import for `content`. */
  const data = (content: FileContent): Uint8Array[] => {
    const bytes = typeof content === "string" ? Buffer.from(content) : content;
    return [Buffer.from(`data ${String(bytes.length)}\n`), bytes, Buffer.from("\n")];
  };
  /** A path fast-import can take, inside the repository. */
  const checkedPath = (repository: string, file: string): void => {
    resolveInside(resolveInside(root, repository), file);
    // fast-import reads an unquoted path up to the end of the line; a leading `"` starts a quoted one.
    if (file.includes("\n") || file.startsWith('"')) {
      throw new Error(`fixture path must not hold a line break or start with a quote: ${file}`);
    }
  };
  /** The fast-import command that adds or replaces `file`: a file, a symbolic link or a submodule entry. */
  const fileCommand = (repository: string, file: string, content: HistoryFile): Uint8Array[] => {
    checkedPath(repository, file);
    if (typeof content === "string" || content instanceof Uint8Array) {
      return [Buffer.from(`M 100644 inline ${file}\n`), ...data(content)];
    }
    return "link" in content
      ? [Buffer.from(`M 120000 inline ${file}\n`), ...data(content.link)]
      : [Buffer.from(`M 160000 ${content.submodule} ${file}\n`)];
  };

  const workspace: FixtureWorkspace = {
    root,
    path: (relativePath) => resolveInside(root, relativePath),
    async write(relativePath, content) {
      const file = resolveInside(root, relativePath);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content);
    },
    async git(args, repository = ".", input) {
      const date = new Date(BASE_DATE + commitCount * 1000).toISOString();
      const run = execFileAsync("git", [...args], {
        cwd: resolveInside(root, repository),
        env: {
          ...cleanEnv(),
          GIT_CONFIG_GLOBAL: gitconfig,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          GIT_AUTHOR_NAME: "LogReq Test",
          GIT_AUTHOR_EMAIL: "test@logreq.invalid",
          GIT_COMMITTER_NAME: "LogReq Test",
          GIT_COMMITTER_EMAIL: "test@logreq.invalid",
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date,
        },
      });
      // A git that exits before reading all of stdin (EPIPE) rejects `run`, which carries the error.
      run.child.stdin?.on("error", () => undefined);
      run.child.stdin?.end(input);
      const { stdout } = await run;
      return stdout;
    },
    async commit(repository = ".", message = "fixture") {
      commitCount++;
      await workspace.git(["add", "--all"], repository);
      await workspace.git(["commit", "--quiet", "--allow-empty", "--no-verify", "-m", message], repository);
      return workspace.head(repository);
    },
    async commitFiles(files, options = {}) {
      const repository = options.repository ?? ".";
      const parent = options.parent ?? (await workspace.head(repository));
      commitCount++;
      const seconds = (BASE_DATE + commitCount * 1000) / 1000;
      const ref = `refs/logreq-fixture/${String(commitCount)}`;
      const stream = [
        Buffer.from(`commit ${ref}\ncommitter LogReq Test <test@logreq.invalid> ${String(seconds)} +0000\n`),
        ...data(options.message ?? "fixture"),
        Buffer.from(`from ${parent}\n`),
        ...Object.entries(files).flatMap(([file, content]) => fileCommand(repository, file, content)),
      ];
      await workspace.git(["fast-import", "--quiet"], repository, Buffer.concat(stream));
      const commit = (await workspace.git(["rev-parse", ref], repository)).trim();
      await workspace.git(["update-ref", "-d", ref], repository);
      return commit;
    },
    async commitHistory(commits, options = {}) {
      const repository = options.repository ?? ".";
      historyCount++;
      const ref =
        options.branch === undefined
          ? `refs/logreq-fixture/history-${String(historyCount)}`
          : `refs/heads/${options.branch}`;
      const marks = new Map<string, number>();
      const made: { readonly name: string; readonly mark: number; readonly date: Date }[] = [];
      const stream = commits.flatMap((commit, i): Uint8Array[] => {
        if (marks.has(commit.name)) {
          throw new Error(`commit name used twice: ${commit.name}`);
        }
        const parents = commit.parents ?? commits.slice(i - 1, i).map((c) => c.name);
        const parentRef = (parent: string): string => {
          const mark = marks.get(parent);
          return mark === undefined ? parent : `:${String(mark)}`;
        };
        marks.set(commit.name, i + 1);
        commitCount++;
        const seconds = (BASE_DATE + commitCount * 1000) / 1000;
        made.push({ name: commit.name, mark: i + 1, date: new Date(seconds * 1000) });
        const [first, ...merged] = parents;
        return [
          // A commit without parents starts a new root (`reset` empties the branch).
          ...(first === undefined ? [Buffer.from(`reset ${ref}\n`)] : []),
          Buffer.from(
            `commit ${ref}\nmark :${String(i + 1)}\ncommitter LogReq Test <test@logreq.invalid> ${String(seconds)} +0000\n`,
          ),
          ...data(commit.message ?? commit.name),
          ...(first === undefined ? [] : [Buffer.from(`from ${parentRef(first)}\n`)]),
          ...merged.map((parent) => Buffer.from(`merge ${parentRef(parent)}\n`)),
          ...(commit.deleted ?? []).map((file) => {
            checkedPath(repository, file);
            return Buffer.from(`D ${file}\n`);
          }),
          ...Object.entries(commit.files ?? {}).flatMap(([file, content]) =>
            fileCommand(repository, file, content),
          ),
        ];
      });
      const marksFile = path.join(base, `marks-${String(historyCount)}`);
      await workspace.git(
        ["fast-import", "--quiet", `--export-marks=${marksFile}`],
        repository,
        Buffer.concat(stream),
      );
      if (options.branch === undefined) {
        await workspace.git(["update-ref", "-d", ref], repository);
      }
      // One line `:<mark> <commit ID>` per commit.
      const ids: Readonly<Record<string, string>> = Object.fromEntries(
        (await fs.readFile(marksFile, "utf8"))
          .trim()
          .split("\n")
          .map((line): [string, string] => {
            const [mark = "", id = ""] = line.split(" ");
            return [mark, id];
          }),
      );
      return Object.fromEntries(
        made.map(({ name, mark, date }) => [name, { id: String(ids[`:${String(mark)}`]), date }]),
      );
    },
    async head(repository = ".") {
      return (await workspace.git(["rev-parse", "HEAD"], repository)).trim();
    },
    async cleanup() {
      await fs.rm(base, { recursive: true, force: true, maxRetries: 3 });
    },
  };

  try {
    if (options.fixture !== undefined) {
      const source = resolveInside(options.fixturesDir ?? defaultFixturesDir, options.fixture);
      await fs.cp(source, root, { recursive: true, errorOnExist: false });
    }
    for (const [relativePath, content] of Object.entries(options.files ?? {})) {
      await workspace.write(relativePath, content);
    }
    const repositories = options.git === true ? ["."] : (options.git ?? []);
    for (const repository of repositories) {
      await fs.mkdir(resolveInside(root, repository), { recursive: true });
      await workspace.git(["init", "--quiet", "--initial-branch=main"], repository);
      await workspace.commit(repository);
    }
  } catch (error) {
    await workspace.cleanup();
    throw error;
  }
  return workspace;
}

/**
 * Clone a Git repository of a fixture (default its root) into a new temporary workspace: a separate
 * working copy of the same repository, as one more person or agent would have it (SR-081). The clone
 * gets its own empty global Git config (`GIT_CONFIG_GLOBAL`), like every fixture workspace, so its
 * `git` and `commit` work as in any fixture workspace.
 */
export async function cloneFixtureWorkspace(
  origin: FixtureWorkspace,
  repository = ".",
  options: Pick<FixtureOptions, "tempDir"> = {},
): Promise<FixtureWorkspace> {
  const clone = await createFixtureWorkspace(options);
  try {
    await clone.git(["clone", "--quiet", "--no-hardlinks", origin.path(repository), "."]);
  } catch (error) {
    await clone.cleanup();
    throw error;
  }
  return clone;
}
