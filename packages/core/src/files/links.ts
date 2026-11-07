// Links that leave a root are refused before anything follows them (offline rule, #294). `lstat`
// and `realpath` of a path follow every link above its last name, so a link checked out from a
// repository (`img -> /net/host/x`, an automounter, or `\\host\share` on Windows) would open a
// network share before a check after the fact refuses it. The walk here looks at the path name by
// name from the root with `lstat` (which never follows the name it is given, and gets only paths
// whose names above are no links or were replaced by their text) and reads each link's text with
// `readlink` (which follows nothing). A link stays inside when its text, taken name by name from
// the link's real folder (a `..` steps back one folder the walk has checked, as the file system
// does, never by normalising the text), stays inside the root; then the walk goes on with the text
// in its place. An absolute text must name the root exactly. Nothing above the root is looked at.
import fs from "node:fs/promises";
import path from "node:path";
import { errorCode } from "./paths.js";

/** At most this many links per path, as Linux allows (`ELOOP`); more count as leaving. */
export const MAX_LINKS = 40;

/** The names of `text` (a link text or a relative path), split at `/` and, on Windows, at `\`. */
const namesOf = (text: string, platform: NodeJS.Platform): string[] =>
  text.split(platform === "win32" ? /[\\/]/u : "/").filter((name) => name !== "" && name !== ".");

/** `text` without the `\\?\` prefix Windows puts in front of a drive path (a junction's target). */
const withoutLongPrefix = (text: string): string => text.replace(/^\\\\\?\\(?=[A-Za-z]:\\)/u, "");

/** Names Windows opens as devices, also with an extension (`nul.txt`), as in `local-paths.ts`. */
const DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/iu;

/**
 * Whether Windows could open a share or device through the link text `text` (already without the
 * `\\?\` of a drive path), so that it is refused without comparing it with the root: a UNC or
 * device text (`\\`, `//`), one from the root of the current drive (`\x`), a drive-relative
 * one (`Z:x`, resolved against that drive's own working folder), a `:` anywhere but after the drive letter (a stream), and a name Windows does not open
 * as written (trailing dots or spaces, a device name).
 */
const unsafeOnWindows = (text: string): boolean => {
  const drive = /^[A-Za-z]:[\\/]/u.test(text);
  return (
    /^[\\/]/u.test(text) ||
    (drive ? text.slice(2) : text).includes(":") ||
    text.split(/[\\/]/u).some((name, i) => {
      if (name === "" || name === "." || name === ".." || (drive && i === 0)) {
        return false;
      }
      const trimmed = name.replace(/[. ]+$/u, "");
      return trimmed !== name || DEVICE_NAME.test(trimmed);
    })
  );
};

/** An absolute path as its file system root (`/`, `C:\\`) and the names below it. */
interface Split {
  readonly base: string;
  readonly names: readonly string[];
}

const split = (absolute: string, platform: NodeJS.Platform): Split => {
  const base = path.parse(absolute).root;
  return { base, names: namesOf(absolute.slice(base.length), platform) };
};

/** Whether `names` (below `base`) are those of `root` or of a path below it, compared exactly. */
const within = (root: Split, base: string, names: readonly string[]): boolean =>
  base === root.base && root.names.length <= names.length && root.names.every((name, i) => names[i] === name);

/** "Nothing there": the path or a folder above it does not exist, or a name above it is a file. */
const absent = (error: unknown): boolean => {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
};

/** Whether `at` is a link (`lstat`, which does not follow it); undefined when nothing is there. */
const isLink = async (at: string): Promise<boolean | undefined> => {
  try {
    return (await fs.lstat(at)).isSymbolicLink();
  } catch (error) {
    if (absent(error)) {
      return undefined;
    }
    throw error;
  }
};

/** Options of `linksStayInside`. */
export interface LinkOptions {
  /** Further folders, absolute, that a link may lead into (the other repositories of a workspace). */
  readonly alsoInside?: readonly string[];
  /** Whose path rules apply; default `process.platform` (tests). */
  readonly platform?: NodeJS.Platform;
}

/** A folder a link may lead into, as a link text may name it (`as`) and as the walk enters it. */
interface Named {
  readonly as: Split;
  readonly folder: Split;
}

/** Each folder as given and as its real path, both entered as given. */
const namedFolders = async (
  given: readonly Split[],
  platform: NodeJS.Platform,
): Promise<readonly Named[]> => {
  const reals = await Promise.all(
    given.map(async (folder) => ({
      as: split(await fs.realpath(folder.base + folder.names.join(path.sep)), platform),
      folder,
    })),
  );
  return [...given.map((folder) => ({ as: folder, folder })), ...reals];
};

/**
 * Where the walk goes on after a link in the folder `done` whose text is `text`: the folder to
 * stand in and the names to walk from it, or undefined when the text leaves at once.
 */
const afterLink = async (
  text: string,
  done: readonly string[],
  platform: NodeJS.Platform,
  named: () => Promise<readonly Named[]>,
): Promise<{ readonly folder: readonly string[]; readonly names: readonly string[] } | undefined> => {
  if (platform === "win32" && unsafeOnWindows(text)) {
    return undefined;
  }
  if (!(platform === "win32" ? /^[A-Za-z]:[\\/]/u.test(text) : path.isAbsolute(text))) {
    return { folder: done, names: namesOf(text, platform) };
  }
  const target = split(text, platform);
  const match = (await named()).find(({ as }) => within(as, target.base, target.names));
  return match === undefined
    ? undefined
    : { folder: match.folder.names, names: target.names.slice(match.as.names.length) };
};

/**
 * Whether every link on the path `absolute` (`root` or below it, both absolute) stays inside
 * `root` or a folder of `alsoInside`, judged before any of them is followed (see the file comment).
 * Only names inside those folders are looked at; a `..` may step out of one only on the way into
 * another. A path that ends early (a name not there, or a file above a name) is judged as far as
 * it exists. Errors other than "not there" reject.
 */
export const linksStayInside = async (
  root: string,
  absolute: string,
  options: LinkOptions = {},
): Promise<boolean> => {
  const platform = options.platform ?? process.platform;
  const start = split(root, platform);
  const given = [start, ...(options.alsoInside ?? []).map((folder) => split(folder, platform))];
  // An absolute link text may also name a folder by its real path, looked up only for one.
  let named: Promise<readonly Named[]> | undefined;
  const { base } = start;
  let done = [...start.names];
  let rest = namesOf(path.relative(root, absolute), platform);
  let links = 0;
  while (rest.length > 0) {
    const [name, ...after] = rest as [string, ...string[]];
    rest = after;
    if (name === "..") {
      if (done.pop() === undefined) {
        return false;
      }
      continue;
    }
    const next = [...done, name];
    if (!given.some((folder) => within(folder, base, next))) {
      return false;
    }
    const at = base + next.join(path.sep);
    const link = await isLink(at);
    if (link === undefined) {
      // Nothing there (or a file above it): no call can follow anything further down.
      return true;
    }
    if (!link) {
      done = next;
      continue;
    }
    links += 1;
    const text = withoutLongPrefix(await fs.readlink(at));
    const went =
      links > MAX_LINKS
        ? undefined
        : await afterLink(text, done, platform, () => (named ??= namedFolders(given, platform)));
    if (went === undefined) {
      return false;
    }
    done = [...went.folder];
    rest = [...went.names, ...rest];
  }
  return true;
};
