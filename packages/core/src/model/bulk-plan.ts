// The plan of an `element.bulkUpdate` (#158): one fingerprint of the files it writes, so that a
// confirmation writes exactly what its preview showed. No state is kept: the confirmation plans
// again and compares the fingerprints (`bulk-update.ts`).
//
// - Each planned file is one entry: the header `JSON.stringify([repository, file, id, sha256,
//   length]) + "\n"` and then its planned bytes, where `file` is relative to the repository (`/` as
//   separator, so independent of `.reqseq/local.yaml`) and `sha256` is that of the file as read.
//   The planned bytes bind the operation, the value, choice keys and target versions.
// - The entries are hashed in path order (`byPath`, by code units, never `localeCompare`), so the
//   value is the same for the same file names and bytes, whatever the path of the workspace, the
//   machine or the access. A CRLF checkout has other bytes and so another plan; a checkout whose
//   file names have another Unicode normalization (NFD on macOS) has other names and so another plan.
// - Not bound: skipped and unchanged elements, problems and hints. The planned bytes never hold the
//   titles of relation targets that the write refreshes (decision on ThomasBirkmaier/ReqSeq-archive#307): `withCurrentTitles`
//   runs in `writeElementFiles`, after the plan, so a confirmation may write a refreshed title that
//   its plan does not show, and the plan is the same.
import { createHash } from "node:crypto";
import { byPath } from "./path-order.js";

/** One file the change rewrites. */
export interface PlanEntry {
  /** Workspace name of the repository. */
  readonly repository: string;
  /** Relative to the repository, `/` as separator. */
  readonly file: string;
  readonly id: string;
  /** SHA-256 of the file as read, hex. */
  readonly sha256: string;
  /** The bytes the change writes. */
  readonly bytes: Uint8Array;
}

/** The version prefix of the fingerprint: another framing gets another prefix. */
const VERSION = "p1";

/** The fingerprint of the planned writes, `p1:` and 64 hex digits (see the file comment). */
export const planFingerprint = (entries: readonly PlanEntry[]): string => {
  const sorted = [...entries].sort((a, b) => byPath(a.repository, b.repository) || byPath(a.file, b.file));
  const hash = createHash("sha256");
  for (const { repository, file, id, sha256, bytes } of sorted) {
    hash.update(`${JSON.stringify([repository, file, id, sha256, bytes.length])}\n`);
    hash.update(bytes);
  }
  return `${VERSION}:${hash.digest("hex")}`;
};
