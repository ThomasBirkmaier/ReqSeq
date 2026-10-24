import { setTimeout as sleep } from "node:timers/promises";
import { errorCode } from "./paths.js";

/**
 * Errors that are often transient on Windows, where a virus scanner, indexer or editor briefly holds
 * a file open. Retrying them elsewhere costs a few milliseconds before the error is passed on.
 */
export const TRANSIENT_CODES: readonly string[] = ["EPERM", "EACCES", "EBUSY"];

export interface RetryOptions {
  readonly attempts?: number;
  readonly delayMs?: number;
}

/** Runs `fn`, retrying a bounded number of times while it fails with one of `codes`. */
export const retry = async <T>(
  fn: () => Promise<T>,
  codes: readonly string[],
  { attempts = 5, delayMs = 20 }: RetryOptions = {},
): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const code = errorCode(e);
      if (attempt >= attempts || code === undefined || !codes.includes(code)) {
        throw e;
      }
      await sleep(delayMs * attempt);
    }
  }
};
