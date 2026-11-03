// The files of the evidence locations as the watcher sees them (#785, ADR-0008): a marker state that
// the read of the evidence folders depends on (`evidenceReadState` of the evidence block), so the
// watcher of this block resets that read, the index and the status built on it without importing
// the evidence block (which imports the model). The marker is never built: `reset` drops the
// states that depend on it by their declared dependencies.
//
// A file this process wrote into an evidence folder (`evidence.record`, `evidence.enrichJunit`) is
// registered with the SHA-256 of its bytes (`ownEvidenceWrite`), so its own event does not throw
// away the read it carried the new record into (#278, N-036). Any other file, a changed one, a
// folder, a path gone or an overflow resets the read, and forgets the own writes. Temporary files
// of `writeFileAtomic` are not looked at.
import path from "node:path";
import { readFileSha256 } from "../files/index.js";
import type { Workspace } from "../runtime/workspace.js";
import { defineWorkspaceState } from "../runtime/workspace.js";
import type { WorkspaceLayout } from "../workspace/index.js";
import { locate } from "../workspace/index.js";

/** The marker of the evidence files (see the file comment); its value is never read. */
export const evidenceFilesState = defineWorkspaceState("evidence-files", (): true => true);

/** The NFC, lower-case form of a path, as the watcher compares the metamodel folder (#225). */
const folded = (absolute: string): string => absolute.normalize("NFC").toLowerCase();

/** Whether `absolute` is `folder` or lies below it (both folded). */
const within = (folder: string, absolute: string): boolean => {
  const relative = path.relative(folder, absolute);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

/** Compares event paths with the evidence locations of one layout. */
export interface EvidenceFolders {
  /** Whether a change at `absolute` may change what the evidence read finds. */
  readonly touches: (absolute: string) => boolean;
}

/**
 * The evidence locations of `layout` (`file.evidence`, in available repositories), computed once per
 * layout: a path at or below a location (a file, a folder, one that is gone) or one that holds a
 * location (a parent moved, deleted or created) touches them. Compared in NFC and lower case, as
 * a location is spelled as typed in the workspace file.
 */
export const evidenceFolders = (layout: WorkspaceLayout): EvidenceFolders => {
  const folders = (layout.file.evidence ?? [])
    .map((location) => locate(layout, location).folder)
    .filter((folder): folder is string => folder !== undefined)
    .map(folded);
  return {
    touches: (absolute) => {
      const at = folded(absolute);
      return folders.some((folder) => within(folder, at) || within(at, folder));
    },
  };
};

/** The files this process wrote into evidence folders, per workspace: folded path to SHA-256. */
const ownWrites = new WeakMap<Workspace, Map<string, string>>();

/** Registers a file this process wrote into an evidence folder with the SHA-256 of its bytes. */
export const ownEvidenceWrite = (workspace: Workspace, absolute: string, sha256: string): void => {
  const written = ownWrites.get(workspace) ?? new Map<string, string>();
  written.set(folded(absolute), sha256);
  ownWrites.set(workspace, written);
};

/**
 * Forgets the own writes of `workspace`: once the watcher reset the read, it is read from the files
 * again, so a later change of one of them, a revert to the bytes written too, is a change outside.
 */
export const forgetOwnEvidenceWrites = (workspace: Workspace): void => {
  ownWrites.delete(workspace);
};

/**
 * Whether every one of `paths` is a file this process wrote and still holds the bytes it wrote
 * (`ownEvidenceWrite`); a path gone, unreadable or never written here is not.
 */
export const onlyOwnEvidenceWrites = async (
  workspace: Workspace,
  paths: readonly string[],
): Promise<boolean> => {
  const written = ownWrites.get(workspace);
  for (const absolute of paths) {
    const sha256 = written?.get(folded(absolute));
    const read = await readFileSha256(path.dirname(absolute), path.basename(absolute)).catch(() => null);
    if (sha256 === undefined || read?.sha256 !== sha256) {
      return false;
    }
  }
  return true;
};
