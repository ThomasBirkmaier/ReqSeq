// The images an element embeds, as its version counts them (ADR-0005 "Files", D-057, SR-091 AK4;
// rule of spec question #131, option 1). The links come from the shared Markdown scanner; the
// files block hashes the files. The result is the same on every operating system and file system:
// each name of a path must be spelled as on disk (compared after NFC), names that Windows changes
// count as missing everywhere, and only the folder walk of the repository decides what is there.
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "../catalog.js";
import type { FileHash } from "../files/index.js";
import { readFileSha256, readFileStat } from "../files/index.js";
import type { VersionFile } from "../version/version.js";
import type { RepositoryLocation } from "../workspace/index.js";
import { isSkippedOnSomeSystem, windowsChanges } from "./discover.js";
import { markdownImages } from "./markdown-links.js";

/** A URL with a scheme (`https:`, `file:`, `data:`, also `C:` on Windows): never relative. */
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** A backslash before ASCII punctuation escapes it (CommonMark). */
const ESCAPE = /\\([!-/:-@[-`{-~])/g;

/** Whether `text` holds a C0 control character or DEL: a path with one never counts. */
const hasControl = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
};

/** Percent-decoded; a destination that is not valid percent-encoded UTF-8 stays as written. */
const percentDecoded = (destination: string): string => {
  try {
    return decodeURIComponent(destination);
  } catch {
    return destination;
  }
};

/** One image link that counts, before the disk is looked at. */
export interface ImageLink {
  /** As written in the canonical form: relative to the folder of the element file, with `/`. */
  readonly path: string;
  /** The names from the repository folder down to the file. */
  readonly names: readonly string[];
  /** Missing whatever is on disk: a `\`, a trailing `/` or a name that Windows changes. */
  readonly missing: boolean;
}

/** Where the images of an element are looked up: its repository and the walk's `ignore` globs. */
export interface ImageSource {
  readonly repository: Pick<RepositoryLocation, "folder" | "excludes">;
  /** The `ignore` globs of the workspace file (`ignoredBy`), as the element walk uses them. */
  readonly ignored: (relativePath: string) => boolean;
}

/** Whether the walk leaves out a path below `names[0..i]`: a skipped name or an `ignore` glob. */
const walkSkips = (names: readonly string[], ignored: (relativePath: string) => boolean): boolean =>
  names.some((name, i) => isSkippedOnSomeSystem(name) || ignored(names.slice(0, i + 1).join("/")));

/**
 * The image link a destination makes, or undefined when it does not count (ADR-0005 "Files"):
 * escapes are removed, a query or fragment dropped, the rest percent-decoded and resolved against
 * the element's folder. It does not count when it is empty, an absolute URL or path, holds a
 * control character, leaves the repository, names the repository folder, the element's folder or
 * the element's own file, or goes through a name the element walk skips.
 */
export const imageLink = (
  elementFile: string,
  destination: string,
  ignored: (relativePath: string) => boolean,
): ImageLink | undefined => {
  const link = destination.replace(ESCAPE, "$1").replace(/[?#][\s\S]*$/, "");
  if (link === "" || SCHEME.test(link) || link.startsWith("/")) {
    return undefined;
  }
  const decoded = percentDecoded(link);
  const folder = path.posix.dirname(elementFile);
  const resolved = path.posix.normalize(path.posix.join(folder, decoded)).replace(/\/$/, "");
  if (hasControl(decoded) || resolved === "." || resolved === ".." || resolved.startsWith("../")) {
    return undefined;
  }
  const names = resolved.split("/");
  // The element's folder and file count as themselves in any normal form.
  const nfc = resolved.normalize("NFC");
  if (nfc === folder.normalize("NFC") || nfc === elementFile.normalize("NFC") || walkSkips(names, ignored)) {
    return undefined;
  }
  const slash = path.posix.normalize(decoded).endsWith("/");
  // Both from the repository folder, so the working directory of the process plays no part.
  const relative = path.posix.relative(`/${folder}`, `/${resolved}`);
  return {
    path: slash ? `${relative}/` : relative,
    names,
    missing: slash || decoded.includes("\\") || names.some(windowsChanges),
  };
};

/**
 * The image links of `body` that count to the version of the element in `elementFile` (relative
 * to its repository, with `/`), each path once, in the order first embedded (`imageLink`).
 */
export const imageLinks = (
  elementFile: string,
  body: string,
  ignored: (relativePath: string) => boolean = () => false,
): ImageLink[] => {
  const links = new Map<string, ImageLink>();
  for (const destination of markdownImages(body)) {
    const link = imageLink(elementFile, destination, ignored);
    if (link !== undefined && !links.has(link.path)) {
      links.set(link.path, link);
    }
  }
  return [...links.values()];
};

/** The entries of a folder by name; undefined when it is not there. */
interface Folder {
  readonly byName: ReadonlyMap<string, Dirent>;
  /** The entries by their name after NFC, built the first time a name is not found exactly. */
  byNfc?: ReadonlyMap<string, readonly Dirent[]>;
}
type Listing = Folder | undefined;

/** What one image is on disk: hashed, missing, or not counted (inside a nested repository). */
type ImageState = FileHash | null | "nested";

/**
 * Folder listings and image states already read, by absolute folder and by repository and path.
 * Pass one memo to the `embeddedImages` calls of one run; files changed meanwhile are not seen.
 */
export interface ImageMemo {
  readonly listings: Map<string, Promise<Listing>>;
  readonly images: Map<string, Promise<ImageState>>;
}

export const imageMemo = (): ImageMemo => ({ listings: new Map(), images: new Map() });

/** An embedded image with its hash, and the `lstat` it was read after (for a cache, ADR-0008). */
export interface EmbeddedImage extends VersionFile {
  readonly size?: number;
  readonly mtimeMs?: number;
}

const unlistable = (folder: string, error: unknown): CommandError => {
  const code = String((error as NodeJS.ErrnoException).code);
  return new CommandError("file.faulty", `Cannot read folder ${folder}: ${code}`, {
    file: folder,
    reason: code,
  });
};

const listFolder = (memo: ImageMemo, absolute: string, relative: string): Promise<Listing> => {
  const known = memo.listings.get(absolute);
  if (known !== undefined) {
    return known;
  }
  const pending = (async (): Promise<Listing> => {
    try {
      const entries = await fs.readdir(absolute, { withFileTypes: true });
      return { byName: new Map(entries.map((e) => [e.name, e])) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return undefined;
      }
      throw unlistable(relative === "" ? "." : relative, error);
    }
  })();
  memo.listings.set(absolute, pending);
  return pending;
};

/**
 * The entry spelled `name`: the one with exactly that name, else the only one equal to it after
 * NFC (an NFD name on disk for an NFC link, or the other way round); undefined otherwise. Case is
 * never ignored, also where the file system ignores it.
 */
const entryNamed = (folder: Folder, name: string): Dirent | undefined => {
  const exact = folder.byName.get(name);
  if (exact !== undefined) {
    return exact;
  }
  if (folder.byNfc === undefined) {
    const byNfc = new Map<string, Dirent[]>();
    for (const entry of folder.byName.values()) {
      const key = entry.name.normalize("NFC");
      byNfc.set(key, [...(byNfc.get(key) ?? []), entry]);
    }
    folder.byNfc = byNfc;
  }
  const equal = folder.byNfc.get(name.normalize("NFC")) ?? [];
  return equal.length === 1 ? equal[0] : undefined;
};

/**
 * The path at `names` (from the repository folder), name by name as the folder walk sees it: every
 * folder above it a real folder (a link to a folder makes everything below it missing), not the
 * folder of a nested repository (one with a `.git` entry, or in `excludes`), every name spelled as
 * on disk (`entryNamed`). Gives the names as spelled on disk, `null` when it is missing, or
 * `"nested"`.
 */
const located = async (
  source: ImageSource,
  names: readonly string[],
  memo: ImageMemo,
): Promise<readonly string[] | null | "nested"> => {
  const { folder, excludes } = source.repository;
  const spelled: string[] = [];
  for (const [i, name] of names.entries()) {
    const relative = spelled.join("/");
    const absolute = path.join(folder, ...spelled);
    if (i > 0 && excludes.includes(absolute)) {
      return "nested";
    }
    const listing = await listFolder(memo, absolute, relative);
    if (listing === undefined) {
      return null;
    }
    if (i > 0 && listing.byName.has(".git")) {
      return "nested";
    }
    const entry = entryNamed(listing, name);
    if (entry === undefined) {
      return null;
    }
    spelled.push(entry.name);
    if (i < names.length - 1 && !entry.isDirectory()) {
      return null;
    }
  }
  return spelled;
};

/** The state of the image at `names` (`located`); the file itself a regular file or a link. */
const imageState = async (
  source: ImageSource,
  names: readonly string[],
  memo: ImageMemo,
): Promise<ImageState> => {
  const spelled = await located(source, names, memo);
  return spelled === null || spelled === "nested"
    ? spelled
    : readFileSha256(source.repository.folder, spelled.join("/"));
};

/**
 * Whether the working copy has the path at `names` inside a nested repository now (`located`):
 * such an image never counts, so it does not count at an old commit either (ADR-0005 "Version
 * date"). Errors other than "not there" reject with `file.faulty`.
 */
export const inNestedRepository = async (
  source: ImageSource,
  names: readonly string[],
  memo: ImageMemo,
): Promise<boolean> => (await located(source, names, memo)) === "nested";

const stateOf = (source: ImageSource, link: ImageLink, memo: ImageMemo): Promise<ImageState> => {
  if (link.missing) {
    return Promise.resolve(null);
  }
  const key = `${source.repository.folder}\n${link.names.join("/")}`;
  const known = memo.images.get(key);
  if (known !== undefined) {
    return known;
  }
  const pending = imageState(source, link.names, memo);
  memo.images.set(key, pending);
  return pending;
};

/** Files opened at the same time, so an element with many images does not exhaust file handles. */
const CONCURRENCY = 32;

/** `fn` of every item, at most `CONCURRENCY` at a time, in the order of `items`. */
export const mapBounded = async <T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = [];
  const queue = items.entries();
  const worker = async (): Promise<void> => {
    for (const [index, item] of queue) {
      results[index] = await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
};

/**
 * What one image link that is looked up found on disk, kept with a version so that the version can
 * be checked on use (`imagesUnchanged`, ADR-0008): the size and modification time of the file it
 * hashed, `null` when it was missing, `"nested"` when it lay in a nested repository.
 */
export interface ImageSeen {
  /** The names from the repository folder down to the file (`ImageLink.names`). */
  readonly names: readonly string[];
  readonly found: { readonly size: number; readonly mtimeMs: number } | null | "nested";
}

/** The embedded images of an element (`embeddedImages`) and what each lookup found (`ImageSeen`). */
export interface LookedUpImages {
  readonly images: EmbeddedImage[];
  /** Every link that is looked up on disk, in the order of `links`; one missing whatever is on disk is left out. */
  readonly seen: ImageSeen[];
}

/**
 * The images `links` name (`imageLinks`), looked up in the repository of `source` with their
 * SHA-256, and what each lookup found. Images inside a nested repository do not count. Errors other
 * than "not there" reject with `file.faulty`.
 */
export const lookUpImages = async (
  source: ImageSource,
  links: readonly ImageLink[],
  memo: ImageMemo = imageMemo(),
): Promise<LookedUpImages> => {
  const read = await mapBounded(links, async (link) => ({ link, state: await stateOf(source, link, memo) }));
  const images: EmbeddedImage[] = [];
  const seen: ImageSeen[] = [];
  for (const { link, state } of read) {
    if (!link.missing) {
      seen.push({
        names: link.names,
        found: state === null || state === "nested" ? state : { size: state.size, mtimeMs: state.mtimeMs },
      });
    }
    if (state !== "nested") {
      images.push(
        state === null
          ? { path: link.path, sha256: null }
          : { path: link.path, sha256: state.sha256, size: state.size, mtimeMs: state.mtimeMs },
      );
    }
  }
  return { images, seen };
};

/**
 * The embedded images of an element with their SHA-256 (`imageLinks`), looked up in its
 * repository; `null` for one that is missing. Images inside a nested repository do not count.
 * Errors other than "not there" reject with `file.faulty`.
 */
export const embeddedImages = async (
  source: ImageSource,
  elementFile: string,
  body: string,
  memo: ImageMemo = imageMemo(),
): Promise<EmbeddedImage[]> =>
  (await lookUpImages(source, imageLinks(elementFile, body, source.ignored), memo)).images;

/** Whether the lookup `seen` finds the same now: the same kind of result, a file with the same size and time. */
const seenAgain = async (source: ImageSource, seen: ImageSeen, memo: ImageMemo): Promise<boolean> => {
  const spelled = await located(source, seen.names, memo);
  if (spelled === null || spelled === "nested") {
    return seen.found === spelled;
  }
  const now = await readFileStat(source.repository.folder, spelled.join("/"));
  const { found } = seen;
  return now === null || found === null || found === "nested"
    ? now === found
    : now.size === found.size && now.mtimeMs === found.mtimeMs;
};

/**
 * Whether every image lookup in `seen` (`lookUpImages`) finds the same on disk now (ADR-0008): a
 * missing image still missing, one in a nested repository still there, a file with the same size
 * and modification time (as the watcher compares Markdown files below a changed folder). Presence
 * is looked up name by name as `lookUpImages` does, so a rename to another case, a new `.git` entry
 * above an image or a twin name in the other normal form counts as a change. Nothing is hashed.
 * Pass a new `memo`: listings in an old one are not read again. Errors other than "not there"
 * reject with `file.faulty`.
 */
export const imagesUnchanged = async (
  source: ImageSource,
  seen: readonly ImageSeen[],
  memo: ImageMemo,
): Promise<boolean> => (await mapBounded(seen, (s) => seenAgain(source, s, memo))).every(Boolean);
