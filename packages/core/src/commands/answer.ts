// The words the answers of the commands share (SR-224 AK1). Each command builds its sentence
// in its own `answer`, from its output and input only, so it is the same through every access: English,
// one sentence on what the command found, counted or did, with a period at its end and no time relative
// to reading it. `invoke` puts it first in the output (runtime/invoke.ts).

/** `1 element`, `3 elements`: a count and its noun, with `plural` for more or none (default: `noun` + `s`). */
export const counted = (count: number, noun: string, plural = `${noun}s`): string =>
  `${String(count)} ${count === 1 ? noun : plural}`;

/** `3 of 40 elements` for a page shorter than `total`, else `40 elements`. */
export const paged = (shown: number, total: number, noun: string, plural?: string): string =>
  shown < total ? `${String(shown)} of ${counted(total, noun, plural)}` : counted(total, noun, plural);

/** An element as a sentence names it: by its identifier, else by its short ID. */
export const named = (element: { readonly shortId: string; readonly identifier?: string }): string =>
  element.identifier ?? element.shortId;

/**
 * The root of an output as a sentence names it (`named`): by its node among `nodes`, so a UUID and a short ID
 * as `ref` give the same sentence; `ref` as given when the page of `nodes` does not hold the root.
 */
export const rootNamed = (
  root: string,
  nodes: readonly { readonly id: string; readonly shortId: string; readonly identifier?: string }[],
  ref: string,
): string => {
  const node = nodes.find((each) => each.id === root);
  return node === undefined ? ref : named(node);
};

/**
 * A view as a sentence names it: `core`, or its variant by identifier, else short ID, from the `names` of
 * the output; the UUID only when `names` lacks it.
 */
export const viewNamed = (
  view: string,
  names:
    readonly { readonly id: string; readonly shortId: string; readonly identifier?: string }[] | undefined,
): string => {
  const variant = names?.find((name) => name.id === view);
  return variant === undefined ? view : named(variant);
};

/** `a`, `a and b`, `a, b and c`; "" for none. */
export const listed = (items: readonly string[]): string =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.slice(-1).join("")}`;

/**
 * `main; note; note.`: what a command did, then the notes that are not empty, on one line: a line break of
 * a text the input gives (a query, a name) becomes one space.
 */
export const sentence = (main: string, ...notes: readonly string[]): string =>
  `${[main, ...notes.filter((note) => note !== "")].join("; ")}.`.replace(/\s*[\n\r\u2028\u2029]+\s*/g, " ");

/** The note on the files a write command wrote: `1 file written`, or `no file written`. */
export const filesNote = (files: readonly unknown[]): string =>
  files.length === 0 ? "no file written" : `${counted(files.length, "file")} written`;

/** The note on the problems of an output, `2 problems`; "" without one. */
export const problemsNote = (problems: readonly unknown[] | undefined): string =>
  problems === undefined || problems.length === 0 ? "" : counted(problems.length, "problem");

/** The note on an incomplete output (`common.schema.json#/$defs/incomplete`); "" for a complete one. */
export const incompleteNote = (incomplete: boolean | undefined): string =>
  incomplete === true ? "incomplete, as a repository is not available" : "";

/** The first 12 characters of a commit, as a sentence names it. */
export const shortCommit = (commit: string): string => commit.slice(0, 12);
