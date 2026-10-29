import { createHash } from "node:crypto";

/**
 * What ReqSeq saw of a file when it read or wrote it: plain, frozen data that can be cached or
 * sent to a worker thread (ADR-0008). A write replaces a file only while its bytes on disk still
 * have `sha256` (ADR-0007, SR-008 AK3).
 */
export interface FileSnapshot {
  /** Path relative to the root, `/` as separator. */
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
  /** SHA-256 of the bytes, hex. The authority for "unchanged"; size and mtime are for caches. */
  readonly sha256: string;
}

export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export const makeSnapshot = (path: string, size: number, mtimeMs: number, hash: string): FileSnapshot =>
  Object.freeze({ path, size, mtimeMs, sha256: hash });
