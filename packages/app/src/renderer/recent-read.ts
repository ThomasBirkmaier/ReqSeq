// The elements the overview shows among the ones opened last (SR-118 AK1), read for their names only: one
// `element.list` with their UUIDs, as the open buffers are read at the start (`buffer-session.ts`). The list
// answers in a few milliseconds where an `element.get` of each also computes its verification status, whose
// first walk after the start takes hundreds of milliseconds and holds back every call after it (SR-082 AK1,
// #1670). The list fails as a whole when one UUID is unknown (an element deleted since) or in two
// repositories; then, and for an entry the list did not give, each is listed alone, and read with
// `element.get` in its repository only where that fails too for another reason than an unknown UUID, so an
// element that is gone is still told apart from one whose read failed otherwise.
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

/** The element of `entry` among `elements`, by repository and UUID. */
const found = (elements: readonly RecentElement[], entry: RecentEntry): RecentElement | undefined =>
  elements.find((element) => element.id === entry.id && element.repository === entry.repository);

/**
 * One entry the list of all did not give: a list of its UUID alone, still without the verification status,
 * and `element.get` in its repository only when that list cannot answer either (the UUID in two
 * repositories), so one element deleted outside does not bring the slow read back for all of them.
 */
const readOne = async (call: Call, entry: RecentEntry): Promise<RecentRead> => {
  const listed = await call("element.list", { selection: { ids: [entry.id] } });
  const element = listed.ok ? found(listed.output.elements ?? [], entry) : undefined;
  if (element !== undefined) {
    return { ok: true, element };
  }
  if (!listed.ok && listed.code === "ref.unknown") {
    return { ok: false, code: listed.code };
  }
  const answer = await call("element.get", { ref: entry.id, repository: entry.repository });
  return answer.ok ? { ok: true, element: answer.output.element } : { ok: false, code: answer.code };
};

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
  const elements = listed.ok ? (listed.output.elements ?? []) : [];
  const left: RecentEntry[] = [];
  for (const entry of entries) {
    const element = found(elements, entry);
    if (element === undefined) {
      left.push(entry);
    } else {
      reads.set(entryKey(entry), { ok: true, element });
    }
  }
  const answers = await Promise.all(left.map(async (entry) => ({ entry, read: await readOne(call, entry) })));
  for (const { entry, read } of answers) {
    reads.set(entryKey(entry), read);
  }
  return reads;
};
