// A Git commit as the pages show it: the first 7 characters of its ID, as `git log --oneline` shows it, so a
// table keeps its width for the other values. The data (`evidence.list`, `tool.info`) keeps the full ID, and the
// page shows it on hover.

/** A full commit ID: 40 hex characters (SHA-1) or 64 (SHA-256), not part of a longer word. */
const FULL = /\b(?:[0-9a-f]{64}|[0-9a-f]{40})\b/g;

/** `text` with each full commit ID in it cut to its first 7 characters. */
export const shortCommits = (text: string): string => text.replace(FULL, (id) => id.slice(0, 7));

/** The attributes of a cell or span that shows `text` with short commits: the full text on hover where it differs. */
export const fullOnHover = (text: string): { readonly title?: string } =>
  shortCommits(text) === text ? {} : { title: text };
