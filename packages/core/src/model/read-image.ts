// element.readImage (SR-251): the bytes of an image file in the repository of an element, named by
// the destination of a Markdown image relative to the element file, with its media type and size.
// The destination is read as the version reads an embedded image (`imageTarget`, the steps of
// `imageLink` with a reason for each refusal), and the file is looked up name by name as the version
// does (`located`), so a name spelled other than on disk, a link to a folder or a nested repository
// is found the same way. Unlike the version, which hashes a symbolic link's text, a link at the file
// is refused as missing: by `lstat`, by `O_NOFOLLOW` where the system has it, and by comparing the
// opened file with the one `lstat` saw (a link swapped in between two folder lookups is not covered).
// The refusals come in the order of SR-251 AK6: outside (AK5), missing (AK2), unreadable (AK3), too
// large (AK6), no image (AK4). Each has one code and one `details.reason`. A `\` is refused by the
// text: only the names before it are looked up, from folder listings, so no UNC or SMB path is ever
// built (SR-078). Nothing is written.
import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "../catalog.js";
import { imageExtension } from "../files/image-type.js";
import type { ElementReadImageInput, ElementReadImageOutput } from "../generated/types.js";
import type { Workspace } from "../runtime/workspace.js";
import { workspaceLayoutState } from "../workspace/index.js";
import { MAX_CONTENT_BYTES } from "./attachment.js";
import type { ImageSource } from "./images.js";
import { imageMemo, imageTarget, located } from "./images.js";
import { isSkippedOnSomeSystem, windowsChanges } from "./portable-names.js";
import { resolveRef } from "./resolve.js";
import { shortIdState } from "./short-id.js";
import { elementStoreState, ignoredBy } from "./store.js";

/** The largest image the command returns: 20 MiB (SR-251 AK6), as `element.addAttachment` takes. */
export const MAX_IMAGE_BYTES = MAX_CONTENT_BYTES;

/** The media type of each extension `imageExtension` gives. */
const MEDIA_TYPES: ReadonlyMap<string, ElementReadImageOutput["mediaType"]> = new Map([
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

/**
 * Opened without following a link and without waiting where the system can: Windows has neither
 * `O_NOFOLLOW` nor `O_NONBLOCK`, and the `|` takes a missing constant as 0 there.
 */
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** Bytes read at a time, so a file that grows while it is read is never read past the limit. */
const CHUNK_BYTES = 1024 * 1024;

/** Why the destination leads out of the repository (AK5), as `details.cause` and in words. */
const OUTSIDE = {
  scheme: "has a scheme",
  absolute: "starts with /",
  parent: "leads out of the repository with ..",
  nested: "leads into a nested repository",
} as const;

const outside = (destination: string, cause: keyof typeof OUTSIDE): CommandError =>
  new CommandError("input.invalid", `Not read: the image ${destination} ${OUTSIDE[cause]}`, {
    destination,
    reason: "image-outside-repository",
    cause,
  });

const missing = (destination: string): CommandError =>
  new CommandError("input.invalid", `Not read: the image ${destination} does not exist`, {
    destination,
    reason: "image-missing",
  });

const errnoOf = (error: unknown): string => String((error as NodeJS.ErrnoException).code);

const unreadable = (destination: string, cause: string): CommandError =>
  new CommandError("file.faulty", `Not read: the image ${destination} cannot be read (${cause})`, {
    destination,
    reason: "image-unreadable",
    cause,
  });

/** Missing when the file or a folder above it is gone (meanwhile, or a link swapped in); else unreadable. */
const failed = (destination: string, error: unknown): CommandError => {
  const code = errnoOf(error);
  return code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP"
    ? missing(destination)
    : unreadable(destination, code);
};

/** The repository of `record` and the `ignore` globs of the workspace file. */
const sourceOf = async (
  workspace: Workspace,
  record: { readonly repository: string },
): Promise<ImageSource> => {
  const layout = await workspace.get(workspaceLayoutState);
  // The store reads only repositories of the layout, so the element's repository is there.
  const repository = layout.repositories.find((r) => r.name === record.repository);
  /* v8 ignore next 3 -- the store reads only repositories of the layout */
  if (repository === undefined) {
    throw new CommandError("internal", `Repository ${record.repository} is not in the workspace`, {});
  }
  return { repository, ignored: ignoredBy(layout) };
};

/**
 * The refusal of a destination that is missing by its text (AK2), or that leads through the
 * `folders` into a nested repository first (AK5). The sentinel `""` is no name in any listing, so
 * `located` lists the last folder too, for its `.git` entry, and finds nothing in it; an error while
 * listing is AK3, which comes after AK2.
 */
const missingByText = async (
  source: ImageSource,
  folders: readonly string[],
  destination: string,
): Promise<CommandError> => {
  const nested =
    folders.length > 0 &&
    (await located(source, [...folders, ""], imageMemo()).catch(() => null)) === "nested";
  return nested ? outside(destination, "nested") : missing(destination);
};

/**
 * The absolute path of the file `names` leads to (`located`), refused by AK5, AK2 or AK3 otherwise,
 * in that order: a nested repository on the way; a name the element walk skips or the workspace
 * file ignores, a name Windows changes, or a name spelled other than on disk; a folder that cannot
 * be listed.
 */
const lookedUp = async (
  source: ImageSource,
  names: readonly string[],
  destination: string,
): Promise<string> => {
  const skipped = names.some(
    (name, i) =>
      isSkippedOnSomeSystem(name) || windowsChanges(name) || source.ignored(names.slice(0, i + 1).join("/")),
  );
  let spelled: readonly string[] | null | "nested";
  try {
    spelled = await located(source, names, imageMemo());
  } catch (error) {
    // `located` refuses a folder it cannot list with `file.faulty`, its errno code as the reason.
    throw skipped
      ? missing(destination)
      : unreadable(destination, String((error as CommandError).details?.["reason"]));
  }
  if (spelled === "nested") {
    throw outside(destination, "nested");
  }
  if (spelled === null || skipped) {
    throw missing(destination);
  }
  return path.join(source.repository.folder, ...spelled);
};

const tooLarge = (destination: string, size: number): CommandError =>
  new CommandError(
    "input.invalid",
    `Not read: the image ${destination} has ${String(size)} bytes, more than the limit of ${String(MAX_IMAGE_BYTES)} bytes (20 MiB)`,
    { destination, reason: "image-too-large", size, limit: MAX_IMAGE_BYTES },
  );

/** The bytes of `handle` up to its end, refused as too large as soon as there are more than the limit. */
const readAtMost = async (handle: FileHandle, destination: string): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { bytesRead, buffer } = await handle.read({ buffer: Buffer.alloc(CHUNK_BYTES) });
    if (bytesRead === 0) {
      return Buffer.concat(chunks, total);
    }
    chunks.push(buffer.subarray(0, bytesRead));
    total += bytesRead;
    if (total > MAX_IMAGE_BYTES) {
      throw tooLarge(destination, total);
    }
  }
};

