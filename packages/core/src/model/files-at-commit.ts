// The element files of many elements as they were at one commit (SR-232 AK7: the field difference of an element since
// a baseline in the HTML export; SR-051 AK5: the one element of `baseline.compare`; SR-051 AK2: the status at the
// baseline commit of the entries superseded now), read through the git reader (ADR-0006) and never written (D-036), in
// one pass per repository and commit (N-036):
//
// - The commit is resolved in the repository; one it does not have (not fetched, beyond a shallow clone) is
//   `no-commit`.
// - Each element's file is read at the commit at the path it has now, where git can name that path (`isGitPath`; an
//   element at another path is looked for as a moved one). From `LISTED_FROM` paths in one round, one tree listing
//   (`commitBlobs`) gives their blob IDs and the reader reads the blobs by ID, since git walks the tree for each
//   `<commit>:<path>` (#2514: 2.8 s for 10,000 files in folders of 1,000, 0.1 s by ID); a path the listing lacks, or
//   every path when git refuses the listing (a partial clone without trees), is read by `<commit>:<path>`; a listing
//   that times out is unknown. Only for the elements whose path did not hold them there, the element files changed
//   since (`changedPaths`, which names a moved file at its old and its new path) are read the same way, and the one
//   whose frontmatter has the UUID is the element's file then, as `fileSince` finds it. An element no file held at
//   the commit has none.
// - A blob the listing names that git does not have here (a partial clone without blobs) cannot tell whether it held
//   the element: an element at that path, or one looked for among such blobs and not found, is `unread` (its index;
//   left out when none is) and has no file.
import type { GitUnknown } from "../git/reader.js";
import { changedPaths, commitBlobs, isGitPath, openObjectReader, resolveCommit } from "../git/reader.js";
import { elementText, parseFileBytes, zip } from "../files/index.js";
import { ELEMENT_FILE_EXTENSION } from "./discover.js";
import type { ElementContent } from "./field-difference.js";

/**
 * From this many names at one commit, one tree listing of the commit (`commitBlobs`, #439) answers
 * them instead of the reader: a name costs `cat-file` about 0.08 ms in a small folder and more in a
 * large one (git walks the tree for each `<commit>:<path>`), a listing of 50,000 files about 30 ms
 * (HEAD's commit after a merge or an amend, SR-082 AK4; the files at a baseline commit, #2514).
 */
export const LISTED_FROM = 500;

/** How `filesAtCommit` reads. */
export interface FilesAtCommitOptions {
  /**
   * From this many paths in a round, the commit is listed first (default `LISTED_FROM`); 1 lists always, so every
   * blob git does not have is `unread` while the listing works (`baseline.get`, #2514).
   */
  readonly listFrom?: number;
}

/** The file of one element at the commit: its path then, relative to the repository folder, and its content. */
export interface FileAtCommit extends ElementContent {
  readonly path: string;
}

/** What `filesAtCommit` found. */
export type FilesAtCommit =
  | GitUnknown
  /** The repository has no such commit. */
  | { readonly known: true; readonly kind: "no-commit" }
  /**
   * In the order asked; undefined for an element no file held at the commit, or whose file git does not have here
   * (`unread`, the indices asked; left out when none is).
   */
  | {
      readonly known: true;
      readonly kind: "found";
      readonly files: readonly (FileAtCommit | undefined)[];
      readonly unread?: readonly number[];
    };

/** One element asked for: its file now (relative to the repository folder, `/`) and its UUID. */
export interface AskedFile {
  readonly file: string;
  readonly id: string;
}

/** What `holders` read: the files that hold an element, with the UUID each holds, and the paths git does not have. */
interface Held {
  readonly held: readonly (FileAtCommit & { readonly id: unknown })[];
  readonly unread: ReadonlySet<string>;
}

/**
 * The blobs of `paths` at `commit` that hold an element, each with the UUID it holds, and the paths whose blob the
 * listing names but git does not have (see the file comment); unknown when git fails.
 */
