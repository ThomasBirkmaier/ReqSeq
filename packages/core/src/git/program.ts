// Where the git program is (#940). The reader runs git in the repository folder. Started by its
// bare name, Node on Windows (libuv) looks for `git.exe` in the working folder of the child before
// it searches PATH, and on every system a relative entry of PATH (`.`, or an empty one on POSIX)
// names that folder. So a `git.exe` or `git` file in a repository would run instead of Git. The
// reader therefore starts git by the absolute path that `gitProgram` finds.
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

/** What `findGit` looks at: the system, the value of PATH and the file check. */
export interface ProgramEnvironment {
  readonly platform: NodeJS.Platform;
  readonly search: string | undefined;
  /** Whether `file` is a file that may be run. */
  readonly isProgram: (file: string) => boolean;
}

/** Whether `file` is a file the user may run (on Windows: that exists). */
const isProgram = (file: string): boolean => {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

/**
 * The absolute path of the first git program in an absolute folder of PATH, as a shell would find
 * it, or `undefined`. Relative entries are skipped, as they name a folder relative to the folder
 * git runs in. On Windows the program is `git.exe` (Node starts only `.exe` and `.com` files
 * without a shell, and Git for Windows installs `git.exe`), an entry may be in quotes, and an entry
 * without a drive (`\Git\cmd`) is taken on the drive of this process, not of the repository.
 */
export const findGit = (environment: ProgramEnvironment): string | undefined => {
  const windows = environment.platform === "win32";
  const paths = windows ? path.win32 : path.posix;
  const name = windows ? "git.exe" : "git";
  for (const entry of (environment.search ?? "").split(paths.delimiter)) {
    const folder = windows ? entry.replace(/^"(.*)"$/u, "$1") : entry;
    if (paths.isAbsolute(folder)) {
      const file = paths.join(paths.resolve(folder), name);
      if (environment.isProgram(file)) {
        return file;
      }
    }
  }
  return undefined;
};

let found: { readonly search: string | undefined; readonly file: string } | undefined;

/**
 * The absolute path of the git program on PATH of this process (`findGit`), or `undefined` when
 * there is none. A found git is kept while PATH stays the same; without one, every call looks
 * again, so a git installed while ReqSeq runs is found.
 */
export const gitProgram = (): string | undefined => {
  const search = process.env["PATH"];
  if (found !== undefined && found.search === search) {
    return found.file;
  }
  const file = findGit({ platform: process.platform, search, isProgram });
  found = file === undefined ? undefined : { search, file };
  return file;
};
