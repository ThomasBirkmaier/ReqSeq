// Images of an element (SR-097, ADR-0004 "Text and inline references", spec question ThomasBirkmaier/ReqSeq-archive#334 option
// 1): `element.addAttachment` copies an image into the folder named like the element file without
// `.md`, next to it (`requirements/SR-825b7146fb54/layout.png`), and gives the Markdown that embeds
// it with a relative link. The text is not changed: the editor (or any caller) inserts the Markdown
// and saves the text with `element.update`, so the image counts to the version from then on (D-057,
// ADR-0005 "Files").
//
// - The name is the source name made portable (`portableName`): ASCII letters, digits, `_` and `-`,
//   the extension in lower case. It is the same on Windows, macOS and Linux, needs no escaping in
//   Markdown, and every Git server and text editor finds it under the same spelling (SR-097 AK2).
// - Nothing is replaced or deleted (D-045): a name the folder has already (in any case or Unicode
//   normal form, as macOS and Windows compare names) gets `-2`, `-3`, ...; a file with exactly that
//   name and the same bytes is reused. A name the element's text already embeds (a missing image)
//   is skipped too, so this command never changes the element's version by itself.
// - The new path must pass the rules of the element walk (`refuseUnlisted`): never below `.git`
//   (D-036), not ignored, not in a nested repository, portable names.
// - The source is a local path (ADR-0009 `localPath`), also over the API and MCP, which run on the
//   same machine only; it is read whole into memory. An absolute source must be on a drive or below
//   `/` by its text (`typedWorkspaceFolder`), checked before any file-system call: a Windows UNC
//   or device path (`\\host\share\x.png`, `\\?\…`) is refused (`source-not-local`), since
//   reading it would open a network connection (#294). Errors name only its base name, never an
//   absolute path, so every access gives the same error (D-029).
// - Or the source is given as bytes (`content`, base64, with `name`), for an image that has no file,
//   such as one pasted or dropped in the app (SR-190 AK3). Exactly one of `sourcePath` and `content`.
//   At most `MAX_CONTENT_BYTES` decoded, so a request fits the body limit of the API and MCP (SR-080).
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { CommandError } from "../catalog.js";
import { createFolder, readFileSha256, writeFileAtomic } from "../files/index.js";
import type { ElementAddAttachmentInput, ElementAddAttachmentOutput } from "../generated/types.js";
import { metamodelState } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation } from "../workspace/index.js";
import { typedWorkspaceFolder, workspaceLayoutState } from "../workspace/index.js";
import { ELEMENT_FILE_EXTENSION, windowsChanges } from "./discover.js";
import { imageLinks } from "./images.js";
import { resolveRef } from "./resolve.js";
import { shortIdState } from "./short-id.js";
import { elementStoreState } from "./store.js";
import { assertElementWritable, readUnchanged, refuseUnlisted, workspacePath } from "./write.js";

/** The image types `element.addAttachment` takes, by extension in lower case. */
export const IMAGE_EXTENSIONS: readonly string[] = [
  ".avif",
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
];

/** The largest image given as `content` (20 MiB): its base64 stays below the 32 MiB body of the API and MCP. */
export const MAX_CONTENT_BYTES = 20 * 1024 * 1024;

/** The characters of base64 (RFC 4648 section 4), without the padding `=`. */
const BASE64_CHARACTERS = /[A-Za-z0-9+/]/;

/**
 * Whether `text` is padded base64: a multiple of 4 characters of the alphabet, with `=` only as the
 * last one or two. A loop, not one regular expression, which would run out of stack on 28 MB.
 */
export const isBase64 = (text: string): boolean => {
  if (text.length % 4 !== 0) {
    return false;
  }
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  for (let i = 0; i < text.length - padding; i += 1) {
    if (!BASE64_CHARACTERS.test(text.charAt(i))) {
      return false;
    }
  }
  return true;
};

/** Characters of a name before its extension. */
const MAX_NAME = 64;

const invalid = (message: string, details: Record<string, unknown>): CommandError =>
  new CommandError("input.invalid", message, details);

/**
 * `text` as a portable name: compatibility decomposition (NFKD) with the combining marks dropped
 * (`Ä` becomes `A`), every run of other characters than ASCII letters, digits, `_` and `-` one
 * `-`, no `-` at either end, at most 64 characters; `fallback` when nothing is left (baseline
 * files, ADR-0018, take this name too).
 */
export const portableName = (text: string, fallback = "image"): string => {
  const ascii = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-");
  const name = ascii
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME)
    .replace(/-+$/, "");
  return name === "" ? fallback : name;
};

