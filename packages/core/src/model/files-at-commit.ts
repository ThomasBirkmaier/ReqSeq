// The element files of many elements as they were at one commit (SR-232 AK7: the field difference of an element since
// a baseline in the HTML export), read through the git reader (ADR-0006) and never written (D-036), in one pass per
// repository and commit (N-036):
//
// - The commit is resolved in the repository; one it does not have (not fetched, beyond a shallow clone) is
//   `no-commit`.
// - Each element's file is read at the commit at the path it has now, where git can name that path (`isGitPath`; an
//   element at another path is looked for as a moved one). Only for the elements whose path did not hold
//   them there, the element files changed since (`changedPaths`, which names a moved file at its old and its new path)
//   are read through the same object reader, and the one whose frontmatter has the UUID is the element's file then,
//   as `fileSince` finds it. An element no file held at the commit has none.
import type { GitUnknown } from "../git/reader.js";
import { changedPaths, isGitPath, openObjectReader, resolveCommit } from "../git/reader.js";
import { elementText, parseFileBytes, zip } from "../files/index.js";
import { ELEMENT_FILE_EXTENSION } from "./discover.js";
import type { ElementContent } from "./field-difference.js";

/** The file of one element at the commit: its path then, relative to the repository folder, and its content. */
export interface FileAtCommit extends ElementContent {
  readonly path: string;
}

/** What `filesAtCommit` found. */
export type FilesAtCommit =
  | GitUnknown
  /** The repository has no such commit. */
  | { readonly known: true; readonly kind: "no-commit" }
  /** In the order asked; undefined for an element no file held at the commit. */
  | { readonly known: true; readonly kind: "found"; readonly files: readonly (FileAtCommit | undefined)[] };

/** One element asked for: its file now (relative to the repository folder, `/`) and its UUID. */
export interface AskedFile {
  readonly file: string;
  readonly id: string;
}

/** The blobs of `paths` at `commit` that hold an element, each with the UUID it holds; unknown when git fails. */
const holders = async (
  reader: ReturnType<typeof openObjectReader>,
  commit: string,
  paths: readonly string[],
): Promise<readonly (FileAtCommit & { readonly id: unknown })[] | GitUnknown> => {
  const parts = paths.map((): Buffer[] => []);
  const read = await reader.read(
    paths.map((path) => `${commit}:${path}`),
    (_, index) => (chunk) => {
      parts[index]?.push(chunk);
    },
  );
  if (!read.known) {
    return read;
  }
  return zip(paths, parts).flatMap(([path, chunks], index) => {
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
};

const withoutId = ({ id: _, ...file }: FileAtCommit & { readonly id: unknown }): FileAtCommit => file;

/** The files of the elements `asked` at `commit` in the repository of `folder` (see the file comment). */
export const filesAtCommit = async (
  folder: string,
  commit: string,
  asked: readonly AskedFile[],
): Promise<FilesAtCommit> => {
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
      at,
      asked.flatMap((a) => (isGitPath(a.file) ? [a.file] : [])),
    );
    if (!("length" in own)) {
      return own;
    }
    const byPath = new Map(own.map((held) => [held.path, held]));
    const files: (FileAtCommit | undefined)[] = asked.map(({ file, id }) => {
      const held = byPath.get(file);
      return held?.id === id ? withoutId(held) : undefined;
    });
    if (files.every((file) => file !== undefined)) {
      return { known: true, kind: "found", files };
    }
    const since = await changedPaths(folder, at);
    if (!since.known) {
      return since;
    }
    const read = new Set(own.map((held) => held.path));
    const others = await holders(
      reader,
      at,
      since.paths.filter((p) => p.endsWith(ELEMENT_FILE_EXTENSION) && isGitPath(p) && !read.has(p)),
    );
    if (!("length" in others)) {
      return others;
    }
    // The first file that holds a UUID is its file: later entries of the map win, so the files go in backwards.
    const byId = new Map([...own, ...others].reverse().map((held) => [held.id, withoutId(held)]));
    return {
      known: true,
      kind: "found",
      files: files.map((file, index) => file ?? byId.get(asked[index]?.id)),
    };
  } finally {
    reader.close();
  }
};
