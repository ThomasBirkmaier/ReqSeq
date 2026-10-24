// The git reader (ADR-0006): the only module of LogReq that spawns processes. It runs the installed
// `git` program with a fixed set of read-only commands, so nothing here can change a repository
// (D-036, SR-083). When git is missing or a folder is not a repository, Git-based information is
// unknown; everything else keeps working.
//
// Only typed functions are exported. Each one runs exactly one command line of `COMMANDS`; there is
// no way to pass another subcommand or argument. Add commands from ADR-0006's list as SRs need them.
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

/** Every command line LogReq runs, after the fixed options of `run`. Read-only, no network. */
const COMMANDS = {
  /** Top level of the repository and its HEAD commit. */
  head: ["rev-parse", "--show-toplevel", "--verify", "HEAD"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

type GitCommand = keyof typeof COMMANDS;

/** Variables that point git at another repository; inherited ones (for example in a Git hook) would redirect it. */
const LOCATION_VARIABLES: ReadonlySet<string> = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
]);

/** ADR-0006: no optional locks (a `status` must not refresh the index), never ask for credentials. */
const gitEnv = (): NodeJS.ProcessEnv => ({
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !LOCATION_VARIABLES.has(key.toUpperCase())),
  ),
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
});

const MAX_OUTPUT = 64 * 1024 * 1024;

/** A git call that hangs (network file system, a lock) is stopped; the information is then unknown. */
const TIMEOUT_MS = 10_000;

/** Why Git information is unknown. */
export type GitUnknownReason =
  /** The `git` program is not installed or not on `PATH`. */
  | "no-git"
  /** git refuses the repository because another user owns it (`safe.directory`). */
  | "refused"
  /** git did not answer within the time limit. */
  | "timeout"
  /** Not the top level of a repository, no commit yet, or another failure. */
  | "not-a-repository";

type RunResult =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly reason: GitUnknownReason; readonly detail: string };

interface ExecError extends Error {
  readonly code?: unknown;
  readonly killed?: boolean;
}

const unknownReason = (error: ExecError): GitUnknownReason => {
  if (error.code === "ENOENT") {
    return "no-git";
  }
  if (error.killed === true) {
    return "timeout";
  }
  return /dubious ownership|safe\.directory/.test(error.message) ? "refused" : "not-a-repository";
};

/** Runs one command of `COMMANDS` in `cwd` with the fixed options of ADR-0006. Never rejects. */
const run = async (cwd: string, command: GitCommand): Promise<RunResult> =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["--no-pager", "-c", "core.fsmonitor=false", ...COMMANDS[command]],
      {
        cwd,
        env: gitEnv(),
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT,
        timeout: TIMEOUT_MS,
        killSignal: "SIGKILL",
        windowsHide: true,
      },
      (error, stdout) => {
        resolve(
          error === null
            ? { ok: true, stdout }
            : { ok: false, reason: unknownReason(error), detail: error.message },
        );
      },
    );
  });

/** True when both name the same folder after following links (git prints `C:/...` on Windows). */
const sameFolder = async (a: string, b: string): Promise<boolean> =>
  Promise.all([fs.realpath(path.resolve(a)), fs.realpath(path.resolve(b))]).then(
    ([realA, realB]) => path.relative(realA, realB) === "",
    () => false,
  );

export type HeadCommit =
  | { readonly known: true; readonly commit: string }
  /** `detail` is git's own message, for logs only (it may contain paths). */
  | { readonly known: false; readonly reason: GitUnknownReason; readonly detail: string };

/**
 * The HEAD commit of the repository whose top level is `folder`. Unknown when git is missing,
 * refuses the repository, times out, or `folder` is not a repository (or only a subfolder of one)
 * or has no commit yet.
 */
export const headCommit = async (folder: string): Promise<HeadCommit> => {
  const result = await run(folder, "head");
  if (!result.ok) {
    return { known: false, reason: result.reason, detail: result.detail };
  }
  const [topLevel = "", commit = ""] = result.stdout.trim().split(/\r?\n/);
  if (!(await sameFolder(topLevel, folder))) {
    return { known: false, reason: "not-a-repository", detail: "not the top level of a repository" };
  }
  return { known: true, commit };
};
