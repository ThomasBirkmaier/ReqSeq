// The perspectives opened last, for the prompt of "Open perspective" (SR-214 AK1: "die zuletzt geöffneten
// zuerst, dann nach Namen"). Display state of the app like the elements opened last (`recent.ts`): kept in
// the app's own local storage, per workspace, never in the files of the workspace (as SR-118 AK5) and not
// through a catalog command (SR-080 AK1: "außer reiner Darstellung der App"). Only names are stored.
import { fold } from "@reqseq/core/fold";
import type { ListedPerspective } from "./buffers.js";
import type { InvokeResult } from "../shared/protocol.js";
import { workspaceParts } from "./recent.js";

/** The part of `Storage` used here. */
export type PerspectiveStorage = Pick<Storage, "getItem" | "setItem">;

/** The most names kept. */
export const PERSPECTIVES_KEPT = 50;

/** The storage key of the perspectives opened last in a workspace (`workspaceParts`, as the recent elements). */
export const perspectiveUseKey = (status: InvokeResult): string | undefined => {
  const parts = workspaceParts(status);
  return parts === undefined ? undefined : ["reqseq.perspectives.v1", ...parts].join("\n");
};

/** `name` first, once by its folded name (as core compares perspective names), and at most `PERSPECTIVES_KEPT`. */
export const rememberPerspective = (used: readonly string[], name: string): readonly string[] =>
  [name, ...used.filter((known) => fold(known) !== fold(name))].slice(0, PERSPECTIVES_KEPT);

/** The names stored under `key`; broken content, foreign content or a storage that throws give none. */
export const loadPerspectiveUse = (storage: () => PerspectiveStorage, key: string): readonly string[] => {
  try {
    const parsed: unknown = JSON.parse(storage().getItem(key) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((name): name is string => typeof name === "string").slice(0, PERSPECTIVES_KEPT)
      : [];
  } catch {
    return [];
  }
};

/** Stores the names. Remembering is a convenience: a storage that fails is ignored. */
export const savePerspectiveUse = (
  storage: () => PerspectiveStorage,
  key: string,
  used: readonly string[],
): void => {
  try {
    storage().setItem(key, JSON.stringify(used));
  } catch {
    // Not remembered; the prompt lists the perspectives by name next time.
  }
};

/**
 * The perspectives in the order the prompt lists them (SR-214 AK1): those opened last first, the most
 * recent first, then the others by name ignoring case. A name used that no perspective has is skipped.
 */
export const inOrderOfUse = (
  perspectives: readonly ListedPerspective[],
  used: readonly string[],
): readonly ListedPerspective[] => {
  const rank = new Map<string, number>();
  used.forEach((name, at) => {
    if (!rank.has(fold(name))) {
      rank.set(fold(name), at);
    }
  });
  const place = (perspective: ListedPerspective): number => rank.get(fold(perspective.name)) ?? used.length;
  return [...perspectives].sort(
    (a, b) => place(a) - place(b) || fold(a.name).localeCompare(fold(b.name), "en"),
  );
};