/** The bytes of the regular file at `absolute`, refused by AK2, AK3 or AK6. */
const readFile = async (absolute: string, destination: string): Promise<Buffer> => {
  let handle: FileHandle;
  let seen: { readonly dev: number; readonly ino: number };
  try {
    // A link, a folder or anything else that is not a regular file is missing (AK2); a fifo is never waited for.
    const stat = await fs.lstat(absolute);
    if (!stat.isFile()) {
      throw missing(destination);
    }
    seen = stat;
    handle = await fs.open(absolute, READ_FLAGS);
  } catch (error) {
    throw error instanceof CommandError ? error : failed(destination, error);
  }
  try {
    const opened = await handle.stat();
    // Another file than the one `lstat` saw (one swapped in, or a link's target where `O_NOFOLLOW` is missing).
    if (!opened.isFile() || opened.dev !== seen.dev || opened.ino !== seen.ino) {
      throw missing(destination);
    }
    if (opened.size > MAX_IMAGE_BYTES) {
      throw tooLarge(destination, opened.size);
    }
    return await readAtMost(handle, destination);
  } catch (error) {
    throw error instanceof CommandError ? error : unreadable(destination, errnoOf(error));
  } finally {
    await handle.close();
  }
};

/** `element.readImage` (SR-251): the image `input.destination` names, relative to the file of `input.ref`. See the head of this file. */
export const readImage = async (
  workspace: Workspace,
  input: ElementReadImageInput,
): Promise<Omit<ElementReadImageOutput, "answer">> => {
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const record = resolveRef(store, shortIds, input.ref, { repository: input.repository, file: input.file });
  const { destination } = input;
  const target = imageTarget(record.file, destination);
  if (target.kind === "outside") {
    throw outside(destination, target.cause);
  }
  const source = await sourceOf(workspace, record);
  if (target.kind === "missing") {
    throw await missingByText(source, target.folders, destination);
  }
  const bytes = await readFile(await lookedUp(source, target.names, destination), destination);
  const mediaType = MEDIA_TYPES.get(imageExtension(bytes) ?? "");
  if (mediaType === undefined) {
    throw new CommandError(
      "input.invalid",
      `Not read: ${destination} is no AVIF, BMP, GIF, JPEG, PNG, SVG or WebP image by its content`,
      { destination, reason: "not-an-image" },
    );
  }
  return { content: bytes.toString("base64"), mediaType, size: bytes.length };
};
