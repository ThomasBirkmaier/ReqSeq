import { describe, expect, it } from "vitest";
import { clickOffset, titleHeading } from "./title-box.js";

describe("the heading of the title (#621)", () => {
  it("shows the title, and the ID muted for a title that is empty or blank", () => {
    expect(titleHeading("Measure wind", "SR-1")).toEqual({ text: "Measure wind", untitled: false });
    expect(titleHeading("", "SR-1")).toEqual({ text: "SR-1", untitled: true });
    expect(titleHeading("  ", "SR-1")).toEqual({ text: "SR-1", untitled: true });
  });

  it("puts the caret where the click hit the title, within it, else at the end", () => {
    const shown = titleHeading("Measure wind", "SR-1");
    expect(clickOffset(shown, "Measure wind", 4)).toBe(4);
    expect(clickOffset(shown, "Measure wind", 40)).toBe(12);
    expect(clickOffset(shown, "Measure wind", -1)).toBe(0);
    expect(clickOffset(shown, "Measure wind", undefined)).toBe("end");
    expect(clickOffset(titleHeading("", "SR-1"), "", 2)).toBe("end");
  });
});
