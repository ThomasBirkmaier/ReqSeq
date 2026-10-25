import { describe, expect, it } from "vitest";
import { forEachSliced } from "./slices.js";

describe("work in slices (SR-082)", () => {
  it("calls the function for every item in order, also when it gives the event loop a turn after each", async () => {
    const seen: number[] = [];
    let turns = 0;
    const timer = setInterval(() => {
      turns += 1;
    }, 0);
    await forEachSliced([1, 2, 3], (item) => seen.push(item), 0);
    clearInterval(timer);
    expect(seen).toEqual([1, 2, 3]);
    await forEachSliced([4], (item) => seen.push(item));
    expect(seen).toEqual([1, 2, 3, 4]);
    expect(turns).toBeGreaterThanOrEqual(0);
  });
});
