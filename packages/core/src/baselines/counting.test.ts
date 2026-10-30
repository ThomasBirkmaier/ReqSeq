import { describe, expect, it } from "vitest";
import { countsFor } from "./counting.js";

describe("countsFor", () => {
  it("compares date and time, by day when either has no time", () => {
    const at = countsFor("2026-11-02T14:00:00Z");
    expect(["2026-11-02T13:00:00Z", "2026-11-02T14:00:00Z", "2026-11-02", "not a date"].map(at)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(["2026-11-02T15:00:00Z", "2026-11-03"].map(at)).toEqual([false, false]);
    const day = countsFor("2026-11-02");
    expect(["2026-11-02T23:59:00Z", "2026-11-01", "2026-11-03T00:00:00Z"].map(day)).toEqual([
      true,
      true,
      false,
    ]);
  });
});
