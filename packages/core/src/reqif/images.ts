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
import { constants, closeSync, openSync, readSync } from "node:fs";
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

/** Opening never waits: a FIFO opens at once and is then no file (no O_NONBLOCK on Windows). */
const READ_NOW = constants.O_RDONLY | constants.O_NONBLOCK;

/** An image found for the import: its real path and hash, not its bytes. */
export interface ImageFile {
  /** Absolute and real. */
  readonly path: string;
  readonly sha256: string;
  /** The stem of the copy (`attachmentStem`). */
  readonly stem: string;
  /** In lower case, with the dot. */
  readonly extension: string;
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

/** The SHA-256 of the regular file at `real`, read in chunks; why not when it is no file or too large. */
const hashOf = async (real: string): Promise<{ readonly sha256: string } | { readonly why: string }> => {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(real, READ_NOW);
  } catch (error) {
    return { why: `cannot be read (${String((error as NodeJS.ErrnoException).code)})` };
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      return { why: "is no file" };
    }
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(CHUNK);
    let total = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, CHUNK, null);
      if (bytesRead === 0) {
        return { sha256: hash.digest("hex") };
      }
      total += bytesRead;
      if (total > IMAGE_LIMIT_BYTES) {
        return { why: `is larger than ${String(IMAGE_LIMIT_BYTES)} bytes, the most the import copies` };
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
    const hashed = await hashOf(real);
    if ("why" in hashed) {
      return missing(data, hashed.why);
    }
    return {
      kind: "found",
      file: {
        path: real,
        sha256: hashed.sha256,
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
 * The bytes of `file` for the copy, read in chunks while it is written (`createFilesAtomic`); throws
 * `file.changed-on-disk` when they are no longer the ones hashed, so nothing of the call is kept.
 */
export const imageContent = (file: ImageFile, shown: string): (() => Iterable<Uint8Array>) =>
  function* () {
    const fd = openSync(file.path, READ_NOW);
    try {
      const hash = createHash("sha256");
      for (;;) {
        const chunk = Buffer.alloc(CHUNK);
        const bytesRead = readSync(fd, chunk, 0, CHUNK, null);
        if (bytesRead === 0) {
          break;
        }
        hash.update(chunk.subarray(0, bytesRead));
        yield chunk.subarray(0, bytesRead);
      }
      if (hash.digest("hex") !== file.sha256) {
        throw new CommandError(
          "file.changed-on-disk",
          `Not imported: the image ${shown} changed while it was copied. Import again.`,
        );
      }
    } finally {
      closeSync(fd);
    }
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
