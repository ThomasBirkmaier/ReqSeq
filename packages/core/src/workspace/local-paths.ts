// Local paths through the API and the MCP server only inside the repositories of the workspace
// (SR-142, ADR-0009 "Local paths"). `invoke` builds a `LocalPaths` per call: open for the command line
// and the app, `confinedLocalPaths` for every other access. A path is judged as the commands resolve
// it (`path.resolve(workspace.root, value)`, so `..` is normalised by its text, as the command will):
// 1. an absolute value must lie by its text inside a root, as given or as real path, with case and
//    Unicode form folded (this step only refuses, so folding makes it more lenient, never less safe).
//    It refuses `~/Downloads/x`, `/etc/x` and UNC or device paths without touching them, so no
//    network share is opened. A relative value resolved from a local root cannot reach a share.
// 2. the real path of its deepest existing part, walked name by name with `lstat` (a link that cannot
//    be followed is refused, so a dangling link cannot carry a write out), joined with the names that
//    do not exist yet, must lie inside the real folder of a root, compared exactly: both sides are
//    `realpath` output, the spelling on disk.
// The roots are the available repositories of the workspace file and always the workspace root (the
// main repository; before `workspace.init`, or with a faulty workspace file, it is the only root).
// Not covered: hard links, a link swapped between the check and the command's own access, and a link
// inside a repository whose target is a share (`realpath` follows it).
import fs from "node:fs/promises";
import path from "node:path";
import type { LocalPathUse, LocalPaths } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { errorCode } from "../files/paths.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "./layout.js";

/** The rule of the command line and the app: every path is accepted. */
export const OPEN_LOCAL_PATHS: LocalPaths = { check: () => Promise.resolve() };

/** Why a path is refused (`details.reason` of the error). */
export type LocalPathReason = "outside-repositories" | "path-unreadable" | "invalid-path";

interface Root {
  /** As configured, absolute. */
  readonly given: string;
  /** With links resolved. */
  readonly real: string;
}

interface Refused extends LocalPathUse {
  readonly reason: LocalPathReason;
  readonly tilde: boolean;
}

export interface LocalPathOptions {
  /** Whose file name rules apply; default `process.platform` (tests). */
  readonly platform?: NodeJS.Platform;
}

/** Names Windows opens as devices, also with an extension (`nul.txt`). */
const DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/iu;

/** Whether `file` is `folder` or below it; both in the same spelling. */
const contains = (folder: string, file: string): boolean =>
  file === folder || file.startsWith(folder.endsWith(path.sep) ? folder : `${folder}${path.sep}`);

const fold = (text: string): string => text.normalize("NFC").toLowerCase();

/** The roots of `workspace` (see the file comment). */
const rootsOf = async (workspace: Workspace): Promise<readonly Root[]> => {
  const roots: Root[] = [
    { given: workspace.root, real: await fs.realpath(workspace.root).catch(() => workspace.root) },
  ];
  let layout;
  try {
    layout = await workspace.get(workspaceLayoutState);
  } catch {
    // No or a faulty workspace file: the workspace root alone, the narrower set.
    return roots;
  }
  for (const repository of layout.repositories) {
    if (repository.available) {
      roots.push({ given: path.resolve(layout.root, repository.path), real: repository.folder });
    }
  }
  return roots;
};

/** A name Windows does not open as written: trailing dots and spaces dropped, a stream, a device. */
const unsafeOnWindows = (name: string): boolean => {
  const trimmed = name.replace(/[. ]+$/u, "");
  return trimmed === "" || name.includes(":") || DEVICE_NAME.test(trimmed);
};

/** The real form of `absolute`: its deepest existing part resolved, the rest appended; or why not. */
const realForm = async (
  absolute: string,
): Promise<{ readonly real: string } | { readonly reason: LocalPathReason }> => {
  const { root } = path.parse(absolute);
  const names = absolute.slice(root.length).split(path.sep).filter(Boolean);
  let existing = root;
  let found = 0;
  for (const name of names) {
    const next = path.join(existing, name);
    let entry;
    try {
      entry = await fs.lstat(next);
    } catch (error) {
      const code = errorCode(error);
      if (code === "ENOENT" || code === "ENOTDIR") {
        break;
      }
      return { reason: "path-unreadable" };
    }
    // A link that cannot be followed (dangling, a loop) could carry a write anywhere.
    if (
      entry.isSymbolicLink() &&
      !(await fs.stat(next).then(
        () => true,
        () => false,
      ))
    ) {
      return { reason: "outside-repositories" };
    }
    existing = next;
    found += 1;
  }
  try {
    return { real: path.join(await fs.realpath(existing), ...names.slice(found)) };
  } catch {
    return { reason: "path-unreadable" };
  }
};

