// New element files of one call, all or nothing (`reqif.import`, ADR-0013 "Import"): the files module
// writes them (`createFilesAtomic`: temp files first, then each gets its name, and on a failure it
// removes only what the call itself created, D-045); this module plans their versions and puts the
// written files into the element store.
import { CommandError } from "../catalog.js";
import type { FileContent, FileSnapshot, NewFile } from "../files/index.js";
import { createFilesAtomic, sha256 } from "../files/index.js";
import type { Metamodel } from "../metamodel/index.js";
import type { Workspace } from "../runtime/workspace.js";
import type { RepositoryLocation, WorkspaceLayout } from "../workspace/index.js";
import { elementStoreState, ignoredBy, recordWrites } from "./store.js";
import { imageLinks, lookUpImages } from "./images.js";
import { elementVersion } from "./view.js";
import { workspacePath, writtenElement } from "./write.js";

/** One planned new file: relative to its repository, `/` as separator. */
export interface NewElementFile {
  readonly file: string;
  readonly bytes: Uint8Array;
}

/**
 * The version a planned element file will have (ADR-0005), for the relations that point to it
 * before it is written, computed as the store computes it (`imageLinks` with the `ignore` globs,
 * `lookUpImages`, `elementVersion`). Its values must have a normal form (no `.inf`, `.nan`). An
 * image its text embeds is the SHA-256 `images` gives for its path (relative to the folder of the
 * element file), a file the same call writes (SR-095 AK2); any other is looked up on disk.
 */
export const plannedVersion = async (
  metamodel: Metamodel,
  layout: WorkspaceLayout,
  repository: RepositoryLocation,
  planned: NewElementFile,
  images: ReadonlyMap<string, string> = new Map(),
): Promise<string> => {
  const snapshot: FileSnapshot = {
    path: planned.file,
    size: planned.bytes.length,
    mtimeMs: 0,
    sha256: sha256(planned.bytes),
  };
  const { file, record } = writtenElement(repository.name, planned.bytes, snapshot);
  const ignored = ignoredBy(layout);
  const copies: { path: string; sha256: string }[] = [];
  const others: ReturnType<typeof imageLinks> = [];
  for (const link of imageLinks(planned.file, file.body, ignored)) {
    const sha = images.get(link.path);
    if (sha === undefined) {
      others.push(link);
    } else {
      copies.push({ path: link.path, sha256: sha });
    }
  }
  const onDisk = await lookUpImages({ repository, ignored }, others);
  return elementVersion(record, file.body, metamodel, [...copies, ...onDisk.images]);
};

/** A file the same call writes besides the element files, such as the copy of an image or a saved mapping. */
export interface NewImageFile {
  /** Relative to its repository, `/` as separator. */
  readonly file: string;
  readonly content: FileContent;
}

/**
 * Writes the new element files `files` of `repository` and the other files of the call (`images`:
 * the images they embed, a saved mapping), all or nothing; the folders must exist. Returns the files relative to the workspace
 * root, the elements first, in the order given, and puts the elements into the
 * element store (`recordWrites`). On a failure the store is read again, and `details.written` (the
 * files the call created that changed before it could remove them) names workspace paths.
 */
export const createElementFiles = async (
  workspace: Workspace,
  layout: WorkspaceLayout,
  repository: RepositoryLocation,
  files: readonly NewElementFile[],
  images: readonly NewImageFile[] = [],
): Promise<string[]> => {
  let written: readonly {
    readonly file: { readonly planned: NewElementFile };
    readonly snapshot: FileSnapshot;
  }[];
  try {
    // The images first, so an element's version is computed with them on disk.
    const all = await createFilesAtomic<NewFile & { readonly planned?: NewElementFile }>(repository.folder, [
      ...images.map((image) => ({ path: image.file, content: image.content })),
      ...files.map((planned) => ({ path: planned.file, content: planned.bytes, planned })),
    ]);
    written = all.flatMap(({ file, snapshot }) =>
      file.planned === undefined ? [] : [{ file: { planned: file.planned }, snapshot }],
    );
  } catch (error) {
    await workspace.reset(elementStoreState);
    if (error instanceof CommandError && Array.isArray(error.details?.["written"])) {
      const kept = error.details["written"] as readonly unknown[];
      throw new CommandError(
        error.code,
        error.message,
        { ...error.details, written: kept.map((f) => workspacePath(layout, repository, String(f))) },
        { cause: error },
      );
    }
    throw error;
  }
  await recordWrites(
    workspace,
    layout,
    written.map(({ file: { planned }, snapshot }) => ({
      repository: repository.name,
      file: writtenElement(repository.name, planned.bytes, snapshot).file,
      replaced: undefined,
    })),
  );
  return [...files, ...images].map((planned) => workspacePath(layout, repository, planned.file));
};
