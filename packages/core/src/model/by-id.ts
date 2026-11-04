// Lookups by UUID in hot read loops (#215): a check looks up a relation's target once per relation
// (200,000 at N-036). After a change the store's `byId` is a `PatchedMap` (O(changed) for the
// watcher), whose `get` at such a call site, next to the plain `Map` of a store read in full, made
// `workspace.check` 10 to 30 % slower (two map classes at one site, two lookups, and the lists of a
// store read long ago lying far apart in memory). `recordsById` reads a plain view instead.
import type { ElementRecord } from "./elements.js";
import { plainAt } from "./patch-limits.js";
import { PatchedMap } from "./patched-map.js";

type ById = ReadonlyMap<string, readonly ElementRecord[]>;

/** How often `recordsById` looked a `PatchedMap` up before its plain view was built. */
const asks = new WeakMap<ById, number>();
/** The plain view of each `PatchedMap` that has one: built once, kept while the map lives. */
const views = new WeakMap<ById, Map<string, readonly ElementRecord[]>>();
/** The map `recordsById` read last and the plain map it reads for it; kept until another one is read. */
let lastMap: ById | undefined;
let lastView: ById = new Map();

/**
 * The plain view of `byId`: a new `Map` with a copy of each list (so the lists lie together in
 * memory, as after a full read), or undefined while it has been looked up fewer than `plainAt`
 * times, so a carry over one changed file never builds it.
 */
const viewOf = (byId: PatchedMap<string, readonly ElementRecord[]>): ById | undefined => {
  const built = views.get(byId);
  if (built !== undefined) {
    return built;
  }
  const count = (asks.get(byId) ?? 0) + 1;
  asks.set(byId, count);
  if (count < plainAt(byId.size)) {
    return undefined;
  }
  const view = new Map<string, readonly ElementRecord[]>();
  for (const [id, records] of byId) {
    view.set(id, [...records]);
  }
  views.set(byId, view);
  return view;
};

/**
 * Hands the plain view of `from` over to `to`, the patch of `from` with `changes` (`patchStore`):
 * the view is changed in place, O(changed), so a store patched from one whose view was built gets
 * its view without a copy. `from` has none afterwards; read hot again, it builds a new one.
 */
export const handOverView = (
  from: ById,
  to: ById,
  changes: readonly (readonly [string, readonly ElementRecord[] | undefined])[],
): void => {
  const view = views.get(from);
  if (view === undefined) {
    return;
  }
  views.delete(from);
  if (lastMap === from) {
    lastMap = undefined;
  }
  for (const [id, records] of changes) {
    if (records === undefined) {
      view.delete(id);
    } else {
      view.set(id, records);
    }
  }
  views.set(to, view);
};

/** `recordsById` for another map than the last one: switches to it, or to its view. */
const switchTo = (byId: ById, id: string): readonly ElementRecord[] | undefined => {
  const view =
    byId instanceof PatchedMap ? viewOf(byId as PatchedMap<string, readonly ElementRecord[]>) : byId;
  if (view === undefined) {
    return byId.get(id);
  }
  lastMap = byId;
  lastView = view;
  return view.get(id);
};

/**
 * `byId.get(id)` for a hot read loop (`resolveTarget`, `resolveId`, the identifier index): the same
 * records (a list equal to the store's, not always the same array), read from a plain `Map`: the
 * store's own, or a plain view of a patched one once it was looked up `plainAt` times. Small, so
 * that the engine inlines it into the loop: one comparison and one `Map#get`.
 */
export const recordsById = (byId: ById, id: string): readonly ElementRecord[] | undefined =>
  byId === lastMap ? lastView.get(id) : switchTo(byId, id);
