// How Windows and macOS compare a name. It imports nothing, so the Markdown renderer (`@reqseq/core/markdown`) runs
// in a browser; `paths.ts` re-exports it.

/** `name` as Windows and macOS compare it: lower case, trailing dots and spaces dropped. */
export const systemForm = (name: string): string => name.toLowerCase().replace(/[. ]+$/, "");
