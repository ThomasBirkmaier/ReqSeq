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
  /** Run `git <args>` in a repository of the fixture (default the root) and return stdout. */
  git(args: readonly string[], repository?: string): Promise<string>;
  /** Commit everything in a repository (default the root) and return the new HEAD commit ID. */
  commit(repository?: string, message?: string): Promise<string>;
  /** Current HEAD commit ID of a repository (default the root). */
  head(repository?: string): Promise<string>;
  /** Remove the temporary folder. Call it in `afterEach` or `onTestFinished`. */
  cleanup(): Promise<void>;
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

  const workspace: FixtureWorkspace = {
    root,
    path: (relativePath) => resolveInside(root, relativePath),
    async write(relativePath, content) {
      const file = resolveInside(root, relativePath);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content);
    },
    async git(args, repository = ".") {
      const date = new Date(BASE_DATE + commitCount * 1000).toISOString();
      const { stdout } = await execFileAsync("git", [...args], {
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
      return stdout;
    },
    async commit(repository = ".", message = "fixture") {
      commitCount++;
      await workspace.git(["add", "--all"], repository);
      await workspace.git(["commit", "--quiet", "--allow-empty", "--no-verify", "-m", message], repository);
      return workspace.head(repository);
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
