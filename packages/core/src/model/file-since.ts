// Where an element file was at a commit and whether it is committed now (SR-051 AK4, ADR-0018
// "Git"), for `baseline.compare`, read through the git reader (ADR-0006) and never written (D-036):
//
// - The commit is resolved in the repository; one it does not have is `no-commit`.
// - The path at the commit: the file itself when Git lists no change of it since; otherwise the
//   files changed since (`changedPaths`, which names a moved file at its old and its new path) are
//   read at the commit through one object reader, and the one whose frontmatter has the UUID is
//   its old path, the file itself first. No rename detection, no `ls-tree`.
// - Uncommitted: the file differs from HEAD (staged, not staged or untracked), or it is gone.
import type { GitUnknown } from "../git/reader.js";
import { changedPaths, headCommit, isGitPath, openObjectReader, resolveCommit } from "../git/reader.js";
import { idIn } from "./changed.js";
import { ELEMENT_FILE_EXTENSION } from "./discover.js";

/** What `fileSince` found. */
export type FileSince =
  | GitUnknown
  /** The repository has no such commit. */
  | { readonly known: true; readonly kind: "no-commit" }
  | {
      readonly known: true;
      readonly kind: "found";
      /** The HEAD commit. */
      readonly head: string;
      /** The path that held the element at the commit; undefined when no file did. */
      readonly before: string | undefined;
      /** The file differs from HEAD or is gone. */
      readonly uncommitted: boolean;
    };

const nfc = (text: string): string => text.normalize("NFC");

/** The first of `files` (relative to `folder`) that held the element `id` at `commit`, or undefined. */
const holderAt = async (
  folder: string,
  commit: string,
  files: readonly string[],
  id: string,
): Promise<string | undefined | GitUnknown> => {
  const reader = openObjectReader(folder);
  try {
    const asked = files.map((file) => ({ file, parts: [] as Buffer[] }));
    const read = await reader.read(
      files.map((file) => `${commit}:${file}`),
      (_, index) => (chunk) => {
        asked[index]?.parts.push(chunk);
      },
    );
    if (!read.known) {
      return read;
    }
    return asked.find(
      ({ file, parts }, index) =>
        read.objects[index]?.type === "blob" && idIn(file, Buffer.concat(parts)).includes(id),
    )?.file;
  } finally {
    reader.close();
  }
};

/**
 * The file of the element `id` at `commit` in the repository of `folder`, from `file` (its path
 * now, relative to `folder` with `/`; undefined when no file holds it now), and whether `file` is
 * committed (see the file comment).
 */
export const fileSince = async (
  folder: string,
  commit: string,
  file: string | undefined,
  id: string,
): Promise<FileSince> => {
  const resolved = await resolveCommit(folder, commit);
  if (!resolved.known) {
    return resolved;
  }
  if (resolved.commit === undefined) {
    return { known: true, kind: "no-commit" };
  }
  const [head, since] = await Promise.all([headCommit(folder), changedPaths(folder, resolved.commit)]);
  if (!head.known) {
    return head;
  }
  if (!since.known) {
    return since;
  }
  const changed = since.paths.filter((p) => p.endsWith(ELEMENT_FILE_EXTENSION) && isGitPath(p));
  const now = file === undefined ? undefined : nfc(file);
  let before: string | undefined | GitUnknown = file;
  if (now === undefined || changed.some((p) => nfc(p) === now)) {
    const others = changed.filter((p) => nfc(p) !== now);
    before = await holderAt(folder, resolved.commit, file === undefined ? others : [file, ...others], id);
    if (typeof before === "object") {
      return before;
    }
  }
  const uncommitted = await changedPaths(folder, head.commit);
  if (!uncommitted.known) {
    return uncommitted;
  }
  return {
    known: true,
    kind: "found",
    head: head.commit,
    before,
    uncommitted: now === undefined || uncommitted.paths.some((p) => nfc(p) === now),
  };
};
