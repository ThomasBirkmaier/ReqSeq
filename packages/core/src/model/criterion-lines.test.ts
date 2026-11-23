// The generator of new criterion keys (SR-204 AK1).
import { describe, expect, it } from "vitest";
import { drawCriterionKey } from "./criterion-lines.js";

describe("drawCriterionKey", () => {
  it("drawCriterionKey draws again while the key is taken", () => {
    const draws = [0, 0, 0, 0, 1, 0, 0, 0];
    const random = (): number => draws.shift() ?? 0;
    expect(drawCriterionKey(new Set(["bbbb"]), random)).toBe("cbbb");
  });
});
