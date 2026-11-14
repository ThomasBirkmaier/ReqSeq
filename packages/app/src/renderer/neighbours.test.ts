// The buffers drawn in advance (SR-212 AK5): the previous and the next buffer of the active area, of the kinds
// that are quick to read, never the buffer of the other area.
import { describe, expect, it } from "vitest";
import { elementBuffer, filteredList, neighbourhoodBuffer, overviewBuffer } from "./buffers.js";
import type { PackageTypes } from "./neighbours.js";
import { drawnInAdvance, neighbourBuffers, neighbourKeys, withSwipe } from "./neighbours.js";

const PACKAGES: PackageTypes = { known: true, model: { types: new Set(["package"]), key: "packages" } };

const typed = (id: string, type: string): ReturnType<typeof elementBuffer> => ({
  ...elementBuffer(id, "spec", id),
  type,
});

describe("the buffers drawn in advance", () => {
  it("[SR-212/AK-tfck] are an element known not to be a package page and a neighbourhood, nothing else", () => {
    expect(drawnInAdvance(typed("a", "need"), PACKAGES)).toBe(true);
    expect(drawnInAdvance(neighbourhoodBuffer("a", "spec", "a"), PACKAGES)).toBe(true);
    // A package page reads its elements, an element of unknown type might be one.
    expect(drawnInAdvance(typed("p", "package"), PACKAGES)).toBe(false);
    expect(drawnInAdvance(elementBuffer("a", "spec", "a"), PACKAGES)).toBe(false);
    expect(drawnInAdvance(typed("a", "need"), { known: false })).toBe(false);
    // A metamodel without package types has no package page.
    expect(drawnInAdvance(typed("a", "need"), { known: true, model: undefined })).toBe(true);
    expect(drawnInAdvance(filteredList([]), PACKAGES)).toBe(false);
    expect(drawnInAdvance(overviewBuffer(), PACKAGES)).toBe(false);
  });

  it("[SR-212/AK-tfck] are the previous and the next buffer (SR-115 AK5), each once, without the other area's buffer", () => {
    expect(neighbourKeys(["a"], "a", undefined)).toEqual([]);
    expect(neighbourKeys(["a", "b"], "a", undefined)).toEqual(["b"]);
    expect(neighbourKeys(["a", "b", "c", "d"], "b", undefined)).toEqual(["c", "a"]);
    expect(neighbourKeys(["a", "b", "c"], "a", "b")).toEqual(["c"]);
    expect(neighbourKeys(["a", "b"], "x", undefined)).toEqual([]);
  });

  it("[SR-212/AK-tfck] come from the walk's order around the shown buffer, read only when of the kinds read for it", () => {
    const need = typed("n", "need");
    const sensors = typed("p", "package");
    const around = neighbourhoodBuffer("n", "spec", "n");
    const list = filteredList([]);
    const buffers = [need, list, sensors, around];
    const order = buffers.map((buffer) => buffer.key);
    expect(neighbourBuffers(buffers, order, undefined, PACKAGES)).toEqual([
      { buffer: list, by: "record" },
      { buffer: around, by: "read" },
    ]);
    expect(
      neighbourBuffers([around, need, list], [around.key, need.key, list.key], undefined, PACKAGES),
    ).toEqual([
      { buffer: need, by: "read" },
      { buffer: list, by: "record" },
    ]);
    expect(neighbourBuffers([around, need], [around.key, need.key], need.key, PACKAGES)).toEqual([]);
    expect(neighbourBuffers([], [], undefined, PACKAGES)).toEqual([]);
  });

  it("leave out those dropped, and add the buffer a swipe draws, also a dropped one, never the shown one", () => {
    const need = typed("n", "need");
    const around = neighbourhoodBuffer("n", "spec", "n");
    const list = filteredList([]);
    const besides = [
      { buffer: around, by: "read" as const },
      { buffer: list, by: "record" as const },
    ];
    const buffers = [need, around, list];
    expect(withSwipe(besides, buffers, new Set([list.key]), undefined)).toEqual([besides[0]]);
    expect(withSwipe(besides, buffers, new Set([list.key]), list.key)).toEqual([
      besides[0],
      { buffer: list, by: "swipe" },
    ]);
    expect(withSwipe(besides, buffers, new Set(), need.key)).toEqual(besides);
    expect(withSwipe(besides, buffers, new Set(), "closed")).toEqual(besides);
  });
});