/**
 * The stem of the copy of an image named `name` with `extension` (lower case, with the dot): the
 * name before its extension made portable (`portableName`), with `-image` after a Windows device
 * name such as `CON` or `nul`, which Windows refuses with any extension. Shared with the ReqIF
 * import, which copies an image like this command (SR-095 AK2).
 */
export const attachmentStem = (name: string, extension: string): string => {
  const stem = portableName(name.slice(0, name.length - path.extname(name).length));
  return windowsChanges(`${stem}${extension}`) ? `${stem}-image` : stem;
};

/** A source image as read. */
interface Source {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  /** The portable name without extension (`portableName`), also the alt text. */
  readonly stem: string;
  /** The extension in lower case, with the dot. */
  readonly extension: string;
}

/** Why a source cannot be read: missing (`input.invalid`) or another error (`file.faulty`). */
const unreadable = (name: string, error: unknown): CommandError => {
  const code = String((error as NodeJS.ErrnoException).code);
  return code === "ENOENT" || code === "ENOTDIR"
    ? invalid(`The image ${name} does not exist`, { reason: "source-missing" })
    : new CommandError("file.faulty", `Cannot read the image ${name} (${code})`, { reason: code });
};

/**
 * The absolute path of the source `sourcePath` (relative to `root`, or absolute), by its text alone,
 * before any file-system call. An absolute `sourcePath` must pass `typedWorkspaceFolder`, so on
 * Windows a UNC or device path, whose read would connect to its host (offline rule), is refused.
 */
export const sourceLocation = (
  root: string,
  sourcePath: string,
  platform: NodeJS.Platform = process.platform,
): string => {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const absolute = paths.resolve(root, sourcePath);
  if (
    paths.isAbsolute(sourcePath) &&
    typedWorkspaceFolder(sourcePath, { platform, home: root }) === undefined
  ) {
    throw invalid(
      `${paths.basename(absolute)} is not a path on a drive of this computer; ReqSeq reads no network or device path`,
      {
        reason: "source-not-local",
      },
    );
  }
  return absolute;
};

/** The extension of `name` in lower case, which must be one of an image. */
const imageExtension = (name: string): string => {
  const extension = path.extname(name).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(extension)) {
    throw invalid(`${name} is no image ReqSeq embeds; the name must end in ${IMAGE_EXTENSIONS.join(", ")}`, {
      reason: "not-an-image",
      extension,
    });
  }
  return extension;
};

const sourceOf = (bytes: Uint8Array, name: string, extension: string): Source => ({
  bytes,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  stem: attachmentStem(name, extension),
  extension,
});

/**
 * The image given as `content` (base64) with `name`: the base name of `name` names it. The base64 is
 * checked by its pattern, so a request with other characters is refused instead of decoded loosely.
 */
export const contentSource = (content: string, name: string): Source => {
  const base = name.slice(name.search(/[^/\\]*$/));
  const extension = imageExtension(base);
  if (!isBase64(content)) {
    throw invalid(`The content of ${base} is not base64`, { reason: "content-not-base64" });
  }
  const bytes = Buffer.from(content, "base64");
  if (bytes.length > MAX_CONTENT_BYTES) {
    throw invalid(`${base} is larger than 20 MiB`, { reason: "content-too-large", limit: MAX_CONTENT_BYTES });
  }
  return sourceOf(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), base, extension);
};

/** The source of `input`: exactly one of `sourcePath` and `content` (with `name`). */
const sourceFor = async (root: string, input: ElementAddAttachmentInput): Promise<Source> => {
  const { sourcePath, content, name } = input;
  if (sourcePath !== undefined && (content !== undefined || name !== undefined)) {
    throw invalid("Give the image as sourcePath or as content with name, not both", {
      reason: "source-twice",
    });
  }
  if (sourcePath !== undefined) {
    return readSource(root, sourcePath);
  }
  if (content === undefined || name === undefined) {
    throw invalid("Give the image as sourcePath, or as content with name", { reason: "source-none" });
  }
  return contentSource(content, name);
};

/** The image at `sourcePath` (relative to `root`, or absolute): a regular file with an image extension. */
const readSource = async (root: string, sourcePath: string): Promise<Source> => {
  const absolute = sourceLocation(root, sourcePath);
  const name = path.basename(absolute);
  const extension = imageExtension(name);
  let bytes: Uint8Array;
  try {
    if (!(await fs.stat(absolute)).isFile()) {
      throw invalid(`${name} is not a file`, { reason: "source-not-a-file" });
    }
    bytes = await fs.readFile(absolute);
  } catch (error) {
    throw error instanceof CommandError ? error : unreadable(name, error);
  }
  return sourceOf(bytes, name, extension);
};