/** Why `value` is refused, or undefined when it lies inside a root. */
const judge = async (
  workspace: Workspace,
  roots: readonly Root[],
  value: string,
  platform: NodeJS.Platform,
): Promise<LocalPathReason | undefined> => {
  if (value.includes("\0")) {
    return "invalid-path";
  }
  const absolute = path.resolve(workspace.root, value);
  if (platform === "win32") {
    const names = absolute.slice(path.parse(absolute).root.length).split(/[\\/]/u).filter(Boolean);
    if (names.some(unsafeOnWindows)) {
      return "invalid-path";
    }
  }
  if (path.isAbsolute(value)) {
    const text = fold(absolute);
    if (!roots.some((r) => contains(fold(r.given), text) || contains(fold(r.real), text))) {
      return "outside-repositories";
    }
  }
  const form = await realForm(absolute);
  if ("reason" in form) {
    return form.reason;
  }
  return roots.some((r) => contains(r.real, form.real)) ? undefined : "outside-repositories";
};

/** `~` as the first name: ReqSeq expands nothing, so it names a folder `~` in the workspace root. */
const startsWithTilde = (value: string): boolean => value === "~" || /^~[\\/]/u.test(value);

/** The base name of `value` for messages, never an absolute path (ADR-0009). */
const shownName = (value: string): string =>
  // eslint-disable-next-line no-control-regex -- control characters (a NUL) are not shown as they are
  (path.basename(value) || "/").replace(/[\u0000-\u001f]/gu, "?");

const PART: Readonly<Record<LocalPathReason, (name: string) => string>> = {
  "outside-repositories": (name) => `${name} does not lie inside the repositories of the workspace`,
  "path-unreadable": (name) => `${name} or a folder above it cannot be looked at`,
  "invalid-path": (name) => `${name} is not a valid local path`,
};

const messageOf = (refused: readonly Refused[]): string => {
  const parts = refused.map(
    (r) =>
      `${r.field} (${shownName(r.path)}): ${
        r.tilde
          ? "~ is not expanded; give the path from the workspace root"
          : PART[r.reason](shownName(r.path))
      }`,
  );
  return `${parts.join("; ")}. Through the API and the MCP server ReqSeq accepts only local paths inside the repositories of the workspace; copy the file into a repository, or use the command line`;
};

/**
 * Rejects with `input.invalid` (`details.reason`, `fields`, `files`: the base names) when a path of
 * `uses` lies outside the repositories of `workspace`; the same whether the path exists or not.
 */
export const assertInsideRepositories = async (
  workspace: Workspace,
  command: string,
  uses: readonly LocalPathUse[],
  options: LocalPathOptions = {},
): Promise<void> => {
  if (uses.length === 0) {
    return;
  }
  const platform = options.platform ?? process.platform;
  const roots = await rootsOf(workspace);
  const refused: Refused[] = [];
  for (const use of uses) {
    const tilde = startsWithTilde(use.path);
    const reason = tilde ? "outside-repositories" : await judge(workspace, roots, use.path, platform);
    if (reason !== undefined) {
      refused.push({ ...use, reason, tilde });
    }
  }
  const [first] = refused;
  if (first !== undefined) {
    throw new CommandError("input.invalid", messageOf(refused), {
      command,
      reason: first.reason,
      fields: refused.map((r) => r.field),
      files: refused.map((r) => shownName(r.path)),
    });
  }
};

/** The rule of an API or MCP call of `command` (SR-142). */
export const confinedLocalPaths = (
  workspace: Workspace,
  command: string,
  options: LocalPathOptions = {},
): LocalPaths => ({
  check: (uses) => assertInsideRepositories(workspace, command, uses, options),
});
