// The images a ReqIF file embeds (SR-095 AK2, ADR-0013 "Paths"): `<xhtml:object data=…>` names a
// file next to the ReqIF file, and the import copies it next to the element like an image pasted in
// the app (`element.addAttachment`, SR-097: `attachmentStem`, `IMAGE_EXTENSIONS`).
//
// - `data` must be a relative path without scheme (percent-encoded as a URI reference) that
//   resolves, real path included, below the folder of the ReqIF file. Through API and MCP it must
//   also lie inside the repositories (the call's `localPaths`, SR-142). Otherwise it is
//   `image-outside`. A path that is not there, no regular file (a folder, a FIFO: opened without
//   waiting), a file larger than `IMAGE_LIMIT_BYTES` or no image type is `image-missing`.
// - An image is read once to hash it, one at a time, and kept only as its path and hash; the copy
//   reads it again while it is written (`imageContent`), and refuses it when its bytes changed.
// - The name of the copy is `attachmentStem` with its extension in lower case (else the one of its
//   `type`); a name an element has already gets `-2`, `-3`, ..., and the same bytes keep one copy.
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { LocalPaths } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { IMAGE_EXTENSIONS, attachmentStem, clashKey } from "../model/index.js";
import type { XhtmlImage } from "./xhtml-markdown.js";
import { IMAGE_TYPE_EXTENSIONS } from "./xhtml-markdown.js";

/** The largest image the import copies. */
export const IMAGE_LIMIT_BYTES = 64 * 1024 * 1024;

/** Bytes read at a time. */
const CHUNK = 1024 * 1024;

/**
 * Opening never waits (a FIFO opens at once and is then no file) and never follows a symbolic link
 * as the last name; Windows has neither flag, and its links need rights to create.
 */
// A flag Windows lacks is undefined, which `|` takes as 0.
const READ_NOW = constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW;

/** An image found for the import: its real path and hash, not its bytes. */
export interface ImageFile {
  /** Absolute and real. */
  readonly path: string;
  readonly sha256: string;
  /** The stem of the copy (`attachmentStem`). */
  readonly stem: string;
  /** In lower case, with the dot. */
  readonly extension: string;
  /** The file that was hashed, so the copy reads no other one. */
  readonly size: number;
  readonly dev: number;
  readonly ino: number;
}

/** What an image of the file is: found, or why it is not copied (a loss). */
export type ImageRead =
  | { readonly kind: "found"; readonly file: ImageFile }
  | { readonly kind: "image-missing" | "image-outside"; readonly reason: string };