const holders = async (
  reader: ReturnType<typeof openObjectReader>,
  folder: string,
  commit: string,
  paths: readonly string[],
  listFrom: number,
): Promise<Held | GitUnknown> => {
  const listing = paths.length < listFrom ? undefined : await commitBlobs(folder, commit, paths);
  if (listing?.known === false && listing.reason === "timeout") {
    return listing;
  }
  const ids = paths.map((path) => (listing?.known === true ? listing.ids.get(path) : undefined));
  const parts = paths.map((): Buffer[] => []);
  const read = await reader.read(
    paths.map((path, index) => ids[index] ?? `${commit}:${path}`),
    (_, index) => (chunk) => {
      parts[index]?.push(chunk);
    },
  );
  if (!read.known) {
    return read;
  }
  const unread = new Set(
    paths.filter((_, index) => ids[index] !== undefined && read.objects[index] === null),
  );
  const held = zip(paths, parts).flatMap(([path, chunks], index) => {
    if (read.objects[index]?.type !== "blob") {
      return [];
    }
    const parsed = parseFileBytes(path, Buffer.concat(chunks));
    const data: unknown = parsed.kind === "parsed" ? parsed.content.data : undefined;
    if (parsed.kind !== "parsed" || typeof data !== "object" || data === null || Array.isArray(data)) {
      return [];
    }
    const values = data as Readonly<Record<string, unknown>>;
    return [
      {
        path,
        id: values["id"],
        type: String(values["type"]),
        data: values,
        text: elementText(parsed.content.body),
      },
    ];
  });
  return { held, unread };
};

const withoutId = ({ id: _, ...file }: FileAtCommit & { readonly id: unknown }): FileAtCommit => file;

/** The files of the elements `asked` at `commit` in the repository of `folder` (see the file comment). */
export const filesAtCommit = async (
  folder: string,
  commit: string,
  asked: readonly AskedFile[],
  options: FilesAtCommitOptions = {},
): Promise<FilesAtCommit> => {
  const listFrom = options.listFrom ?? LISTED_FROM;
  const resolved = await resolveCommit(folder, commit);
  if (!resolved.known) {
    return resolved;
  }
  if (resolved.commit === undefined) {
    return { known: true, kind: "no-commit" };
  }
  const at = resolved.commit;
  const reader = openObjectReader(folder);
  try {
    // Only paths git can name are asked for (`isGitPath`); an element at another path has no file at the commit by its
    // path now, and is looked for among the changed files.
    const own = await holders(
      reader,
      folder,
      at,
      asked.flatMap((a) => (isGitPath(a.file) ? [a.file] : [])),
      listFrom,
    );
    if (!("held" in own)) {
      return own;
    }
    const byPath = new Map(own.held.map((held) => [held.path, held]));
    const files: (FileAtCommit | undefined)[] = asked.map(({ file, id }) => {
      const held = byPath.get(file);
      return held?.id === id ? withoutId(held) : undefined;
    });
    // An element whose blob git does not have is not looked for elsewhere: that blob may hold it.
    const unread = new Set(asked.flatMap(({ file }, index) => (own.unread.has(file) ? [index] : [])));
    const found = (): FilesAtCommit => ({
      known: true,
      kind: "found",
      files,
      ...(unread.size === 0 ? {} : { unread: [...unread] }),
    });
    if (files.every((file, index) => file !== undefined || unread.has(index))) {
      return found();
    }
    const since = await changedPaths(folder, at);
    if (!since.known) {
      return since;
    }
    const read = new Set(own.held.map((held) => held.path));
    const others = await holders(
      reader,
      folder,
      at,
      since.paths.filter((p) => p.endsWith(ELEMENT_FILE_EXTENSION) && isGitPath(p) && !read.has(p)),
      listFrom,
    );
    if (!("held" in others)) {
      return others;
    }
    // The first file that holds a UUID is its file: later entries of the map win, so the files go in backwards.
    const byId = new Map([...own.held, ...others.held].reverse().map((held) => [held.id, withoutId(held)]));
    for (const [index, file] of files.entries()) {
      if (file !== undefined || unread.has(index)) {
        continue;
      }
      files[index] = byId.get(asked[index]?.id);
      // Not found while a changed file could not be read: that one may have held it.
      if (files[index] === undefined && others.unread.size > 0) {
        unread.add(index);
      }
    }
    return found();
  } finally {
    reader.close();
  }
};
