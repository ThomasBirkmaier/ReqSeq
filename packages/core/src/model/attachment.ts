// Images of an element (SR-097, ADR-0004 "Text and inline references", spec question #334 option
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
//   same machine only; it is read whole into memory. Errors name only its base name, never an
//   absolute path, so every access gives the same error (D-029).
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
import { workspaceLayoutState } from "../workspace/index.js";
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

/** Characters of a name before its extension. */
const MAX_NAME = 64;

const invalid = (message: string, details: Record<string, unknown>): CommandError =>
  new CommandError("input.invalid", message, details);

/**
 * `text` as a portable name: compatibility decomposition (NFKD) with the combining marks dropped
 * (`Ä` becomes `A`), every run of other characters than ASCII letters, digits, `_` and `-` one
 * `-`, no `-` at either end, at most 64 characters; `image` when nothing is left.
 */
export const portableName = (text: string): string => {
  const ascii = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-");
  const name = ascii
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME)
    .replace(/-+$/, "");
  return name === "" ? "image" : name;
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

/** The image at `sourcePath` (relative to `root`, or absolute): a regular file with an image extension. */
const readSource = async (root: string, sourcePath: string): Promise<Source> => {
  const absolute = path.resolve(root, sourcePath);
  const name = path.basename(absolute);
  const extension = path.extname(name).toLowerCase();
  if (!IMAGE_EXTENSIONS.includes(extension)) {
    throw invalid(`${name} is no image LogReq embeds; the name must end in ${IMAGE_EXTENSIONS.join(", ")}`, {
      reason: "not-an-image",
      extension,
    });
  }
  let bytes: Uint8Array;
  try {
    if (!(await fs.stat(absolute)).isFile()) {
      throw invalid(`${name} is not a file`, { reason: "source-not-a-file" });
    }
    bytes = await fs.readFile(absolute);
  } catch (error) {
    throw error instanceof CommandError ? error : unreadable(name, error);
  }
  const stem = portableName(name.slice(0, -extension.length));
  return {
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    // A device name such as `CON` or `nul` is refused by Windows with any extension.
    stem: windowsChanges(`${stem}${extension}`) ? `${stem}-image` : stem,
    extension,
  };
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
 * the element `input.ref` and returns the file (relative to the workspace root, `/`) and the
 * Markdown that embeds it relatively. See the head of this file.
 */
export const addAttachment = async (
  workspace: Workspace,
  input: ElementAddAttachmentInput,
): Promise<ElementAddAttachmentOutput> => {
  const layout = await workspace.get(workspaceLayoutState);
  const metamodel = await workspace.get(metamodelState);
  const store = await workspace.get(elementStoreState);
  const shortIds = await workspace.get(shortIdState);
  const record = resolveRef(store, shortIds, input.ref);
  assertElementWritable(metamodel, record);
  const source = await readSource(workspace.root, input.sourcePath);
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
  // The folder as the walk sees it: spelled as on disk where only the normal form differs (#194).
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