/** Reads the image an XHTML value names, once per `data` and `type` and call. */
export type ImageReader = (image: XhtmlImage) => Promise<ImageRead>;

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** Whether `inner` lies below `outer` (both absolute and real): no `..` segment, not the folder itself. */
const below = (outer: string, inner: string): boolean => {
  const relative = path.relative(outer, inner);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

/** `data` as a relative path, percent-decoded without query or fragment; undefined when it is none. */
const relativePath = (data: string): string | undefined => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(data.replace(/[?#][\s\S]*$/, ""));
  } catch {
    return undefined;
  }
  return SCHEME.test(data) || /^[/\\]/.test(decoded) || path.isAbsolute(decoded) ? undefined : decoded;
};

/** What the hashed file is: its identity and size. */
type Identity = Pick<ImageFile, "size" | "dev" | "ino">;

/** Why the open file `stat` is not the one to read; undefined when it is (`file` for the copy). */
const refusal = (stat: Stats, file?: Identity): string | undefined => {
  if (!stat.isFile()) {
    return "is no file";
  }
  if (stat.size > IMAGE_LIMIT_BYTES) {
    return `is larger than ${String(IMAGE_LIMIT_BYTES)} bytes, the most the import copies`;
  }
  return file === undefined || (stat.dev === file.dev && stat.ino === file.ino && stat.size === file.size)
    ? undefined
    : "changed";
};

/**
 * Hashes the file at `real` (checked to lie below `realFolder`) through one handle: a regular file
 * of at most `IMAGE_LIMIT_BYTES`, which is still the one at `real` after it was opened (no link or
 * folder swapped in meanwhile), read up to its size; why not otherwise.
 */
const hashOf = async (
  real: string,
  realFolder: string,
): Promise<({ readonly sha256: string } & Identity) | { readonly why: string }> => {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(real, READ_NOW);
  } catch (error) {
    return { why: `cannot be read (${String((error as NodeJS.ErrnoException).code)})` };
  }
  try {
    const stat = await handle.stat();
    const why = refusal(stat);
    if (why !== undefined) {
      return { why };
    }
    const again = await fs.realpath(real);
    const now = await fs.stat(again);
    if (!below(realFolder, again) || now.dev !== stat.dev || now.ino !== stat.ino) {
      return { why: "changed while it was read" };
    }
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(CHUNK);
    let total = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(CHUNK, stat.size + 1 - total), null);
      total += bytesRead;
      if (bytesRead === 0 || total > stat.size) {
        return total === stat.size
          ? { sha256: hash.digest("hex"), size: stat.size, dev: stat.dev, ino: stat.ino }
          : { why: "changed while it was read" };
      }
      hash.update(chunk.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
};

/**
 * The reader of the images of the ReqIF file `reqifFile` (absolute) for a call with `localPaths`
 * (see the file comment). Reasons name `data` as written, never an absolute path.
 */
export const imageReader = (reqifFile: string, localPaths: LocalPaths): ImageReader => {
  const folder = path.dirname(reqifFile);
  let realFolder: Promise<string> | undefined;
  const read = new Map<string, Promise<ImageRead>>();
  const outside = (data: string, why: string): ImageRead => ({
    kind: "image-outside",
    reason: `the image ${data} ${why}, so it is not copied`,
  });
  const missing = (data: string, why: string): ImageRead => ({
    kind: "image-missing",
    reason: `the image ${data} ${why}`,
  });
  const readOne = async ({ data, type }: XhtmlImage): Promise<ImageRead> => {
    const relative = relativePath(data);
    if (relative === undefined) {
      return outside(data, "is no relative path");
    }
    const absolute = path.resolve(folder, relative);
    let real: string;
    try {
      real = await fs.realpath(absolute);
    } catch {
      return below(folder, absolute)
        ? missing(data, "is not next to the ReqIF file")
        : outside(data, "is not below the folder of the ReqIF file");
    }
    realFolder ??= fs.realpath(folder);
    if (!below(await realFolder, real)) {
      return outside(data, "is not below the folder of the ReqIF file");
    }
    try {
      await localPaths.check([{ field: `file (image ${data})`, path: real }]);
    } catch (error) {
      if (error instanceof CommandError && error.code === "input.invalid") {
        return outside(data, "is outside the repositories of the workspace");
      }
      throw error;
    }
    const own = path.extname(real).toLowerCase();
    const extension = IMAGE_EXTENSIONS.includes(own) ? own : IMAGE_TYPE_EXTENSIONS.get(type ?? "");
    if (extension === undefined) {
      return missing(data, "is no image ReqSeq embeds");
    }
    const hashed = await hashOf(real, await realFolder);
    if ("why" in hashed) {
      return missing(data, hashed.why);
    }
    return {
      kind: "found",
      file: {
        path: real,
        ...hashed,
        stem: attachmentStem(path.basename(real), extension),
        extension,
      },
    };
  };
  return (image) => {
    const key = `${image.data}\n${image.type ?? ""}`;
    let found = read.get(key);
    if (found === undefined) {
      found = readOne(image);
      read.set(key, found);
    }
    return found;
  };
};

/**
 * The bytes of `file` for the copy, read in chunks while it is written (`createFilesAtomic`) through
 * one handle, never past the hashed size; throws `file.changed-on-disk` when the file or its bytes
 * are no longer the ones hashed, so nothing of the call is kept.
 */
export const imageContent = (file: ImageFile, shown: string): (() => Iterable<Uint8Array>) => {
  const changed = (): CommandError =>
    new CommandError(
      "file.changed-on-disk",
      `Not imported: the image ${shown} changed while it was copied. Import again.`,
    );
  return function* () {
    let fd: number;
    try {
      fd = openSync(file.path, READ_NOW);
    } catch {
      throw changed();
    }
    try {
      if (refusal(fstatSync(fd), file) !== undefined) {
        throw changed();
      }
      const hash = createHash("sha256");
      let total = 0;
      for (;;) {
        const chunk = Buffer.alloc(CHUNK);
        const bytesRead = readSync(fd, chunk, 0, Math.min(CHUNK, file.size + 1 - total), null);
        total += bytesRead;
        if (bytesRead === 0 || total > file.size) {
          break;
        }
        hash.update(chunk.subarray(0, bytesRead));
        yield chunk.subarray(0, bytesRead);
      }
      if (total !== file.size || hash.digest("hex") !== file.sha256) {
        throw changed();
      }
    } finally {
      closeSync(fd);
    }
  };
};

/** The copies of one element's images: a free name per image, the same bytes once. */
export class ImageNames {
  private readonly bySha = new Map<string, string>();
  private readonly taken = new Set<string>();
  readonly files: { readonly name: string; readonly file: ImageFile }[] = [];

  /** The name of the copy of `file` in the element's image folder. */
  nameOf(file: ImageFile): string {
    const known = this.bySha.get(file.sha256);
    if (known !== undefined) {
      return known;
    }
    for (let n = 1; ; n++) {
      const name = `${file.stem}${n === 1 ? "" : `-${String(n)}`}${file.extension}`;
      if (!this.taken.has(clashKey(name))) {
        this.taken.add(clashKey(name));
        this.bySha.set(file.sha256, name);
        this.files.push({ name, file });
        return name;
      }
    }
  }
}
