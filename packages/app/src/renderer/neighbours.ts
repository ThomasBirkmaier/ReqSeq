// The buffers drawn in advance (SR-212 AK5): the previous and the next buffer (SR-115 AK5) of the active area,
// drawn hidden beside the shown one, so a switch to one of them slides without waiting for its draw. Only what
// is quick to read is read for it: an element known not to be a package page, and the neighbourhood of an
// element (SR-107). Every other buffer is drawn only from what its shown view read (`area-record.ts`). Pure
// display (ADR-0002 rule 3): no catalog command, no React.
//
// In a split window only the active area has buffers drawn in advance, and never the one the other area
// shows: only the active area switches with "Previous buffer" and "Next buffer" (SR-211 AK9).
import { cycleKey } from "./buffer-cycle.js";
import type { Buffer, Buffers } from "./buffers.js";
import type { PackageModel } from "./package-page.js";
import { packageOf } from "./package-page.js";

/** What the window knows of the package types: the model (none without package types), once the metamodel is read. */
export type PackageTypes =
  { readonly known: false } | { readonly known: true; readonly model: PackageModel | undefined };

/** A buffer of a kind that is quick to read: an element known not to be a package page, or a neighbourhood. */
export const drawnInAdvance = (buffer: Buffer, packages: PackageTypes): boolean => {
  if (buffer.kind === "neighbourhood") {
    return true;
  }
  return (
    buffer.kind === "element" &&
    buffer.type !== undefined &&
    packages.known &&
    packageOf(packages.model, buffer.type) === undefined
  );
};

/**
 * The keys of the previous and the next buffer of `shown` in the walk `order` (SR-115 AK5), each once,
 * without `shown` and without `other`, the buffer of the other area: none with one buffer, one with two.
 */
export const neighbourKeys = (
  order: readonly string[],
  shown: string | undefined,
  other: string | undefined,
): readonly string[] => {
  const keys = [cycleKey(order, shown, 1), cycleKey(order, shown, -1)];
  return keys.filter(
    (key, at): key is string =>
      key !== undefined && key !== shown && key !== other && keys.indexOf(key) === at,
  );
};

/**
 * How a buffer beside the shown one is drawn in advance: `read` from the workspace (an element or a
 * neighbourhood), `record` only from the answers its shown view got (every other buffer, which the app never
 * reads for it, `area-record.ts`), or `swipe`, read as a shown buffer because a swipe to it began (SR-211 AK3).
 */
export type DrawnBy = "read" | "record" | "swipe";

/** A buffer drawn hidden beside the shown one, and how. */
export interface Neighbour {
  readonly buffer: Buffer;
  readonly by: DrawnBy;
}

/** The buffers to draw hidden beside `shown`: its neighbours in `order`, each with how it is drawn. */
export const neighbourBuffers = (
  buffers: Buffers,
  order: readonly string[],
  other: string | undefined,
  packages: PackageTypes,
): readonly Neighbour[] => {
  const shown = buffers[0]?.key;
  return neighbourKeys(order, shown, other).flatMap((key) => {
    const buffer = buffers.find((open) => open.key === key);
    return buffer === undefined ? [] : [{ buffer, by: drawnInAdvance(buffer, packages) ? "read" : "record" }];
  });
};

/**
 * The buffers drawn beside the shown one (the first of `buffers`): `besides` without those a change `dropped`
 * until the next switch, and the buffer a swipe draws (`swiped`, SR-211 AK3) as `swipe`, also when it was
 * dropped; never the shown one or the one the other area shows (`other`).
 */
export const withSwipe = (
  besides: readonly Neighbour[],
  buffers: Buffers,
  dropped: ReadonlySet<string>,
  swiped: string | undefined,
  other?: string,
): readonly Neighbour[] => {
  const shown = buffers[0]?.key;
  const kept = besides.filter(({ buffer }) => !dropped.has(buffer.key) && buffer.key !== swiped);
  const drawn = buffers.find(
    (buffer) => buffer.key === swiped && buffer.key !== shown && buffer.key !== other,
  );
  return drawn === undefined ? kept : [...kept, { buffer: drawn, by: "swipe" }];
};