/** How names are compared for a clash: after NFC and in lower case, as macOS and Windows compare them. */
export const clashKey = (name: string): string => name.normalize("NFC").toLowerCase();

/** The entries of `folder` (relative to the repository, `/`); none when it does not exist yet. */
const entriesOf = async (repository: RepositoryLocation, folder: string): Promise<Dirent[]> => {
  try {
    return await fs.readdir(path.join(repository.folder, ...folder.split("/")), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw new CommandError(
      "file.faulty",
      `Cannot read folder ${folder} (${String((error as NodeJS.ErrnoException).code)})`,
      { file: folder, reason: String((error as NodeJS.ErrnoException).code) },
    );
  }
};

/** A name in the image folder: a new one, or the one of a file with the same bytes. */
interface FreeName {
  readonly name: string;
  readonly reused: boolean;
}

/**
 * The first of `<stem><ext>`, `<stem>-2<ext>`, `<stem>-3<ext>`, ... in `folder` that is a file with
 * the bytes of `source` (reused) or clashes with no entry of the folder and no path in `embedded`
 * (`clashKey`, paths relative to the repository).
 */
const freeName = async (
  repository: RepositoryLocation,
  folder: string,
  source: Source,
  embedded: ReadonlySet<string>,
): Promise<FreeName> => {
  const entries = await entriesOf(repository, folder);
  const exact = new Map(entries.map((entry) => [entry.name, entry]));
  const taken = new Set(entries.map((entry) => clashKey(entry.name)));
  for (let n = 1; ; n++) {
    const name = `${source.stem}${n === 1 ? "" : `-${String(n)}`}${source.extension}`;
    if (
      exact.get(name)?.isFile() === true &&
      (await readFileSha256(repository.folder, `${folder}/${name}`))?.sha256 === source.sha256
    ) {
      return { name, reused: true };
    }
    if (!taken.has(clashKey(name)) && !embedded.has(clashKey(`${folder}/${name}`))) {
      return { name, reused: false };
    }
  }
};

/** One path segment of a Markdown link destination, percent-encoded where it needs it (RFC 3986). */
const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * `element.addAttachment` (SR-097): copies the image at `input.sourcePath` into the image folder of
 * the element `input.ref` (the copy `input.repository` and `input.file` name, SR-088, #821) and
 * returns the file (relative to the workspace root, `/`) and the Markdown that embeds it relatively.
 * See the head of this file.
 */
export const addAttachment = async (
  workspace: Workspace,
  input: ElementAddAttachmentInput,
): Promise<ElementAddAttachmentOutput> => {
  const layout = await workspace.get(workspaceLayoutState);
  const metamodel = await workspace.get(metamodelState);
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const record = resolveRef(store, shortIds, input.ref, {
    repository: input.repository,
    file: input.file,
  });
  assertElementWritable(metamodel, record);
  const source = await sourceFor(workspace.root, input);
  const { repository, current } = await readUnchanged(workspace, layout, record);
  const elementFolder = path.posix.dirname(record.file);
  const stem = path.posix.basename(record.file).slice(0, -ELEMENT_FILE_EXTENSION.length);
  if (stem === "") {
    throw invalid(`${record.file} has no name before .md, so it has no folder for images`, {
      file: record.file,
      reason: "no-image-folder",
    });
  }
  const asGiven = elementFolder === "." ? stem : `${elementFolder}/${stem}`;
  // The folder as the walk sees it: spelled as on disk where only the normal form differs (ThomasBirkmaier/ReqSeq-archive#194).
  const folder = path.posix.dirname(
    await refuseUnlisted(layout, repository, `${asGiven}/${source.stem}${source.extension}`),
  );
  const embedded = new Set(
    imageLinks(record.file, current.file.body).map((link) => clashKey(link.names.join("/"))),
  );
  const { name, reused } = await freeName(repository, folder, source, embedded);
  let file = await refuseUnlisted(layout, repository, `${folder}/${name}`);
  if (!reused) {
    // Checked again with the folder there, so a link or `.git` entry put there meanwhile is not
    // written into; the exclusive create never replaces a file another program made meanwhile.
    await createFolder(repository.folder, folder);
    file = await refuseUnlisted(layout, repository, file);
    await writeFileAtomic(repository.folder, file, source.bytes, null);
  }
  const link = path.posix.relative(elementFolder, file).split("/").map(encodeSegment).join("/");
  return { file: workspacePath(layout, repository, file), markdown: `![${source.stem}](${link})` };
};
