// The order of file paths in a repository of the element store (`store.ts`), in a module of its
// own so that tests can count the sorts of a write (#729).

/**
 * The order of file paths in a repository of the store: by UTF-16 code units, as
 * `listMarkdownFiles` sorts them (not `localeCompare`). States that merge in store order use it
 * (`carryProblems`, `carryIncomingIndex`).
 */
export const byPath = (a: string, b: string): number => Number(a > b) - Number(a < b);

/** The entries as a new map in path order (`byPath`): one sort. */
export const inPathOrder = <V>(entries: Iterable<readonly [string, V]>): Map<string, V> =>
  new Map([...entries].sort(([a], [b]) => byPath(a, b)));
