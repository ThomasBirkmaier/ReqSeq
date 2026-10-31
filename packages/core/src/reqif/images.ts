// The images a ReqIF file embeds (SR-095 AK2, ADR-0013 "Paths"): `<xhtml:object data=…>` names a
// file next to the ReqIF file, and the import copies it next to the element like an image pasted in
// the app (`element.addAttachment`, SR-097).
//
// - `data` must be a relative path without scheme (percent-encoded as a URI reference) that
//   resolves, real path included, below the folder of the ReqIF file. Through API and MCP it must
//   also lie inside the repositories (the call's `localPaths`, SR-142). Otherwise it is
//   `image-outside`; a file that is not there or cannot be read (a folder) is `image-missing`.
// - The name of the copy is the source name made portable (`portableName`) with its extension in
//   lower case (else the one of its `type`); a name an element has already gets `-2`, `-3`, ...,
//   and the same bytes keep one copy.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { LocalPaths } from "../catalog.js";
import { CommandError } from "../catalog.js";
import { IMAGE_EXTENSIONS, clashKey, portableName, windowsChanges } from "../model/index.js";
import type { XhtmlImage } from "./xhtml-markdown.js";

/** An image read for the import. */
export interface ImageFile {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  /** The portable name without extension. */
  readonly stem: string;
  /** In lower case, with the dot. */
  readonly extension: string;
}

/** What an image of the file is: read, or why it is not copied (a loss). */
export type ImageRead =
  | { readonly kind: "found"; readonly file: ImageFile }
  | { readonly kind: "image-missing" | "image-outside"; readonly reason: string };

/** Reads the image an XHTML value names, once per `data` and call. */
export type ImageReader = (image: XhtmlImage) => Promise<ImageRead>;

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** The extension of each image type `IMAGE_EXTENSIONS` takes. */
const TYPE_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ["image/avif", ".avif"],
  ["image/bmp", ".bmp"],
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/svg+xml", ".svg"],
  ["image/webp", ".webp"],
]);

/** Whether `inner` is `outer` or below it (both absolute and real). */
const below = (outer: string, inner: string): boolean => {
  const relative = path.relative(outer, inner);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
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

/** The image file read at `real`; undefined when neither its extension nor `type` is an image ReqSeq embeds. */
const imageFile = (real: string, bytes: Uint8Array, type: string | undefined): ImageFile | undefined => {
  const name = path.basename(real);
  const own = path.extname(name).toLowerCase();
  const extension = IMAGE_EXTENSIONS.includes(own) ? own : TYPE_EXTENSIONS.get(type ?? "");
  if (extension === undefined) {
    return undefined;
  }
  const stem = portableName(name.slice(0, name.length - own.length));
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    // A device name such as `CON` or `nul` is refused by Windows with any extension.
    stem: windowsChanges(`${stem}${extension}`) ? `${stem}-image` : stem,
    extension,
  };
};

/**
 * The reader of the images of the ReqIF file `reqifFile` (absolute) for a call with `localPaths`
 * (see the file comment). Errors name `data` as written, never an absolute path.
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
    let bytes: Uint8Array;
    try {
      // A folder is EISDIR (EPERM on some systems): no file.
      bytes = await fs.readFile(real);
    } catch (error) {
      return missing(data, `cannot be read (${String((error as NodeJS.ErrnoException).code)})`);
    }
    const file = imageFile(real, bytes, type);
    return file === undefined ? missing(data, "is no image ReqSeq embeds") : { kind: "found", file };
  };
  return (image) => {
    let found = read.get(image.data);
    if (found === undefined) {
      found = readOne(image);
      read.set(image.data, found);
    }
    return found;
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
