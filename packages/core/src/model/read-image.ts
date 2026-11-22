// element.readImage (SR-251): the bytes of an image file in the repository of an element, named by
// the destination of a Markdown image relative to the element file, with its media type and size.
// The destination is read as the version reads an embedded image (`imageTarget`, the steps of
// `imageLink` with a reason for each refusal), and the file is looked up name by name as the version
// does (`located`), so a name spelled other than on disk, a link to a folder or a nested repository
// is found the same way. Unlike the version, which hashes a symbolic link's text, a link at the file
// is refused as missing, so no link ever leads the read out of the repository. The refusals come in
// the order of SR-251 AK6: outside (AK5), missing (AK2), unreadable (AK3), too large (AK6), no image
// (AK4). Each has one code and one `details.reason`. A `\` is refused by the text, before any file
// system call, so no UNC or SMB path is opened (SR-078). Nothing is written.
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
 * Opened without following a link where the system can: Windows has no `O_NOFOLLOW`, and the `|`
 * takes the missing constant as 0 there. The `lstat` before the open refuses a link on every system.
 */
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;

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

/**
 * The names on disk of the file `names` leads to (`located`), refused by AK5, AK2 or AK3 otherwise:
 * a nested repository on the way, a name the element walk skips or the workspace file ignores, a
 * name Windows changes, or a name spelled other than on disk.
 */
const lookedUp = async (
  workspace: Workspace,
  record: { readonly repository: string },
  names: readonly string[],
  destination: string,
): Promise<string> => {
  const layout = await workspace.get(workspaceLayoutState);
  // The store reads only repositories of the layout, so the element's repository is there.
  const repository = layout.repositories.find((r) => r.name === record.repository);
  /* v8 ignore next 3 -- the store reads only repositories of the layout */
  if (repository === undefined) {
    throw new CommandError("internal", `Repository ${record.repository} is not in the workspace`, {});
  }
  const ignored = ignoredBy(layout);
  let spelled: readonly string[] | null | "nested";
  try {
    spelled = await located({ repository, ignored }, names, imageMemo());
  } catch (error) {
    // `located` refuses a folder it cannot list with `file.faulty`, its errno code as the reason.
    throw unreadable(destination, String((error as CommandError).details?.["reason"]));
  }
  if (spelled === "nested") {
    throw outside(destination, "nested");
  }
  const skipped = names.some(
    (name, i) =>
      isSkippedOnSomeSystem(name) || windowsChanges(name) || ignored(names.slice(0, i + 1).join("/")),
  );
  if (spelled === null || skipped) {
    throw missing(destination);
  }
  return path.join(repository.folder, ...spelled);
};

/** The bytes of the regular file at `absolute`, refused by AK2, AK3 or AK6. */
const readFile = async (absolute: string, destination: string): Promise<Buffer> => {
  let handle: FileHandle;
  try {
    // A link, a folder or anything else that is not a regular file is missing (AK2); a fifo is never opened.
    if (!(await fs.lstat(absolute)).isFile()) {
      throw missing(destination);
    }
    handle = await fs.open(absolute, READ_FLAGS);
  } catch (error) {
    throw error instanceof CommandError ? error : failed(destination, error);
  }
  try {
    const { size } = await handle.stat();
    if (size > MAX_IMAGE_BYTES) {
      throw new CommandError(
        "input.invalid",
        `Not read: the image ${destination} has ${String(size)} bytes, more than the limit of ${String(MAX_IMAGE_BYTES)} bytes (20 MiB)`,
        { destination, reason: "image-too-large", size, limit: MAX_IMAGE_BYTES },
      );
    }
    return await handle.readFile();
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
  if (target.kind === "missing") {
    throw missing(destination);
  }
  const bytes = await readFile(await lookedUp(workspace, record, target.names, destination), destination);
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
