// The buffers drawn in advance (SR-212 AK5): the previous and the next buffer (SR-115 AK5) of the active area,
// drawn hidden beside the shown one, so a switch to one of them slides without waiting for its draw. Only what
// is quick to read is drawn so: an element known not to be a package page, and the neighbourhood of an
// element (SR-107). Pure display (ADR-0002 rule 3): no catalog command, no React.
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

/** The buffers to draw hidden beside `shown`: its neighbours in `order` of a kind `drawnInAdvance` takes. */
export const neighbourBuffers = (
  buffers: Buffers,
  order: readonly string[],
  other: string | undefined,
  packages: PackageTypes,
): readonly Buffer[] => {
  const shown = buffers[0]?.key;
  return neighbourKeys(order, shown, other).flatMap((key) => {
    const buffer = buffers.find((open) => open.key === key);
    return buffer !== undefined && drawnInAdvance(buffer, packages) ? [buffer] : [];
  });
};
