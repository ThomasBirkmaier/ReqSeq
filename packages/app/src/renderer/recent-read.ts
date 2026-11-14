// The elements the overview shows among the ones opened last (SR-118 AK1), read for their names only: one
// `element.list` with their UUIDs, as the open buffers are read at the start (`buffer-session.ts`). The list
// answers in a few milliseconds where an `element.get` of each also computes its verification status, whose
// first walk after the start takes hundreds of milliseconds and holds back every call after it (SR-082 AK1,
// #1670). The list fails as a whole when one UUID is unknown (an element deleted since) or in two
// repositories; then, and for an entry the list did not give, each is read with `element.get` and its
// repository, so an element that is gone is still told apart from one whose read failed otherwise.
import type { Call } from "./call.js";
import type { RecentEntry } from "./recent.js";

/** What the overview shows of a recent element: its identity and its name (SR-084 AK4). */
export interface RecentElement {
  readonly id: string;
  readonly repository: string;
  readonly shortId: string;
  readonly identifier?: string | undefined;
  readonly title: string;
  readonly type?: string | undefined;
}

/** The read of one entry: its element, or the error code of a read that failed. */
export type RecentRead =
  { readonly ok: true; readonly element: RecentElement } | { readonly ok: false; readonly code: string };

/** The key of an element by repository and UUID: a UUID may exist in several repositories. */
export const entryKey = (entry: { readonly id: string; readonly repository: string }): string =>
  `${entry.repository}\n${entry.id}`;

/** The read of every entry, by `entryKey`. */
export const readRecent = async (
  call: Call,
  entries: readonly RecentEntry[],
): Promise<ReadonlyMap<string, RecentRead>> => {
  const reads = new Map<string, RecentRead>();
  if (entries.length === 0) {
    return reads;
  }
  const listed = await call("element.list", { selection: { ids: [...new Set(entries.map((e) => e.id))] } });
  if (listed.ok) {
    for (const element of listed.output.elements ?? []) {
      reads.set(entryKey(element), { ok: true, element });
    }
  }
  const left = entries.filter((entry) => !reads.has(entryKey(entry)));
  const answers = await Promise.all(
    left.map(async (entry) => ({
      entry,
      answer: await call("element.get", { ref: entry.id, repository: entry.repository }),
    })),
  );
  for (const { entry, answer } of answers) {
    reads.set(
      entryKey(entry),
      answer.ok ? { ok: true, element: answer.output.element } : { ok: false, code: answer.code },
    );
  }
  return reads;
};
